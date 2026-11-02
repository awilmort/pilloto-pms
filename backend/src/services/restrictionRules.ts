/**
 * Booking rules (RestrictionRule) — validation, per-field resolution and plain-language
 * summaries (CHANNEX_ARCHITECTURE.md §4.3, plan Phase 4.2). Pilloto-native: used by the
 * channel-manager RateResolver, the booking engine and the Pricing/Calendar UI alike.
 */

import { ChannexDate, addDays, isChannexDate, todayInTz, weekdayCode, WeekdayCode } from './channex/dates';

export const RESTRICTION_FIELDS = ['minStayArrival', 'maxStay', 'closedToArrival', 'closedToDeparture', 'stopSell'] as const;
export type RestrictionField = typeof RESTRICTION_FIELDS[number];

export interface ResolvedRestrictions {
  minStayArrival: number;
  maxStay: number;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
}

export const DEFAULT_RESTRICTIONS: Readonly<ResolvedRestrictions> = Object.freeze({
  minStayArrival: 1,
  maxStay: 0,
  closedToArrival: false,
  closedToDeparture: false,
  stopSell: false,
});

/** How far ahead a rule may end (two years). */
export const RESTRICTION_HORIZON_DAYS = 730;

/** The RestrictionRule fields resolution and summaries read. */
export interface RestrictionRuleLike {
  _id?: unknown;
  name?: string;
  origin?: string;
  scope?: 'property' | 'room_types' | 'rate_plans' | string;
  roomTypeIds?: unknown[];
  ratePlanIds?: unknown[];
  dateStart: string;
  dateEnd: string;
  days?: string[];
  minStayArrival?: number | null;
  maxStay?: number | null;
  closedToArrival?: boolean | null;
  closedToDeparture?: boolean | null;
  stopSell?: boolean | null;
  isActive?: boolean;
  updatedAt?: Date | string;
}

const isSet = (v: unknown) => v !== undefined && v !== null;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Everything wrong with a rule, as plain sentences (empty when valid). `today` is the
 * property-local date the 730-day horizon counts from (default: today in UTC).
 */
