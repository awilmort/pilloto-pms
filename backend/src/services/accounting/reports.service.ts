import { Types } from 'mongoose';
import JournalEntry from '../../models/JournalEntry';
import Account, { IAccount } from '../../models/Account';
import Bill from '../../models/Bill';
import Invoice from '../../models/Invoice';
import Supplier from '../../models/Supplier';
import Customer from '../../models/Customer';

/**
 * Financial reports (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 9.2,
 * PILLOTO_ACCOUNTING_ARCHITECTURE.md §5.6). Every report here is computed live
 * from `JournalEntry`/`Invoice`/`Bill` on each request — no cached/materialized
 * report tables, per the plan's explicit "Done when" wording. Kept as a
 * separate service (not folded into `ledger.service.ts`) since these are pure
 * *readers* of the ledger `ledger.service.ts` writes, never callers of
 * `postJournalEntry` themselves.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);

interface AccountRef {
  _id: Types.ObjectId;
  code: string;
  name: string;
  type: IAccount['type'];
  normalBalance: IAccount['normalBalance'];
}

const toAccountRef = (acc: IAccount): AccountRef => ({
  _id: acc._id as Types.ObjectId,
  code: acc.code,
  name: acc.name,
  type: acc.type,
  normalBalance: acc.normalBalance,
});

/**
 * Sums every `JournalEntry` line's debit/credit per account, for whatever
 * `date` filter the caller passes — the one aggregation every report below is
 * built from, so numbering/rounding stays in one place.
 *
 * Deliberately does NOT filter `isVoid: false`. `reversePostedEntries`
 * (`ledger.service.ts`) voids an entry by marking it `isVoid: true` *and*
 * posting a separate, exactly-flipped reversal entry (`isVoid: false`) per
 * account — an immutable-audit-trail design (see `JournalEntry.ts`'s own
 * header comment), not a "hide it" design. Excluding the original while
 * counting the reversal would double-apply the reversal instead of
 * cancelling it: original+reversal, both counted, sums to exactly zero per
 * account (the reversal is the original's exact negation by construction);
 * original excluded + reversal counted sums to the *negative* of the
 * original instead. Found and fixed during Phase 7.2's live verification —
 * see the accounting-implementation-progress memory for the worked example.
 */
