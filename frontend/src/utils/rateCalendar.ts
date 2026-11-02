/**
 * Pricing → Calendar helpers: dates, staged cell edits and the rows of one Calendar save.
 *
 * Edits made in the grid are staged per (rate plan, date, field) and sent together with the
 * bulk dialog's rows in ONE `PUT /rate-calendar/bulk`, so a Save is one request (and, once the
 * channel manager is on, one push per kind to the OTAs). Staged cells are compressed into the
 * fewest rows: consecutive dates with the same edits become one range, and plans with the same
 * range and edits share a row.
 */
import type {
  CalendarChange, CalendarField, CalendarSet, RestrictionField, ValueSource, WeekdayCode,
} from '../services/api';

export const WEEKDAYS: WeekdayCode[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
export const RESTRICTION_FIELDS: RestrictionField[] = ['minStayArrival', 'maxStay', 'closedToArrival', 'closedToDeparture', 'stopSell'];
/** How far ahead the Calendar can be edited (server: RESTRICTION_HORIZON_DAYS) */
export const EDIT_HORIZON_DAYS = 730;

// ─── Dates (`YYYY-MM-DD`, calendar days) ─────────────────────────────────────

const utc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day, 12);
};
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number): string => fmt(utc(d) + n * 86400000);
export const diffDays = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / 86400000);
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && fmt(utc(v)) === v;

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const weekdayOf = (d: string): WeekdayCode => (['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'] as WeekdayCode[])[new Date(utc(d)).getUTCDay()];

/** The browser's local calendar date. */
export function todayLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// ─── Staged edits ────────────────────────────────────────────────────────────

/** A staged value: the new value, or 'reset' (go back to the plan price / named rules) */
export type StagedValue = number | boolean | 'reset';
/** `${ratePlanId}|${date}` → field → staged value */
export type Staged = Record<string, Partial<Record<CalendarField, StagedValue>>>;

export const cellKey = (ratePlanId: string, date: string) => `${ratePlanId}|${date}`;

/**
 * Stage (or un-stage) one field of one cell. Typing back the value the server already shows
 * removes the edit instead of keeping a no-op change.
 */
export function stageEdit(staged: Staged, ratePlanId: string, date: string, field: CalendarField, value: StagedValue | undefined, current?: number | boolean): Staged {
  const key = cellKey(ratePlanId, date);
  const cell = { ...(staged[key] ?? {}) };
  if (value === undefined || (value !== 'reset' && value === current)) delete cell[field];
  else cell[field] = value;
  const next = { ...staged };
  if (Object.keys(cell).length) next[key] = cell;
  else delete next[key];
  return next;
}

/** Number of staged (cell, field) edits. */
export const stagedCount = (staged: Staged) => Object.values(staged).reduce((n, cell) => n + Object.keys(cell).length, 0);

const signature = (cell: Partial<Record<CalendarField, StagedValue>>) =>
  JSON.stringify(Object.entries(cell).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function toRow(ratePlanIds: string[], dateFrom: string, dateTo: string, cell: Partial<Record<CalendarField, StagedValue>>): CalendarChange {
  const set: CalendarSet = {};
  const reset: CalendarField[] = [];
  for (const [field, value] of Object.entries(cell) as [CalendarField, StagedValue][]) {
    if (value === 'reset') reset.push(field);
    else (set as any)[field] = value;
  }
  return {
    ratePlanIds, dateFrom, dateTo,
    ...(Object.keys(set).length ? { set } : {}),
    ...(reset.length ? { reset: reset.sort() } : {}),
  };
}

/** Staged cells as the fewest bulk rows (consecutive equal dates → a range; equal rows → one row for several plans). */
export function stagedToChanges(staged: Staged): CalendarChange[] {
  const byPlan = new Map<string, { date: string; cell: Partial<Record<CalendarField, StagedValue>> }[]>();
  for (const [key, cell] of Object.entries(staged)) {
    if (!Object.keys(cell).length) continue;
    const [planId, date] = key.split('|');
    if (!byPlan.has(planId)) byPlan.set(planId, []);
    byPlan.get(planId)!.push({ date, cell });
  }

  const rows = new Map<string, CalendarChange & { sig: string }>();
  for (const [planId, cells] of byPlan) {
    cells.sort((a, b) => (a.date < b.date ? -1 : 1));
    let run: { from: string; to: string; cell: typeof cells[number]['cell']; sig: string } | null = null;
    const flush = () => {
      if (!run) return;
      const key = `${run.from}|${run.to}|${run.sig}`;
      const existing = rows.get(key);
      if (existing) existing.ratePlanIds.push(planId);
      else rows.set(key, { ...toRow([planId], run.from, run.to, run.cell), sig: run.sig });
    };
    for (const { date, cell } of cells) {
      const sig = signature(cell);
      if (run && run.sig === sig && addDays(run.to, 1) === date) run.to = date;
      else { flush(); run = { from: date, to: date, cell, sig }; }
    }
    flush();
  }
  return [...rows.values()]
    .map(({ sig, ...row }) => ({ ...row, ratePlanIds: [...row.ratePlanIds].sort() }))
    .sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : a.ratePlanIds[0] < b.ratePlanIds[0] ? -1 : 1));
}

// ─── Bulk edit dialog rows ───────────────────────────────────────────────────

