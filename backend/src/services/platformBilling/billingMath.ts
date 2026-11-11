/**
 * Pure pieces of Pilloto's subscription billing: proration, ITBIS on a charge, period labels.
 * No I/O, so each is tested directly. Money is handled in integer centavos so 0.1 + 0.2 never
 * shows up on a charge.
 */
import { BillingTax } from '../../models/PlatformSettings';
import { dominicanDate, dominicanPeriod, periodBounds, taxRateOf } from '../fiscal/fiscalCore';

export const toCents = (amount: number): number => Math.round((amount + Number.EPSILON) * 100);
export const fromCents = (cents: number): number => cents / 100;
export const round2 = (amount: number): number => fromCents(toCents(amount));

/** Round-half-up integer division, like BillingSoft's own rounding of a line's ITBIS. */
const divRound = (n: number, d: number) => Math.floor((n * 2 + d) / (d * 2));

/**
 * The share of `period` a subscription that started at `startedAt` is charged for: 1 for every
 * month but the first, which counts from the day it started (inclusive), in Dominican time.
 */
export function proration(period: string, startedAt: Date): number {
  if (dominicanPeriod(startedAt) !== period) return 1;
  const { to } = periodBounds(period);
  const days = Number(to.slice(8));
  const startDay = Number(dominicanDate(startedAt).slice(8));
  return Math.round(((days - startDay + 1) / days) * 10_000) / 10_000;
}

export interface DiscountTerms {
  type: 'percent' | 'amount';
  value: number;
}

/**
 * What a discount takes off a subscription line. `base` is the line before the discount (price ×
 * `share` of the month); a fixed amount is prorated by the same share so a half month gets half of
 * it. Never more than the line itself.
 */
export function discountAmount(base: number, discount: DiscountTerms, share = 1): number {
  const raw = discount.type === 'percent' ? (base * discount.value) / 100 : discount.value * share;
  return Math.min(round2(base), round2(Math.max(0, raw)));
}

export interface ChargeTotals {
  subtotal: number;
  itbis: number;
  total: number;
}

/**
 * The totals of a charge made of `lineAmounts` (net, before ITBIS). ITBIS is computed per line and
 * rounded to the centavo, the way DGII (and BillingSoft) compute an e-CF, so a charge settled in
 * one payment produces an e-CF with exactly the same total.
 */
export function chargeTotals(lineAmounts: number[], tax: BillingTax): ChargeTotals {
  const rate = taxRateOf(tax);
  let net = 0;
  let itbis = 0;
  for (const amount of lineAmounts) {
    const cents = toCents(amount);
    net += cents;
    itbis += divRound(cents * rate, 100);
  }
  return { subtotal: fromCents(net), itbis: fromCents(itbis), total: fromCents(net + itbis) };
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** `2026-11` → `noviembre 2026` (the language of the documents Pilloto sends and issues). */
export function periodLabelEs(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return `${MONTHS_ES[month - 1] ?? period} ${year}`;
}

/** `YYYY-MM-DD` plus `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const isPeriod = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
