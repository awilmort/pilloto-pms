import RatePlan, { IRatePlan } from '../models/RatePlan';
import PricingRuleModel, { RuleTarget, RuleModel, PricingRuleOrigin, getRuleTargetPriority } from '../models/PricingRule';
import TaxModel from '../models/Tax';

// ─── Pure building blocks (shared with services/channex/rateResolver.ts) ────────
// calculateTieredPrice() and the channel-manager RateResolver use these, so the
// booking engine, admin quotes and OTAs never disagree about a night's price.

export interface OccupancyTierLike {
  guestType: 'adult' | 'child';
  guestNumber: number;
  price: number;
}

export interface RatePlanPricing {
  basePrice: number;
  occupancyTiers: OccupancyTierLike[];
}

/** The PricingRule fields that eligibility, selection and application read. */
export interface PricingRuleLike {
  _id?: unknown;
  name?: string;
  ruleTarget: RuleTarget | string;
  ruleModel: RuleModel | string;
  origin?: PricingRuleOrigin | string;
  direction?: 'discount' | 'surcharge' | string;
  value?: number;
  scope?: 'base' | 'occupancy' | 'both' | string;
  customBasePrice?: number;
  customOccupancyTiers?: OccupancyTierLike[];
  periodPattern?: string;
  specificDays?: number[];
  dateStart?: Date | null;
  dateEnd?: Date | null;
  minimumNights?: number;
  blackoutDates?: Array<{ start: Date; end: Date }>;
  updatedAt?: Date;
}

/** Guests split as evenly as possible across rooms: the first (N % R) rooms get one extra. */
export function distributeGuests(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const extra = total % buckets;
  return Array.from({ length: buckets }, (_, i) => (i < extra ? base + 1 : base));
}

/** Σ tier prices for guests 1..count; a missing tier falls back to the last defined tier. */
export function calcOccupancyCost(count: number, tiers: Array<{ guestNumber: number; price: number }>): number {
  let cost = 0;
  for (let i = 1; i <= count; i++) {
    const tier = tiers.find(t => t.guestNumber === i) ?? tiers[tiers.length - 1];
    if (tier) cost += tier.price;
  }
  return cost;
}

const tiersOf = (tiers: OccupancyTierLike[] | undefined, guestType: 'adult' | 'child') =>
  (tiers ?? []).filter(t => t.guestType === guestType).sort((a, b) => a.guestNumber - b.guestNumber);

/**
 * Whether a rule applies to a stay starting on `date` (validity window, blackout dates,
 * day-of-week pattern, minimum nights). Uses the server-local calendar day of `date`.
 */
export function isRuleApplicable(rule: PricingRuleLike, date: Date, nights: number): boolean {
  const dayStart  = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd    = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const dayOfWeek = date.getDay(); // 0 = Sun … 6 = Sat

  // Validity window (open-ended when dateStart is not set)
  if (rule.dateStart != null) {
    if (rule.dateEnd == null || rule.dateStart > dayEnd || rule.dateEnd < dayStart) return false;
  }

  // Blackout dates — highest precedence; if the date is blacked out, skip the rule.
  if (rule.blackoutDates && rule.blackoutDates.length > 0) {
    const blocked = rule.blackoutDates.some(b => {
      const bStart = new Date(b.start.getFullYear(), b.start.getMonth(), b.start.getDate());
      const bEnd   = new Date(b.end.getFullYear(),   b.end.getMonth(),   b.end.getDate(), 23, 59, 59, 999);
      return dayStart >= bStart && dayStart <= bEnd;
    });
    if (blocked) return false;
  }

  // Period pattern.
  if (rule.periodPattern === 'weekdays' && (dayOfWeek === 0 || dayOfWeek === 6)) return false;
  if (rule.periodPattern === 'weekends' && dayOfWeek !== 0 && dayOfWeek !== 6) return false;
  if (rule.periodPattern === 'specific_days') {
    if (!rule.specificDays?.includes(dayOfWeek)) return false;
  }

  // Minimum nights.
  if (rule.minimumNights && nights < rule.minimumNights) return false;

  return true;
}