export function restrictionRuleProblems(rule: Partial<RestrictionRuleLike>, today: ChannexDate = todayInTz('UTC')): string[] {
  const problems: string[] = [];
  const { dateStart, dateEnd } = rule;
  if (!isChannexDate(dateStart) || !isChannexDate(dateEnd)) {
    problems.push('Choose a start and end date (YYYY-MM-DD).');
  } else {
    if (dateEnd < dateStart) problems.push('The end date must be on or after the start date.');
    const horizon = addDays(today, RESTRICTION_HORIZON_DAYS);
    if (dateEnd > horizon) problems.push(`Booking rules can be set up to ${RESTRICTION_HORIZON_DAYS} days ahead (until ${horizon}).`);
  }

  const scope = rule.scope ?? 'property';
  const roomTypes = rule.roomTypeIds ?? [];
  const ratePlans = rule.ratePlanIds ?? [];
  if (scope === 'property' && (roomTypes.length || ratePlans.length)) {
    problems.push('A whole-property rule cannot list room types or rate plans.');
  }
  if (scope === 'room_types' && (!roomTypes.length || ratePlans.length)) {
    problems.push('Choose at least one room type (and no rate plans) for a room-type rule.');
  }
  if (scope === 'rate_plans' && (!ratePlans.length || roomTypes.length)) {
    problems.push('Choose at least one rate plan (and no room types) for a rate-plan rule.');
  }
  if (!['property', 'room_types', 'rate_plans'].includes(scope)) problems.push('Unknown scope.');

  const days = rule.days ?? [];
  if (days.some((d) => !['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'].includes(d))) problems.push('Unknown weekday.');

  if (!RESTRICTION_FIELDS.some((f) => isSet(rule[f]))) {
    problems.push('Set at least one booking rule (minimum stay, maximum stay, no arrivals, no departures or closed).');
  }
  const intIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  if (isSet(rule.minStayArrival) && !intIn(rule.minStayArrival, 1, 730)) problems.push('Minimum stay must be a whole number of nights from 1 to 730.');
  if (isSet(rule.maxStay) && !intIn(rule.maxStay, 0, 730)) problems.push('Maximum stay must be a whole number of nights from 0 (no maximum) to 730.');
  if (isSet(rule.minStayArrival) && isSet(rule.maxStay) && (rule.maxStay as number) > 0
      && (rule.maxStay as number) < (rule.minStayArrival as number)) {
    problems.push('Maximum stay cannot be shorter than the minimum stay.');
  }
  for (const f of ['closedToArrival', 'closedToDeparture', 'stopSell'] as const) {
    if (isSet(rule[f]) && typeof rule[f] !== 'boolean') problems.push(`${f} must be true or false.`);
  }
  return problems;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export interface RuleScopeTarget {
  ratePlanId: string;
  roomTypeId: string;
}

/** Does the rule cover this rate plan (directly, through its room type, or property-wide)? */
export function ruleCoversPlan(rule: RestrictionRuleLike, target: RuleScopeTarget): boolean {
  const scope = rule.scope ?? 'property';
  if (scope === 'property') return true;
  if (scope === 'room_types') return (rule.roomTypeIds ?? []).some((id) => String(id) === target.roomTypeId);
  if (scope === 'rate_plans') return (rule.ratePlanIds ?? []).some((id) => String(id) === target.ratePlanId);
  return false;
}

/** Does the rule cover this date (range + weekday filter)? */
export function ruleCoversDate(rule: RestrictionRuleLike, date: ChannexDate): boolean {
  if (date < rule.dateStart || date > rule.dateEnd) return false;
  const days = rule.days ?? [];
  return days.length === 0 || days.includes(weekdayCode(date));
}

const updatedTime = (r: RestrictionRuleLike) => (r.updatedAt ? new Date(r.updatedAt).getTime() : 0);

/** Newest first — the order in which rules win. */
export function sortNewestFirst<T extends RestrictionRuleLike>(rules: T[]): T[] {
  return [...rules].sort((a, b) => updatedTime(b) - updatedTime(a));
}

export interface ResolvedRestrictionsWithSources {
  values: ResolvedRestrictions;
  /** The rule that decided each field (absent = default) */
  sources: Partial<Record<RestrictionField, RestrictionRuleLike>>;
}

/**
 * Per-field resolution for one rate plan and date: for each field, the newest active rule
 * covering the date and plan and setting that field wins; other fields are untouched by it.
 * `rules` should already be in scope for the plan and sorted newest first (see sortNewestFirst).
 */
export function resolveRestrictionsOn(rules: RestrictionRuleLike[], date: ChannexDate): ResolvedRestrictionsWithSources {
  const values: ResolvedRestrictions = { ...DEFAULT_RESTRICTIONS };
  const sources: ResolvedRestrictionsWithSources['sources'] = {};
  const pending = new Set<RestrictionField>(RESTRICTION_FIELDS);
  for (const rule of rules) {
    if (pending.size === 0) break;
    if (rule.isActive === false || !ruleCoversDate(rule, date)) continue;
    for (const field of [...pending]) {
      const v = rule[field];
      if (!isSet(v)) continue;
      (values as any)[field] = v;
      sources[field] = rule;
      pending.delete(field);
    }
  }
  return { values, sources };
}

// ─── Plain-language summaries ────────────────────────────────────────────────

export type SummaryLanguage = 'es' | 'en';

export interface SummaryNames {
  roomTypes?: Record<string, string>;
  ratePlans?: Record<string, string>;
}

const DAY_NAMES: Record<SummaryLanguage, Record<WeekdayCode, string>> = {
  es: { mo: 'lunes', tu: 'martes', we: 'miércoles', th: 'jueves', fr: 'viernes', sa: 'sábado', su: 'domingo' },
  en: { mo: 'Monday', tu: 'Tuesday', we: 'Wednesday', th: 'Thursday', fr: 'Friday', sa: 'Saturday', su: 'Sunday' },
};
/** Recurring form: "los sábados" / "on Saturdays" */
const DAY_NAMES_PLURAL: Record<SummaryLanguage, Record<WeekdayCode, string>> = {
  es: { mo: 'lunes', tu: 'martes', we: 'miércoles', th: 'jueves', fr: 'viernes', sa: 'sábados', su: 'domingos' },
  en: { mo: 'Mondays', tu: 'Tuesdays', we: 'Wednesdays', th: 'Thursdays', fr: 'Fridays', sa: 'Saturdays', su: 'Sundays' },
};
const MONTHS: Record<SummaryLanguage, string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const ORDER: WeekdayCode[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];

function joinList(items: string[], lang: SummaryLanguage): string {
  if (items.length <= 1) return items.join('');
  const and = lang === 'es' ? 'y' : 'and';
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

function formatDate(d: ChannexDate, lang: SummaryLanguage, withYear: boolean): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[lang][m - 1]}${withYear ? ` ${y}` : ''}`;
}

function formatRange(start: ChannexDate, end: ChannexDate, lang: SummaryLanguage): string {
  if (start === end) return formatDate(start, lang, true);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDate(start, lang, !sameYear)} – ${formatDate(end, lang, true)}`;
}

