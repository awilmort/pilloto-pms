/**
 * Monthly DGII reports from the books.
 *
 *  - Formato 606 (compras de bienes y servicios, Norma General 07-2018): one row per bill dated in
 *    the month, as the pipe-separated TXT DGII's pre-validation tool and Oficina Virtual accept —
 *    header `606|RNC|AAAAMM|rows`, 23 fields per row, dates AAAAMMDD, amounts with two decimals.
 *    The 607 (sales) is not generated: e-CF sales reach the DGII when issued and are excluded from it.
 *  - ITBIS summary: the figures the IT-1 is filled from — ITBIS on sales (accepted e-CF), ITBIS
 *    paid on purchases that is deductible, and the ITBIS/ISR withheld from suppliers.
 */
import Bill, { IBill } from '../../models/Bill';
import ElectronicInvoice from '../../models/ElectronicInvoice';
import { ISupplier } from '../../models/Supplier';
import { PaymentForm, taxIdType } from '../../constants/dgii';
import { dominicanDate } from '../fiscal/fiscalCore';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * A bill's date as the day it means. Dates picked in a form are stored at midnight UTC (the day
 * itself); a timestamp taken from the clock is read in Dominican time.
 */
export function billDay(d: Date): string {
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') || iso.endsWith('T12:00:00.000Z') ? iso.slice(0, 10) : dominicanDate(d);
}

const compact = (day: string) => day.replace(/-/g, '');

/** 606 "Forma de pago" from the payments made: none is a purchase on credit. */
export function paymentForm(bill: Pick<IBill, 'payments'>): PaymentForm {
  const kinds = new Set(
    (bill.payments ?? []).map((p) => (p.method === 'cash' ? '01' : p.method === 'card' ? '03' : p.method === 'other' ? '07' : '02')),
  );
  if (kinds.size === 0) return '04';
  if (kinds.size > 1) return '07';
  return [...kinds][0] as PaymentForm;
}

export interface Row606 {
  billId: string;
  billNumber: string;
  supplierName: string;
  rncCedula: string;
  idType: '1' | '2' | '';
  expenseType: string;
  ncf: string;
  ncfModified: string;
  issueDate: string; // AAAAMMDD
  paymentDate: string; // AAAAMMDD or ''
  servicesAmount: number;
  goodsAmount: number;
  totalAmount: number;
  itbisBilled: number;
  itbisWithheld: number;
  itbisProportional: number;
  itbisToCost: number;
  itbisAdvance: number;
  itbisPerceived: number;
  isrType: string;
  isrWithheld: number;
  isrPerceived: number;
  selectiveTax: number;
  otherTaxes: number;
  legalTip: number;
  paymentForm: PaymentForm;
}

export interface Issue606 {
  billId: string;
  billNumber: string;
  severity: 'error' | 'warning';
  problem: 'missing_tax_id' | 'invalid_tax_id' | 'missing_ncf' | 'retention_unpaid';
}

export interface Report606 {
  period: string;
  rnc: string | null;
  rows: Row606[];
  issues: Issue606[];
  totals: { count: number; servicesAmount: number; goodsAmount: number; totalAmount: number; itbisBilled: number; itbisWithheld: number; itbisToCost: number; itbisAdvance: number; isrWithheld: number };
}

/** Bills of `period` (by their own date) that count: received, partly or fully paid — never drafts or voided. */
async function billsOf(period: string): Promise<(IBill & { supplier: ISupplier })[]> {
  const [y, m] = period.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - 24 * 3600_000);
  const to = new Date(Date.UTC(y, m, 1) + 24 * 3600_000);
  const bills = await Bill.find({ status: { $in: ['received', 'partial', 'paid'] }, issueDate: { $gte: from, $lt: to } })
    .populate('supplier', 'name taxId')
    .sort({ issueDate: 1, billNumber: 1 });
  return bills.filter((b) => billDay(b.issueDate).slice(0, 7) === period) as any;
}

