import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type ChargeTrigger = 'checkout_overdue' | 'no_show' | 'early_departure';
export type ReservationType = 'room' | 'daypass' | 'PasaTarde' | 'event';

export interface IChargeRule extends Document {
  name: string;
  trigger: ChargeTrigger;
  priority: number;
  conditions: {
    /** Hours past due before triggering (e.g. 2 for 2h after checkout time) */
    timeThresholdHours?: number;
    reservationTypes?: ReservationType[];
    roomTypeId?: mongoose.Types.ObjectId;
    dateStart?: Date;
    dateEnd?: Date;
  };
  chargeTemplateId: mongoose.Types.ObjectId;
  /** Multiplier applied on top of the template amount (1 = no change) */
  multiplierOverride?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const chargeRuleSchema = new Schema<IChargeRule>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  trigger: {
    type: String,
    enum: ['checkout_overdue', 'no_show', 'early_departure'],
    required: true,
  },
  priority: {
    type: Number,
    default: 0,
  },
  conditions: {
    timeThresholdHours: { type: Number, min: 0 },
    reservationTypes: [{ type: String, enum: ['room', 'daypass', 'PasaTarde', 'event'] }],
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType' },
    dateStart: { type: Date },
    dateEnd: { type: Date },
  },
  chargeTemplateId: {
    type: Schema.Types.ObjectId,
    ref: 'ChargeTemplate',
    required: true,
  },
  multiplierOverride: {
    type: Number,
    min: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

chargeRuleSchema.pre('save', function (next) {
  const { dateStart, dateEnd } = this.conditions;
  if (dateStart && dateEnd && new Date(dateStart) >= new Date(dateEnd)) {
    return next(new Error('conditions.dateEnd must be after conditions.dateStart'));
  }
  next();
});

// ── Multi-tenancy ────────────────────────────────────────────
chargeRuleSchema.plugin(tenantPlugin);

export default mongoose.model<IChargeRule>('ChargeRule', chargeRuleSchema);
