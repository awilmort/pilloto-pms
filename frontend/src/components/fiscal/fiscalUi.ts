/**
 * Small, pure helpers the e-CF screens share (PMS and Accounting alike): how each state looks, how
 * an API error becomes a sentence, and how amounts, periods and plans are shown.
 */
import type { TFunction } from 'i18next';
import type { EcfEstadoECF, EcfTipo, FiscalPlanId, FiscalState, FiscalStatementStatus } from '../../types';

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'default';

/** How each e-CF state is shown. `busy` states are still moving, so the UI offers a refresh. */
export const ESTADO_META: Record<EcfEstadoECF, { tone: Tone; busy: boolean; needsAttention: boolean }> = {
  Aceptado: { tone: 'success', busy: false, needsAttention: false },
  'Aceptado Condicional': { tone: 'warning', busy: false, needsAttention: true },
  Rechazado: { tone: 'error', busy: false, needsAttention: true },
  Error: { tone: 'error', busy: false, needsAttention: true },
  'Sin Resolver': { tone: 'warning', busy: true, needsAttention: true },
  'En Proceso': { tone: 'info', busy: true, needsAttention: false },
  Firmado: { tone: 'info', busy: true, needsAttention: false },
  Pendiente: { tone: 'default', busy: true, needsAttention: false },
  Anulado: { tone: 'default', busy: false, needsAttention: false },
};

/**
 * Props for a chip of `tone`. The theme's warning amber is too light for white text (about 2.9:1),
 * so warnings get dark text on a light amber instead; every other tone keeps the theme's colour.
 */
export function chipTone(tone: Tone): { color: 'default' | 'success' | 'error' | 'info'; sx?: object } {
  if (tone === 'warning') return { color: 'default', sx: { bgcolor: '#FCEFD4', color: '#6B4003', border: '1px solid #EBC983' } };
  return { color: tone };
}

export const estadoMeta = (estado: EcfEstadoECF) => ESTADO_META[estado] ?? { tone: 'default' as Tone, busy: false, needsAttention: false };

/** The i18n key of a state (`En Proceso` → `fiscal.estado.En_Proceso`). */
export const estadoKey = (estado: string): string => `fiscal.estado.${estado.replace(/ /g, '_')}`;

/** States a note may reference: DGII accepted the document. */
export const isValidDocument = (estado: EcfEstadoECF): boolean => estado === 'Aceptado' || estado === 'Aceptado Condicional';

export const TIPOS_SALES: EcfTipo[] = ['E31', 'E32', 'E33', 'E34'];
export const TIPOS_OTHER = ['41', '43', '44', '45', '46', '47'] as const;

/** Whether a document can be sent to its buyer or downloaded: BillingSoft has it. */
export const hasOfficialFiles = (doc: { billingsoftDocumentId?: string }): boolean => Boolean(doc.billingsoftDocumentId);

/** Documents issued in DGII's test environments have no fiscal value. */
export const isTestDocument = (doc: { environment?: string }): boolean => Boolean(doc.environment) && doc.environment !== 'ecf';

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export const STATE_TONE: Record<FiscalState, Tone> = {
  inactive: 'default',
  suspended: 'error',
  not_started: 'warning',
  in_progress: 'info',
  ready: 'success',
};

/** The five steps of the onboarding checklist, in order. */
export const READINESS_STEPS = ['profile', 'certificate', 'sequences', 'directory', 'first_document'] as const;

// ─── Errors ──────────────────────────────────────────────────────────────────

export interface ApiFailure {
  response?: { data?: { code?: string; message?: string; fields?: Record<string, string> } };
  message?: string;
}

export const errorCode = (err: unknown): string | undefined => (err as ApiFailure)?.response?.data?.code;
export const errorFields = (err: unknown): Record<string, string> => (err as ApiFailure)?.response?.data?.fields ?? {};

/**
 * A sentence for an API error: the translation of its code when there is one, else the server's own
 * message (BillingSoft's explanation of a refusal is worth showing), else a generic line.
 */
export function fiscalErrorMessage(err: unknown, t: TFunction): string {
  const data = (err as ApiFailure)?.response?.data;
  if (data?.code) {
    const key = `fiscal.errors.${data.code}`;
    const translated = t(key, { defaultValue: '' });
    if (translated) return translated;
  }
  return data?.message || t('fiscal.errors.generic', 'Something went wrong with electronic invoicing.');
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Numbers follow Dominican convention (1,234.50) whatever the interface language: a plain `es`
 * would print Spain's (1234,50), which is wrong for DGII documents and for the books.
 */
const NUMBER_LOCALE = 'es-DO';

/** Pesos, always (DGII's books are kept in DOP), with centavos. The second argument is accepted so callers may pass the UI language; it does not change the format. */
export const formatDop = (value?: number | string | null, _language?: string): string => {
  const n = Number(value ?? 0);
  return `RD$${new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)}`;
};

/** A whole number with thousands separators, Dominican style. */
export const formatInt = (value: number): string => new Intl.NumberFormat(NUMBER_LOCALE).format(value);

/** `2026-11` → "noviembre de 2026" / "November 2026". */
export function periodLabel(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** `2026-12-01` → "1 de diciembre". */
export function dayLabel(day: string, locale: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export const PLAN_ORDER: FiscalPlanId[] = ['essential', 'pro', 'max'];

export const STATEMENT_TONE: Record<FiscalStatementStatus, Tone> = { open: 'info', closed: 'warning', paid: 'success', void: 'default' };

/** Share of the monthly allowance used (0–1+), for the usage bar. */
export const usageRatio = (used: number, included: number): number => (included > 0 ? used / included : 0);

/** RNC (9) / cédula (11) with its usual separators; anything else is left as typed. */
export function formatTaxId(value?: string): string {
  const d = (value ?? '').replace(/\D/g, '');
  if (d.length === 9) return `${d[0]}-${d.slice(1, 3)}-${d.slice(3, 8)}-${d[8]}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d[10]}`;
  return value ?? '';
}

/** Whether `value` is a plausible tax id: 9 digits (RNC) or 11 (cédula). */
export const isTaxId = (value: string): boolean => /^(\d{9}|\d{11})$/.test(value.replace(/\D/g, ''));

// ─── Dates ───────────────────────────────────────────────────────────────────

const DR = 'America/Santo_Domingo';

/** A date as Dominican time shows it: "10/11/2026". */
export const formatDate = (iso?: string | Date | null, locale = 'es-DO'): string =>
  iso ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: DR }).format(new Date(iso)) : '—';

/** A moment as Dominican time shows it: "10/11/2026, 11:05". */
export const formatDateTime = (iso?: string | Date | null, locale = 'es-DO'): string =>
  iso
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DR }).format(new Date(iso))
    : '—';

/** Save a Blob as a file the browser downloads. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
