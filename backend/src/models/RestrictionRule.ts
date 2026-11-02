/**
 * RestrictionRule — "booking rules" (CHANNEX_ARCHITECTURE.md §4.3, §10.1).
 *
 * Pilloto-native. A rule has a date range (inclusive `YYYY-MM-DD`), optional weekdays, a scope
 * (whole property, some room types, or some rate plans) and any subset of the five restriction
 * values. For a rate plan, date and field, the most recently saved active rule covering that
 * date and scope and setting that field wins; with none, the defaults apply (min stay 1, no
 * max stay, open to arrival/departure, selling). "Open again" is therefore just a newer rule
 * setting the field back (minStayArrival 1, maxStay 0, CTA/CTD/stopSell false).
 *
 * Min stay is arrival-based only. Rules are created as named rules in the Pricing page
 * (origin 'manual') or by Calendar edits (origin 'calendar').
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { changeCapturePlugin } from '../services/channex/changeCapture';
import { isChannexDate, todayInTz, WeekdayCode } from '../services/channex/dates';
import { restrictionRuleProblems } from '../services/restrictionRules';

export const RESTRICTION_RULE_SCOPES = ['property', 'room_types', 'rate_plans'] as const;
export type RestrictionRuleScope = typeof RESTRICTION_RULE_SCOPES[number];
export const RESTRICTION_RULE_ORIGINS = ['manual', 'calendar'] as const;
export type RestrictionRuleOrigin = typeof RESTRICTION_RULE_ORIGINS[number];
export const WEEKDAY_CODES: WeekdayCode[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];

export interface IRestrictionRule extends Document {
  tenantId: mongoose.Types.ObjectId;
  name: string;
  origin: RestrictionRuleOrigin;
  scope: RestrictionRuleScope;
  roomTypeIds: mongoose.Types.ObjectId[];
  ratePlanIds: mongoose.Types.ObjectId[];
  /** Inclusive `YYYY-MM-DD` */
  dateStart: string;
  dateEnd: string;
  /** Weekdays the rule applies on; empty = every day */
  days: WeekdayCode[];
  /** Minimum nights, checked on the arrival date (1 = no minimum) */
  minStayArrival?: number;
  /** Maximum nights, checked on the arrival date (0 = no maximum) */
  maxStay?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
  isActive: boolean;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const dateField = {
  type: String,
  required: true,
  validate: { validator: (v: string) => isChannexDate(v), message: 'Dates must be real dates in YYYY-MM-DD format' },
};

const restrictionRuleSchema = new Schema<IRestrictionRule>(
  {
    name:        { type: String, required: true, trim: true, maxlength: 200 },
    origin:      { type: String, enum: RESTRICTION_RULE_ORIGINS, default: 'manual' },
    scope:       { type: String, enum: RESTRICTION_RULE_SCOPES, default: 'property' },
    roomTypeIds: [{ type: Schema.Types.ObjectId, ref: 'RoomType' }],
    ratePlanIds: [{ type: Schema.Types.ObjectId, ref: 'RatePlan' }],
    dateStart:   dateField,
    dateEnd:     dateField,
    days:        [{ type: String, enum: WEEKDAY_CODES }],
    minStayArrival:    { type: Number, min: 1, max: 730 },
    maxStay:           { type: Number, min: 0, max: 730 },
    closedToArrival:   { type: Boolean },
    closedToDeparture: { type: Boolean },
    stopSell:          { type: Boolean },
    isActive:    { type: Boolean, default: true },
    updatedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Cross-field rules (range, scope consistency, at least one restriction, 730-day horizon) —
// same checks the API reports, so a save can never store an inconsistent rule.
// The horizon counts from the latest "today" on Earth (UTC+14): the routes check against the
// property's own date first, so this can never refuse what they accepted.
restrictionRuleSchema.pre('validate', function (next) {
  const problems = restrictionRuleProblems(this.toObject(), todayInTz('Pacific/Kiritimati'));
  if (problems.length) this.invalidate('dateStart', problems.join(' '));
  next();
});

restrictionRuleSchema.plugin(tenantPlugin);
restrictionRuleSchema.plugin(changeCapturePlugin, { model: 'RestrictionRule' });
restrictionRuleSchema.index({ tenantId: 1, isActive: 1, dateStart: 1, dateEnd: 1 });
restrictionRuleSchema.index({ tenantId: 1, origin: 1 });

export default mongoose.model<IRestrictionRule>('RestrictionRule', restrictionRuleSchema);
