/**
 * Frontend mirror of backend/src/constants/unitsOfMeasure.ts — must be kept
 * in sync (same duplication pattern as lib/apps.ts / lib/permissions.ts,
 * since there's no shared package between frontend and backend).
 */
export const UNIT_OF_MEASURE_CODES = [
  'unit', 'box', 'pack', 'dozen',
  'kg', 'g', 'lb', 'oz',
  'l', 'ml', 'gal',
  'm', 'cm',
] as const;

export type UnitOfMeasureCode = typeof UNIT_OF_MEASURE_CODES[number];