/** keep = leave as it is; on/off = set the flag */
export type TriState = 'keep' | 'on' | 'off';

export interface BulkRow {
  id: string;
  ratePlanIds: string[];
  dateFrom: string;
  dateTo: string;
  /** Selected weekdays; all seven = every day */
  days: WeekdayCode[];
  price: string;
  minStayArrival: string;
  maxStay: string;
  closedToArrival: TriState;
  closedToDeparture: TriState;
  stopSell: TriState;
  /** Go back to the plan price (and named rules) on these nights */
  resetPrice: boolean;
  /** Remove booking rules typed in the Calendar on these nights */
  resetRestrictions: boolean;
}

let rowSeq = 0;
export function emptyBulkRow(today: string, ratePlanIds: string[] = []): BulkRow {
  return {
    id: `row-${++rowSeq}`, ratePlanIds, dateFrom: today, dateTo: today, days: [...WEEKDAYS],
    price: '', minStayArrival: '', maxStay: '', closedToArrival: 'keep', closedToDeparture: 'keep', stopSell: 'keep',
    resetPrice: false, resetRestrictions: false,
  };
}

/** Nights of the row's range that fall on its weekdays. */
export function bulkRowNights(row: Pick<BulkRow, 'dateFrom' | 'dateTo' | 'days'>): number {
  if (!isDate(row.dateFrom) || !isDate(row.dateTo) || row.dateTo < row.dateFrom || diffDays(row.dateFrom, row.dateTo) > EDIT_HORIZON_DAYS) return 0;
  const days = new Set(row.days);
  return eachDate(row.dateFrom, row.dateTo).filter((d) => days.has(weekdayOf(d))).length;
}

export type BulkRowError = 'plans' | 'dates' | 'past' | 'horizon' | 'days' | 'noNights' | 'price' | 'minStay' | 'maxStay' | 'maxBelowMin' | 'nothing';

const money = /^\d+(\.\d{1,2})?$/;
const wholeNumber = /^\d+$/;

/** Validate a dialog row; `change` is set only when there are no errors. */
export function bulkRowToChange(row: BulkRow, today: string): { change?: CalendarChange; errors: BulkRowError[] } {
  const errors: BulkRowError[] = [];
  if (row.ratePlanIds.length === 0) errors.push('plans');
  if (!isDate(row.dateFrom) || !isDate(row.dateTo) || row.dateTo < row.dateFrom) errors.push('dates');
  else {
    if (row.dateFrom < today) errors.push('past');
    if (row.dateTo > addDays(today, EDIT_HORIZON_DAYS)) errors.push('horizon');
  }
  if (row.days.length === 0) errors.push('days');
  else if (!errors.includes('dates') && bulkRowNights(row) === 0) errors.push('noNights');

  const set: CalendarSet = {};
  const reset: CalendarField[] = [];
  if (row.price.trim()) {
    if (!money.test(row.price.trim()) || !(Number(row.price) > 0)) errors.push('price');
    else set.price = Number(row.price);
  }
  if (row.minStayArrival.trim()) {
    const n = Number(row.minStayArrival);
    if (!wholeNumber.test(row.minStayArrival.trim()) || n < 1 || n > 730) errors.push('minStay');
    else set.minStayArrival = n;
  }
  if (row.maxStay.trim()) {
    const n = Number(row.maxStay);
    if (!wholeNumber.test(row.maxStay.trim()) || n > 730) errors.push('maxStay');
    else set.maxStay = n;
  }
  if (set.minStayArrival !== undefined && set.maxStay !== undefined && set.maxStay > 0 && set.maxStay < set.minStayArrival) errors.push('maxBelowMin');
  for (const f of ['closedToArrival', 'closedToDeparture', 'stopSell'] as const) {
    if (row[f] !== 'keep') set[f] = row[f] === 'on';
  }
  if (row.resetPrice && set.price === undefined) reset.push('price');
  if (row.resetRestrictions) reset.push(...RESTRICTION_FIELDS.filter((f) => set[f] === undefined));
  if (Object.keys(set).length === 0 && reset.length === 0 && !errors.some((e) => e === 'price' || e === 'minStay' || e === 'maxStay')) errors.push('nothing');

  if (errors.length) return { errors };
  const allDays = row.days.length === 7;
  return {
    errors,
    change: {
      ratePlanIds: [...row.ratePlanIds],
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      ...(allDays ? {} : { days: WEEKDAYS.filter((d) => row.days.includes(d)) }),
      ...(Object.keys(set).length ? { set } : {}),
      ...(reset.length ? { reset } : {}),
    },
  };
}

// ─── Value sources ───────────────────────────────────────────────────────────

/** How a Calendar value is marked: no marker for plan prices and defaults. */
export type SourceMark = 'none' | 'named' | 'calendar';

export function sourceMark(src: ValueSource | undefined): SourceMark {
  if (!src || src.kind === 'plan' || src.kind === 'default') return 'none';
  return src.origin === 'calendar' ? 'calendar' : 'named';
}

/** True when any restriction of the day comes from a Calendar edit (so "reset" has something to remove). */
export const hasCalendarRestriction = (restrictions: Record<RestrictionField, { source: ValueSource }>) =>
  RESTRICTION_FIELDS.some((f) => sourceMark(restrictions[f]?.source) === 'calendar');
