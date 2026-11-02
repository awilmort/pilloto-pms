/**
 * Chart palette and chrome for every eCharts chart in the app.
 *
 * Categorical slots are used in this fixed order and never cycled; a ninth series folds into
 * "Other". Slot 1 is the PMS brand blue. The set was validated for colour-vision deficiency
 * and lightness on the white card surface (adjacent CVD ΔE ≥ 9.1, normal-vision ΔE ≥ 19.6);
 * slots 3–5 sit under 3:1 contrast, so every chart ships with a table view.
 * Status colours are reserved for good / warning / serious / critical and always come with an
 * icon or label.
 */
import { BRAND, FONT_UI } from '../../brand';

export const SERIES = ['#3D7BF5', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const;
/** Neutral for "Other" / comparison context */
export const OTHER = '#9AA0B2';

export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const;

/** Single-hue sequential ramp (blue), light → dark */
export const SEQUENTIAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'] as const;

export const INK = {
  primary: BRAND.ink,
  secondary: BRAND.slate,
  muted: '#898781',
  grid: '#E9EBF0',
  baseline: '#C3C2B7',
  surface: '#FFFFFF',
} as const;

export const CHART_FONT = FONT_UI;

/** Series colour by stable index (entity order, not rank); past the eighth slot, "Other" grey */
export const seriesColor = (i: number) => (i < SERIES.length ? SERIES[i] : OTHER);
