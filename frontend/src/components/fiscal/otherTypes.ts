/**
 * What each less common e-CF type admits, as BillingSoft enforces it (its per-type rules table).
 * The form shows only what a type allows; BillingSoft still validates everything and explains a
 * refusal, so this is guidance, never the authority.
 */
import type { FiscalOtherLine } from '../../services/api';

export type OtherType = '41' | '43' | '44' | '45' | '46' | '47';
export type Tax = FiscalOtherLine['tax'];

export interface OtherTypeRules {
  /** Does the document name a counterparty? */
  buyer: 'required' | 'optional' | 'forbidden';
  /** Which identifiers it admits. */
  ids: ('rnc' | 'foreignId')[];
  /** At least one identifier is required. */
  idRequired: boolean;
  /** `TipoIngresos` must be stated. */
  incomeType: boolean;
  /** May be sold on credit with a due date. */
  credit: boolean;
  taxes: Tax[];
  kinds: ('good' | 'service')[];
  /** What each line withholds (the issuer withholds from the counterparty). */
  withholding: { itbis: boolean; isr: boolean; required: boolean };
}

const ALL: Tax[] = ['itbis18', 'itbis16', 'itbis0', 'exempt'];

export const OTHER_TYPE_RULES: Record<OtherType, OtherTypeRules> = {
  '41': { buyer: 'required', ids: ['rnc'], idRequired: true, incomeType: false, credit: true, taxes: ALL, kinds: ['service', 'good'], withholding: { itbis: true, isr: true, required: true } },
  '43': { buyer: 'forbidden', ids: [], idRequired: false, incomeType: false, credit: false, taxes: ['exempt'], kinds: ['service', 'good'], withholding: { itbis: false, isr: false, required: false } },
  '44': { buyer: 'required', ids: ['rnc', 'foreignId'], idRequired: true, incomeType: true, credit: true, taxes: ['exempt'], kinds: ['service', 'good'], withholding: { itbis: false, isr: false, required: false } },
  '45': { buyer: 'required', ids: ['rnc'], idRequired: true, incomeType: true, credit: true, taxes: ALL, kinds: ['service', 'good'], withholding: { itbis: false, isr: false, required: false } },
  '46': { buyer: 'optional', ids: ['rnc', 'foreignId'], idRequired: false, incomeType: true, credit: true, taxes: ['itbis0'], kinds: ['service', 'good'], withholding: { itbis: false, isr: false, required: false } },
  '47': { buyer: 'optional', ids: ['foreignId'], idRequired: false, incomeType: false, credit: true, taxes: ['exempt'], kinds: ['service'], withholding: { itbis: false, isr: true, required: true } },
};

export const INCOME_TYPES = ['01', '02', '03', '04', '05', '06'] as const;

export const TAX_RATE: Record<Tax, number> = { itbis18: 18, itbis16: 16, itbis0: 0, exempt: 0 };

/** quantity × unit price, then its ITBIS, each to the centavo — the way DGII computes a line. */
export function lineTotal(quantity: string, unitPrice: string, tax: Tax): { net: number; itbis: number } {
  const q = Number(quantity);
  const p = Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return { net: 0, itbis: 0 };
  const net = Math.round(q * p * 100) / 100;
  return { net, itbis: Math.round(net * TAX_RATE[tax]) / 100 };
}