/**
 * Ordering that selects the single best rule:
 *   1. Target priority  — guest (3) > company (2) > promotional (1)
 *   2. Calendar first   — a calendar adjustment (origin 'calendar') beats other promotional
 *                         rules; among calendar adjustments the most recently saved wins
 *   3. Date specificity — shorter validity window wins (more specific)
 *   4. Effective value  — higher value wins; custom model is always treated as highest
 */
export function compareRules(a: PricingRuleLike, b: PricingRuleLike): number {
  const pa = getRuleTargetPriority(a.ruleTarget as RuleTarget);
  const pb = getRuleTargetPriority(b.ruleTarget as RuleTarget);
  if (pa !== pb) return pb - pa;                          // higher tier first
  const ca = a.origin === 'calendar';
  const cb = b.origin === 'calendar';
  if (ca !== cb) return ca ? -1 : 1;                      // calendar adjustment first
  if (ca && cb) {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (ta !== tb) return tb - ta;                        // newest calendar adjustment first
  }
  const la = dateRangeLen(a), lb = dateRangeLen(b);
  if (la !== lb) return la - lb;                          // shorter range (more specific) first
  return effectiveVal(b) - effectiveVal(a);               // higher value first
}

function dateRangeLen(r: PricingRuleLike): number {
  if (r.dateStart && r.dateEnd) return r.dateEnd.getTime() - r.dateStart.getTime();
  return Infinity;
}
function effectiveVal(r: PricingRuleLike): number {
  return r.ruleModel === 'custom' ? Infinity : (r.value ?? 0);
}

/** The single best rule among already-eligible candidates, or null. */
export function selectBestRule<T extends PricingRuleLike>(rules: T[]): T | null {
  return [...rules].sort(compareRules)[0] ?? null;
}

export interface NightPrice {
  /** Σ base price over rooms, before any rule */
  basePrice: number;
  /** Σ occupancy cost over rooms, before any rule */
  occupancyCost: number;
  subtotal: number;
  adjustedBase: number;
  adjustedOccupancy: number;
  /** max(0, adjustedBase + adjustedOccupancy) */
  adjustedSubtotal: number;
}

/** One night's price for the party across `rooms` rooms, with the winning rule (if any) applied. */
export function computeNightPrice(
  plan: RatePlanPricing,
  party: { adults: number; children: number; rooms: number },
  rule: PricingRuleLike | null,
): NightPrice {
  const { adults, children, rooms } = party;
  const adultTiers = tiersOf(plan.occupancyTiers, 'adult');
  const childTiers = tiersOf(plan.occupancyTiers, 'child');
  const adultPerRoom = distributeGuests(adults, rooms);
  const childPerRoom = distributeGuests(children, rooms);

  // Base price and occupancy cost are summed across all rooms.
  let basePricePerNight = 0;
  let occupancyPerNight = 0;
  for (let r = 0; r < rooms; r++) {
    basePricePerNight += plan.basePrice;
    occupancyPerNight += calcOccupancyCost(adultPerRoom[r], adultTiers)
      + calcOccupancyCost(childPerRoom[r], childTiers);
  }
  const subtotalPerNight = basePricePerNight + occupancyPerNight;

  let adjustedBase      = basePricePerNight;
  let adjustedOccupancy = occupancyPerNight;

  if (rule) {
    if (rule.ruleModel === 'custom') {
      // Replace base price per room; recalculate occupancy from custom tiers.
      const customBase = rule.customBasePrice ?? plan.basePrice;
      adjustedBase = customBase * rooms;

      const customAdultTiers = tiersOf(rule.customOccupancyTiers, 'adult');
      const customChildTiers = tiersOf(rule.customOccupancyTiers, 'child');

      adjustedOccupancy = 0;
      for (let r = 0; r < rooms; r++) {
        const effAdult = customAdultTiers.length > 0 ? customAdultTiers : adultTiers;
        const effChild = customChildTiers.length > 0 ? customChildTiers : childTiers;
        adjustedOccupancy += calcOccupancyCost(adultPerRoom[r], effAdult)
          + calcOccupancyCost(childPerRoom[r], effChild);
      }
    } else {
      // 'percentage' | 'fixed'
      const sign  = (rule.direction ?? 'discount') === 'discount' ? -1 : 1;
      const v     = rule.value ?? 0;

      if (rule.ruleModel === 'percentage') {
        const factor = (v / 100) * sign;
        if (rule.scope === 'base'      || rule.scope === 'both') {
          adjustedBase      = adjustedBase      + adjustedBase      * factor;
        }
        if (rule.scope === 'occupancy' || rule.scope === 'both') {
          adjustedOccupancy = adjustedOccupancy + adjustedOccupancy * factor;
        }
      } else {
        // 'fixed'
        const delta = v * sign;
        if (rule.scope === 'base'      || rule.scope === 'both') {
          adjustedBase      = adjustedBase      + delta;
        }
        if (rule.scope === 'occupancy' || rule.scope === 'both') {
          adjustedOccupancy = adjustedOccupancy + delta;
        }
      }
    }
  }

  return {
    basePrice: basePricePerNight,
    occupancyCost: occupancyPerNight,
    subtotal: subtotalPerNight,
    adjustedBase,
    adjustedOccupancy,
    adjustedSubtotal: Math.max(0, adjustedBase + adjustedOccupancy),
  };
}

