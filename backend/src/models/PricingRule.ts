import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

// ── Enums / literal types ─────────────────────────────────────────────────────

/** Priority tier for the rule. Guest rules beat company; company beats promotional. */
export type RuleTarget = 'guest' | 'company' | 'promotional';

/** How the adjustment value is expressed. */
export type RuleModel = 'percentage' | 'fixed' | 'custom';

/** Whether the value is subtracted (discount) or added (surcharge). */
export type RuleDirection = 'discount' | 'surcharge';

/** Which price component(s) the adjustment targets. */
export type RuleScope = 'base' | 'occupancy' | 'both';

/** Day-of-week pattern for when the rule is active. */
export type PeriodPattern = 'all_days' | 'weekdays' | 'weekends' | 'specific_days';

// ── Priority helper ───────────────────────────────────────────────────────────

/**
 * Returns the numeric priority tier for a given rule target.
 * Guest (3) > Company (2) > Promotional (1).
 */
export function getRuleTargetPriority(target: RuleTarget): number {
  if (target === 'guest') return 3;
  if (target === 'company') return 2;
  return 1;
}

// ── Sub-document interfaces ───────────────────────────────────────────────────

export interface IBlackoutRange {
  start: Date;
  end: Date;
}

export interface IOccupancyTierOverride {
  guestType: 'adult' | 'child';
  guestNumber: number;
  price: number;
}

// ── Main interface ────────────────────────────────────────────────────────────

export interface IPricingRule extends Document {
  name: string;

  // ── Targeting ────────────────────────────────────────────────────────────────
  /** Priority tier and scope of application. */
  ruleTarget: RuleTarget;
  /** Required when ruleTarget = 'company'. */
  companyId?: mongoose.Types.ObjectId;
  /** Required when ruleTarget = 'guest'. Matched against reservation contactInfo.email. */
  guestEmail?: string;

  // ── Base rate plan ────────────────────────────────────────────────────────────
  /** The rate plan this rule is applied on top of (always required). */
  ratePlanId: mongoose.Types.ObjectId;

  // ── Rule model ────────────────────────────────────────────────────────────────
  ruleModel: RuleModel;

  // Fields for ruleModel = 'percentage' | 'fixed'
  /**
   * 'discount' subtracts, 'surcharge' adds.
   * For company and guest rules this is always forced to 'discount'.
   * Required when ruleModel = 'percentage' | 'fixed'.
   */
  direction?: RuleDirection;
  /** Percent (0–100) for percentage ruleModel; currency amount for fixed ruleModel. */
  value?: number;
  /** Which component(s) are adjusted. Required when ruleModel = 'percentage' | 'fixed'. */
  scope?: RuleScope;

  // Fields for ruleModel = 'custom' — replaces the rate plan entirely for matched bookings
  /** Replaces the rate plan base price per room per night. */
  customBasePrice?: number;
  /** Replaces the rate plan occupancy tiers. Unspecified guest types fall back to the base plan. */
  customOccupancyTiers?: IOccupancyTierOverride[];

  // ── Period ────────────────────────────────────────────────────────────────────
  periodPattern: PeriodPattern;
  /** Day numbers (0 = Sun … 6 = Sat). Required when periodPattern = 'specific_days'. */
  specificDays?: number[];

  // ── Validity window ───────────────────────────────────────────────────────────
  dateStart?: Date;
  dateEnd?: Date;

  // ── Stay conditions ───────────────────────────────────────────────────────────
  /** Rule only applies when the booking is for at least this many nights. */
  minimumNights?: number;

