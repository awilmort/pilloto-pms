/**
 * Bank accounts and reconciliation (PLANS_AND_SUBSCRIPTIONS_PLAN.md phase 3).
 *
 *  - Where a payment lands: cash goes to Caja (1000); anything else to the bank account chosen, or
 *    the default one (the seeded "Bancos", 1010, until another is made default).
 *  - A bank account's movements are its GL account's journal lines; its statement lines (imported
 *    or typed) are matched to them, or turned into an entry (a fee, interest), or ignored.
 *  - A reconciliation to a statement date closes when beginning balance + the statement lines up to
 *    that date equals the statement's ending balance, and every line up to then is matched or ignored.
 */
import { Types } from 'mongoose';
import Account from '../../models/Account';
import BankAccount, { IBankAccount } from '../../models/BankAccount';
import BankReconciliation, { IBankReconciliation } from '../../models/BankReconciliation';
import BankStatementLine, { IBankStatementLine } from '../../models/BankStatementLine';
import JournalEntry from '../../models/JournalEntry';
import { NORMAL_BALANCE_BY_ACCOUNT_TYPE, SYSTEM_ACCOUNT_CODES } from '../../constants/accounting';
import { getSystemAccountIds, postJournalEntry } from './ledger.service';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

// ─── Accounts ────────────────────────────────────────────────────────────────

/** The default bank account, created on the seeded "Bancos" (1010) the first time it is needed. */
export async function ensureDefaultBankAccount(): Promise<IBankAccount> {
  const existing = await BankAccount.findOne({ isDefault: true, isActive: true });
  if (existing) return existing;
  const any = await BankAccount.findOne({ isActive: true }).sort({ createdAt: 1 });
  if (any) {
    any.isDefault = true;
    await any.save();
    return any;
  }
  const ids = await getSystemAccountIds([SYSTEM_ACCOUNT_CODES.BANK]);
  try {
    return await BankAccount.create({ name: 'Cuenta principal', glAccount: ids[SYSTEM_ACCOUNT_CODES.BANK], isDefault: true });
  } catch (err: any) {
    if (err?.code === 11000) return (await BankAccount.findOne({ glAccount: ids[SYSTEM_ACCOUNT_CODES.BANK] }))!;
    throw err;
  }
}

/** Throws 400 unless `id` is an active bank account. */
export async function assertBankAccount(id: unknown): Promise<IBankAccount> {
  if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) throw fail(400, 'Invalid bank account');
  const bank = await BankAccount.findOne({ _id: id, isActive: true });
  if (!bank) throw fail(400, 'Invalid bank account');
  return bank;
}

/** The GL account a payment by `method` settles against: Caja for cash, else the chosen or default bank. */
export async function settlementAccountId(method: string, bankAccountId?: unknown): Promise<Types.ObjectId> {
  if (method === 'cash') return (await getSystemAccountIds([SYSTEM_ACCOUNT_CODES.CASH]))[SYSTEM_ACCOUNT_CODES.CASH];
  if (bankAccountId) return (await assertBankAccount(bankAccountId)).glAccount;
  return (await ensureDefaultBankAccount()).glAccount;
}

/** The next free code for a bank sub-account: 1011, 1012… (1010 is the default "Bancos"). */
async function nextBankCode(): Promise<string> {
  const used = new Set((await Account.find({ code: { $regex: /^10[1-9]\d$/ } }).select('code').lean()).map((a) => a.code));
  for (let n = 1011; n <= 1099; n++) if (!used.has(String(n))) return String(n);
  throw fail(409, 'No free account code for another bank (1011–1099 are used)');
}

export interface BankAccountInput {
  name: string;
  bankName?: string;
  accountNumberLast4?: string;
  currency?: 'DOP' | 'USD' | 'EUR';
  isDefault?: boolean;
}

/** A new bank account with its own GL asset account. */
export async function createBankAccount(input: BankAccountInput): Promise<IBankAccount> {
  const name = (input.name ?? '').trim();
  if (!name) throw fail(400, 'name is required');
  await ensureDefaultBankAccount();
  const account = await Account.create({
    code: await nextBankCode(),
    name: `Banco — ${name}`.slice(0, 150),
    type: 'asset',
    normalBalance: NORMAL_BALANCE_BY_ACCOUNT_TYPE.asset,
    isSystem: false,
    isActive: true,
  });
  if (input.isDefault) await BankAccount.updateMany({ isDefault: true }, { $set: { isDefault: false } });
  return BankAccount.create({
    name, bankName: input.bankName, accountNumberLast4: input.accountNumberLast4 || undefined, currency: input.currency ?? 'DOP',
    glAccount: account._id, isDefault: !!input.isDefault,
  });
}

