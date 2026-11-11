import { Types } from 'mongoose';
import JournalEntry from '../../models/JournalEntry';
import Account, { IAccount } from '../../models/Account';
import Bill from '../../models/Bill';
import Invoice from '../../models/Invoice';
import Customer from '../../models/Customer';
import Supplier from '../../models/Supplier';
import Product from '../../models/Product';
import ElectronicInvoice from '../../models/ElectronicInvoice';
import { SYSTEM_ACCOUNT_CODES } from '../../constants/accounting';
import { EMPTY_BUCKETS, bucketFor } from './reports.service';

/**
 * The Accounting dashboard (`GET /api/accounting/dashboard`). One request returns every block;
 * each block is computed live from the ledger/documents, like the reports it summarizes, and is
 * only computed when the caller holds the permission behind it (`access`) — a block the user may
 * not see is `undefined`, never an empty shell. Numbers deliberately reuse the reports' rules
 * (P&L = revenue − expense accounts on their normal side; aging = `bucketFor` on due date) so a
 * dashboard figure always matches the report it links to.
 *
 * Pure helpers (`resolvePeriod`, `monthStarts`, `nextTaxDeadlines`, `computeDso`, `daysBetween`)
 * are exported for tests.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const DAY_MS = 86400000;

// ── Periods ──────────────────────────────────────────────────────────────

export type DashboardPeriod = 'month' | 'lastMonth' | 'quarter' | 'year';
export const DASHBOARD_PERIODS: DashboardPeriod[] = ['month', 'lastMonth', 'quarter', 'year'];

export interface ResolvedPeriod {
  key: DashboardPeriod;
  from: Date;
  to: Date;
  /** The comparison range: the same stretch of the preceding month / quarter / year. */
  prevFrom: Date;
  prevTo: Date;
}

/** Whole days elapsed between two instants, rounded down (negative when `b` is earlier). */
export const daysBetween = (a: Date, b: Date): number => Math.floor((a.getTime() - b.getTime()) / DAY_MS);

/**
 * `month`/`quarter`/`year` run from the start of the calendar unit up to `now` and compare with the
 * same number of elapsed days of the previous unit (so a half-finished month is never judged against
 * a full one); `lastMonth` is the complete previous month against the month before it.
 */
export function resolvePeriod(key: DashboardPeriod, now: Date): ResolvedPeriod {
  const y = now.getFullYear();
  const m = now.getMonth();
  const clampTo = (start: Date, daysIn: number, unitEnd: Date) => {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + daysIn - 1);
    return endOfDay(end > unitEnd ? unitEnd : end);
  };

  if (key === 'lastMonth') {
    const from = new Date(y, m - 1, 1);
    const to = endOfDay(new Date(y, m, 0));
    const prevFrom = new Date(y, m - 2, 1);
    return { key, from, to, prevFrom, prevTo: endOfDay(new Date(y, m - 1, 0)) };
  }

  let from: Date;
  let prevFrom: Date;
  let prevUnitEnd: Date;
  if (key === 'quarter') {
    const qStart = Math.floor(m / 3) * 3;
    from = new Date(y, qStart, 1);
    prevFrom = new Date(y, qStart - 3, 1);
    prevUnitEnd = new Date(y, qStart, 0);
  } else if (key === 'year') {
    from = new Date(y, 0, 1);
    prevFrom = new Date(y - 1, 0, 1);
    prevUnitEnd = new Date(y, 0, 0);
  } else {
    from = new Date(y, m, 1);
    prevFrom = new Date(y, m - 1, 1);
    prevUnitEnd = new Date(y, m, 0);
  }
  const elapsed = daysBetween(startOfDay(now), from) + 1;
  return { key, from, to: endOfDay(now), prevFrom, prevTo: clampTo(prevFrom, elapsed, prevUnitEnd) };
}

/** First day of each of the last `count` calendar months, oldest first, ending with `now`'s month. */
export function monthStarts(now: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1));
}

export const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ── DGII calendar ────────────────────────────────────────────────────────

export type TaxDeadlineKey = 'informativeReturns' | 'itbisReturn';

export interface TaxDeadline {
  key: TaxDeadlineKey;
  /** The day of the month the obligation falls on. */
  day: number;
  /** Next occurrence on or after today (calendar date; weekend/holiday shifts are not applied). */
  date: Date;
  daysLeft: number;
}

