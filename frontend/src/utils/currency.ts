export type CurrencyConfig = {
  symbol: string; // e.g., "RD$"
  locale?: string; // e.g., "es-DO"
};

const DEFAULT_CURRENCY: CurrencyConfig = {
  symbol: 'RD$',
  locale: 'es-DO',
};

export function getCurrencyConfig(): CurrencyConfig {
  const symbol = (process.env.REACT_APP_CURRENCY_SYMBOL || '').trim();
  const locale = (process.env.REACT_APP_LOCALE || '').trim();
  return {
    symbol: symbol || DEFAULT_CURRENCY.symbol,
    locale: locale || DEFAULT_CURRENCY.locale,
  };
}

export function formatMoney(value?: number): string {
  const { symbol, locale } = getCurrencyConfig();
  const n = Number(value || 0);
  try {
    // Dominican Peso is DOP. We only need symbol consistency per request; fallback keeps RD$ prefix.
    const formatted = new Intl.NumberFormat(locale || undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
    return `${symbol}${formatted}`;
  } catch {
    return `${symbol}${n.toFixed(0)}`;
  }
}
