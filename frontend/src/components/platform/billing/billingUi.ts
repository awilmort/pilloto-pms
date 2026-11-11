/**
 * Small, pure helpers the billing console shares: how a charge or payment looks, how an API error
 * becomes a sentence, the months a price can start from. Money and dates reuse the e-CF screens'
 * formatters (Dominican convention, Dominican time) so both always agree.
 */
import type { TFunction } from 'i18next';
import type { BillingChargeStatus, BillingPayment, BillingTax } from '../../../types/billing';
import { ApiFailure, Tone } from '../../fiscal/fiscalUi';

export { formatDop, formatDate, formatDateTime, formatInt, periodLabel, downloadBlob, errorFields, errorCode } from '../../fiscal/fiscalUi';
export type { Tone } from '../../fiscal/fiscalUi';

export const CHARGE_TONE: Record<BillingChargeStatus, Tone> = { open: 'info', partial: 'warning', paid: 'success', void: 'default' };

export const TAX_LABELS: Record<BillingTax, { key: string; fallback: string }> = {
  itbis18: { key: 'platformBilling.tax.itbis18', fallback: 'ITBIS 18%' },
  itbis16: { key: 'platformBilling.tax.itbis16', fallback: 'ITBIS 16%' },
  itbis0: { key: 'platformBilling.tax.itbis0', fallback: 'ITBIS 0% (taxed at zero rate)' },
  exempt: { key: 'platformBilling.tax.exempt', fallback: 'Exempt (no ITBIS)' },
};

/**
 * A sentence for an API error: the translation of its code when there is one, else the server's own
 * message (a BillingSoft refusal explains itself), else a generic line.
 */
export function billingErrorMessage(err: unknown, t: TFunction): string {
  const data = (err as ApiFailure)?.response?.data;
  if (data?.code) {
    const translated = t(`platformBilling.errors.${data.code}`, { defaultValue: '' });
    if (translated) return translated;
  }
  return data?.message || t('platformBilling.errors.generic', 'Something went wrong. Try again.');
}

const DR_OFFSET_MS = -4 * 60 * 60 * 1000;

/** `YYYY-MM` now, in Dominican time. */
export const currentPeriod = (now: Date = new Date()): string => new Date(now.getTime() + DR_OFFSET_MS).toISOString().slice(0, 7);

/** The current month and the next `count - 1`: the months a new price can start from. */
export function upcomingPeriods(count = 12, now: Date = new Date()): string[] {
  const [y, m] = currentPeriod(now).split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const month = m - 1 + i;
    return `${y + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`;
  });
}

export type EcfState = 'reversed' | 'issued' | 'processing' | 'attention' | 'missing';

/**
 * Where a payment's e-CF stands, for the badge and the actions offered: no e-CF yet (with or
 * without a reason), still moving, needing a person, or done.
 */
export function ecfState(payment: Pick<BillingPayment, 'status' | 'ecf' | 'ecfError'>): EcfState {
  if (payment.status === 'reversed') return 'reversed';
  if (!payment.ecf) return 'missing';
  switch (payment.ecf.estado) {
    case 'Aceptado':
    case 'Aceptado Condicional':
    case 'Anulado':
      return 'issued';
    case 'Rechazado':
    case 'Error':
    case 'Sin Resolver':
      return 'attention';
    default:
      return 'processing';
  }
}

/** Whether issuing (or issuing again) can help: no e-CF, one never confirmed, or one DGII rejected. */
export const canRetryEcf = (payment: Pick<BillingPayment, 'status' | 'ecf'>): boolean =>
  payment.status === 'recorded' && (!payment.ecf || ['Rechazado', 'Error', 'Pendiente'].includes(payment.ecf.estado));

/** Opens a downloaded PDF in a new tab. */
export function openBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
