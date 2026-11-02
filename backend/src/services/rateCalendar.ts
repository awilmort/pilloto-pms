/**
 * Rate calendar — the Calendar view and its bulk edits (CHANNEX_ARCHITECTURE.md §4.3, §8.5;
 * plan Phase 4.3). Pilloto-native.
 *
 * The Calendar is a view over the existing pricing model, not a second store:
 *   - a price typed for some nights → a calendar-origin PricingRule (custom base price) per rate plan
 *   - a booking rule typed for some nights → a calendar-origin RestrictionRule per rate plan
 *   - "reset" on some nights → calendar rules covering those nights are trimmed or split so the
 *     plan price / named rules show through again; named (manual) rules are never touched
 *   - after every save, calendar rules whose every night (and field) is covered by newer
 *     calendar rules are deleted, so they do not pile up
 *
 * Precedence is "newest wins": rows of one request get strictly increasing timestamps (a later
 * row beats an earlier one), and pieces cut from an existing rule keep that rule's timestamps, so
 * trimming never changes which rule wins on the nights that remain.
 *
 * Money is in currency units (like PricingRule), dates are property-local `YYYY-MM-DD`.
 */

import mongoose from 'mongoose';
import PricingRule, { IPricingRule } from '../models/PricingRule';
import RestrictionRule, { IRestrictionRule } from '../models/RestrictionRule';
import RatePlan from '../models/RatePlan';
import RoomType from '../models/RoomType';
import {
  ChannexDate, WeekdayCode, addDays, diffDays, eachDate, fromChannexDate, isChannexDate, toChannexDate, weekdayCode,
} from './channex/dates';
import { RESTRICTION_FIELDS, RESTRICTION_HORIZON_DAYS, RestrictionField } from './restrictionRules';
import Room from '../models/Room';
import RoomBlock from '../models/RoomBlock';
import Reservation from '../models/Reservation';
import { computeInventory, explainNight, getInventory, loadInventoryWindow, InventoryCell } from './channex/inventory.service';
import { resolveRates, ValueSource } from './channex/rateResolver';

export const WEEKDAYS: WeekdayCode[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
export const CALENDAR_FIELDS = ['price', ...RESTRICTION_FIELDS] as const;
export type CalendarField = typeof CALENDAR_FIELDS[number];
export const MAX_CALENDAR_VIEW_DAYS = 60;
export const MAX_BULK_CHANGES = 200;

// ─── Segments: a date range with an optional weekday filter ─────────────────

export interface Segment {
  dateStart: ChannexDate;
  dateEnd: ChannexDate;
  /** Weekdays covered; empty = every day */
  days: WeekdayCode[];
}

const daySet = (days: WeekdayCode[]) => new Set<WeekdayCode>(days.length ? days : WEEKDAYS);
const normalizeDays = (set: Set<WeekdayCode>): WeekdayCode[] => (set.size === 7 ? [] : WEEKDAYS.filter((d) => set.has(d)));

/** Every date a segment covers. */
export function segmentDates(seg: Segment): ChannexDate[] {
  const days = daySet(seg.days);
  return eachDate(seg.dateStart, seg.dateEnd).filter((d) => days.has(weekdayCode(d)));
}

/** Tighten a segment to its first/last covered date; null if it covers none. */
function tighten(seg: Segment): Segment | null {
  if (seg.dateEnd < seg.dateStart || daySet(seg.days).size === 0) return null;
  const dates = segmentDates(seg);
  if (dates.length === 0) return null;
  return { dateStart: dates[0], dateEnd: dates[dates.length - 1], days: seg.days };
}

/**
 * Split `rule` by `reset`: `kept` covers the rule's dates the reset does not touch (exactly),
 * `hit` the rule's dates it does touch (null when they don't overlap).
 */
export function subtractSegment(rule: Segment, reset: Segment): { kept: Segment[]; hit: Segment | null } {
  const start = rule.dateStart > reset.dateStart ? rule.dateStart : reset.dateStart;
  const end = rule.dateEnd < reset.dateEnd ? rule.dateEnd : reset.dateEnd;
  const ruleDays = daySet(rule.days);
  const resetDays = daySet(reset.days);
  const hitDays = new Set([...ruleDays].filter((d) => resetDays.has(d)));
  // Check emptiness before normalizing: an empty weekday list means "every day"
  const hit = start <= end && hitDays.size > 0
    ? tighten({ dateStart: start, dateEnd: end, days: normalizeDays(hitDays) })
    : null;
  if (!hit) return { kept: [rule], hit: null };

  const keepDays = new Set([...ruleDays].filter((d) => !resetDays.has(d)));
  const kept = [
    tighten({ dateStart: rule.dateStart, dateEnd: addDays(start, -1), days: rule.days }),
    keepDays.size ? tighten({ dateStart: start, dateEnd: end, days: normalizeDays(keepDays) }) : null,
    tighten({ dateStart: addDays(end, 1), dateEnd: rule.dateEnd, days: rule.days }),
  ].filter((s): s is Segment => s !== null);
  return { kept, hit };
}

export interface ShadowCandidate {
  id: string;
  updatedAt: Date;
  segment: Segment;
  fields: string[];
}

/** Ids of rules whose every (date, field) is covered by newer rules of the list. */
export function findShadowed(rules: ShadowCandidate[]): string[] {
  const covered = new Map<string, Set<ChannexDate>>();
  const shadowed: string[] = [];
  const newestFirst = [...rules].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  for (const rule of newestFirst) {
    const dates = segmentDates(rule.segment);
    const fullyCovered = rule.fields.every((f) => dates.every((d) => covered.get(f)?.has(d)));
    if (fullyCovered) {
      shadowed.push(rule.id);
      continue;
    }
    for (const f of rule.fields) {
      if (!covered.has(f)) covered.set(f, new Set());
      for (const d of dates) covered.get(f)!.add(d);
    }
  }
  return shadowed;
}

// ─── PricingRule ↔ Segment ───────────────────────────────────────────────────

const JS_DAY: Record<WeekdayCode, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
const CODE_OF_JS_DAY: WeekdayCode[] = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];