/**
 * Monthly DGII dates: the informative formats (606/607/608/609) are due by the 15th and the IT-1
 * (ITBIS return) by the 20th of the month after the period. Dates are plain calendar days.
 */
export function nextTaxDeadlines(now: Date): TaxDeadline[] {
  const today = startOfDay(now);
  const rules: { key: TaxDeadlineKey; day: number }[] = [
    { key: 'informativeReturns', day: 15 },
    { key: 'itbisReturn', day: 20 },
  ];
  return rules.map(({ key, day }) => {
    let date = new Date(today.getFullYear(), today.getMonth(), day);
    if (date < today) date = new Date(today.getFullYear(), today.getMonth() + 1, day);
    return { key, day, date, daysLeft: daysBetween(date, today) };
  });
}

/** Days Sales Outstanding: open receivables over the last 90 days' invoicing, scaled to 90 days. */
export function computeDso(openReceivables: number, invoiced90Days: number): number | null {
  if (invoiced90Days <= 0.005) return null;
  return Math.round((openReceivables / invoiced90Days) * 90);
}

// ── Ledger totals ────────────────────────────────────────────────────────

interface RangeSpec { key: string; from: Date; to: Date }
type AccountTotals = Map<string, { debit: number; credit: number }>;

/**
 * Per-account debit/credit totals for several date ranges in a single round trip. Void entries are
 * included on purpose, exactly as in `reports.service.ts` — the reversal entry cancels them.
 */
async function totalsByRange(ranges: RangeSpec[]): Promise<Map<string, AccountTotals>> {
  const facets: Record<string, any[]> = {};
  for (const r of ranges) {
    facets[r.key] = [
      { $match: { date: { $gte: r.from, $lte: r.to } } },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
    ];
  }
  const [result] = await JournalEntry.aggregate([{ $facet: facets }]);
  const out = new Map<string, AccountTotals>();
  for (const r of ranges) {
    const m: AccountTotals = new Map();
    for (const row of (result?.[r.key] ?? []) as { _id: Types.ObjectId; debit: number; credit: number }[]) {
      m.set(String(row._id), { debit: row.debit, credit: row.credit });
    }
    out.set(r.key, m);
  }
  return out;
}

/**
 * Money in / out of the cash and bank accounts per range. Netted entry by entry, so moving cash
 * to the bank (both sides inside the cash group) is neither an inflow nor an outflow.
 */