function formatScope(rule: RestrictionRuleLike, lang: SummaryLanguage, names: SummaryNames): string {
  const scope = rule.scope ?? 'property';
  if (scope === 'room_types') {
    const ids = (rule.roomTypeIds ?? []).map(String);
    const labels = ids.map((id) => names.roomTypes?.[id]).filter((n): n is string => !!n);
    if (labels.length !== ids.length) return lang === 'es' ? `${ids.length} tipos de habitación` : `${ids.length} room types`;
    return lang === 'es' ? `habitaciones ${joinList(labels, lang)}` : `${joinList(labels, lang)} rooms`;
  }
  if (scope === 'rate_plans') {
    const ids = (rule.ratePlanIds ?? []).map(String);
    const labels = ids.map((id) => names.ratePlans?.[id]).filter((n): n is string => !!n);
    if (labels.length !== ids.length) return lang === 'es' ? `${ids.length} tarifas` : `${ids.length} rate plans`;
    return lang === 'es'
      ? `${labels.length === 1 ? 'tarifa' : 'tarifas'} ${joinList(labels, lang)}`
      : `${joinList(labels, lang)} ${labels.length === 1 ? 'rate' : 'rates'}`;
  }
  return lang === 'es' ? 'todas las habitaciones' : 'all rooms';
}

const nights = (n: number, lang: SummaryLanguage) =>
  lang === 'es' ? `${n} ${n === 1 ? 'noche' : 'noches'}` : `${n} ${n === 1 ? 'night' : 'nights'}`;

/**
 * One sentence describing the rule, e.g.
 * "Mínimo 2 noches para llegadas viernes y sábado, 15 dic 2026 – 15 abr 2027, todas las habitaciones".
 */
export function summarizeRestrictionRule(rule: RestrictionRuleLike, lang: SummaryLanguage, names: SummaryNames = {}): string {
  const days = ORDER.filter((d) => (rule.days ?? []).includes(d));
  const filtered = days.length > 0 && days.length < 7;
  const dayList = filtered ? joinList(days.map((d) => DAY_NAMES[lang][d]), lang) : '';
  const dayListPlural = filtered ? joinList(days.map((d) => DAY_NAMES_PLURAL[lang][d]), lang) : '';
  const onArrivals = filtered ? (lang === 'es' ? ` para llegadas ${dayList}` : ` for arrivals on ${dayList}`) : '';
  const onDays = filtered ? (lang === 'es' ? ` los ${dayListPlural}` : ` on ${dayListPlural}`) : '';

  const es = lang === 'es';
  const parts: string[] = [];
  if (isSet(rule.minStayArrival)) {
    const n = rule.minStayArrival as number;
    parts.push((n > 1 ? (es ? `Mínimo ${nights(n, lang)}` : `Minimum ${nights(n, lang)}`) : (es ? 'Sin mínimo de noches' : 'No minimum stay')) + onArrivals);
  }
  if (isSet(rule.maxStay)) {
    const n = rule.maxStay as number;
    parts.push((n > 0 ? (es ? `Máximo ${nights(n, lang)}` : `Maximum ${nights(n, lang)}`) : (es ? 'Sin máximo de noches' : 'No maximum stay')) + onArrivals);
  }
  if (isSet(rule.closedToArrival)) {
    parts.push((rule.closedToArrival ? (es ? 'Sin llegadas' : 'No arrivals') : (es ? 'Llegadas permitidas' : 'Arrivals allowed')) + onDays);
  }
  if (isSet(rule.closedToDeparture)) {
    parts.push((rule.closedToDeparture ? (es ? 'Sin salidas' : 'No departures') : (es ? 'Salidas permitidas' : 'Departures allowed')) + onDays);
  }
  if (isSet(rule.stopSell)) {
    parts.push((rule.stopSell ? (es ? 'Cerrado a la venta' : 'Closed to sale') : (es ? 'Abierto a la venta' : 'Open for sale')) + onDays);
  }
  const restrictions = parts
    .map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1)))
    .join('; ');
  return `${restrictions}, ${formatRange(rule.dateStart, rule.dateEnd, lang)}, ${formatScope(rule, lang, names)}`;
}

