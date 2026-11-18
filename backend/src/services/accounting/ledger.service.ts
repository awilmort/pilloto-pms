import { Types } from 'mongoose';
import JournalEntry, { IJournalEntry, JournalEntrySource, JournalEntrySourceModel } from '../../models/JournalEntry';
import Account from '../../models/Account';
import { nextSequence } from '../../models/Counter';
import { SYSTEM_ACCOUNT_CODES } from '../../constants/accounting';
import { seedDefaultChartOfAccounts } from '../../utils/seedChartOfAccounts';

/**
 * The single write path onto the general ledger (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md
 * Phase 3.2, PILLOTO_ACCOUNTING_ARCHITECTURE.md §5.2). Every later auto-posting hook
 * (Phase 7's Invoice/Bill/PMS events) and the manual journal entry endpoint (Phase 9.1)
 * call this instead of constructing JournalEntry docs themselves, so numbering and
 * balance validation live in exactly one place.
 */

export interface PostJournalEntryLine {
  account: Types.ObjectId | string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface JournalEntrySourceRef {
  model: JournalEntrySourceModel;
  id: Types.ObjectId | string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Blocks posting to a "control"/summary account — one that has its own child
 * accounts and exists only to roll up their balances (e.g. "6000 Gastos
 * Operativos" parenting 6010-6090). Enterprise chart-of-accounts tools distinguish "Cuenta de
 * Control" (rollup, not postable) from "Cuenta de Movimiento" (leaf, postable) —
 * this codebase had `parentAccount` for the rollup hierarchy but nothing stopping
 * a manual entry from posting directly to the parent, which would double-count
 * against its children's totals in any rollup report. A control account is
 * derived (has children) rather than a stored flag, so it can never drift out of
 * sync as accounts are added/reparented.
 */
async function assertLinesTargetMovementAccounts(lines: PostJournalEntryLine[]): Promise<void> {
  const accountIds = Array.from(new Set(lines.map((l) => String(l.account))));
  const controlAccounts = await Account.find({ parentAccount: { $in: accountIds } })
    .distinct('parentAccount');
  if (controlAccounts.length === 0) return;

  const controlIds = new Set(controlAccounts.map((id) => String(id)));
  const offendingIds = accountIds.filter((id) => controlIds.has(id));
  if (offendingIds.length === 0) return;

  const offending = await Account.find({ _id: { $in: offendingIds } }).select('code name').lean();
  const names = offending.map((a) => `${a.code} ${a.name}`).join(', ');
  throw new Error(
    `Cannot post to control account(s) ${names} — they only summarize their sub-accounts' balances. Post to a sub-account instead.`
  );
}

export async function postJournalEntry(
  lines: PostJournalEntryLine[],
  source: JournalEntrySource,
  sourceRef: JournalEntrySourceRef | undefined,
  memo: string,
  userId: Types.ObjectId | string,
  date: Date = new Date()
): Promise<IJournalEntry> {
  await assertLinesTargetMovementAccounts(lines);

  const entryNumber = `JE-${String(await nextSequence('journalEntryNumber')).padStart(6, '0')}`;

  const entry = new JournalEntry({
    entryNumber,
    date,
    memo,
    source,
    sourceModel: sourceRef?.model,
    sourceId: sourceRef?.id,
    lines: lines.map((line) => ({
      account: line.account,
      debit: round2(line.debit || 0),
      credit: round2(line.credit || 0),
      memo: line.memo,
    })),
    createdBy: userId,
  });

  // JournalEntry's own pre-validate hooks enforce >=2 lines, exactly-one-of-debit/credit
  // per line, and sum(debit) === sum(credit) — this call is where those errors surface.
  await entry.save();
  return entry;
}

/**
 * Resolves well-known Chart-of-Accounts codes (`SYSTEM_ACCOUNT_CODES`) to this tenant's
 * actual `Account` `_id`s, for every auto-posting hook from Phase 7 onward — never a
 * hardcoded ObjectId, per the implementation plan. Throws loudly (a clear, named-code
 * error, not a generic 500) when the Chart of Accounts hasn't been seeded for this
 * tenant, surfacing that Phase 3.1's provisioning step must run first.
 */
export async function getSystemAccountIds(codes: string[]): Promise<Record<string, Types.ObjectId>> {
  const uniqueCodes = Array.from(new Set(codes));
  const load = async () => {
    const accounts = await Account.find({ code: { $in: uniqueCodes } }).select('code').lean();
    const found: Record<string, Types.ObjectId> = {};
    for (const acc of accounts) found[acc.code] = acc._id as Types.ObjectId;
    return found;
  };
  let map = await load();
  // A system account added to the default chart after this tenant was provisioned (e.g. the 606
  // retention accounts) is created on first use; the seed is idempotent.
  if (uniqueCodes.some((code) => !map[code]) && (await Account.exists({}))) {
    await seedDefaultChartOfAccounts();
    map = await load();
  }

  const missing = uniqueCodes.filter((code) => !map[code]);
  if (missing.length > 0) {
    throw new Error(
      `Chart of Accounts is missing required system account(s): ${missing.join(', ')} — run Accounting provisioning (Phase 3.1 seed) for this tenant first.`
    );
  }
  return map;
}

/**
 * Reverses every still-active JournalEntry posted under `(sourceModel, sourceId,
 * originalSource)` with a flipped-lines entry under `reversalSource`, then marks each
 * original entry `isVoid` (immutable `lines` stay untouched — only the exempted
 * isVoid/voidedAt/voidReason fields are set, per JournalEntry's own pre-save guard).
 * Shared by Invoice.void/Bill.void (Phase 7.1) and reusable by every later void action
 * (CreditNote in Phase 8, manual entries in Phase 9, PMS payment reversal in Phase 7.2).
 */
export async function reversePostedEntries(
  sourceModel: JournalEntrySourceModel,
  sourceId: Types.ObjectId | string,
  originalSource: JournalEntrySource,
  reversalSource: JournalEntrySource,
  memo: string,
  userId: Types.ObjectId | string
): Promise<IJournalEntry[]> {
  const entries = await JournalEntry.find({ sourceModel, sourceId, source: originalSource, isVoid: false });

  const reversals: IJournalEntry[] = [];
  for (const entry of entries) {
    const reversal = await postJournalEntry(
      entry.lines.map((line) => ({ account: line.account, debit: line.credit, credit: line.debit, memo: line.memo })),
      reversalSource,
      { model: sourceModel, id: sourceId },
      memo,
      userId
    );
    reversals.push(reversal);

    entry.isVoid = true;
    entry.voidedAt = new Date();
    entry.voidReason = memo;
    await entry.save();
  }
  return reversals;
}

// ─── Foreign currency ────────────────────────────────────────────────────────

/**
 * A balanced entry in a document's currency, converted to DOP (the books' currency) at `rate`.
 * Each amount is rounded to the centavo; the rounding difference goes to line `plug` (the
 * receivable/payable) so the entry stays balanced. Rate 1 returns the lines unchanged.
 */
export function inFunctional(lines: PostJournalEntryLine[], rate: number, plug = 0): PostJournalEntryLine[] {
  if (!rate || rate === 1) return lines;
  const out = lines.map((l) => ({ ...l, debit: round2((l.debit || 0) * rate), credit: round2((l.credit || 0) * rate) }));
  const diff = round2(out.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0));
  if (diff !== 0) {
    const p = out[plug];
    if ((p.debit || 0) > 0) p.debit = round2((p.debit || 0) - diff);
    else p.credit = round2((p.credit || 0) + diff);
  }
  return out;
}

export interface SettlementInput {
  /** Document currency amount paid or received. */
  amount: number;
  /** The document's own rate (what the receivable/payable was booked at). */
  documentRate: number;
  /** The rate on the payment day. */
  paymentRate: number;
  /** `in`: money received (Dr cash / Cr receivable); `out`: money paid (Dr payable or receivable / Cr cash). */
  direction: 'in' | 'out';
  cashAccount: Types.ObjectId | string;
  /** Receivable (in) or payable / receivable being refunded (out). */
  controlAccount: Types.ObjectId | string;
}

/**
 * The entry of a payment, in DOP: the cash side at the payment's rate, the receivable/payable at
 * the document's, and the difference as a realised exchange gain (4300) or loss (6080).
 */
export async function settlementLines(input: SettlementInput): Promise<PostJournalEntryLine[]> {
  const cash = round2(input.amount * (input.paymentRate || 1));
  const control = round2(input.amount * (input.documentRate || 1));
  const lines: PostJournalEntryLine[] =
    input.direction === 'in'
      ? [{ account: input.cashAccount, debit: cash }, { account: input.controlAccount, credit: control }]
      : [{ account: input.controlAccount, debit: control }, { account: input.cashAccount, credit: cash }];
  // Money in worth more than booked, or money out worth less, is a gain.
  const gain = round2(input.direction === 'in' ? cash - control : control - cash);
  if (gain !== 0) {
    const ids = await getSystemAccountIds([SYSTEM_ACCOUNT_CODES.FX_GAIN, SYSTEM_ACCOUNT_CODES.FX_LOSS]);
    lines.push(gain > 0 ? { account: ids[SYSTEM_ACCOUNT_CODES.FX_GAIN], credit: gain } : { account: ids[SYSTEM_ACCOUNT_CODES.FX_LOSS], debit: -gain });
  }
  return lines;
}
