// ─────────────────────────────────────────────────────────────
// Tiered pricing types
// ─────────────────────────────────────────────────────────────

export interface OccupancyTier {
  guestType: 'adult' | 'child';
  guestNumber: number;
  price: number;
}

export interface RatePlan {
  _id?: string;
  name: string;
  roomTypeId: string | { _id: string; name: string; capacity: number };
  basePrice: number;
  pricingMode: 'tiered';
  occupancyTiers: OccupancyTier[];
  isActive?: boolean;
}

export type AdjustmentType = 'replace' | 'percent' | 'fixed';
export type AdjustmentScope = 'base' | 'occupancy' | 'subtotal';

export interface PricingRuleAdjustment {
  _id?: string;
  name: string;
  priority: number;
  dateStart?: string;
  dateEnd?: string;
  roomTypeId?: string | { _id: string; name: string };
  ratePlanId?: string | { _id: string; name: string; roomTypeId: string | { _id: string; name: string } };
  companyId?: string | { _id: string; name: string };
  guestEmail?: string;
  adjustmentType: AdjustmentType;
  adjustmentValue: number;
  adjustmentScope: AdjustmentScope;
  isActive?: boolean;
}

export interface TaxConfig {
  _id?: string;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  appliesTo: 'room' | 'guest' | 'total';
  isInclusive: boolean;
  priority: number;
  isActive?: boolean;
}

export interface TieredPriceBreakdown {
  basePrice: number;
  occupancyCost: number;
  subtotal: number;
  adjustedSubtotal: number;
  taxes: Array<{ name: string; type: string; amount: number; isInclusive: boolean }>;
  totalTaxes: number;
  finalTotal: number;
  nights: number;
}

/**
 * Client-side tiered price calculation (mirrors backend logic).
 * Used for real-time preview in the UI before calling the backend.
 */
export function calculateTieredPriceLocal(
  ratePlan: RatePlan,
  adults: number,
  children: number,
  nights = 1,
  rules: PricingRuleAdjustment[] = [],
  taxes: TaxConfig[] = [],
  date?: Date,
  companyId?: string,
  guestEmail?: string
): TieredPriceBreakdown {
  // Step 1: Occupancy cost
  let occupancyCost = 0;
  for (let i = 1; i <= adults; i++) {
    const tier = ratePlan.occupancyTiers.find(t => t.guestType === 'adult' && t.guestNumber === i);
    if (tier) occupancyCost += tier.price;
  }
  for (let i = 1; i <= children; i++) {
    const tier = ratePlan.occupancyTiers.find(t => t.guestType === 'child' && t.guestNumber === i);
    if (tier) occupancyCost += tier.price;
  }

  const subtotalPerNight = ratePlan.basePrice + occupancyCost;

  // Step 2: Filter applicable rules
  const checkDate = date ?? new Date();
  const activeRules = rules.filter(r => {
    if (r.isActive === false) return false;
    // room type condition
    const ratePlanRoomTypeId = typeof ratePlan.roomTypeId === 'object' ? ratePlan.roomTypeId?._id : ratePlan.roomTypeId;
    const ruleRoomTypeId = typeof r.roomTypeId === 'object' ? r.roomTypeId?._id : r.roomTypeId;
    if (ruleRoomTypeId && ruleRoomTypeId !== ratePlanRoomTypeId) return false;
    // date range condition
    if (r.dateStart && r.dateEnd) {
      const ds = new Date(r.dateStart);
      const de = new Date(r.dateEnd);
      if (checkDate < ds || checkDate > de) return false;
    }
    // company condition
    const ruleCompanyId = typeof r.companyId === 'object' ? r.companyId?._id : r.companyId;
    if (ruleCompanyId && ruleCompanyId !== companyId) return false;
    // guest condition
    if (r.guestEmail && r.guestEmail !== guestEmail) return false;
    return true;
  });

  // Step 3: Apply rules
  let adjustedBase = ratePlan.basePrice;
  let adjustedOccupancy = occupancyCost;

  const applyOrder: AdjustmentType[] = ['replace', 'percent', 'fixed'];
  for (const type of applyOrder) {
    const rulesOfType = activeRules
      .filter(r => r.adjustmentType === type)
      .sort((a, b) => b.priority - a.priority);
    for (const rule of rulesOfType) {
      const { adjustmentScope, adjustmentValue } = rule;
      if (type === 'replace') {
        if (adjustmentScope === 'base') adjustedBase = adjustmentValue;
        else if (adjustmentScope === 'occupancy') adjustedOccupancy = adjustmentValue;
        else { adjustedBase = adjustmentValue; adjustedOccupancy = 0; }
      } else if (type === 'percent') {
        const factor = adjustmentValue / 100;
        if (adjustmentScope === 'base') adjustedBase += adjustedBase * factor;
        else if (adjustmentScope === 'occupancy') adjustedOccupancy += adjustedOccupancy * factor;
        else adjustedBase += (adjustedBase + adjustedOccupancy) * factor;
      } else {
        if (adjustmentScope === 'base') adjustedBase += adjustmentValue;
        else if (adjustmentScope === 'occupancy') adjustedOccupancy += adjustmentValue;
        else adjustedBase += adjustmentValue;
      }
    }
  }

  const adjustedSubtotal = Math.max(0, adjustedBase + adjustedOccupancy) * nights;

  // Step 4: Taxes
  const activeTaxes = taxes.filter(t => t.isActive !== false);
  const taxBreakdowns = activeTaxes.map(tax => {
    let amount = 0;
    if (tax.type === 'percentage') {
      amount = adjustedSubtotal * (tax.value / 100);
    } else if (tax.appliesTo === 'guest') {
      amount = (adults + children) * tax.value * nights;
    } else if (tax.appliesTo === 'room') {
      amount = tax.value * nights;
    } else {
      amount = tax.value;
    }
    return { name: tax.name, type: tax.type, amount, isInclusive: tax.isInclusive };
  });

  const totalTaxes = taxBreakdowns.filter(t => !t.isInclusive).reduce((s, t) => s + t.amount, 0);

  return {
    basePrice: ratePlan.basePrice * nights,
    occupancyCost: occupancyCost * nights,
    subtotal: subtotalPerNight * nights,
    adjustedSubtotal,
    taxes: taxBreakdowns,
    totalTaxes,
    finalTotal: adjustedSubtotal + totalTaxes,
    nights,
  };
}

