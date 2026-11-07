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
  /** Offered on OTAs through the channel manager (default true) */
  sellOnChannels?: boolean;
  /** The room type's default plan, pre-selected when no contract or promo code applies */
  isDefault?: boolean;
  /** 'private' = hidden in the booking engine unless a promo code unlocks it; staff can always book it */
  visibility?: 'public' | 'private';
  /** Promo codes (upper case) that unlock a private plan in the booking engine */
  accessCodes?: string[];
  /** Guest-facing text shown in the booking engine */
  description?: string;
}

// ─────────────────────────────────────────────────────────────
// Pricing Rule types
// ─────────────────────────────────────────────────────────────

export type RuleTarget = 'guest' | 'company' | 'promotional';
export type RuleModel = 'percentage' | 'fixed' | 'custom';
export type RuleDirection = 'discount' | 'surcharge';
export type RuleScope = 'base' | 'occupancy' | 'both';
export type PeriodPattern = 'all_days' | 'weekdays' | 'weekends' | 'specific_days';

export interface IOccupancyTierOverride {
  guestType: 'adult' | 'child';
  guestNumber: number;
  price: number;
}

export interface IBlackoutRange {
  start: string;
  end: string;
}

export interface PricingRule {
  _id?: string;
  name: string;
  ruleTarget: RuleTarget;
  companyId?: string | { _id: string; name: string };
  guestEmail?: string;
  ratePlanId: string | { _id: string; name: string; roomTypeId: string | object };
  ruleModel: RuleModel;
  direction?: RuleDirection;
  value?: number;
  scope?: RuleScope;
  customBasePrice?: number;
  customOccupancyTiers?: IOccupancyTierOverride[];
  periodPattern: PeriodPattern;
  specificDays?: number[];
  dateStart?: string;
  dateEnd?: string;
  minimumNights?: number;
  blackoutDates?: IBlackoutRange[];
  isActive?: boolean;
  /** 'calendar' = a price typed in Pricing → Calendar ("Ajustes del calendario") */
  origin?: 'manual' | 'calendar';
  updatedAt?: string;
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