/** A calendar PricingRule's nights as a segment (calendar rules are always date-bound). */
export function pricingRuleSegment(rule: Pick<IPricingRule, 'dateStart' | 'dateEnd' | 'periodPattern' | 'specificDays'>): Segment | null {
  if (!rule.dateStart || !rule.dateEnd) return null;
  let days: WeekdayCode[] = [];
  if (rule.periodPattern === 'weekdays') days = ['mo', 'tu', 'we', 'th', 'fr'];
  else if (rule.periodPattern === 'weekends') days = ['sa', 'su'];
  else if (rule.periodPattern === 'specific_days') days = normalizeDays(new Set((rule.specificDays ?? []).map((n) => CODE_OF_JS_DAY[n])));
  return { dateStart: toChannexDate(new Date(rule.dateStart)), dateEnd: toChannexDate(new Date(rule.dateEnd)), days };
}

function segmentToPricingFields(seg: Segment) {
  return {
    dateStart: fromChannexDate(seg.dateStart),
    dateEnd: fromChannexDate(seg.dateEnd),
    periodPattern: seg.days.length ? 'specific_days' : 'all_days',
    specificDays: seg.days.length ? seg.days.map((d) => JS_DAY[d]).sort() : undefined,
  };
}

const calendarRuleName = (seg: Segment) =>
  `Calendario ${seg.dateStart === seg.dateEnd ? seg.dateStart : `${seg.dateStart} → ${seg.dateEnd}`}`;

// ─── Bulk change validation ──────────────────────────────────────────────────

export interface CalendarSet {
  /** Nightly base price (currency units, > 0); occupancy surcharges still come from the rate plan */
  price?: number;
  minStayArrival?: number;
  maxStay?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
}

export interface CalendarChange extends Segment {
  ratePlanIds: string[];
  set: CalendarSet;
  reset: CalendarField[];
}

export interface BulkValidationContext {
  /** Property-local today: past dates cannot be edited */
  today: ChannexDate;
  /** Rate plans of the tenant */
  ratePlanIds: Set<string>;
}

