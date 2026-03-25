import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type AdjustmentType = 'replace' | 'percent' | 'fixed';
export type AdjustmentScope = 'base' | 'occupancy' | 'subtotal';

export interface IPricingRule extends Document {
  name: string;
  priority: number;

  // Conditions (all optional — unset means "match any")
  dateStart?: Date;
  dateEnd?: Date;
  roomTypeId?: mongoose.Types.ObjectId;        // matches rate plan's room type
  ratePlanId?: mongoose.Types.ObjectId;       // specific rate plan
  companyId?: mongoose.Types.ObjectId;        // specific company
  guestEmail?: string;                        // specific guest

  // Action
  adjustmentType: AdjustmentType;
  adjustmentValue: number;
  adjustmentScope: AdjustmentScope;

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const pricingRuleSchema = new Schema<IPricingRule>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    priority: { type: Number, required: true, default: 0 },

    dateStart: { type: Date },
    dateEnd: { type: Date },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', index: true, sparse: true },
    ratePlanId: { type: Schema.Types.ObjectId, ref: 'RatePlan', index: true, sparse: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true, sparse: true },
    guestEmail: { type: String, trim: true, lowercase: true, index: true, sparse: true },

    adjustmentType: { type: String, enum: ['replace', 'percent', 'fixed'], required: true },
    adjustmentValue: { type: Number, required: true },
    adjustmentScope: { type: String, enum: ['base', 'occupancy', 'subtotal'], required: true, default: 'subtotal' },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

pricingRuleSchema.pre('save', function (next) {
  if ((this.dateStart && !this.dateEnd) || (!this.dateStart && this.dateEnd)) {
    return next(new Error('Both dateStart and dateEnd must be provided together'));
  }
  if (this.dateStart && this.dateEnd && this.dateStart > this.dateEnd) {
    return next(new Error('dateStart must be before or equal to dateEnd'));
  }
  next();
});

pricingRuleSchema.plugin(tenantPlugin);

export default mongoose.model<IPricingRule>('PricingRule', pricingRuleSchema);