export function row606(bill: IBill & { supplier: ISupplier }): { row: Row606; issues: Issue606['problem'][] } {
  const problems: Issue606['problem'][] = [];
  const taxId = (bill.supplier?.taxId ?? '').replace(/\D/g, '');
  const type = taxIdType(taxId);
  if (!taxId) problems.push('missing_tax_id');
  else if (!type) problems.push('invalid_tax_id');
  if (!bill.ncf) problems.push('missing_ncf');

  // The DGII reports pesos: a USD/EUR bill at its own rate.
  const fx = (bill as any).exchangeRate || 1;
  let goods = 0;
  let services = 0;
  for (const li of bill.lineItems) {
    if (li.lineType === 'inventory' || li.isGoods) goods += li.lineTotal * fx;
    else services += li.lineTotal * fx;
  }
  const paidDays = (bill.payments ?? []).map((p) => billDay(new Date(p.date))).sort();
  const fullyPaid = bill.status === 'paid';
  const paymentDate = fullyPaid && paidDays.length ? compact(paidDays[paidDays.length - 1]) : '';
  if ((bill.itbisWithheld > 0 || bill.isrWithheld > 0) && !paymentDate) problems.push('retention_unpaid');

  return {
    row: {
      billId: String(bill._id),
      billNumber: bill.billNumber,
      supplierName: bill.supplier?.name ?? '',
      rncCedula: taxId,
      idType: type ? (String(type) as '1' | '2') : '',
      expenseType: bill.expenseType ?? (bill.lineItems.some((l) => l.lineType === 'inventory') ? '09' : '02'),
      ncf: bill.ncf ?? '',
      ncfModified: '',
      issueDate: compact(billDay(bill.issueDate)),
      paymentDate,
      servicesAmount: r2(services),
      goodsAmount: r2(goods),
      totalAmount: r2(r2(goods) + r2(services)), // services + goods, as the 606 checks
      itbisBilled: r2(bill.taxAmount * fx),
      itbisWithheld: r2((bill.itbisWithheld ?? 0) * fx),
      itbisProportional: 0,
      itbisToCost: bill.itbisToCost ? r2(bill.taxAmount * fx) : 0,
      itbisAdvance: bill.itbisToCost ? 0 : r2(bill.taxAmount * fx),
      itbisPerceived: 0,
      isrType: (bill.isrWithheld ?? 0) > 0 ? bill.isrWithholdingType ?? '' : '',
      isrWithheld: r2((bill.isrWithheld ?? 0) * fx),
      isrPerceived: 0,
      selectiveTax: 0,
      otherTaxes: 0,
      legalTip: 0,
      paymentForm: paymentForm(bill),
    },
    issues: problems,
  };
}

/** The month's 606: rows, what blocks or deserves a look, and totals. Runs in the tenant's context. */
export async function build606(period: string, rnc: string | null): Promise<Report606> {
  const rows: Row606[] = [];
  const issues: Issue606[] = [];
  for (const bill of await billsOf(period)) {
    const { row, issues: problems } = row606(bill);
    rows.push(row);
    for (const problem of problems) {
      issues.push({ billId: row.billId, billNumber: row.billNumber, severity: problem === 'retention_unpaid' ? 'warning' : 'error', problem });
    }
  }
  const sum = (k: keyof Row606) => r2(rows.reduce((s, r) => s + (r[k] as number), 0));
  return {
    period,
    rnc,
    rows,
    issues,
    totals: {
      count: rows.length,
      servicesAmount: sum('servicesAmount'),
      goodsAmount: sum('goodsAmount'),
      totalAmount: sum('totalAmount'),
      itbisBilled: sum('itbisBilled'),
      itbisWithheld: sum('itbisWithheld'),
      itbisToCost: sum('itbisToCost'),
      itbisAdvance: sum('itbisAdvance'),
      isrWithheld: sum('isrWithheld'),
    },
  };
}

const money = (n: number) => (n > 0 ? n.toFixed(2) : '');