/** Validate and normalize the PUT body; returns `{ errors }` (row-numbered messages) or `{ changes }`. */
export function parseBulkChanges(body: unknown, ctx: BulkValidationContext): { errors: string[] } | { changes: CalendarChange[] } {
  const rows = (body as any)?.changes;
  if (!Array.isArray(rows) || rows.length === 0) return { errors: ['Send at least one change in "changes".'] };
  if (rows.length > MAX_BULK_CHANGES) return { errors: [`At most ${MAX_BULK_CHANGES} changes per save.`] };
  const horizon = addDays(ctx.today, RESTRICTION_HORIZON_DAYS);
  const errors: string[] = [];
  const changes: CalendarChange[] = [];

  rows.forEach((row: any, i: number) => {
    const at = (msg: string) => errors.push(`Change ${i + 1}: ${msg}`);
    const before = errors.length;
    const ids = Array.isArray(row?.ratePlanIds) ? [...new Set(row.ratePlanIds.map(String))] as string[] : [];
    if (ids.length === 0) at('choose at least one rate plan.');
    else if (ids.some((id) => !ctx.ratePlanIds.has(id))) at('one of the rate plans was not found.');

    const { dateFrom, dateTo } = row ?? {};
    if (!isChannexDate(dateFrom) || !isChannexDate(dateTo)) at('dateFrom and dateTo must be YYYY-MM-DD dates.');
    else {
      if (dateTo < dateFrom) at('dateTo must be on or after dateFrom.');
      if (dateFrom < ctx.today) at(`past dates cannot be changed (today is ${ctx.today}).`);
      if (dateTo > horizon) at(`dates can be changed up to ${RESTRICTION_HORIZON_DAYS} days ahead (until ${horizon}).`);
    }

    const days: WeekdayCode[] = row?.days === undefined ? [] : row.days;
    if (!Array.isArray(days) || days.some((d) => !WEEKDAYS.includes(d))) at('days must be a list of mo, tu, we, th, fr, sa, su.');

    const set: CalendarSet = {};
    const rawSet = row?.set ?? {};
    if (typeof rawSet !== 'object' || Array.isArray(rawSet)) at('"set" must be an object.');
    else {
      for (const key of Object.keys(rawSet)) {
        if (!(CALENDAR_FIELDS as readonly string[]).includes(key)) at(`unknown field "${key}".`);
      }
      const v = rawSet;
      if (v.price !== undefined) {
        if (typeof v.price !== 'number' || !(v.price > 0) || v.price > 10_000_000 || Math.round(v.price * 100) !== Number((v.price * 100).toFixed(6))) {
          at('price must be a positive amount with at most 2 decimals (to close dates use stopSell).');
        } else set.price = v.price;
      }
      const intIn = (x: unknown, min: number, max: number) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
      if (v.minStayArrival !== undefined) {
        if (!intIn(v.minStayArrival, 1, 730)) at('minStayArrival must be a whole number of nights from 1 to 730.');
        else set.minStayArrival = v.minStayArrival;
      }
      if (v.maxStay !== undefined) {
        if (!intIn(v.maxStay, 0, 730)) at('maxStay must be a whole number of nights from 0 (no maximum) to 730.');
        else set.maxStay = v.maxStay;
      }
      if (set.minStayArrival !== undefined && set.maxStay !== undefined && set.maxStay > 0 && set.maxStay < set.minStayArrival) {
        at('maxStay cannot be shorter than minStayArrival.');
      }
      for (const f of ['closedToArrival', 'closedToDeparture', 'stopSell'] as const) {
        if (v[f] !== undefined) {
          if (typeof v[f] !== 'boolean') at(`${f} must be true or false.`);
          else set[f] = v[f];
        }
      }
    }

    const reset: CalendarField[] = row?.reset === undefined ? [] : row.reset;
    if (!Array.isArray(reset) || reset.some((f) => !(CALENDAR_FIELDS as readonly string[]).includes(f))) {
      at(`reset must list fields among: ${CALENDAR_FIELDS.join(', ')}.`);
    } else {
      const both = reset.filter((f) => (set as any)[f] !== undefined);
      if (both.length) at(`${both.join(', ')} cannot be both set and reset in one change.`);
    }
    if (errors.length === before && Object.keys(set).length === 0 && (!Array.isArray(reset) || reset.length === 0)) {
      at('nothing to change (empty "set" and "reset").');
    }

    if (errors.length === before) {
      const seg = { dateStart: dateFrom, dateEnd: dateTo, days: normalizeDays(new Set(days)) };
      if (segmentDates(seg).length === 0) at('the weekdays chosen do not fall within the dates.');
      else changes.push({ ...seg, ratePlanIds: ids, set, reset: [...new Set(reset)] });
    }
  });
  return errors.length ? { errors } : { changes };
}

