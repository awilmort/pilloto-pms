import RatePlan, { IRatePlan } from '../models/RatePlan';
import PricingRuleModel from '../models/PricingRule';
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
}

export interface TaxBreakdown {
  name: string;
  type: 'percentage' | 'fixed';
  amount: number;
  isInclusive: boolean;
}

export interface TieredPriceResult {
  ratePlan: { _id: string; name: string; roomTypeId: string; roomTypeName: string } | null;
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

  // ── Step 4: Apply pricing rules ──────────────────────────
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

  const ruleFilter: any = {
    isActive: true,
    $or: [
      { dateStart: { $exists: false } },
      { dateStart: null },
      { dateStart: { $lte: dayEnd }, dateEnd: { $gte: dayStart } },
    ],
  };

  // Condition matching: room type
  const roomTypeIdStr = String(ratePlan.roomTypeId?._id ?? ratePlan.roomTypeId ?? '');
  const roomTypeCondition: any[] = [
    { roomTypeId: { $exists: false } },
    { roomTypeId: null },
    { roomTypeId: ratePlan.roomTypeId },
  ];
  ruleFilter.$and = [
    { $or: roomTypeCondition },
  ];

  // Condition matching: company
  if (companyId) {
    ruleFilter.$and.push({
      $or: [{ companyId: { $exists: false } }, { companyId: null }, { companyId }],
    });
  } else {
    ruleFilter.$and.push({
      $or: [{ companyId: { $exists: false } }, { companyId: null }],
    });
  }

  // Condition matching: guest email
  if (guestEmail) {
    ruleFilter.$and.push({
      $or: [{ guestEmail: { $exists: false } }, { guestEmail: null }, { guestEmail: guestEmail.toLowerCase() }],
    });
  } else {
    ruleFilter.$and.push({
      $or: [{ guestEmail: { $exists: false } }, { guestEmail: null }],
    });
  }

  const applicableRules = await PricingRuleModel.find(ruleFilter)
    .sort({ priority: -1 })
    .exec();

  // Apply rules in execution order: replace → percent → fixed (then by priority within each type)
  const applyOrder: Array<'replace' | 'percent' | 'fixed'> = ['replace', 'percent', 'fixed'];

  let adjustedBase = basePricePerNight;
  let adjustedOccupancy = occupancyPerNight;

  for (const type of applyOrder) {
    const rulesOfType = applicableRules.filter(r => r.adjustmentType === type);
    for (const rule of rulesOfType) {
      const { adjustmentScope, adjustmentValue } = rule;

      if (type === 'replace') {
        if (adjustmentScope === 'base') adjustedBase = adjustmentValue;
        else if (adjustmentScope === 'occupancy') adjustedOccupancy = adjustmentValue;
        else if (adjustmentScope === 'subtotal') {
          // replace entire subtotal means override base, zero out occupancy
          adjustedBase = adjustmentValue;
          adjustedOccupancy = 0;
        }
      } else if (type === 'percent') {
        const factor = adjustmentValue / 100;
        if (adjustmentScope === 'base') adjustedBase += adjustedBase * factor;
        else if (adjustmentScope === 'occupancy') adjustedOccupancy += adjustedOccupancy * factor;
        else if (adjustmentScope === 'subtotal') {
          const sub = adjustedBase + adjustedOccupancy;
          const delta = sub * factor;
          adjustedBase += delta;
        }
      } else if (type === 'fixed') {
        if (adjustmentScope === 'base') adjustedBase += adjustmentValue;
        else if (adjustmentScope === 'occupancy') adjustedOccupancy += adjustmentValue;
        else if (adjustmentScope === 'subtotal') adjustedBase += adjustmentValue;
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

