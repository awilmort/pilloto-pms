/**
 * Channex date helpers (CHANNEX_ARCHITECTURE.md §4.5) — the only module that formats
 * Channex dates.
 *
 * Channex speaks calendar dates `YYYY-MM-DD` in the property's timezone. Pilloto stores
 * reservation dates as noon UTC of the calendar date, so conversion is pure:
 * `YYYY-MM-DD` ↔ `Date.UTC(y, m - 1, d, 12)`. Night `d` is occupied when
 * `checkIn ≤ d < checkOut`. "Today" is computed in the property timezone.
 */

export type ChannexDate = string;

export type WeekdayCode = 'mo' | 'tu' | 'we' | 'th' | 'fr' | 'sa' | 'su';

export interface DateRange {
  dateFrom: ChannexDate;
  dateTo: ChannexDate; // inclusive
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS: WeekdayCode[] = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** True for a real calendar date in `YYYY-MM-DD` form (rejects e.g. 2026-02-30). */
export function isChannexDate(value: unknown): value is ChannexDate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function assertChannexDate(value: unknown): asserts value is ChannexDate {
  if (!isChannexDate(value)) throw new RangeError(`Invalid Channex date: ${String(value)}`);
}

/** Pilloto Date (noon UTC of the calendar date) → `YYYY-MM-DD`, read from the UTC calendar day. */
export function toChannexDate(date: Date): ChannexDate {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new RangeError('Invalid Date');
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** `YYYY-MM-DD` → noon UTC Date, the way Pilloto stores calendar dates. */
export function fromChannexDate(value: string): Date {
  assertChannexDate(value);
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function toDate(value: Date | ChannexDate): ChannexDate {
  return typeof value === 'string' ? (assertChannexDate(value), value) : toChannexDate(value);
}

/** Calendar date "today" in an IANA timezone (throws RangeError for an unknown timezone). */
export function todayInTz(timeZone: string, now: Date = new Date()): ChannexDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: ChannexDate, days: number): ChannexDate {
  return toChannexDate(new Date(fromChannexDate(date).getTime() + days * DAY_MS));
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: ChannexDate, b: ChannexDate): number {
  return Math.round((fromChannexDate(b).getTime() - fromChannexDate(a).getTime()) / DAY_MS);
}

/** Every date from `dateFrom` to `dateTo`, both inclusive. Empty when `dateTo < dateFrom`. */
export function eachDate(dateFrom: ChannexDate, dateTo: ChannexDate): ChannexDate[] {
  const out: ChannexDate[] = [];
  for (let d = dateFrom; d <= dateTo; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Occupied nights of a stay: `checkIn ≤ d < checkOut`. */
export function eachNight(checkIn: Date | ChannexDate, checkOut: Date | ChannexDate): ChannexDate[] {
  const from = toDate(checkIn);
  const to = toDate(checkOut);
  return to > from ? eachDate(from, addDays(to, -1)) : [];
}

/** The nights of a stay as an inclusive range, or null for a zero-night stay. */
export function nightsRange(checkIn: Date | ChannexDate, checkOut: Date | ChannexDate): DateRange | null {
  const from = toDate(checkIn);
  const to = toDate(checkOut);
  return to > from ? { dateFrom: from, dateTo: addDays(to, -1) } : null;
}

/** Intersect a range with [min, max]; null when nothing is left. */
export function clampRange(range: DateRange, min: ChannexDate, max: ChannexDate): DateRange | null {
  const dateFrom = range.dateFrom < min ? min : range.dateFrom;
  const dateTo = range.dateTo > max ? max : range.dateTo;
  return dateFrom <= dateTo ? { dateFrom, dateTo } : null;
}

/** Union of possibly overlapping or adjacent ranges, sorted. */
export function mergeRanges(ranges: DateRange[]): DateRange[] {
  const sorted = [...ranges].sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : 0));
  const out: DateRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.dateFrom <= addDays(last.dateTo, 1)) {
      if (r.dateTo > last.dateTo) last.dateTo = r.dateTo;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Channex weekday code (`days` filter) of a date. */
export function weekdayCode(date: ChannexDate): WeekdayCode {
  return WEEKDAYS[fromChannexDate(date).getUTCDay()];
}