// ─── Applying a bulk save ────────────────────────────────────────────────────

export interface BulkResult {
  pricingRulesCreated: number;
  restrictionRulesCreated: number;
  rulesTrimmed: number;
  rulesDeleted: number;
  /** Nights touched per rate plan (for refreshing the view, and later for the ARI outbox) */
  affected: { ratePlanId: string; dateFrom: ChannexDate; dateTo: ChannexDate; fields: CalendarField[] }[];
}

const oid = (id: string) => new mongoose.Types.ObjectId(id);

/** Save a document keeping explicit createdAt/updatedAt (they decide precedence). */
async function saveWithTimestamps(doc: mongoose.Document, createdAt: Date, updatedAt: Date) {
  doc.set('createdAt', createdAt);
  doc.set('updatedAt', updatedAt);
  await doc.save({ timestamps: false });
}

const restrictionFieldsOf = (r: Pick<IRestrictionRule, RestrictionField>): RestrictionField[] =>
  RESTRICTION_FIELDS.filter((f) => r[f] !== undefined && r[f] !== null);

const restrictionSegment = (r: Pick<IRestrictionRule, 'dateStart' | 'dateEnd' | 'days'>): Segment =>
  ({ dateStart: r.dateStart, dateEnd: r.dateEnd, days: normalizeDays(new Set(r.days ?? [])) });

/** Reset price on `seg` for one plan: trim/split calendar price rules (named rules untouched). */
async function resetPrice(ratePlanId: string, seg: Segment, stats: BulkResult) {
  const rules = await PricingRule.find({
    ratePlanId: oid(ratePlanId), origin: 'calendar',
    dateStart: { $lte: fromChannexDate(seg.dateEnd) }, dateEnd: { $gte: fromChannexDate(seg.dateStart) },
  });
  for (const rule of rules) {
    const ruleSeg = pricingRuleSegment(rule);
    if (!ruleSeg) continue;
    const { kept, hit } = subtractSegment(ruleSeg, seg);
    if (!hit) continue;
    const base = rule.toObject();
    for (const piece of kept) {
      const { _id, createdAt, updatedAt, ...fields } = base as any;
      await saveWithTimestamps(new PricingRule({ ...fields, ...segmentToPricingFields(piece), name: calendarRuleName(piece) }), createdAt, updatedAt);
    }
    await rule.deleteOne();
    stats.rulesTrimmed++;
  }
}

/** Reset restriction `fields` on `seg` for one plan: trim/split calendar booking rules. */
async function resetRestrictions(ratePlanId: string, seg: Segment, fields: RestrictionField[], stats: BulkResult) {
  const rules = await RestrictionRule.find({
    origin: 'calendar', ratePlanIds: oid(ratePlanId), dateStart: { $lte: seg.dateEnd }, dateEnd: { $gte: seg.dateStart },
  });
  for (const rule of rules) {
    const ruleFields = restrictionFieldsOf(rule);
    if (!ruleFields.some((f) => fields.includes(f))) continue;
    const { kept, hit } = subtractSegment(restrictionSegment(rule), seg);
    if (!hit) continue;
    const { _id, createdAt, updatedAt, ...base } = rule.toObject() as any;
    const pieces: { seg: Segment; ratePlanIds: unknown[]; drop: RestrictionField[] }[] = [];
    // Other plans sharing the rule keep it whole
    const others = (base.ratePlanIds ?? []).filter((id: unknown) => String(id) !== ratePlanId);
    if (others.length) pieces.push({ seg: restrictionSegment(rule), ratePlanIds: others, drop: [] });
    for (const k of kept) pieces.push({ seg: k, ratePlanIds: [oid(ratePlanId)], drop: [] });
    // On the reset nights, only the reset fields go
    if (ruleFields.some((f) => !fields.includes(f))) pieces.push({ seg: hit, ratePlanIds: [oid(ratePlanId)], drop: fields });
    for (const p of pieces) {
      const doc: any = { ...base, scope: 'rate_plans', roomTypeIds: [], ratePlanIds: p.ratePlanIds, dateStart: p.seg.dateStart, dateEnd: p.seg.dateEnd, days: p.seg.days, name: calendarRuleName(p.seg) };
      for (const f of p.drop) delete doc[f];
      await saveWithTimestamps(new RestrictionRule(doc), createdAt, updatedAt);
    }
    await rule.deleteOne();
    stats.rulesTrimmed++;
  }
}