// ─── Checking a stay ─────────────────────────────────────────────────────────

export type StayViolationCode = 'stop_sell' | 'closed_to_arrival' | 'closed_to_departure' | 'min_stay' | 'max_stay';

export interface StayViolation {
  code: StayViolationCode;
  /** stop_sell: the closed nights; CTA: the arrival date; CTD: the departure date */
  dates?: ChannexDate[];
  /** min_stay / max_stay: the limit set on the arrival date */
  limit?: number;
  nights: number;
}

/** Restriction values per date, plus why stop sell was forced (inactive plan, no price). */
export type RestrictionDays = Record<ChannexDate, ResolvedRestrictions & { forcedStopSell?: string }>;

/**
 * Booking rules a stay breaks (empty = bookable): stop sell on any night, no arrivals on the
 * arrival date, no departures on the departure date, and the arrival date's minimum and
 * maximum stay. `days` must cover check-in through check-out (the departure date included);
 * missing dates count as defaults.
 */
export function stayViolations(days: RestrictionDays, checkIn: ChannexDate, checkOut: ChannexDate): StayViolation[] {
  const nightsList: ChannexDate[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) nightsList.push(d);
  const nights = nightsList.length;
  const on = (d: ChannexDate) => days[d] ?? DEFAULT_RESTRICTIONS;
  const out: StayViolation[] = [];

  const closed = nightsList.filter((d) => on(d).stopSell);
  if (closed.length) out.push({ code: 'stop_sell', dates: closed, nights });
  const arrival = on(checkIn);
  if (arrival.closedToArrival) out.push({ code: 'closed_to_arrival', dates: [checkIn], nights });
  if (on(checkOut).closedToDeparture) out.push({ code: 'closed_to_departure', dates: [checkOut], nights });
  if (arrival.minStayArrival > nights) out.push({ code: 'min_stay', limit: arrival.minStayArrival, nights });
  if (arrival.maxStay > 0 && arrival.maxStay < nights) out.push({ code: 'max_stay', limit: arrival.maxStay, nights });
  return out;
}

/** One plain sentence per violation, for staff warnings and booking-engine messages. */
export function describeStayViolation(v: StayViolation, lang: SummaryLanguage): string {
  const es = lang === 'es';
  const dates = (v.dates ?? []).map((d) => formatDate(d, lang, true));
  const list = joinList(dates.length > 3 ? [...dates.slice(0, 3), es ? `${dates.length - 3} más` : `${dates.length - 3} more`] : dates, lang);
  switch (v.code) {
    case 'stop_sell':
      return es ? `Cerrado a la venta: ${list}.` : `Closed to sale: ${list}.`;
    case 'closed_to_arrival':
      return es ? `No se permiten llegadas el ${list}.` : `No arrivals allowed on ${list}.`;
    case 'closed_to_departure':
      return es ? `No se permiten salidas el ${list}.` : `No departures allowed on ${list}.`;
    case 'min_stay':
      return es
        ? `Llegando ese día la estancia mínima es de ${nights(v.limit ?? 1, lang)} (esta reserva tiene ${nights(v.nights, lang)}).`
        : `Arriving that day, the minimum stay is ${nights(v.limit ?? 1, lang)} (this booking has ${nights(v.nights, lang)}).`;
    case 'max_stay':
      return es
        ? `Llegando ese día la estancia máxima es de ${nights(v.limit ?? 0, lang)} (esta reserva tiene ${nights(v.nights, lang)}).`
        : `Arriving that day, the maximum stay is ${nights(v.limit ?? 0, lang)} (this booking has ${nights(v.nights, lang)}).`;
  }
}