export interface TaxLike {
  name: string;
  type: 'percentage' | 'fixed' | string;
  value: number;
  appliesTo: 'room' | 'guest' | 'total' | string;
  isInclusive: boolean;
}

/**
 * Taxes on a stay's room total: percentages on the subtotal, fixed amounts per guest-night,
 * per room-night or once per stay. Only exclusive taxes add to the total.
 */
export function computeStayTaxes(
  taxes: TaxLike[],
  stay: { adjustedSubtotal: number; adults: number; children: number; rooms: number; nights: number },
): { taxes: TaxBreakdown[]; totalExclusive: number } {
  const breakdown: TaxBreakdown[] = [];
  let totalExclusive = 0;
  for (const tax of taxes) {
    let amount = 0;
    if (tax.type === 'percentage') {
      amount = stay.adjustedSubtotal * (tax.value / 100);
    } else if (tax.type === 'fixed') {
      if (tax.appliesTo === 'guest') amount = (stay.adults + stay.children) * tax.value * stay.nights;
      else if (tax.appliesTo === 'room') amount = tax.value * stay.rooms * stay.nights;
      else amount = tax.value; // total scope
    }
    breakdown.push({ name: tax.name, type: tax.type as TaxBreakdown['type'], amount, isInclusive: tax.isInclusive });
    if (!tax.isInclusive) totalExclusive += amount;
  }
  return { taxes: breakdown, totalExclusive };
}


export interface TieredPriceInput {
  ratePlanId?: string;
  roomTypeId?: string;
  adults: number;
  children: number;
  date: Date;
  nights?: number;
  rooms?: number; // number of rooms required (default 1)
  companyId?: string;
  guestEmail?: string;
  /**
   * 'admin' = front-desk booking: company and guest rules apply.
   * 'public' = guest self-service: only promotional rules apply.
   * Defaults to 'public'.
   */
  channel?: 'admin' | 'public';
}

export interface TaxBreakdown {
  name: string;
  type: 'percentage' | 'fixed';
  amount: number;
  isInclusive: boolean;
}

export interface TieredPriceResult {
  ratePlan: { _id: string; name: string; roomTypeId: string; roomTypeName: string } | null;
  /** The single pricing rule that was selected and applied, or null if none matched. */
  appliedRule?: { _id: string; name: string; ruleTarget: RuleTarget; model: RuleModel } | null;
  basePrice: number;
  occupancyCost: number;
  subtotal: number;
  adjustedSubtotal: number;
  taxes: TaxBreakdown[];
  totalTaxes: number;
  finalTotal: number;
  nights: number;
}

