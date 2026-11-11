/**
 * Pure pieces of the e-CF module: errors, Dominican-time helpers, the tenant's lifecycle state,
 * BillingSoft-status mapping and the totals math. No I/O, so each is tested directly.
 */
import { FiscalCertification, ITenant } from '../../models/Tenant';
import { EcfEstadoECF, EcfTipo, IEcfLineItem } from '../../models/ElectronicInvoice';
import { FiscalConfig, getFiscalConfig } from '../../config/fiscal';
import { BsDocumentRequest, BsDocumentStatus, BsLine, BsLineTax } from './billingsoftTypes';

// ─── Errors ──────────────────────────────────────────────────────────────────

/** A failure the API answers with `statusCode` and a stable `code` the UI can switch on. */
export class FiscalError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'FiscalError';
  }
}

// ─── Dominican time (UTC-4 all year; the Dominican Republic has no daylight saving) ──

const DR_OFFSET_MS = -4 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of `instant` in Dominican time. */
export function dominicanDate(instant: Date): string {
  const d = new Date(instant.getTime() + DR_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `YYYY-MM` of `instant` in Dominican time. */
export const dominicanPeriod = (instant: Date): string => dominicanDate(instant).slice(0, 7);

/** The month before `period` (`YYYY-MM`). */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** The month after `period` (`YYYY-MM`). */
export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}

/** First day of the month after `instant`'s, `YYYY-MM-DD` (when a scheduled downgrade applies). */
export const firstDayOfNextMonth = (instant: Date): string => `${nextPeriod(dominicanPeriod(instant))}-01`;

/** First and last day of `period`, `YYYY-MM-DD`. */
export function periodBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${pad(last)}` };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Where a tenant stands with electronic invoicing, the same in PMS and Accounting:
 * `inactive` (never activated), `suspended`, then DGII's certification: `not_started`,
 * `in_progress`, and `ready` once `certified`.
 */
export type FiscalState = 'inactive' | 'suspended' | 'not_started' | 'in_progress' | 'ready';

export function fiscalState(tenant: Pick<ITenant, 'fiscal'>): FiscalState {
  const f = tenant.fiscal;
  if (!f?.organizationId) return 'inactive';
  if (!f.isActive) return 'suspended';
  const byCertification: Record<FiscalCertification, FiscalState> = {
    not_started: 'not_started',
    in_progress: 'in_progress',
    certified: 'ready',
  };
  return byCertification[f.certification] ?? 'not_started';
}

/**
 * Throws unless the tenant may issue an e-CF now. Documents from DGII's test environments have no
 * fiscal value, so issuing waits for DGII's certification (development and QA can opt out).
 */
export function assertCanIssue(
  tenant: Pick<ITenant, 'fiscal'>,
  cfg: FiscalConfig = getFiscalConfig(),
): string {
  if (!cfg.partnerApiKey) {
    throw new FiscalError(503, 'FISCAL_NOT_CONFIGURED', 'Electronic invoicing is not available on this server');
  }
  const state = fiscalState(tenant);
  if (state === 'inactive') {
    throw new FiscalError(409, 'FISCAL_NOT_ACTIVATED', 'Electronic invoicing is not activated for this company');
  }
  if (state === 'suspended') {
    throw new FiscalError(409, 'FISCAL_SUSPENDED', 'Electronic invoicing is suspended for this company');
  }
  if (state !== 'ready' && !cfg.allowUncertified) {
    throw new FiscalError(
      409,
      'FISCAL_NOT_CERTIFIED',
      'DGII has not certified this company to issue electronic invoices yet. Complete the certification in BillingSoft first.',
    );
  }
  return tenant.fiscal!.organizationId!;
}

// ─── Status mapping ──────────────────────────────────────────────────────────

const ESTADO_OF_STATUS: Record<BsDocumentStatus, EcfEstadoECF> = {
  signed: 'Firmado',
  in_process: 'En Proceso',
  accepted: 'Aceptado',
  conditionally_accepted: 'Aceptado Condicional',
  rejected: 'Rechazado',
  unresolved: 'Sin Resolver',
  annulled: 'Anulado',
};

export const estadoOfStatus = (status: BsDocumentStatus): EcfEstadoECF => ESTADO_OF_STATUS[status] ?? 'Pendiente';

export const tipoOfType = (type: string): EcfTipo => `E${type}` as EcfTipo;
export const typeOfTipo = (tipo: EcfTipo): BsDocumentRequest['type'] => tipo.slice(1) as BsDocumentRequest['type'];

// ─── Totals ──────────────────────────────────────────────────────────────────

const TAX_RATE: Record<BsLineTax, number> = { itbis18: 18, itbis16: 16, itbis0: 0, exempt: 0 };
export const taxRateOf = (tax: BsLineTax): number => TAX_RATE[tax];

/** Decimal string with up to `decimals` decimals → integer scaled by 10^decimals (no float drift). */
function scaled(value: string, decimals: number): number {
  const [whole, frac = ''] = value.split('.');
  return Number(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

/** Round-half-up integer division. */
const divRound = (n: number, d: number) => Math.floor((n * 2 + d) / (d * 2));

export interface DocumentTotals {
  lineItems: IEcfLineItem[];
  /** Total with ITBIS. */
  totalFactura: number;
  totalImpuestos: number;
}

/**
 * The line items and totals of a request, computed the way DGII does: each line's amount
 * (quantity × unit price) to the centavo, then its ITBIS on that amount to the centavo. Done in
 * integers so 0.1 + 0.2 never shows up on an invoice.
 */
export function totalsOfLines(lines: BsLine[]): DocumentTotals {
  let netCents = 0;
  let taxCents = 0;
  const lineItems = lines.map((line) => {
    // quantity has 2 decimals, unit price 4: the product is scaled by 10^6, a centavo is 10^4 of that.
    const amount = divRound(scaled(line.quantity, 2) * scaled(line.unitPrice, 4), 10_000);
    const rate = taxRateOf(line.tax);
    const itbis = divRound(amount * rate, 100);
    netCents += amount;
    taxCents += itbis;
    return {
      description: line.name,
      qty: Number(line.quantity),
      netPrice: amount / 100,
      itbisRate: rate,
      itbisAmount: itbis / 100,
      grossAmount: (amount + itbis) / 100,
    };
  });
  return { lineItems, totalFactura: (netCents + taxCents) / 100, totalImpuestos: taxCents / 100 };
}

/** A Number as a decimal string with at most `decimals` decimals, trailing zeros trimmed to 2. */
export function decimalString(value: number, decimals = 4): string {
  const s = value.toFixed(decimals);
  return s.replace(/(\.\d{2}\d*?)0+$/, '$1');
}

/**
 * The net amount (before ITBIS) of a tax-inclusive `gross` amount at `ratePercent`, as a decimal
 * string for a quantity of 1. BillingSoft rounds the line and then its ITBIS to the centavo, so a
 * plain division can come out a centavo off the folio's total, and for some amounts (100.00 at 18%:
 * 84.74 totals 99.99, 84.75 totals 100.01) no net amount gives the exact total at all. This picks
 * the neighbouring centavo whose total is nearest to `gross` — exact whenever one exists — and, on
 * a tie, the lower one, so an invoice never bills more than the folio.
 */
export function netFromGross(gross: number, ratePercent: number): string {
  const grossCents = Math.round(gross * 100);
  const estimate = Math.round(grossCents / (1 + ratePercent / 100));
  const totalOf = (netCents: number) => netCents + divRound(netCents * ratePercent, 100);
  let best = estimate;
  for (const offset of [-2, -1, 0, 1, 2]) {
    const candidate = estimate + offset;
    const diff = Math.abs(totalOf(candidate) - grossCents);
    const bestDiff = Math.abs(totalOf(best) - grossCents);
    if (diff < bestDiff || (diff === bestDiff && totalOf(candidate) < totalOf(best))) best = candidate;
  }
  return (best / 100).toFixed(2);
}

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
