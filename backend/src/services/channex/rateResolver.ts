/**
 * RateResolver — per-night prices and booking rules per rate plan (CHANNEX_ARCHITECTURE.md §6.1).
 *
 * Pilloto-native translation layer: existing rate plans + promotional pricing rules (including
 * Calendar adjustments) + booking rules (RestrictionRule) become, for every rate plan and date,
 * the per-occupancy rates and restrictions that channels receive. Nothing is stored here.
 *
 * For rate plan P and date d:
 *   1. base = P.basePrice; adult occupancy cost for n adults = Σ adult tiers 1..n (last tier repeats)
 *   2. the single best PROMOTIONAL rule for d (calendar adjustments first, newest wins), using the
 *      same selection and application as calculateTieredPrice(). Rules with minimumNights > 1
 *      cannot be expressed as a nightly price and are left out. Guest and company rules are
 *      front-desk prices and never reach channels.
 *   3. rate(n) = adjusted base + adjusted occupancy(n), n = 1..room-type capacity, in integer
 *      cents; optionally plus the tenant's exclusive taxes (ratesIncludeTaxes)
 *   4. restrictions: per field, the newest active RestrictionRule covering d and P wins
 *   5. stop sell is forced when P or its room type is inactive, or when any rate(n) ≤ 0
 *      (Channex rejects non-positive rates)
 */

import mongoose from 'mongoose';
import RatePlan from '../../models/RatePlan';
import RoomType from '../../models/RoomType';
import PricingRule from '../../models/PricingRule';
import RestrictionRule from '../../models/RestrictionRule';
import Tax from '../../models/Tax';
import AppSettings from '../../models/AppSettings';
import { computeNightPrice, isRuleApplicable, selectBestRule, PricingRuleLike, RatePlanPricing } from '../../utils/pricing';
import {
  RESTRICTION_FIELDS, RestrictionField, RestrictionRuleLike, ResolvedRestrictions,
  resolveRestrictionsOn, ruleCoversPlan, sortNewestFirst,
} from '../restrictionRules';
import { ChannexDate, DateRange, diffDays, eachDate, fromChannexDate } from './dates';

export const MAX_RESOLVE_DAYS = 731;

type Id = mongoose.Types.ObjectId | string;

export interface ResolverRatePlan extends RatePlanPricing {
  _id: Id;
  name?: string;
  roomTypeId: Id;
  isActive: boolean;
}

export interface ResolverRoomType {
  _id: Id;
  capacity: number;
  isActive: boolean;
}

export interface ResolverTax {
  name?: string;
  type: 'percentage' | 'fixed' | string;
  value: number;
  appliesTo: 'room' | 'guest' | 'total' | string;
  isInclusive: boolean;
}

/** Where a value comes from — for "why this value?" explanations in the Calendar. */
export type ValueSource =
  | { kind: 'plan' }
  | { kind: 'default' }
  | { kind: 'rule'; ruleId: string; name?: string; origin: 'manual' | 'calendar' }
  | { kind: 'booking_rule'; ruleId: string; name?: string; origin: 'manual' | 'calendar' };

export type StopSellReason = 'rate_plan_inactive' | 'room_type_inactive' | 'no_price';

export interface ResolvedDay extends ResolvedRestrictions {
  /** Nightly base price after the winning rule, pre-tax, in cents — the value a Calendar edit sets */
  basePrice: number;
  /** occupancy (adults) → rate in integer cents */
  rates: Record<number, number>;
  priceSource: ValueSource;
  restrictionSources: Record<RestrictionField, ValueSource>;
  /** Set when stop sell is forced regardless of booking rules */
  forcedStopSell?: StopSellReason;
}

/** ratePlanId → date → resolved values */
export type ResolvedRates = Record<string, Record<ChannexDate, ResolvedDay>>;

export interface ResolveRatesInput extends DateRange {
  ratePlans: ResolverRatePlan[];
  roomTypes: ResolverRoomType[];
  /** Pricing rules of those plans (any target/state — filtered here) */
  pricingRules: (PricingRuleLike & { ratePlanId: Id; isActive?: boolean })[];
  restrictionRules: RestrictionRuleLike[];
  /** Active taxes; used only when includeTaxes */
  taxes?: ResolverTax[];
  includeTaxes?: boolean;
}

/** Integer cents, robust to binary float noise (e.g. 89.99999999 → 9000). */
export const toCents = (amount: number) => Math.round(Number((amount * 100).toFixed(6)));

/** Exclusive taxes on one room-night for `adults` guests (per-stay 'total' taxes cannot be expressed per night). */
export function exclusiveNightTaxes(price: number, adults: number, taxes: ResolverTax[]): number {
  let total = 0;
  for (const tax of taxes) {
    if (tax.isInclusive) continue;
    if (tax.type === 'percentage') total += price * (tax.value / 100);
    else if (tax.type === 'fixed' && tax.appliesTo === 'guest') total += adults * tax.value;
    else if (tax.type === 'fixed' && tax.appliesTo === 'room') total += tax.value;
  }
  return total;
}

const ruleSource = (r: PricingRuleLike): ValueSource => ({
  kind: 'rule', ruleId: String(r._id), name: r.name, origin: r.origin === 'calendar' ? 'calendar' : 'manual',
});
const bookingRuleSource = (r: RestrictionRuleLike): ValueSource => ({
  kind: 'booking_rule', ruleId: String(r._id), name: r.name, origin: r.origin === 'calendar' ? 'calendar' : 'manual',
});

