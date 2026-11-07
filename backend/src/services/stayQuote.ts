/**
 * Stay quotes and booking-rule checks for Pilloto's own booking paths (CHANNEX_ARCHITECTURE.md
 * §6.1, §8.5; plan Phase 4.5). Pilloto-native.
 *
 * Prices are summed night by night with the same building blocks as the channel-manager
 * RateResolver, so the booking engine and OTAs quote the same nightly rate:
 *   - each night gets its own best promotional rule (calendar adjustments first, newest wins),
 *     so a calendar price on one night changes only that night of a stay
 *   - for one room without children, a night's price is exactly the rate OTAs receive for that
 *     occupancy. Two differences are deliberate: children and multi-room parties are priced
 *     with the plan's child tiers and guest split, and long-stay rules (minimumNights > 1),
 *     which OTAs cannot receive as a nightly price, still apply to stays long enough
 *   - each night is rounded to cents; taxes are computed on the stay like calculateTieredPrice
 *
 * Booking rules (RestrictionRule + forced stop sell) are checked with `stayViolations`: the
 * booking engine hides or refuses a plan that breaks one; staff get warnings and may override.
 *
 * Staff quotes also price contracts: a context loaded with `companyId` / `guestEmail` holds
 * that company's and guest's rules, which beat promotional ones night by night (guest >
 * company > promotional, as in calculateTieredPrice). Which plan a stay is booked on is
 * decided by services/ratePlanSelection.ts.
 */

import mongoose from 'mongoose';
import RatePlan from '../models/RatePlan';
import RoomType from '../models/RoomType';
import PricingRule from '../models/PricingRule';
import RestrictionRule from '../models/RestrictionRule';
import Tax from '../models/Tax';
import {
  computeNightPrice, computeStayTaxes, isRuleApplicable, selectBestRule, PricingRuleLike, TaxBreakdown, TaxLike,
} from '../utils/pricing';
import { resolveRatesFrom, toCents, ResolverRatePlan, ResolverRoomType, ValueSource } from './channex/rateResolver';
import {
  describeStayViolation, stayViolations, RestrictionDays, RestrictionRuleLike, StayViolation,
} from './restrictionRules';
import { ChannexDate, eachNight, fromChannexDate, isChannexDate, toChannexDate } from './channex/dates';

type Id = mongoose.Types.ObjectId | string;

/** Plan fields the rate-plan selection reads (services/ratePlanSelection.ts). */
export interface StayPlanMeta {
  isDefault?: boolean;
  visibility?: 'public' | 'private';
  accessCodes?: string[];
  description?: string;
}

export interface StayContext {
  ratePlans: (ResolverRatePlan & StayPlanMeta & { name: string })[];
  roomTypes: (ResolverRoomType & { name?: string })[];
  pricingRules: (PricingRuleLike & { ratePlanId: Id; isActive?: boolean })[];
  restrictionRules: RestrictionRuleLike[];
  taxes: TaxLike[];
  /**
   * Staff quotes for a company or guest: their negotiated (company / guest) rules price the
   * stay. Without it only promotional rules apply, whatever the context holds — guest-facing
   * quotes never get negotiated prices.
   */
  negotiatedRules?: boolean;
}

export interface Stay {
  /** Property-local `YYYY-MM-DD` */
  checkIn: ChannexDate;
  checkOut: ChannexDate;
}

export interface StayParty {
  adults: number;
  children: number;
  rooms: number;
}

export interface NightQuote {
  date: ChannexDate;
  /** Price of the night for the party (all rooms), pre-tax, currency units */
  price: number;
  source: ValueSource;
}

/** Same shape as calculateTieredPrice()'s result, plus the nightly breakdown and booking-rule checks. */
export interface StayQuote {
  ratePlan: { _id: string; name: string; roomTypeId: string; roomTypeName: string };
  /** The rule of the first night (compatibility with single-rule quotes) */
  appliedRule: { _id: string; name: string; ruleTarget: string; model: string } | null;
  basePrice: number;
  occupancyCost: number;
  subtotal: number;
  adjustedSubtotal: number;
  taxes: TaxBreakdown[];
  totalTaxes: number;
  finalTotal: number;
  nights: number;
  nightly: NightQuote[];
  /** Booking rules the stay breaks for this plan (empty = bookable) */
  violations: StayViolation[];
  /**
   * A negotiated rule priced at least one night: 'guest' (a rule for the guest's e-mail) beats
   * 'company'. Null when only promotional rules or the plan price applied.
   */
  contract: 'guest' | 'company' | null;
}

const round2 = (n: number) => toCents(n) / 100;

/** A stay from Dates or `YYYY-MM-DD` strings (Pilloto stores calendar dates at noon UTC). */
export function toStay(checkIn: Date | string, checkOut: Date | string): Stay {
  const asDate = (v: Date | string) => (typeof v === 'string' && isChannexDate(v) ? v : toChannexDate(new Date(v)));
  return { checkIn: asDate(checkIn), checkOut: asDate(checkOut) };
}

