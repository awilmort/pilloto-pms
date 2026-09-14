/**
 * Controlled vocabulary for Product.unitOfMeasure — a fixed list rather than free
 * text, to prevent drift like "lb" vs "lbs" vs "pound". Deliberately general-purpose
 * (count/weight/volume/length), not scoped to any one industry's stock — Pilloto
 * Accounting is sold to any DR business, not just hospitality. Unit-conversion groups
 * (buy in one unit, sell in another) are out of scope for v1.
 */
export const UNIT_OF_MEASURE_CODES = [
  'unit', 'box', 'pack', 'dozen',
  'kg', 'g', 'lb', 'oz',
  'l', 'ml', 'gal',
  'm', 'cm',
] as const;

export type UnitOfMeasureCode = typeof UNIT_OF_MEASURE_CODES[number];