/** Delete calendar rules of a plan fully covered by newer calendar rules. */
async function collectShadowed(ratePlanId: string, stats: BulkResult) {
  const priceRules = await PricingRule.find({ ratePlanId: oid(ratePlanId), origin: 'calendar', isActive: true })
    .select('_id updatedAt dateStart dateEnd periodPattern specificDays').lean();
  const priceIds = findShadowed(priceRules
    .map((r: any) => ({ id: String(r._id), updatedAt: new Date(r.updatedAt), segment: pricingRuleSegment(r)!, fields: ['price'] }))
    .filter((c) => c.segment));
  if (priceIds.length) {
    const res = await PricingRule.deleteMany({ _id: { $in: priceIds.map(oid) }, origin: 'calendar' });
    stats.rulesDeleted += res.deletedCount ?? 0;
  }

  // Only single-plan calendar rules can be shadowed by this plan's rules alone
  const restrictionRules = await RestrictionRule.find({ origin: 'calendar', isActive: true, ratePlanIds: oid(ratePlanId) }).lean();
  const restrictionIds = findShadowed(restrictionRules
    .filter((r: any) => (r.ratePlanIds ?? []).length === 1)
    .map((r: any) => ({ id: String(r._id), updatedAt: new Date(r.updatedAt), segment: restrictionSegment(r), fields: restrictionFieldsOf(r) })));
  if (restrictionIds.length) {
    const res = await RestrictionRule.deleteMany({ _id: { $in: restrictionIds.map(oid) }, origin: 'calendar' });
    stats.rulesDeleted += res.deletedCount ?? 0;
  }
}

/**
 * Apply validated changes in order: per change, first its resets, then its sets. Then clean up
 * shadowed calendar rules of every affected plan. Runs in the current tenant context.
 */
export async function applyBulkChanges(changes: CalendarChange[], userId?: string): Promise<BulkResult> {
  const stats: BulkResult = { pricingRulesCreated: 0, restrictionRulesCreated: 0, rulesTrimmed: 0, rulesDeleted: 0, affected: [] };
  // Strictly increasing timestamps: later rows win over earlier rows and over everything saved before
  let clock = Date.now();
  const tick = () => new Date(++clock);

  for (const change of changes) {
    const seg: Segment = { dateStart: change.dateStart, dateEnd: change.dateEnd, days: change.days };
    const resetRestrictionFields = change.reset.filter((f): f is RestrictionField => f !== 'price');
    const setRestrictionFields = RESTRICTION_FIELDS.filter((f) => change.set[f] !== undefined);

    for (const ratePlanId of change.ratePlanIds) {
      if (change.reset.includes('price')) await resetPrice(ratePlanId, seg, stats);
      if (resetRestrictionFields.length) await resetRestrictions(ratePlanId, seg, resetRestrictionFields, stats);

      if (change.set.price !== undefined) {
        const at = tick();
        await saveWithTimestamps(new PricingRule({
          name: calendarRuleName(seg), origin: 'calendar', ruleTarget: 'promotional', ratePlanId: oid(ratePlanId),
          ruleModel: 'custom', customBasePrice: change.set.price, isActive: true, ...segmentToPricingFields(seg),
        }), at, at);
        stats.pricingRulesCreated++;
      }
      if (setRestrictionFields.length) {
        const at = tick();
        const values = Object.fromEntries(setRestrictionFields.map((f) => [f, change.set[f]]));
        await saveWithTimestamps(new RestrictionRule({
          name: calendarRuleName(seg), origin: 'calendar', scope: 'rate_plans', ratePlanIds: [oid(ratePlanId)], roomTypeIds: [],
          dateStart: seg.dateStart, dateEnd: seg.dateEnd, days: seg.days, isActive: true, updatedBy: userId, ...values,
        }), at, at);
        stats.restrictionRulesCreated++;
      }
      stats.affected.push({
        ratePlanId, dateFrom: seg.dateStart, dateTo: seg.dateEnd,
        fields: [...new Set<CalendarField>([...change.reset, ...(Object.keys(change.set) as CalendarField[])])],
      });
    }
  }

  for (const ratePlanId of new Set(changes.flatMap((c) => c.ratePlanIds))) await collectShadowed(ratePlanId, stats);
  return stats;
}