// ─── Pure core ───────────────────────────────────────────────────────────────

/** Restriction values for check-in through check-out (departure date included) for one plan. */
export function stayRestrictionDays(ctx: StayContext, ratePlanId: string, stay: Stay): RestrictionDays {
  const plan = ctx.ratePlans.find((p) => String(p._id) === ratePlanId);
  if (!plan || stay.checkOut <= stay.checkIn) return {};
  const resolved = resolveRatesFrom({
    dateFrom: stay.checkIn,
    dateTo: stay.checkOut,
    ratePlans: [plan],
    roomTypes: ctx.roomTypes,
    pricingRules: ctx.pricingRules,
    restrictionRules: ctx.restrictionRules,
  })[ratePlanId] ?? {};
  const days: RestrictionDays = {};
  for (const [date, d] of Object.entries(resolved)) {
    days[date] = {
      minStayArrival: d.minStayArrival, maxStay: d.maxStay, closedToArrival: d.closedToArrival,
      closedToDeparture: d.closedToDeparture, stopSell: d.stopSell,
      ...(d.forcedStopSell ? { forcedStopSell: d.forcedStopSell } : {}),
    };
  }
  return days;
}

/** Booking rules the stay breaks for one plan. */
export function checkStayFrom(ctx: StayContext, ratePlanId: string, stay: Stay): StayViolation[] {
  return stayViolations(stayRestrictionDays(ctx, ratePlanId, stay), stay.checkIn, stay.checkOut);
}

/** Night-by-night quote for one plan, or null when the plan is not in the context. */
export function quoteStayFrom(ctx: StayContext, ratePlanId: string, stay: Stay, party: StayParty): StayQuote | null {
  const plan = ctx.ratePlans.find((p) => String(p._id) === ratePlanId);
  if (!plan) return null;
  const roomType = ctx.roomTypes.find((rt) => String(rt._id) === String(plan.roomTypeId));
  const nightDates = eachNight(stay.checkIn, stay.checkOut);
  const stayNights = nightDates.length;
  const rooms = Math.max(1, party.rooms);
  // Negotiated (company / guest) rules only for staff quotes that loaded them
  const rules = ctx.pricingRules.filter((r) => String(r.ratePlanId) === ratePlanId && r.isActive !== false
    && (r.ruleTarget === 'promotional' || ctx.negotiatedRules === true));

  let basePrice = 0;
  let occupancyCost = 0;
  let subtotal = 0;
  let adjustedCents = 0;
  let firstRule: PricingRuleLike | null = null;
  let contract: StayQuote['contract'] = null;
  const nightly: NightQuote[] = [];
  nightDates.forEach((date, i) => {
    const rule = selectBestRule(rules.filter((r) => isRuleApplicable(r, fromChannexDate(date), stayNights)));
    if (i === 0) firstRule = rule;
    if (rule?.ruleTarget === 'guest') contract = 'guest';
    else if (rule?.ruleTarget === 'company' && contract !== 'guest') contract = 'company';
    const night = computeNightPrice(plan, { adults: party.adults, children: party.children, rooms }, rule);
    const cents = toCents(night.adjustedSubtotal);
    basePrice += night.basePrice;
    occupancyCost += night.occupancyCost;
    subtotal += night.subtotal;
    adjustedCents += cents;
    nightly.push({
      date,
      price: cents / 100,
      source: rule
        ? { kind: 'rule', ruleId: String(rule._id), name: rule.name, origin: rule.origin === 'calendar' ? 'calendar' : 'manual' }
        : { kind: 'plan' },
    });
  });

  const adjustedSubtotal = adjustedCents / 100;
  const nights = Math.max(1, stayNights);
  const { taxes, totalExclusive } = computeStayTaxes(ctx.taxes, {
    adjustedSubtotal, adults: party.adults, children: party.children, rooms, nights,
  });
  const rule = firstRule as PricingRuleLike | null;
  return {
    ratePlan: {
      _id: ratePlanId,
      name: plan.name,
      roomTypeId: String(plan.roomTypeId),
      roomTypeName: roomType?.name ?? '',
    },
    appliedRule: rule
      ? { _id: String(rule._id), name: rule.name ?? '', ruleTarget: String(rule.ruleTarget), model: String(rule.ruleModel) }
      : null,
    basePrice: round2(basePrice),
    occupancyCost: round2(occupancyCost),
    subtotal: round2(subtotal),
    adjustedSubtotal,
    taxes: taxes.map((t) => ({ ...t, amount: round2(t.amount) })),
    totalTaxes: round2(totalExclusive),
    finalTotal: round2(adjustedSubtotal + totalExclusive),
    nights,
    nightly,
    violations: checkStayFrom(ctx, ratePlanId, stay),
    contract,
  };
}