export async function calculateTieredPrice(input: TieredPriceInput): Promise<TieredPriceResult> {
  const nights = Math.max(1, input.nights ?? 1);
  const rooms = Math.max(1, input.rooms ?? 1);
  const { adults, children, date, companyId, guestEmail } = input;

  // ── Step 1: Resolve rate plan ──────────────────────────────
  let ratePlan: IRatePlan | null = null;

  if (input.ratePlanId) {
    ratePlan = await RatePlan.findById(input.ratePlanId).populate('roomTypeId', 'name capacity').exec();
  } else if (input.roomTypeId) {
    // Find the best active plan for the room type (prefer first alphabetically for determinism)
    ratePlan = await RatePlan.findOne({ roomTypeId: input.roomTypeId, isActive: true })
      .sort({ name: 1 })
      .populate('roomTypeId', 'name capacity')
      .exec();
  }

  if (!ratePlan) {
    return {
      ratePlan: null,
      appliedRule: null,
      basePrice: 0,
      occupancyCost: 0,
      subtotal: 0,
      adjustedSubtotal: 0,
      taxes: [],
      totalTaxes: 0,
      finalTotal: 0,
      nights,
    };
  }

  // ── Step 2: Find the single best matching pricing rule ─────────────────────
  // Rules are evaluated on the stay's first night and apply to every night.
  const dayStart  = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd    = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const channel   = input.channel ?? 'public';

  // Build candidate query: active rules for this rate plan, within validity window (if set).
  const candidateFilter: any = {
    isActive: true,
    ratePlanId: ratePlan._id,
    $or: [
      { dateStart: { $exists: false }, dateEnd: { $exists: false } },
      { dateStart: null },
      { dateStart: { $lte: dayEnd }, dateEnd: { $gte: dayStart } },
    ],
  };

  // Channel restriction:
  //   'admin'  = front-desk booking → company, guest, and promotional rules eligible.
  //   'public' = guest self-service → only promotional rules eligible.
  const targetConditions: any[] = [{ ruleTarget: 'promotional' }];
  if (channel === 'admin') {
    if (companyId) targetConditions.push({ ruleTarget: 'company', companyId });
    if (guestEmail) targetConditions.push({ ruleTarget: 'guest', guestEmail: guestEmail.toLowerCase() });
  }
  candidateFilter.$and = [{ $or: targetConditions }];

  const ruleCandidates = await PricingRuleModel.find(candidateFilter).exec();
  const winnerRule = selectBestRule(ruleCandidates.filter(rule => isRuleApplicable(rule, date, nights)));

  // ── Step 3–4: Per-night price with the rule applied ────────────────────────
  const night = computeNightPrice(ratePlan, { adults, children, rooms }, winnerRule);
  const basePricePerNight = night.basePrice;
  const occupancyPerNight = night.occupancyCost;
  const subtotalPerNight  = night.subtotal;

  let appliedRule: TieredPriceResult['appliedRule'] = null;
  if (winnerRule) {
    appliedRule = {
      _id:        String(winnerRule._id),
      name:       winnerRule.name,
      ruleTarget: winnerRule.ruleTarget as RuleTarget,
      model:      winnerRule.ruleModel as RuleModel,
    };
  }

  const adjustedSubtotalPerNight = night.adjustedSubtotal;
  const adjustedSubtotal = adjustedSubtotalPerNight * nights;

  // ── Step 5: Apply taxes ───────────────────────────────────
  const activeTaxes = await TaxModel.find({ isActive: true }).sort({ priority: -1 }).exec();
  const { taxes: taxBreakdowns, totalExclusive: totalExclusiveTaxes } = computeStayTaxes(activeTaxes, {
    adjustedSubtotal, adults, children, rooms, nights,
  });

  // ── Step 6: Final total ───────────────────────────────────
  const finalTotal = adjustedSubtotal + totalExclusiveTaxes;

  return {
    ratePlan: {
      _id: String(ratePlan._id),
      name: ratePlan.name,
      roomTypeId: String(ratePlan.roomTypeId?._id ?? ratePlan.roomTypeId ?? ''),
      roomTypeName: (ratePlan.roomTypeId as any)?.name ?? '',
    },
    appliedRule,
    basePrice: basePricePerNight * nights,
    occupancyCost: occupancyPerNight * nights,
    subtotal: subtotalPerNight * nights,
    adjustedSubtotal,
    taxes: taxBreakdowns,
    totalTaxes: totalExclusiveTaxes,
    finalTotal,
    nights,
  };
}