async function accountTotalsMap(dateFilter: Record<string, Date>): Promise<Map<string, { debit: number; credit: number }>> {
  const rows = await JournalEntry.aggregate([
    { $match: { date: dateFilter } },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  const map = new Map<string, { debit: number; credit: number }>();
  for (const r of rows) map.set(String(r._id), { debit: round2(r.debit), credit: round2(r.credit) });
  return map;
}

// ── Trial Balance ────────────────────────────────────────────────────────

export async function getTrialBalance(asOf: Date) {
  const totals = await accountTotalsMap({ $lte: endOfDay(asOf) });
  const accounts = await Account.find({}).sort({ code: 1 }).lean<IAccount[]>();

  const rows: { account: AccountRef; debit: number; credit: number }[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const acc of accounts) {
    const t = totals.get(String(acc._id)) || { debit: 0, credit: 0 };
    const net = round2(t.debit - t.credit);
    if (Math.abs(net) < 0.005) continue;
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? round2(-net) : 0;
    rows.push({ account: toAccountRef(acc), debit, credit });
    totalDebit += debit;
    totalCredit += credit;
  }

  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);
  return { asOf, rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

// ── Profit & Loss ────────────────────────────────────────────────────────

export async function getProfitAndLoss(from: Date, to: Date) {
  const totals = await accountTotalsMap({ $gte: startOfDay(from), $lte: endOfDay(to) });
  const accounts = await Account.find({ type: { $in: ['revenue', 'expense'] } }).sort({ code: 1 }).lean<IAccount[]>();

  const revenue: { account: AccountRef; amount: number }[] = [];
  const expenses: { account: AccountRef; amount: number }[] = [];
  let totalRevenue = 0;
  let totalExpenses = 0;

  for (const acc of accounts) {
    const t = totals.get(String(acc._id)) || { debit: 0, credit: 0 };
    const net = round2(t.debit - t.credit);
    // Presented on the account's own normal-balance side, so a contra-revenue
    // account like 4100 (debit-heavy but typed 'revenue') nets negative here
    // and correctly reduces totalRevenue when summed — no special-casing.
    const amount = acc.normalBalance === 'debit' ? net : round2(-net);
    if (Math.abs(amount) < 0.005) continue;
    if (acc.type === 'revenue') { revenue.push({ account: toAccountRef(acc), amount }); totalRevenue += amount; }
    else { expenses.push({ account: toAccountRef(acc), amount }); totalExpenses += amount; }
  }

  totalRevenue = round2(totalRevenue);
  totalExpenses = round2(totalExpenses);
  return { from, to, revenue, totalRevenue, expenses, totalExpenses, netIncome: round2(totalRevenue - totalExpenses) };
}

// ── Balance Sheet ────────────────────────────────────────────────────────

export async function getBalanceSheet(asOf: Date) {
  const totals = await accountTotalsMap({ $lte: endOfDay(asOf) });
  const accounts = await Account.find({}).sort({ code: 1 }).lean<IAccount[]>();

  const byType: Record<IAccount['type'], { account: AccountRef; balance: number }[]> = {
    asset: [], liability: [], equity: [], revenue: [], expense: [],
  };
  const typeTotal: Record<IAccount['type'], number> = { asset: 0, liability: 0, equity: 0, revenue: 0, expense: 0 };

  for (const acc of accounts) {
    const t = totals.get(String(acc._id)) || { debit: 0, credit: 0 };
    const net = round2(t.debit - t.credit);
    const balance = acc.normalBalance === 'debit' ? net : round2(-net);
    if (Math.abs(balance) < 0.005) continue;
    byType[acc.type].push({ account: toAccountRef(acc), balance });
    typeTotal[acc.type] = round2(typeTotal[acc.type] + balance);
  }

  // No period-closing entries exist anywhere in this plan (Phase 9.1 manual
  // entries included) — revenue/expense never move into Retained Earnings on
  // their own. A live "as of" balance sheet therefore folds all-time net
  // income straight into the equity section, which is what keeps
  // Assets = Liabilities + Equity true at every instant: the fundamental
  // debit=credit identity of every posted JournalEntry guarantees
  // Assets - Liabilities - Equity - Revenue + Expense == 0 always, i.e.
  // Assets == Liabilities + Equity + (Revenue - Expense).
  const netIncomeToDate = round2(typeTotal.revenue - typeTotal.expense);
  const totalEquity = round2(typeTotal.equity + netIncomeToDate);
  const totalLiabilitiesAndEquity = round2(typeTotal.liability + totalEquity);

  return {
    asOf,
    assets: byType.asset,
    totalAssets: typeTotal.asset,
    liabilities: byType.liability,
    totalLiabilities: typeTotal.liability,
    equity: byType.equity,
    netIncomeToDate,
    totalEquity,
    totalLiabilitiesAndEquity,
    balanced: Math.abs(typeTotal.asset - totalLiabilitiesAndEquity) < 0.01,
  };
}

// ── AP / AR Aging ────────────────────────────────────────────────────────

export type AgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
const EMPTY_BUCKETS = (): Record<AgingBucketKey, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });

function bucketFor(daysPastDue: number): AgingBucketKey {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return 'd1_30';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  return 'd90_plus';
}

export async function getApAging(asOf: Date) {
  const bills = await Bill.find({ status: { $in: ['received', 'partial'] }, balanceDue: { $gt: 0.005 } })
    .populate('supplier', 'name')
    .lean();

  const bySupplier = new Map<string, { supplier: { _id: Types.ObjectId; name: string }; buckets: Record<AgingBucketKey, number>; total: number }>();
  const grandTotal = EMPTY_BUCKETS();

  for (const bill of bills) {
    const supplier = bill.supplier as unknown as { _id: Types.ObjectId; name: string } | null;
    const key = supplier ? String(supplier._id) : `unknown-${bill._id}`;
    if (!bySupplier.has(key)) {
      bySupplier.set(key, { supplier: supplier || { _id: bill._id as Types.ObjectId, name: '—' }, buckets: EMPTY_BUCKETS(), total: 0 });
    }
    const row = bySupplier.get(key)!;
    const daysPastDue = Math.floor((asOf.getTime() - new Date(bill.dueDate).getTime()) / 86400000);
    const bucket = bucketFor(daysPastDue);
    row.buckets[bucket] = round2(row.buckets[bucket] + bill.balanceDue);
    row.total = round2(row.total + bill.balanceDue);
    grandTotal[bucket] = round2(grandTotal[bucket] + bill.balanceDue);
  }

  const rows = Array.from(bySupplier.values()).sort((a, b) => b.total - a.total);
  const grandTotalSum = round2(Object.values(grandTotal).reduce((s, v) => s + v, 0));
  return { asOf, rows, grandTotal, grandTotalSum };
}

export async function getArAging(asOf: Date) {
  const invoices = await Invoice.find({ status: { $in: ['sent', 'partial'] }, balanceDue: { $gt: 0.005 } })
    .populate('customer', 'name razonSocial')
    .lean();

  const byCustomer = new Map<string, { customer: { _id: string; name: string }; buckets: Record<AgingBucketKey, number>; total: number }>();
  const grandTotal = EMPTY_BUCKETS();

  for (const invoice of invoices) {
    // Individual (non-Customer) customers have no stable identity across invoices —
    // grouped per-invoice rather than aggregated, and labeled from the snapshot.
    const customer = invoice.customer as unknown as { _id: Types.ObjectId; name: string; razonSocial?: string } | null;
    const key = customer ? String(customer._id) : `individual-${invoice._id}`;
    const label = customer ? (customer.razonSocial || customer.name) : (invoice.individualCustomer?.name || '—');
    if (!byCustomer.has(key)) {
      byCustomer.set(key, { customer: { _id: key, name: label }, buckets: EMPTY_BUCKETS(), total: 0 });
    }
    const row = byCustomer.get(key)!;
    // Invoice.dueDate is optional (§5.1) — fall back to issueDate so an invoice
    // with no explicit terms still ages from when it was sent, not never.
    const dueDate = invoice.dueDate || invoice.issueDate;
    const daysPastDue = Math.floor((asOf.getTime() - new Date(dueDate).getTime()) / 86400000);
    const bucket = bucketFor(daysPastDue);
    row.buckets[bucket] = round2(row.buckets[bucket] + invoice.balanceDue);
    row.total = round2(row.total + invoice.balanceDue);
    grandTotal[bucket] = round2(grandTotal[bucket] + invoice.balanceDue);
  }

  const rows = Array.from(byCustomer.values()).sort((a, b) => b.total - a.total);
  const grandTotalSum = round2(Object.values(grandTotal).reduce((s, v) => s + v, 0));
  return { asOf, rows, grandTotal, grandTotalSum };
}

// ── Supplier / Customer statements ──────────────────────────────────────

interface StatementTransaction {
  date: Date;
  type: 'bill' | 'invoice' | 'payment';
  reference: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

function buildStatement(
  events: { date: Date; type: 'bill' | 'invoice' | 'payment'; reference: string; debit: number; credit: number }[],
  from: Date | undefined,
  to: Date | undefined,
) {
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  let openingBalance = 0;
  const transactions: StatementTransaction[] = [];
  let running = 0;

  for (const e of events) {
    if (from && e.date < startOfDay(from)) {
      openingBalance = round2(openingBalance + e.debit - e.credit);
      continue;
    }
    if (to && e.date > endOfDay(to)) continue;
    running = round2((transactions.length === 0 ? openingBalance : running) + e.debit - e.credit);
    transactions.push({ ...e, runningBalance: running });
  }

  const closingBalance = transactions.length > 0 ? transactions[transactions.length - 1].runningBalance : openingBalance;
  return { openingBalance, transactions, closingBalance };
}

export async function getSupplierStatement(supplierId: string, from?: Date, to?: Date) {
  const supplier = await Supplier.findById(supplierId).lean();
  if (!supplier) return null;

  const bills = await Bill.find({ supplier: supplierId, status: { $in: ['received', 'partial', 'paid'] } }).sort({ issueDate: 1 }).lean();

  const events: { date: Date; type: 'bill' | 'payment'; reference: string; debit: number; credit: number }[] = [];
  for (const bill of bills) {
    events.push({ date: new Date(bill.issueDate), type: 'bill', reference: bill.billNumber, debit: bill.total, credit: 0 });
    for (const p of bill.payments) {
      events.push({ date: new Date(p.date), type: 'payment', reference: `${bill.billNumber} · ${p.method}`, debit: 0, credit: p.amount });
    }
  }

  const { openingBalance, transactions, closingBalance } = buildStatement(events, from, to);
  return {
    supplier: { _id: supplier._id, name: supplier.name, taxId: supplier.taxId },
    from, to, openingBalance, transactions, closingBalance,
  };
}

export async function getCustomerStatement(customerId: string, from?: Date, to?: Date) {
  const customer = await Customer.findById(customerId).lean();
  if (!customer) return null;

  const invoices = await Invoice.find({ customer: customerId, status: { $in: ['sent', 'partial', 'paid'] } }).sort({ issueDate: 1 }).lean();

  const events: { date: Date; type: 'invoice' | 'payment'; reference: string; debit: number; credit: number }[] = [];
  for (const invoice of invoices) {
    events.push({ date: new Date(invoice.issueDate), type: 'invoice', reference: invoice.invoiceNumber, debit: invoice.total, credit: 0 });
    for (const p of invoice.payments) {
      // 'credit-note' payments (applyCreditNote, Phase 8.1) land here exactly like
      // a cash payment — both reduce what the customer owes on this invoice.
      events.push({ date: new Date(p.date), type: 'payment', reference: `${invoice.invoiceNumber} · ${p.method}`, debit: 0, credit: p.amount });
    }
  }

  const { openingBalance, transactions, closingBalance } = buildStatement(events, from, to);
  return {
    customer: { _id: customer._id, name: (customer as { razonSocial?: string; name: string }).razonSocial || customer.name },
    from, to, openingBalance, transactions, closingBalance,
  };
}

// ── General Ledger (single account, transaction detail) ────────────────

export async function getGeneralLedger(accountId: string, from?: Date, to?: Date) {
  const account = await Account.findById(accountId).lean<IAccount>();
  if (!account) return null;

  const accountObjectId = new Types.ObjectId(accountId);
  // See `accountTotalsMap`'s comment above — no `isVoid: false` filter here either,
  // for the same reason (a voided entry's paired reversal is what cancels it out).
  const rows = await JournalEntry.aggregate([
    { $match: { date: to ? { $lte: endOfDay(to) } : { $lte: endOfDay(new Date()) } } },
    { $unwind: '$lines' },
    { $match: { 'lines.account': accountObjectId } },
    { $sort: { date: 1, entryNumber: 1 } },
    { $project: { entryNumber: 1, date: 1, memo: 1, source: 1, debit: '$lines.debit', credit: '$lines.credit', lineMemo: '$lines.memo' } },
  ]);

  // A debit-normal account's balance grows with debits; a credit-normal account's
  // balance grows with credits — same convention as the balance sheet/P&L above.
  const sign = account.normalBalance === 'debit' ? 1 : -1;

  let openingBalance = 0;
  const transactions: { entryNumber: string; date: Date; memo: string; source: string; debit: number; credit: number; runningBalance: number }[] = [];
  let running = 0;

  for (const r of rows) {
    const delta = sign * (r.debit - r.credit);
    if (from && new Date(r.date) < startOfDay(from)) {
      openingBalance = round2(openingBalance + delta);
      continue;
    }
    running = round2((transactions.length === 0 ? openingBalance : running) + delta);
    transactions.push({
      entryNumber: r.entryNumber, date: r.date, memo: r.lineMemo || r.memo, source: r.source,
      debit: round2(r.debit), credit: round2(r.credit), runningBalance: running,
    });
  }

  const closingBalance = transactions.length > 0 ? transactions[transactions.length - 1].runningBalance : openingBalance;
  return { account: toAccountRef(account), from, to, openingBalance, transactions, closingBalance };
}

export const dateHelpers = { startOfDay, endOfDay, startOfYear };