// ─── The Calendar view ───────────────────────────────────────────────────────

export interface CalendarValue<T> { value: T; source: ValueSource }

export interface CalendarRatePlanDay {
  /** Currency units: `base` is the editable nightly price; rates per occupancy are what channels receive */
  price: { base: number; single: number; full: number; rates: Record<number, number>; source: ValueSource };
  restrictions: Record<RestrictionField, CalendarValue<number | boolean>>;
  /** Set when stop sell is forced regardless of booking rules */
  forcedStopSell?: string;
}

export interface CalendarView {
  from: ChannexDate;
  to: ChannexDate;
  dates: ChannexDate[];
  ratesIncludeTaxes: boolean;
  roomTypes: Array<{
    _id: string;
    name: string;
    capacity: number;
    isActive: boolean;
    /** Offered on OTAs through the channel manager */
    sellOnChannels: boolean;
    availability: Record<ChannexDate, { available: number; total: number; blocked: number; assigned: number; unassignedDemand: number; overbooked: number }>;
    ratePlans: Array<{ _id: string; name: string; isActive: boolean; sellOnChannels: boolean; days: Record<ChannexDate, CalendarRatePlanDay> }>;
  }>;
}

export async function getRateCalendar(q: { from: ChannexDate; to: ChannexDate; roomTypeIds?: string[]; ratesIncludeTaxes: boolean }): Promise<CalendarView> {
  const typeFilter = q.roomTypeIds ? { _id: { $in: q.roomTypeIds.map(oid) } } : {};
  const roomTypes = await RoomType.find(typeFilter).select('_id name capacity isActive sellOnChannels').sort({ name: 1 }).lean();
  const typeIds = roomTypes.map((t) => String(t._id));
  const plans = typeIds.length
    ? await RatePlan.find({ roomTypeId: { $in: typeIds.map(oid) } }).select('_id name roomTypeId isActive sellOnChannels').sort({ name: 1 }).lean()
    : [];
  const [inventory, resolved] = await Promise.all([
    typeIds.length ? getInventory({ dateFrom: q.from, dateTo: q.to, roomTypeIds: typeIds }) : Promise.resolve({}),
    plans.length ? resolveRates({ dateFrom: q.from, dateTo: q.to, ratePlanIds: plans.map((p) => String(p._id)), includeTaxes: q.ratesIncludeTaxes }) : Promise.resolve({}),
  ]);
  const units = (cents: number) => cents / 100;
  const dates = eachDate(q.from, q.to);

  return {
    from: q.from,
    to: q.to,
    dates,
    ratesIncludeTaxes: q.ratesIncludeTaxes,
    roomTypes: roomTypes.map((rt: any) => {
      const id = String(rt._id);
      const capacity = Math.max(1, rt.capacity ?? 1);
      return {
        _id: id,
        name: rt.name,
        capacity,
        isActive: rt.isActive,
        sellOnChannels: rt.sellOnChannels !== false,
        availability: Object.fromEntries(dates.map((d) => {
          const c = (inventory as any)[id]?.[d] ?? { total: 0, blocked: 0, assigned: 0, unassignedDemand: 0, available: 0, overbooked: 0 };
          return [d, { available: c.available, total: c.total, blocked: c.blocked, assigned: c.assigned, unassignedDemand: c.unassignedDemand, overbooked: c.overbooked }];
        })),
        ratePlans: plans.filter((p: any) => String(p.roomTypeId) === id).map((p: any) => {
          const byDate = (resolved as any)[String(p._id)] ?? {};
          return {
            _id: String(p._id),
            name: p.name,
            isActive: p.isActive,
            sellOnChannels: p.sellOnChannels !== false,
            days: Object.fromEntries(dates.map((d) => {
              const r = byDate[d];
              const restrictions = Object.fromEntries(RESTRICTION_FIELDS.map((f) => [f, { value: r[f], source: r.restrictionSources[f] }])) as CalendarRatePlanDay['restrictions'];
              const rates = Object.fromEntries(Object.entries(r.rates as Record<string, number>).map(([n, c]) => [n, units(c)]));
              return [d, {
                price: { base: units(r.basePrice), single: units(r.rates[1]), full: units(r.rates[capacity] ?? r.rates[1]), rates, source: r.priceSource },
                restrictions,
                ...(r.forcedStopSell ? { forcedStopSell: r.forcedStopSell } : {}),
              } as CalendarRatePlanDay];
            })),
          };
        }),
      };
    }),
  };
}