/** Pure core of RateResolver. */
export function resolveRatesFrom(input: ResolveRatesInput): ResolvedRates {
  const dates = eachDate(input.dateFrom, input.dateTo);
  const roomTypes = new Map(input.roomTypes.map((rt) => [String(rt._id), rt]));
  const taxes = input.includeTaxes ? (input.taxes ?? []) : [];
  const out: ResolvedRates = {};

  for (const plan of input.ratePlans) {
    const planId = String(plan._id);
    const roomTypeId = String(plan.roomTypeId);
    const roomType = roomTypes.get(roomTypeId);
    const capacity = Math.max(1, roomType?.capacity ?? 1);

    // Channel prices: promotional rules only, expressible per night
    const rules = input.pricingRules.filter((r) =>
      String(r.ratePlanId) === planId
      && r.isActive !== false
      && r.ruleTarget === 'promotional'
      && !(r.minimumNights && r.minimumNights > 1));
    const restrictions = sortNewestFirst(input.restrictionRules.filter((r) =>
      r.isActive !== false && ruleCoversPlan(r, { ratePlanId: planId, roomTypeId })));

    const forced: StopSellReason | undefined = !plan.isActive ? 'rate_plan_inactive'
      : (!roomType || !roomType.isActive) ? 'room_type_inactive'
        : undefined;

    out[planId] = {};
    for (const date of dates) {
      const night = fromChannexDate(date);
      const rule = selectBestRule(rules.filter((r) => isRuleApplicable(r, night, 1)));

      const rates: Record<number, number> = {};
      let basePrice = 0;
      for (let n = 1; n <= capacity; n++) {
        const night = computeNightPrice(plan, { adults: n, children: 0, rooms: 1 }, rule);
        if (n === 1) basePrice = toCents(Math.max(0, night.adjustedBase));
        const price = night.adjustedSubtotal;
        rates[n] = toCents(price + exclusiveNightTaxes(price, n, taxes));
      }

      const { values, sources } = resolveRestrictionsOn(restrictions, date);
      const restrictionSources = {} as Record<RestrictionField, ValueSource>;
      for (const field of RESTRICTION_FIELDS) {
        const src = sources[field];
        restrictionSources[field] = src ? bookingRuleSource(src) : { kind: 'default' };
      }

      const forcedStopSell = forced ?? (Object.values(rates).some((c) => c <= 0) ? 'no_price' : undefined);
      out[planId][date] = {
        ...values,
        stopSell: values.stopSell || Boolean(forcedStopSell),
        basePrice,
        rates,
        priceSource: rule ? ruleSource(rule) : { kind: 'plan' },
        restrictionSources,
        ...(forcedStopSell ? { forcedStopSell } : {}),
      };
    }
  }
  return out;
}

// ─── DB access ───────────────────────────────────────────────────────────────

export interface ResolveRatesQuery extends DateRange {
  ratePlanIds?: Id[];
  /** Default: AppSettings.channelManager.ratesIncludeTaxes */
  includeTaxes?: boolean;
}

/** `resolve(tenant, ratePlanIds?, dateFrom, dateTo)` of architecture §6.1, in the current tenant context. */
export async function resolveRates(q: ResolveRatesQuery): Promise<ResolvedRates> {
  if (q.dateTo < q.dateFrom) return {};
  if (diffDays(q.dateFrom, q.dateTo) + 1 > MAX_RESOLVE_DAYS) {
    throw new RangeError(`RateResolver window is limited to ${MAX_RESOLVE_DAYS} days`);
  }

  const planFilter = q.ratePlanIds ? { _id: { $in: q.ratePlanIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } : {};
  const ratePlans = await RatePlan.find(planFilter).select('_id name roomTypeId basePrice occupancyTiers isActive').lean();
  if (ratePlans.length === 0) return {};

  let includeTaxes = q.includeTaxes;
  if (includeTaxes === undefined) {
    const settings = await AppSettings.findOne({}).select('channelManager.ratesIncludeTaxes').lean();
    includeTaxes = Boolean(settings?.channelManager?.ratesIncludeTaxes);
  }

  // A day of slack on each side: rule windows are compared on server-local days
  const windowStart = new Date(fromChannexDate(q.dateFrom).getTime() - 36 * 3600e3);
  const windowEnd = new Date(fromChannexDate(q.dateTo).getTime() + 36 * 3600e3);
  const [roomTypes, pricingRules, restrictionRules, taxes] = await Promise.all([
    RoomType.find({ _id: { $in: ratePlans.map((p) => p.roomTypeId) } }).select('_id capacity isActive').lean(),
    PricingRule.find({
      ratePlanId: { $in: ratePlans.map((p) => p._id) },
      ruleTarget: 'promotional',
      isActive: true,
      $or: [{ dateStart: null }, { dateStart: { $lte: windowEnd }, dateEnd: { $gte: windowStart } }],
    }).lean(),
    RestrictionRule.find({ isActive: true, dateStart: { $lte: q.dateTo }, dateEnd: { $gte: q.dateFrom } }).lean(),
    includeTaxes ? Tax.find({ isActive: true }).sort({ priority: -1 }).lean() : Promise.resolve([]),
  ]);

  return resolveRatesFrom({
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
    ratePlans: ratePlans as unknown as ResolverRatePlan[],
    roomTypes: roomTypes as unknown as ResolverRoomType[],
    pricingRules: pricingRules as unknown as ResolveRatesInput['pricingRules'],
    restrictionRules: restrictionRules as unknown as RestrictionRuleLike[],
    taxes: taxes as unknown as ResolverTax[],
    includeTaxes,
  });
}