/** The 606 TXT: header + one line per row (only rows without errors). CRLF line ends. */
export function render606Txt(rnc: string, period: string, rows: Row606[]): string {
  const lines = rows.map((r) =>
    [
      r.rncCedula, r.idType, r.expenseType, r.ncf, r.ncfModified, r.issueDate, r.paymentDate,
      r.servicesAmount.toFixed(2), r.goodsAmount.toFixed(2), r.totalAmount.toFixed(2), r.itbisBilled.toFixed(2),
      money(r.itbisWithheld), money(r.itbisProportional), money(r.itbisToCost), money(r.itbisAdvance), money(r.itbisPerceived),
      r.isrType, money(r.isrWithheld), money(r.isrPerceived), money(r.selectiveTax), money(r.otherTaxes), money(r.legalTip),
      r.paymentForm,
    ].join('|'),
  );
  return [`606|${rnc}|${period.replace('-', '')}|${rows.length}`, ...lines].join('\r\n') + '\r\n';
}

// ─── ITBIS summary (IT-1 helper) ─────────────────────────────────────────────

const SALES_TYPES = ['E31', 'E32', 'E33', 'E44', 'E45'];

export interface ItbisSummary {
  period: string;
  sales: { documents: number; itbis: number; creditNotes: number; creditNotesItbis: number; netItbis: number };
  purchases: { bills: number; itbisBilled: number; itbisAdvance: number; itbisToCost: number };
  withheld: { itbis: number; isr: number };
  /** ITBIS on sales less deductible ITBIS on purchases: positive to pay, negative a balance in favour. */
  itbisBalance: number;
  /** What the month's IT-1 pays: the ITBIS balance (when positive) plus the ITBIS withheld from suppliers. */
  itbisToPay: number;
}

/** The month's ITBIS figures. Runs in the tenant's context (`tenantId` for e-CF, not tenant-scoped). */
export async function itbisSummary(period: string, tenantId: unknown): Promise<ItbisSummary> {
  const [y, m] = period.split('-').map(Number);
  // Dominican month: UTC−4, so the month runs from 04:00 UTC on the 1st.
  const from = new Date(Date.UTC(y, m - 1, 1, 4));
  const to = new Date(Date.UTC(y, m, 1, 4));
  const ecf = await ElectronicInvoice.find({
    tenantId, issuedAt: { $gte: from, $lt: to }, estadoECF: { $in: ['Aceptado', 'Aceptado Condicional'] },
  }).select('tipo totalImpuestos').lean();
  const sales = ecf.filter((d: any) => SALES_TYPES.includes(d.tipo));
  const notes = ecf.filter((d: any) => d.tipo === 'E34');
  const salesItbis = r2(sales.reduce((s, d: any) => s + (d.totalImpuestos ?? 0), 0));
  const notesItbis = r2(notes.reduce((s, d: any) => s + (d.totalImpuestos ?? 0), 0));

  const bills = await billsOf(period);
  const dop = (b: IBill, n: number) => n * ((b as any).exchangeRate || 1);
  const itbisBilled = r2(bills.reduce((s, b) => s + dop(b, b.taxAmount), 0));
  const itbisToCost = r2(bills.filter((b) => b.itbisToCost).reduce((s, b) => s + dop(b, b.taxAmount), 0));
  const itbisAdvance = r2(itbisBilled - itbisToCost);
  const withheldItbis = r2(bills.reduce((s, b) => s + dop(b, b.itbisWithheld ?? 0), 0));
  const withheldIsr = r2(bills.reduce((s, b) => s + dop(b, b.isrWithheld ?? 0), 0));
  const netItbis = r2(salesItbis - notesItbis);
  const itbisBalance = r2(netItbis - itbisAdvance);
  return {
    period,
    sales: { documents: sales.length, itbis: salesItbis, creditNotes: notes.length, creditNotesItbis: notesItbis, netItbis },
    purchases: { bills: bills.length, itbisBilled, itbisAdvance, itbisToCost },
    withheld: { itbis: withheldItbis, isr: withheldIsr },
    itbisBalance,
    itbisToPay: r2(Math.max(0, itbisBalance) + withheldItbis),
  };
}