  // ── Blackout dates ────────────────────────────────────────────────────────────
  /**
   * Date ranges where this rule does NOT apply, regardless of the period pattern.
   * Blackout dates always take precedence.
   */
  blackoutDates?: IBlackoutRange[];

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const blackoutRangeSchema = new Schema<IBlackoutRange>(
  {
    start: { type: Date, required: true },
    end:   { type: Date, required: true },
  },
  { _id: false }
);

const occupancyTierOverrideSchema = new Schema<IOccupancyTierOverride>(
  {
    guestType:   { type: String, enum: ['adult', 'child'], required: true },
    guestNumber: { type: Number, required: true, min: 1 },
    price:       { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// ── Main schema ───────────────────────────────────────────────────────────────

const pricingRuleSchema = new Schema<IPricingRule>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },

    ruleTarget: {
      type: String,
      enum: ['guest', 'company', 'promotional'] as RuleTarget[],
      required: true,
      index: true,
    },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true, sparse: true },
    guestEmail: { type: String, trim: true, lowercase: true, index: true, sparse: true },

    ratePlanId: { type: Schema.Types.ObjectId, ref: 'RatePlan', required: true, index: true },

    ruleModel: {
      type: String,
      enum: ['percentage', 'fixed', 'custom'] as RuleModel[],
      required: true,
    },

    direction: { type: String, enum: ['discount', 'surcharge'] as RuleDirection[] },
    value:     { type: Number, min: 0 },
    scope:     { type: String, enum: ['base', 'occupancy', 'both'] as RuleScope[] },

    customBasePrice:      { type: Number, min: 0 },
    customOccupancyTiers: { type: [occupancyTierOverrideSchema], default: undefined },

    periodPattern: {
      type: String,
      enum: ['all_days', 'weekdays', 'weekends', 'specific_days'] as PeriodPattern[],
      required: true,
      default: 'all_days',
    },
    specificDays: { type: [Number], default: undefined },

    dateStart: { type: Date },
    dateEnd:   { type: Date },

    minimumNights: { type: Number, min: 1 },

    blackoutDates: { type: [blackoutRangeSchema], default: undefined },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ── Validation hook ───────────────────────────────────────────────────────────

pricingRuleSchema.pre('save', function (next) {
  // ── Target validations ────────────────────────────────────
  if (this.ruleTarget === 'company') {
    if (!this.companyId) return next(new Error('companyId is required for company rules'));
    if (this.ruleModel !== 'custom') this.direction = 'discount'; // always a discount
  }

  if (this.ruleTarget === 'guest') {
    if (!this.guestEmail?.trim()) return next(new Error('guestEmail is required for guest rules'));
    if (this.ruleModel !== 'custom') this.direction = 'discount'; // always a discount
  }

  if (this.ruleTarget === 'promotional') {
    // Promotional rules must not carry individual targeting
    this.companyId = undefined;
    this.guestEmail = undefined;
  }

  // ── Model validations ─────────────────────────────────────
  if (this.ruleModel === 'percentage' || this.ruleModel === 'fixed') {
    if (this.direction === undefined || this.direction === null) {
      return next(new Error('direction is required for percentage and fixed models'));
    }
    if (this.value === undefined || this.value === null) {
      return next(new Error('value is required for percentage and fixed models'));
    }
    if (!this.scope) {
      return next(new Error('scope is required for percentage and fixed models'));
    }
    if (this.ruleModel === 'percentage' && (this.value as number) > 100) {
      return next(new Error('Percentage value cannot exceed 100'));
    }
    // Clear custom-only fields
    this.customBasePrice      = undefined;
    this.customOccupancyTiers = undefined;
  }

  if (this.ruleModel === 'custom') {
    const hasBase  = this.customBasePrice !== undefined && this.customBasePrice !== null;
    const hasTiers = this.customOccupancyTiers && this.customOccupancyTiers.length > 0;
    if (!hasBase && !hasTiers) {
      return next(new Error('Custom model requires at least customBasePrice or customOccupancyTiers'));
    }
    // Clear percentage/fixed-only fields
    this.direction = undefined;
    this.value     = undefined;
    this.scope     = undefined;
  }

  // ── Period validations ────────────────────────────────────
  if (this.periodPattern === 'specific_days') {
    if (!this.specificDays || this.specificDays.length === 0) {
      return next(new Error('specificDays is required when periodPattern is specific_days'));
    }
    if (this.specificDays.some(d => d < 0 || d > 6)) {
      return next(new Error('specificDays values must be between 0 (Sun) and 6 (Sat)'));
    }
  }

  // ── Validity date validations ─────────────────────────────
  if ((this.dateStart && !this.dateEnd) || (!this.dateStart && this.dateEnd)) {
    return next(new Error('Both dateStart and dateEnd must be provided together'));
  }
  if (this.dateStart && this.dateEnd && this.dateStart > this.dateEnd) {
    return next(new Error('dateStart must be before or equal to dateEnd'));
  }

  // ── Blackout date validations ─────────────────────────────
  if (this.blackoutDates && this.blackoutDates.length > 0) {
    for (const range of this.blackoutDates) {
      if (range.start > range.end) {
        return next(new Error('Each blackout date start must be before or equal to its end'));
      }
    }
  }

  next();
});

// ── Multi-tenancy ─────────────────────────────────────────────────────────────
pricingRuleSchema.plugin(tenantPlugin);

export default mongoose.model<IPricingRule>('PricingRule', pricingRuleSchema);