/** Plain-language reason a quote cannot be booked (first violation), Spanish and English. */
export function violationMessages(violations: StayViolation[]): { es: string; en: string } | null {
  if (violations.length === 0) return null;
  return { es: describeStayViolation(violations[0], 'es'), en: describeStayViolation(violations[0], 'en') };
}

// ─── DB access ───────────────────────────────────────────────────────────────

export interface StayContextQuery extends Stay {
  ratePlanIds?: Id[];
  roomTypeIds?: Id[];
  /** Staff quotes: also load this company's negotiated rules */
  companyId?: Id;
  /** Staff quotes: also load the rules for this guest e-mail */
  guestEmail?: string;
}

/** Everything a stay quote reads, in the current tenant context, in five set-based queries. */
export async function loadStayContext(q: StayContextQuery): Promise<StayContext> {
  const oid = (id: Id) => new mongoose.Types.ObjectId(String(id));
  const planFilter: any = {};
  if (q.ratePlanIds) planFilter._id = { $in: q.ratePlanIds.map(oid) };
  if (q.roomTypeIds) planFilter.roomTypeId = { $in: q.roomTypeIds.map(oid) };
  const ratePlans = await RatePlan.find(planFilter)
    .select('_id name roomTypeId basePrice occupancyTiers isActive isDefault visibility accessCodes description')
    .lean();
  if (ratePlans.length === 0) return { ratePlans: [], roomTypes: [], pricingRules: [], restrictionRules: [], taxes: [], negotiatedRules: false };

  // A day of slack on each side: rule windows are compared on server-local days
  const windowStart = new Date(fromChannexDate(q.checkIn).getTime() - 36 * 3600e3);
  const windowEnd = new Date(fromChannexDate(q.checkOut).getTime() + 36 * 3600e3);
  const targets: any[] = [{ ruleTarget: 'promotional' }];
  if (q.companyId && mongoose.Types.ObjectId.isValid(String(q.companyId))) {
    targets.push({ ruleTarget: 'company', companyId: oid(q.companyId) });
  }
  const email = typeof q.guestEmail === 'string' ? q.guestEmail.trim().toLowerCase() : '';
  if (email) targets.push({ ruleTarget: 'guest', guestEmail: email });
  const [roomTypes, pricingRules, restrictionRules, taxes] = await Promise.all([
    RoomType.find({ _id: { $in: ratePlans.map((p) => p.roomTypeId) } }).select('_id name capacity isActive').lean(),
    PricingRule.find({
      ratePlanId: { $in: ratePlans.map((p) => p._id) },
      $and: [{ $or: targets }],
      isActive: true,
      $or: [{ dateStart: null }, { dateStart: { $lte: windowEnd }, dateEnd: { $gte: windowStart } }],
    }).lean(),
    RestrictionRule.find({ isActive: true, dateStart: { $lte: q.checkOut }, dateEnd: { $gte: q.checkIn } }).lean(),
    Tax.find({ isActive: true }).sort({ priority: -1 }).lean(),
  ]);
  return {
    ratePlans: ratePlans as unknown as StayContext['ratePlans'],
    roomTypes: roomTypes as unknown as StayContext['roomTypes'],
    pricingRules: pricingRules as unknown as StayContext['pricingRules'],
    restrictionRules: restrictionRules as unknown as RestrictionRuleLike[],
    taxes: taxes as unknown as TaxLike[],
    negotiatedRules: targets.length > 1,
  };
}

export interface StayWarning {
  ratePlanId: string;
  ratePlanName: string;
  roomTypeName: string;
  code: StayViolation['code'];
  violation: StayViolation;
  message: { es: string; en: string };
}

/** Booking rules a stay breaks on each given plan — staff warnings, never errors. */
export async function stayRestrictionWarnings(q: Stay & { ratePlanIds: Id[] }): Promise<StayWarning[]> {
  const ids = [...new Set(q.ratePlanIds.map(String))];
  if (ids.length === 0 || q.checkOut <= q.checkIn) return [];
  const ctx = await loadStayContext({ ...q, ratePlanIds: ids });
  const warnings: StayWarning[] = [];
  for (const plan of ctx.ratePlans) {
    const id = String(plan._id);
    const roomTypeName = ctx.roomTypes.find((rt) => String(rt._id) === String(plan.roomTypeId))?.name ?? '';
    for (const violation of checkStayFrom(ctx, id, q)) {
      warnings.push({
        ratePlanId: id, ratePlanName: plan.name, roomTypeName, code: violation.code, violation,
        message: { es: describeStayViolation(violation, 'es'), en: describeStayViolation(violation, 'en') },
      });
    }
  }
  return warnings;
}
