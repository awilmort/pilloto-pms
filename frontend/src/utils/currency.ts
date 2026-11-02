/**
 * Money formatting.
 *
 * PMS screens show the property's currency (Settings → Property profile). It is set once the
 * tenant is resolved (TenantContext) and again when the profile is saved. An unset currency
 * is DOP. Accounting screens always use pesos — DGII books are kept in DOP — through
 * `formatAccountingMoney`.
 */
export type CurrencyConfig = {
  code: string;    // e.g. "DOP"
  symbol: string;  // e.g. "RD$"
  locale?: string; // e.g. "es-DO"
};

const DEFAULT_CODE = 'DOP';
const SYMBOLS: Record<string, string> = { DOP: 'RD$', USD: 'US$', EUR: '€' };
const LOCALE = (process.env.REACT_APP_LOCALE || '').trim() || 'es-DO';

let propertyCurrency = DEFAULT_CODE;

/** Set the property's currency (ISO code); empty means DOP. */
export function setPropertyCurrency(code?: string | null): void {
  propertyCurrency = (code || '').trim().toUpperCase() || DEFAULT_CODE;
}

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code;
}

/** The property's currency, for PMS screens. */
export function getCurrencyConfig(): CurrencyConfig {
  return { code: propertyCurrency, symbol: currencySymbol(propertyCurrency), locale: LOCALE };
}

function format(symbol: string, value?: number): string {
  const n = Number(value || 0);
  try {
    const formatted = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
    return `${symbol}${formatted}`;
  } catch {
    return `${symbol}${n.toFixed(0)}`;
  }
}

/** An amount in the property's currency (PMS screens). */
export function formatMoney(value?: number): string {
  return format(currencySymbol(propertyCurrency), value);
}

/** An amount in pesos (Accounting screens). */
export function formatAccountingMoney(value?: number): string {
  return format(currencySymbol(DEFAULT_CODE), value);
}
