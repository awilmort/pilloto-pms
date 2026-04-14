import RatePlan, { IRatePlan } from '../models/RatePlan';
import PricingRuleModel, { RuleTarget, RuleModel, getRuleTargetPriority } from '../models/PricingRule';
import TaxModel from '../models/Tax';

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

  // ── Step 2: Distribute guests across rooms & calculate occupancy ──────────
  // The rate plan is applied per room. Guests are distributed as evenly as
  // possible: the first (N % R) rooms receive one extra guest.
  function distributeGuests(total: number, buckets: number): number[] {
    const base = Math.floor(total / buckets);
    const extra = total % buckets;
    return Array.from({ length: buckets }, (_, i) => (i < extra ? base + 1 : base));
  }

  function calcOccupancyCost(
    count: number,
    tiers: Array<{ guestNumber: number; price: number }>
  ): number {
    let cost = 0;
    for (let i = 1; i <= count; i++) {
      const tier = tiers.find(t => t.guestNumber === i) ?? tiers[tiers.length - 1];
      if (tier) cost += tier.price;
    }
    return cost;
  }

  const adultTiers = ratePlan.occupancyTiers
    .filter(t => t.guestType === 'adult')
    .sort((a, b) => a.guestNumber - b.guestNumber);

  const childTiers = ratePlan.occupancyTiers
    .filter(t => t.guestType === 'child')
    .sort((a, b) => a.guestNumber - b.guestNumber);

  const adultPerRoom = distributeGuests(adults, rooms);
  const childPerRoom = distributeGuests(children, rooms);

  // ── Step 3: Per-night subtotal ────────────────────────────
  // Base price and occupancy cost are summed across all rooms.
  let basePricePerNight = 0;
  let occupancyPerNight = 0;
  for (let r = 0; r < rooms; r++) {
    basePricePerNight += ratePlan.basePrice;
    occupancyPerNight += calcOccupancyCost(adultPerRoom[r], adultTiers)
      + calcOccupancyCost(childPerRoom[r], childTiers);
  }
  const subtotalPerNight = basePricePerNight + occupancyPerNight;

  // ── Step 4: Find & apply the single best matching pricing rule ─────────────
  const dayStart  = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd    = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const dayOfWeek = date.getDay(); // 0 = Sun … 6 = Sat
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

  // Post-query filters: period pattern, blackout dates, minimum nights.
  const filteredRules = ruleCandidates.filter(rule => {
    // Blackout dates — highest precedence; if the booking date is blacked out, skip the rule.
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
  });

  // Sort to select the single best rule:
  //   1. Target priority  — guest (3) > company (2) > promotional (1)
  //   2. Date specificity — shorter validity window wins (more specific)
  //   3. Effective value  — higher value wins; custom model is always treated as highest
  function dateRangeLen(r: any): number {
    if (r.dateStart && r.dateEnd) return r.dateEnd.getTime() - r.dateStart.getTime();
    return Infinity;
  }
  function effectiveVal(r: any): number {
    return r.ruleModel === 'custom' ? Infinity : (r.value ?? 0);
  }

  filteredRules.sort((a, b) => {
    const pa = getRuleTargetPriority(a.ruleTarget as RuleTarget);
    const pb = getRuleTargetPriority(b.ruleTarget as RuleTarget);
    if (pa !== pb) return pb - pa;                          // higher tier first
    const la = dateRangeLen(a), lb = dateRangeLen(b);
    if (la !== lb) return la - lb;                          // shorter range (more specific) first
    return effectiveVal(b) - effectiveVal(a);               // higher value first
  });

  const winnerRule = filteredRules[0] ?? null;

  let adjustedBase      = basePricePerNight;
  let adjustedOccupancy = occupancyPerNight;
  let appliedRule: TieredPriceResult['appliedRule'] = null;

  if (winnerRule) {
    appliedRule = {
      _id:        String(winnerRule._id),
      name:       winnerRule.name,
      ruleTarget: winnerRule.ruleTarget as RuleTarget,
      model:      winnerRule.ruleModel as RuleModel,
    };

    if (winnerRule.ruleModel === 'custom') {
      // Replace base price per room; recalculate occupancy from custom tiers.
      const customBase = winnerRule.customBasePrice ?? ratePlan.basePrice;
      adjustedBase = customBase * rooms;

      const customAdultTiers = (winnerRule.customOccupancyTiers ?? [])
        .filter(t => t.guestType === 'adult')
        .sort((a, b) => a.guestNumber - b.guestNumber);
      const customChildTiers = (winnerRule.customOccupancyTiers ?? [])
        .filter(t => t.guestType === 'child')
        .sort((a, b) => a.guestNumber - b.guestNumber);

      adjustedOccupancy = 0;
      for (let r = 0; r < rooms; r++) {
        const effAdult = customAdultTiers.length > 0 ? customAdultTiers : adultTiers;
        const effChild = customChildTiers.length > 0 ? customChildTiers : childTiers;
        adjustedOccupancy += calcOccupancyCost(adultPerRoom[r], effAdult)
          + calcOccupancyCost(childPerRoom[r], effChild);
      }
    } else {
      // 'percentage' | 'fixed'
      const sign  = (winnerRule.direction ?? 'discount') === 'discount' ? -1 : 1;
      const v     = winnerRule.value ?? 0;

      if (winnerRule.ruleModel === 'percentage') {
        const factor = (v / 100) * sign;
        if (winnerRule.scope === 'base'      || winnerRule.scope === 'both') {
          adjustedBase      = adjustedBase      + adjustedBase      * factor;
        }
        if (winnerRule.scope === 'occupancy' || winnerRule.scope === 'both') {
          adjustedOccupancy = adjustedOccupancy + adjustedOccupancy * factor;
        }
      } else {
        // 'fixed'
        const delta = v * sign;
        if (winnerRule.scope === 'base'      || winnerRule.scope === 'both') {
          adjustedBase      = adjustedBase      + delta;
        }
        if (winnerRule.scope === 'occupancy' || winnerRule.scope === 'both') {
          adjustedOccupancy = adjustedOccupancy + delta;
        }
      }
    }
  }

  const adjustedSubtotalPerNight = Math.max(0, adjustedBase + adjustedOccupancy);
  const adjustedSubtotal = adjustedSubtotalPerNight * nights;

  // ── Step 5: Apply taxes ───────────────────────────────────
  const activeTaxes = await TaxModel.find({ isActive: true }).sort({ priority: -1 }).exec();
  const taxBreakdowns: TaxBreakdown[] = [];
  let totalExclusiveTaxes = 0;

  for (const tax of activeTaxes) {
    let taxAmount = 0;

    if (tax.type === 'percentage') {
      taxAmount = adjustedSubtotal * (tax.value / 100);
    } else if (tax.type === 'fixed') {
      if (tax.appliesTo === 'guest') {
        taxAmount = (adults + children) * tax.value * nights;
      } else if (tax.appliesTo === 'room') {
        taxAmount = tax.value * rooms * nights;
      } else {
        // total scope
        taxAmount = tax.value;
      }
    }

    taxBreakdowns.push({
      name: tax.name,
      type: tax.type,
      amount: taxAmount,
      isInclusive: tax.isInclusive,
    });

    if (!tax.isInclusive) {
      totalExclusiveTaxes += taxAmount;
    }
  }

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

