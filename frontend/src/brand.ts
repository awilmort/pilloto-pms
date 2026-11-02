/**
 * Pilloto brand tokens — mirrors pilloto-brand-kit/tokens/tokens.json.
 *
 * Product dots: PMS is blue, Accounting (Contable) is green. The brand kit
 * shipped them the other way round; they were deliberately swapped
 * (2026-10-31) and the kit's own files were updated to match.
 */
export const BRAND = {
  ink: '#121A33',
  inkSoft: '#2A3352',
  vermilion: '#E4572E',
  vermilionOnDark: '#FF6B4A',
  vermilionText: '#B93D17',
  paper: '#F5F6F8',
  mist: '#E3E6EE',
  slate: '#5B6278',
  white: '#FFFFFF',
} as const;

export type ProductCode = 'pms' | 'accounting' | 'pos' | 'rrhh';

export const PRODUCT_COLORS: Record<ProductCode, string> = {
  pms: '#3D7BF5',
  accounting: '#14B8A6',
  pos: '#F4A62A',
  rrhh: '#9566F0',
};

export const FONT_UI = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** `#RRGGBB` + alpha (0–1) → `rgba()`; keeps tints derived from the tokens above. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