/** GL balance of an account (debits − credits), optionally up to `asOf` (inclusive day). */
export async function glBalance(glAccount: Types.ObjectId, asOf?: string): Promise<number> {
  const match: Record<string, unknown> = { 'lines.account': glAccount };
  if (asOf) match.date = { $lt: new Date(`${asOf}T23:59:59.999Z`) };
  // find() goes through the tenant plugin (aggregations would not be scoped).
  const entries = await JournalEntry.find(match).select('lines').lean();
  let sum = 0;
  for (const e of entries) for (const l of e.lines) if (String(l.account) === String(glAccount)) sum += (l.debit || 0) - (l.credit || 0);
  return r2(sum);
}

// ─── Candidates and matching ─────────────────────────────────────────────────

/** Entries that are not real movements: voided ones and the reversals that cancel them. */
const REVERSAL_SOURCES = ['invoice_void', 'bill_void', 'credit_note_void', 'debit_note_void', 'pms_payment_reversed'];

export interface BookLine {
  entry: string;
  entryNumber: string;
  line: string;
  date: string;
  memo: string;
  /** + money in (debit to the bank), − money out (credit). */
  amount: number;
  cleared: boolean;
}

/** The bank GL account's journal lines in a window, each with whether a statement line already matched it. */
export async function bookLines(bank: IBankAccount, options: { from?: string; to?: string; unclearedOnly?: boolean } = {}): Promise<BookLine[]> {
  const filter: Record<string, unknown> = { 'lines.account': bank.glAccount, isVoid: { $ne: true }, source: { $nin: REVERSAL_SOURCES } };
  if (options.from || options.to) {
    filter.date = {
      ...(options.from ? { $gte: new Date(`${options.from}T00:00:00.000Z`) } : {}),
      ...(options.to ? { $lte: new Date(`${options.to}T23:59:59.999Z`) } : {}),
    };
  }
  const entries = await JournalEntry.find(filter).sort({ date: 1, entryNumber: 1 }).lean();
  // Manual reversals reference the entry they cancel; neither is a movement.
  const reversed = new Set(entries.filter((e) => e.source === 'manual' && e.sourceModel === 'JournalEntry').map((e) => String(e.sourceId)));
  const clearedIds = new Set(
    (await BankStatementLine.find({ bankAccount: bank._id, status: 'matched' }).select('matches.line').lean()).flatMap((s) => s.matches.map((m) => String(m.line))),
  );
  const out: BookLine[] = [];
  for (const e of entries) {
    if (reversed.has(String(e._id)) || (e.source === 'manual' && e.sourceModel === 'JournalEntry')) continue;
    for (const l of e.lines) {
      if (String(l.account) !== String(bank.glAccount)) continue;
      const cleared = clearedIds.has(String(l._id));
      if (options.unclearedOnly && cleared) continue;
      out.push({
        entry: String(e._id), entryNumber: e.entryNumber, line: String(l._id), date: e.date.toISOString().slice(0, 10),
        memo: l.memo || e.memo, amount: r2((l.debit || 0) - (l.credit || 0)), cleared,
      });
    }
  }
  return out;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** For each unmatched statement line, uncleared book lines of the same amount within `days` days, closest first. */
export function suggestMatches(statement: Pick<IBankStatementLine, 'amount' | 'date'>[], book: BookLine[], days = 7): BookLine[][] {
  const pool = book.filter((b) => !b.cleared);
  return statement.map((s) =>
    pool
      .filter((b) => Math.abs(b.amount - s.amount) < 0.005 && dayDiff(b.date, s.date) <= days)
      .sort((x, y) => dayDiff(x.date, s.date) - dayDiff(y.date, s.date)),
  );
}

async function statementLineOf(bank: IBankAccount, id: string): Promise<IBankStatementLine> {
  if (!Types.ObjectId.isValid(id)) throw fail(404, 'Statement line not found');
  const line = await BankStatementLine.findOne({ _id: id, bankAccount: bank._id });
  if (!line) throw fail(404, 'Statement line not found');
  if (line.reconciliation) throw fail(409, 'This line belongs to a closed reconciliation', 'BANK_LOCKED');
  return line;
}

/** Matches a statement line to one or more uncleared book lines whose amounts add up to it. */
export async function matchLine(bank: IBankAccount, statementLineId: string, lineIds: string[]): Promise<IBankStatementLine> {
  const st = await statementLineOf(bank, statementLineId);
  if (!Array.isArray(lineIds) || lineIds.length === 0) throw fail(400, 'Choose at least one movement');
  const book = await bookLines(bank);
  const chosen = lineIds.map((id) => book.find((b) => b.line === id));
  if (chosen.some((b) => !b)) throw fail(400, 'A chosen movement is not on this bank account');
  if (chosen.some((b) => b!.cleared)) throw fail(409, 'A chosen movement is already matched', 'BANK_ALREADY_MATCHED');
  const sum = r2(chosen.reduce((s, b) => s + b!.amount, 0));
  if (Math.abs(sum - st.amount) >= 0.005) throw fail(400, `The movements add up to ${sum.toFixed(2)}, not ${st.amount.toFixed(2)}`, 'BANK_AMOUNT_MISMATCH');
  st.matches = chosen.map((b) => ({ entry: new Types.ObjectId(b!.entry), line: new Types.ObjectId(b!.line), amount: b!.amount })) as any;
  st.status = 'matched';
  await st.save();
  return st;
}

export async function unmatchLine(bank: IBankAccount, statementLineId: string): Promise<IBankStatementLine> {
  const st = await statementLineOf(bank, statementLineId);
  st.matches = [] as any;
  st.status = 'unmatched';
  await st.save();
  return st;
}

export async function ignoreLine(bank: IBankAccount, statementLineId: string, ignore = true): Promise<IBankStatementLine> {
  const st = await statementLineOf(bank, statementLineId);
  if (st.status === 'matched') throw fail(409, 'Unmatch it first');
  st.status = ignore ? 'ignored' : 'unmatched';
  await st.save();
  return st;
}

/**
 * Posts the entry a statement line is missing (bank fee, interest, a transfer between accounts)
 * against `counterAccountId` and matches the line to it.
 */
export async function createEntryForLine(bank: IBankAccount, statementLineId: string, counterAccountId: string, memo: string | undefined, userId: unknown): Promise<IBankStatementLine> {
  const st = await statementLineOf(bank, statementLineId);
  if (st.status !== 'unmatched') throw fail(409, 'This line is already matched or ignored');
  if (!Types.ObjectId.isValid(counterAccountId)) throw fail(400, 'Choose an account');
  const counter = await Account.findOne({ _id: counterAccountId, isActive: true });
  if (!counter) throw fail(400, 'Choose an account');
  if (String(counter._id) === String(bank.glAccount)) throw fail(400, 'Choose a different account than the bank itself');
  const amount = Math.abs(st.amount);
  const into = st.amount > 0;
  const entry = await postJournalEntry(
    [
      { account: bank.glAccount, ...(into ? { debit: amount } : { credit: amount }), memo: st.description },
      { account: counter._id as Types.ObjectId, ...(into ? { credit: amount } : { debit: amount }), memo: st.description },
    ],
    'bank_entry',
    { model: 'BankStatementLine', id: st._id as Types.ObjectId },
    (memo?.trim() || st.description).slice(0, 500),
    userId as any,
    new Date(`${st.date}T12:00:00.000Z`),
  );
  const bankLine = entry.lines.find((l) => String(l.account) === String(bank.glAccount))!;
  st.matches = [{ entry: entry._id, line: bankLine._id, amount: st.amount }] as any;
  st.status = 'matched';
  await st.save();
  return st;
}

// ─── Statement lines ─────────────────────────────────────────────────────────

export interface StatementRowInput { date: string; description: string; amount: number; reference?: string }

const fingerprintOf = (r: StatementRowInput) => [r.date, r.amount.toFixed(2), (r.reference ?? '').trim(), r.description.trim().toLowerCase()].join('|');

/** Adds statement lines (an import or a manual one). Rows already present are skipped. */
export async function addStatementLines(bank: IBankAccount, rows: StatementRowInput[], source: 'import' | 'manual', userId: unknown): Promise<{ added: number; duplicates: number; invalid: number }> {
  if (!Array.isArray(rows) || rows.length === 0) throw fail(400, 'No rows to add');
  if (rows.length > 5000) throw fail(400, 'At most 5,000 rows at a time');
  let added = 0, duplicates = 0, invalid = 0;
  const seen = new Set<string>();
  for (const raw of rows) {
    const row: StatementRowInput = {
      date: String(raw?.date ?? '').slice(0, 10),
      description: String(raw?.description ?? '').trim().slice(0, 300),
      amount: r2(Number(raw?.amount)),
      reference: raw?.reference ? String(raw.reference).trim().slice(0, 100) : undefined,
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(row.amount) || row.amount === 0 || !row.description) { invalid++; continue; }
    const fingerprint = fingerprintOf(row);
    if (seen.has(fingerprint) || (await BankStatementLine.exists({ bankAccount: bank._id, fingerprint }))) { duplicates++; continue; }
    seen.add(fingerprint);
    await BankStatementLine.create({ bankAccount: bank._id, ...row, source, fingerprint, createdBy: userId });
    added++;
  }
  return { added, duplicates, invalid };
}

export async function deleteStatementLine(bank: IBankAccount, id: string): Promise<void> {
  // An entry created from this line stays (it is a real posting); only the statement line goes.
  const st = await statementLineOf(bank, id);
  await BankStatementLine.deleteOne({ _id: st._id });
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

export interface ReconciliationView {
  reconciliation: IBankReconciliation;
  beginningBalance: number;
  statementTotal: number;
  clearedBalance: number;
  difference: number;
  pendingLines: number;
  bookBalance: number;
  canClose: boolean;
}

async function lastClosed(bank: IBankAccount) {
  return BankReconciliation.findOne({ bankAccount: bank._id, status: 'closed' }).sort({ statementDate: -1 });
}

export async function viewReconciliation(bank: IBankAccount, rec: IBankReconciliation): Promise<ReconciliationView> {
  const lines = await BankStatementLine.find({ bankAccount: bank._id, date: { $lte: rec.statementDate }, ...(rec.status === 'closed' ? { reconciliation: rec._id } : { reconciliation: { $exists: false } }) }).lean();
  const counted = lines.filter((l) => l.status !== 'ignored');
  const statementTotal = r2(counted.reduce((s, l) => s + l.amount, 0));
  const clearedBalance = r2(rec.beginningBalance + statementTotal);
  const difference = r2(rec.statementEndingBalance - clearedBalance);
  const pendingLines = lines.filter((l) => l.status === 'unmatched').length;
  return {
    reconciliation: rec,
    beginningBalance: rec.beginningBalance,
    statementTotal,
    clearedBalance,
    difference,
    pendingLines,
    bookBalance: await glBalance(bank.glAccount, rec.statementDate),
    canClose: rec.status === 'open' && Math.abs(difference) < 0.005 && pendingLines === 0,
  };
}

/** Starts (or updates) the open reconciliation of a bank account. */
export async function startReconciliation(bank: IBankAccount, statementDate: string, statementEndingBalance: number, openingBalance?: number): Promise<IBankReconciliation> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statementDate)) throw fail(400, 'statementDate must be YYYY-MM-DD');
  if (!Number.isFinite(statementEndingBalance)) throw fail(400, 'statementEndingBalance is required');
  const previous = await lastClosed(bank);
  if (previous && statementDate <= previous.statementDate) throw fail(409, `The last reconciliation already covers up to ${previous.statementDate}`);
  const beginningBalance = previous ? previous.statementEndingBalance : r2(Number(openingBalance) || 0);
  const open = await BankReconciliation.findOne({ bankAccount: bank._id, status: 'open' });
  if (open) {
    open.statementDate = statementDate;
    open.statementEndingBalance = r2(statementEndingBalance);
    if (!previous && openingBalance !== undefined) open.beginningBalance = beginningBalance;
    await open.save();
    return open;
  }
  return BankReconciliation.create({ bankAccount: bank._id, statementDate, statementEndingBalance: r2(statementEndingBalance), beginningBalance });
}

export async function closeReconciliation(bank: IBankAccount, recId: string, userId: unknown): Promise<ReconciliationView> {
  const rec = Types.ObjectId.isValid(recId) ? await BankReconciliation.findOne({ _id: recId, bankAccount: bank._id }) : null;
  if (!rec) throw fail(404, 'Reconciliation not found');
  if (rec.status === 'closed') throw fail(409, 'Already closed');
  const view = await viewReconciliation(bank, rec);
  if (view.pendingLines > 0) throw fail(409, `${view.pendingLines} statement line(s) are not matched or ignored yet`, 'BANK_PENDING_LINES');
  if (Math.abs(view.difference) >= 0.005) throw fail(409, `There is a difference of ${view.difference.toFixed(2)}`, 'BANK_DIFFERENCE');
  await BankStatementLine.updateMany({ bankAccount: bank._id, date: { $lte: rec.statementDate }, reconciliation: { $exists: false } }, { $set: { reconciliation: rec._id } });
  rec.status = 'closed';
  rec.closedAt = new Date();
  rec.closedBy = userId as any;
  await rec.save();
  return viewReconciliation(bank, rec);
}
