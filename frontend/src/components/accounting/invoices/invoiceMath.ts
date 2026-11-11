/**
 * Pure invoice maths and rules for the invoice page — no React, so it can be unit-tested. The
 * totals mirror the server's own calculation (models/Invoice.ts pre-validate: each line is
 * rounded to cents, then summed) so the figure on screen is the figure that gets saved.
 */
import type { Customer } from '../../../types';

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** ITBIS options the e-CF pipeline supports: 18 %, 16 %, and exempt (0). */
export const TAX_RATES = [18, 16, 0] as const;

export interface DraftLine {
  key: string;
  description: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
}

let keySeq = 0;
export const newDraftLine = (over: Partial<DraftLine> = {}, defaultTaxRate = 18): DraftLine => ({
  key: `line-${++keySeq}`,
  description: '',
  productId: '',
  quantity: '1',
  unitPrice: '',
  discountPercent: '0',
  taxRate: String(defaultTaxRate),
  ...over,
});

const n = (s: string): number => Number(s) || 0;

export interface LineAmounts { gross: number; discount: number; lineTotal: number; taxAmount: number; total: number }

export function lineAmounts(l: Pick<DraftLine, 'quantity' | 'unitPrice' | 'discountPercent' | 'taxRate'>): LineAmounts {
  const gross = n(l.quantity) * n(l.unitPrice);
  const lineTotal = round2(gross * (1 - n(l.discountPercent) / 100));
  const taxAmount = round2(lineTotal * (n(l.taxRate) / 100));
  return { gross: round2(gross), discount: round2(gross - lineTotal), lineTotal, taxAmount, total: round2(lineTotal + taxAmount) };
}

export interface DocumentTotals {
  /** Before discounts. */
  gross: number;
  discount: number;
  /** After discounts, before ITBIS (what the server stores as `subtotal`). */
  subtotal: number;
  taxAmount: number;
  total: number;
  /** ITBIS per rate (taxable rates only), lowest first. */
  byRate: { rate: number; base: number; tax: number }[];
}

export function documentTotals(lines: DraftLine[]): DocumentTotals {
  let gross = 0, discount = 0, subtotal = 0, taxAmount = 0;
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const l of lines) {
    const a = lineAmounts(l);
    gross += a.gross;
    discount += a.discount;
    subtotal += a.lineTotal;
    taxAmount += a.taxAmount;
    const rate = n(l.taxRate);
    if (rate > 0) {
      const row = byRate.get(rate) ?? { base: 0, tax: 0 };
      row.base += a.lineTotal;
      row.tax += a.taxAmount;
      byRate.set(rate, row);
    }
  }
  return {
    gross: round2(gross),
    discount: round2(discount),
    subtotal: round2(subtotal),
    taxAmount: round2(taxAmount),
    total: round2(subtotal + taxAmount),
    byRate: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({ rate, base: round2(v.base), tax: round2(v.tax) })),
  };
}

// ── Payment terms ────────────────────────────────────────────────────────────

export type PaymentTerms = 'cash' | '8' | '15' | '30' | '60' | 'custom';
export const TERMS_OPTIONS: PaymentTerms[] = ['cash', '8', '15', '30', '60', 'custom'];
export const DEFAULT_TERMS: PaymentTerms = '30';

export const termsDays = (terms: PaymentTerms): number | null => (terms === 'custom' ? null : terms === 'cash' ? 0 : Number(terms));

const pad = (x: number) => String(x).padStart(2, '0');
/** Local calendar date as `YYYY-MM-DD` (never shifts a day through UTC). */
export const toIsoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = (): string => toIsoDate(new Date());

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
}

export const daysBetweenIso = (fromIso: string, toIso: string): number => {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

/** Which preset an existing issue/due pair corresponds to ("custom" when it matches none). */
export function termsFromDates(issueIso: string, dueIso: string | undefined): PaymentTerms {
  if (!dueIso) return 'cash';
  const days = daysBetweenIso(issueIso, dueIso);
  if (days <= 0) return 'cash';
  const preset = TERMS_OPTIONS.find((t) => termsDays(t) === days);
  return preset ?? 'custom';
}

// ── e-CF type ────────────────────────────────────────────────────────────────

export type EcfKind = 'E31' | 'E32';

/**
 * The comprobante the invoice will be issued as: a registered customer with an RNC gets a Factura de
 * Crédito Fiscal (E31, lets the buyer claim ITBIS); anyone else a Factura de Consumo (E32). The server
 * makes the same call at issue time.
 */
export const ecfKindFor = (customer: Pick<Customer, 'rnc'> | null | undefined, isIndividual: boolean): EcfKind =>
  !isIndividual && customer?.rnc ? 'E31' : 'E32';

// ── Validation ───────────────────────────────────────────────────────────────

export type InvoiceFormError =
  | 'customerRequired' | 'individualNameRequired' | 'lineDescriptionRequired' | 'lineQuantityRequired' | 'lineUnitPriceRequired' | 'dueBeforeIssue' | 'dueDateRequired';

/** First problem that would make the server reject the invoice, or null. Mirrors the controller's rules. */
export function validateInvoice(input: { isIndividual: boolean; customerId: string; individualName: string; lines: DraftLine[]; issueIso: string; dueIso: string; terms: PaymentTerms }): InvoiceFormError | null {
  if (!input.isIndividual && !input.customerId) return 'customerRequired';
  if (input.isIndividual && !input.individualName.trim()) return 'individualNameRequired';
  for (const l of input.lines) {
    if (!l.description.trim()) return 'lineDescriptionRequired';
    if (!(n(l.quantity) > 0)) return 'lineQuantityRequired';
    if (l.unitPrice === '' || n(l.unitPrice) < 0) return 'lineUnitPriceRequired';
  }
  if (input.terms === 'custom') {
    if (!input.dueIso) return 'dueDateRequired';
    if (input.dueIso < input.issueIso) return 'dueBeforeIssue';
  }
  return null;
}

/** A line the user left completely untouched (the empty row at the end) — not worth validating or saving. */
export const isBlankLine = (l: DraftLine): boolean => !l.description.trim() && !l.productId && l.unitPrice === '';