async function cashFlowByRange(ranges: RangeSpec[], cashIds: Types.ObjectId[]): Promise<Map<string, { inflow: number; outflow: number }>> {
  const out = new Map<string, { inflow: number; outflow: number }>();
  if (cashIds.length === 0) { ranges.forEach((r) => out.set(r.key, { inflow: 0, outflow: 0 })); return out; }
  const facets: Record<string, any[]> = {};
  for (const r of ranges) {
    facets[r.key] = [
      { $match: { date: { $gte: r.from, $lte: r.to }, 'lines.account': { $in: cashIds } } },
      {
        $project: {
          net: {
            $reduce: {
              input: { $filter: { input: '$lines', as: 'l', cond: { $in: ['$$l.account', cashIds] } } },
              initialValue: 0,
              in: { $add: ['$$value', { $subtract: ['$$this.debit', '$$this.credit'] }] },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          inflow: { $sum: { $cond: [{ $gt: ['$net', 0] }, '$net', 0] } },
          outflow: { $sum: { $cond: [{ $lt: ['$net', 0] }, { $multiply: ['$net', -1] }, 0] } },
        },
      },
    ];
  }
  const [result] = await JournalEntry.aggregate([{ $facet: facets }]);
  for (const r of ranges) {
    const row = result?.[r.key]?.[0];
    out.set(r.key, { inflow: round2(row?.inflow ?? 0), outflow: round2(row?.outflow ?? 0) });
  }
  return out;
}

const onNormalSide = (acc: Pick<IAccount, 'normalBalance'>, t?: { debit: number; credit: number }): number => {
  const net = (t?.debit ?? 0) - (t?.credit ?? 0);
  return round2(acc.normalBalance === 'debit' ? net : -net);
};

interface PnL { revenue: number; expenses: number; netIncome: number }

function profitAndLoss(accounts: IAccount[], totals: AccountTotals | undefined): PnL & { expenseRows: { account: IAccount; amount: number }[] } {
  let revenue = 0;
  let expenses = 0;
  const expenseRows: { account: IAccount; amount: number }[] = [];
  for (const acc of accounts) {
    if (acc.type !== 'revenue' && acc.type !== 'expense') continue;
    const amount = onNormalSide(acc, totals?.get(String(acc._id)));
    if (Math.abs(amount) < 0.005) continue;
    if (acc.type === 'revenue') revenue += amount;
    else { expenses += amount; expenseRows.push({ account: acc, amount }); }
  }
  revenue = round2(revenue);
  expenses = round2(expenses);
  return { revenue, expenses, netIncome: round2(revenue - expenses), expenseRows };
}

// ── Dashboard ────────────────────────────────────────────────────────────

export interface DashboardAccess {
  financial: boolean;
  receivables: boolean;
  payables: boolean;
  cityLedger: boolean;
  inventory: boolean;
  ecf: boolean;
}

const TREND_MONTHS = 6;
const LIST_SIZE = 5;
const DUE_SOON_DAYS = 7;

async function buildFinancial(now: Date, period: ResolvedPeriod) {
  const accounts = await Account.find({}).sort({ code: 1 }).lean<IAccount[]>();
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const cashAccounts = [SYSTEM_ACCOUNT_CODES.CASH, SYSTEM_ACCOUNT_CODES.BANK].map((c) => byCode.get(c)).filter(Boolean) as IAccount[];
  const cashIds = cashAccounts.map((a) => a._id as Types.ObjectId);

  const months = monthStarts(now, TREND_MONTHS);
  const monthRanges: RangeSpec[] = months.map((start) => ({
    key: `m:${monthKey(start)}`,
    from: start,
    to: endOfDay(new Date(start.getFullYear(), start.getMonth() + 1, 0)),
  })).map((r, i, all) => (i === all.length - 1 ? { ...r, to: endOfDay(now) } : r));
  const ranges: RangeSpec[] = [
    ...monthRanges,
    { key: 'period', from: period.from, to: period.to },
    { key: 'previous', from: period.prevFrom, to: period.prevTo },
    { key: 'allTime', from: new Date(0), to: endOfDay(now) },
  ];

  const [totals, flows, purchasesTax] = await Promise.all([
    totalsByRange(ranges),
    cashFlowByRange(monthRanges, cashIds),
    Bill.aggregate([
      { $match: { status: { $in: ['received', 'partial', 'paid'] }, issueDate: { $gte: period.from, $lte: period.to } } },
      { $group: { _id: null, tax: { $sum: '$taxAmount' } } },
    ]),
  ]);

  const current = profitAndLoss(accounts, totals.get('period'));
  const previous = profitAndLoss(accounts, totals.get('previous'));

  const allTime = totals.get('allTime');
  const cashBreakdown = cashAccounts.map((a) => ({ code: a.code, name: a.name, balance: onNormalSide(a, allTime?.get(String(a._id))) }));

  let closing = round2(cashBreakdown.reduce((s, a) => s + a.balance, 0));
  // Walk the months backwards from today's balance so each month carries its closing balance.
  const trend = monthRanges.map((r) => {
    const pl = profitAndLoss(accounts, totals.get(r.key));
    const flow = flows.get(r.key)!;
    return { month: r.key.slice(2), revenue: pl.revenue, expenses: pl.expenses, net: pl.netIncome, cashIn: flow.inflow, cashOut: flow.outflow, cashNet: round2(flow.inflow - flow.outflow), cashClosing: 0 };
  });
  for (let i = trend.length - 1; i >= 0; i--) {
    trend[i].cashClosing = closing;
    closing = round2(closing - trend[i].cashNet);
  }

  const salesTaxAccount = byCode.get(SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE);
  const itbisSales = salesTaxAccount ? onNormalSide(salesTaxAccount, totals.get('period')?.get(String(salesTaxAccount._id))) : 0;
  const itbisPurchases = round2(purchasesTax[0]?.tax ?? 0);

  return {
    cash: { total: round2(cashBreakdown.reduce((s, a) => s + a.balance, 0)), accounts: cashBreakdown },
    current: { revenue: current.revenue, expenses: current.expenses, netIncome: current.netIncome },
    previous: { revenue: previous.revenue, expenses: previous.expenses, netIncome: previous.netIncome },
    trend,
    topExpenses: current.expenseRows
      .filter((r) => r.amount > 0)
      // Parents like "6000 Gastos Operativos" only roll up their children — list the leaf accounts.
      .filter((r) => !accounts.some((a) => a.parentAccount && String(a.parentAccount) === String(r.account._id)))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, LIST_SIZE)
      .map((r) => ({ code: r.account.code, name: r.account.name, amount: r.amount })),
    itbis: { sales: itbisSales, purchases: itbisPurchases, net: round2(itbisSales - itbisPurchases) },
  };
}

async function buildReceivables(now: Date) {
  const today = startOfDay(now);
  const since = new Date(today.getTime() - 90 * DAY_MS);
  const [open, invoiced] = await Promise.all([
    Invoice.find({ status: { $in: ['sent', 'partial'] }, balanceDue: { $gt: 0.005 } }).populate('customer', 'name razonSocial').lean(),
    Invoice.aggregate([
      { $match: { status: { $in: ['sent', 'partial', 'paid'] }, issueDate: { $gte: since, $lte: endOfDay(now) } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
  ]);

  const buckets = EMPTY_BUCKETS();
  let total = 0;
  const rows = open.map((inv) => {
    const customer = inv.customer as unknown as { _id: Types.ObjectId; name: string; razonSocial?: string } | null;
    const due = new Date(inv.dueDate || inv.issueDate);
    const daysOverdue = daysBetween(now, due);
    buckets[bucketFor(daysOverdue)] = round2(buckets[bucketFor(daysOverdue)] + inv.balanceDue);
    total = round2(total + inv.balanceDue);
    return {
      _id: String(inv._id),
      invoiceNumber: inv.invoiceNumber,
      customerName: customer ? (customer.razonSocial || customer.name) : (inv.individualCustomer?.name || '—'),
      dueDate: due,
      daysOverdue,
      balanceDue: inv.balanceDue,
    };
  });
  const overdueRows = rows.filter((r) => r.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue || b.balanceDue - a.balanceDue);
  const overdue = round2(overdueRows.reduce((s, r) => s + r.balanceDue, 0));

  return {
    total,
    overdue,
    overdueCount: overdueRows.length,
    openCount: rows.length,
    dsoDays: computeDso(total, invoiced[0]?.total ?? 0),
    buckets,
    invoices: overdueRows.slice(0, LIST_SIZE),
  };
}

async function buildPayables(now: Date) {
  const open = await Bill.find({ status: { $in: ['received', 'partial'] }, balanceDue: { $gt: 0.005 } }).populate('supplier', 'name').lean();
  const buckets = EMPTY_BUCKETS();
  let total = 0;
  const rows = open.map((bill) => {
    const supplier = bill.supplier as unknown as { _id: Types.ObjectId; name: string } | null;
    const due = new Date(bill.dueDate);
    const daysOverdue = daysBetween(now, due);
    buckets[bucketFor(daysOverdue)] = round2(buckets[bucketFor(daysOverdue)] + bill.balanceDue);
    total = round2(total + bill.balanceDue);
    return {
      _id: String(bill._id),
      billNumber: bill.billNumber,
      supplierId: supplier ? String(supplier._id) : null,
      supplierName: supplier?.name || '—',
      dueDate: due,
      daysOverdue,
      balanceDue: bill.balanceDue,
    };
  });
  const overdueRows = rows.filter((r) => r.daysOverdue > 0);
  const dueSoonRows = rows.filter((r) => r.daysOverdue <= 0 && r.daysOverdue >= -DUE_SOON_DAYS);
  // Most urgent first: oldest overdue, then the nearest due dates.
  const attention = [...overdueRows, ...dueSoonRows].sort((a, b) => b.daysOverdue - a.daysOverdue);
  return {
    total,
    overdue: round2(overdueRows.reduce((s, r) => s + r.balanceDue, 0)),
    overdueCount: overdueRows.length,
    dueSoon: round2(dueSoonRows.reduce((s, r) => s + r.balanceDue, 0)),
    dueSoonCount: dueSoonRows.length,
    openCount: rows.length,
    buckets,
    bills: attention.slice(0, LIST_SIZE),
  };
}

async function buildEcf(now: Date) {
  const since = new Date(startOfDay(now).getTime() - 30 * DAY_MS);
  const rows = await ElectronicInvoice.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$estadoECF', count: { $sum: 1 } } },
  ]);
  const count = (...states: string[]) => rows.filter((r) => states.includes(r._id)).reduce((s, r) => s + r.count, 0);
  const summary = {
    accepted: count('Aceptado', 'Aceptado Condicional'),
    inProcess: count('En Proceso', 'Pendiente'),
    contingency: count('Emitido Contingencia'),
    rejected: count('Rechazado', 'Error'),
    total: rows.reduce((s, r) => s + r.count, 0),
    windowDays: 30,
  };
  return summary;
}

async function buildRecentPayments(includeInvoices: boolean, includeBills: boolean) {
  const limit = 6;
  const [received, paid] = await Promise.all([
    includeInvoices
      ? Invoice.aggregate([
        { $match: { 'payments.0': { $exists: true } } },
        { $unwind: '$payments' },
        { $sort: { 'payments.date': -1 } },
        { $limit: limit },
        { $project: { number: '$invoiceNumber', customer: 1, individualCustomer: 1, amount: '$payments.amount', date: '$payments.date', reference: '$payments.reference', method: '$payments.method' } },
      ])
      : [],
    includeBills
      ? Bill.aggregate([
        { $match: { 'payments.0': { $exists: true } } },
        { $unwind: '$payments' },
        { $sort: { 'payments.date': -1 } },
        { $limit: limit },
        { $project: { number: '$billNumber', supplier: 1, amount: '$payments.amount', date: '$payments.date', reference: '$payments.reference', method: '$payments.method' } },
      ])
      : [],
  ]);

  const customerIds = received.map((r: any) => r.customer).filter(Boolean);
  const supplierIds = paid.map((r: any) => r.supplier).filter(Boolean);
  const [customers, suppliers] = await Promise.all([
    customerIds.length ? Customer.find({ _id: { $in: customerIds } }).select('name razonSocial').lean() : [],
    supplierIds.length ? Supplier.find({ _id: { $in: supplierIds } }).select('name').lean() : [],
  ]);
  const customerName = new Map<string, string>((customers as any[]).map((c) => [String(c._id), c.razonSocial || c.name]));
  const supplierName = new Map<string, string>((suppliers as any[]).map((s) => [String(s._id), s.name]));

  return [
    ...received.map((r: any) => ({ kind: 'in' as const, date: r.date as Date, amount: r.amount as number, party: (r.customer && customerName.get(String(r.customer))) || r.individualCustomer?.name || '—', docNumber: r.number as string, method: r.method as string })),
    ...paid.map((r: any) => ({ kind: 'out' as const, date: r.date as Date, amount: r.amount as number, party: (r.supplier && supplierName.get(String(r.supplier))) || '—', docNumber: r.number as string, method: r.method as string })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 8);
}

export async function getDashboard(now: Date, periodKey: DashboardPeriod, access: DashboardAccess) {
  const period = resolvePeriod(periodKey, now);

  const [financial, receivables, payables, ecf, cityLedgerPending, lowStock, recent] = await Promise.all([
    access.financial ? buildFinancial(now, period) : undefined,
    access.receivables ? buildReceivables(now) : undefined,
    access.payables ? buildPayables(now) : undefined,
    access.ecf ? buildEcf(now) : undefined,
    access.cityLedger ? Invoice.countDocuments({ 'cityLedger.authorizationStatus': 'pending' }) : undefined,
    access.inventory
      ? Product.countDocuments({ isActive: true, reorderPoint: { $gt: 0 }, $expr: { $lte: ['$onHandQty', '$reorderPoint'] } })
      : undefined,
    access.receivables || access.payables
      ? buildRecentPayments(access.receivables, access.payables)
      : undefined,
  ]);

  return {
    asOf: now,
    period,
    access,
    financial,
    receivables,
    payables,
    ecf,
    attention: { cityLedgerPending, lowStock },
    recentPayments: recent,
    deadlines: nextTaxDeadlines(now),
  };
}