// ─── "Why?" for one availability cell ────────────────────────────────────────

export interface NightDetails {
  date: ChannexDate;
  roomTypeId: string;
  counts: InventoryCell;
  rooms: { _id: string; name: string; state: 'free' | 'blocked' | 'assigned'; block?: { _id: string; reason: string; notes?: string; until: ChannexDate }; reservation?: ReservationRef }[];
  /** Bookings of the type still waiting for a room */
  unassigned: (ReservationRef & { count: number })[];
}

interface ReservationRef { _id: string; code?: string; guestName: string; checkIn: ChannexDate; checkOut: ChannexDate; status: string }

/** Rooms, bookings and blocks behind one room type's availability on one night. */
export async function getNightDetails(roomTypeId: string, date: ChannexDate): Promise<NightDetails> {
  const data = await loadInventoryWindow({ dateFrom: date, dateTo: date });
  const counts = computeInventory({ ...data, dateFrom: date, dateTo: date, roomTypeIds: [roomTypeId] })[roomTypeId][date];
  const why = explainNight(data, roomTypeId, date);

  const resIds = [...new Set([...why.rooms.map((r) => r.reservationId), ...why.unassigned.map((u) => u.reservationId)].filter(Boolean))] as string[];
  const blockIds = why.rooms.map((r) => r.blockId).filter(Boolean) as string[];
  const [rooms, blocks, reservations] = await Promise.all([
    Room.find({ _id: { $in: why.rooms.map((r) => oid(r.roomId)) } }).select('_id name').lean(),
    blockIds.length ? RoomBlock.find({ _id: { $in: blockIds.map(oid) } }).select('_id reason notes endDate').lean() : Promise.resolve([]),
    resIds.length ? Reservation.find({ _id: { $in: resIds.map(oid) } }).select('_id reservationCode guestName checkInDate checkOutDate status').lean() : Promise.resolve([]),
  ]);
  const roomName = new Map(rooms.map((r: any) => [String(r._id), r.name]));
  const blockById = new Map(blocks.map((b: any) => [String(b._id), b]));
  const resById = new Map<string, ReservationRef>(reservations.map((r: any) => [String(r._id), {
    _id: String(r._id),
    code: r.reservationCode,
    guestName: [r.guestName?.firstName, r.guestName?.lastName].filter(Boolean).join(' '),
    checkIn: toChannexDate(new Date(r.checkInDate)),
    checkOut: r.checkOutDate ? toChannexDate(new Date(r.checkOutDate)) : addDays(toChannexDate(new Date(r.checkInDate)), 1),
    status: r.status,
  }]));

  return {
    date,
    roomTypeId,
    counts,
    rooms: why.rooms
      .map((r) => {
        const block: any = r.blockId ? blockById.get(r.blockId) : undefined;
        return {
          _id: r.roomId,
          name: roomName.get(r.roomId) ?? r.roomId,
          state: r.state,
          ...(block ? { block: { _id: String(block._id), reason: block.reason, notes: block.notes || undefined, until: toChannexDate(new Date(block.endDate)) } } : {}),
          ...(r.reservationId && resById.has(r.reservationId) ? { reservation: resById.get(r.reservationId)! } : {}),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    unassigned: why.unassigned
      .filter((u) => resById.has(u.reservationId))
      .map((u) => ({ ...resById.get(u.reservationId)!, count: u.count })),
  };
}

/** Days from `from` to `to` inclusive. */
export const viewLength = (from: ChannexDate, to: ChannexDate) => diffDays(from, to) + 1;
