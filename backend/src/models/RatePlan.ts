import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IOccupancyTier {
  guestType: 'adult' | 'child';
  guestNumber: number; // 1-based position (1st adult, 2nd adult, etc.)
  price: number;       // 0 means "included"
}

export interface IRatePlan extends Document {
  name: string;             // e.g., "Standard Rate", "Non-refundable", "Corporate Rate"
  roomTypeId: mongoose.Types.ObjectId; // Reference to the RoomType this plan applies to
  basePrice: number;        // nightly / per-stay base price
  pricingMode: 'tiered';    // only supported mode
  occupancyTiers: IOccupancyTier[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const occupancyTierSchema = new Schema<IOccupancyTier>(
  {
    guestType: { type: String, enum: ['adult', 'child'], required: true },
    guestNumber: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const ratePlanSchema = new Schema<IRatePlan>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true },
    basePrice: { type: Number, required: true, min: 0, default: 0 },
    pricingMode: { type: String, enum: ['tiered'], default: 'tiered' },
    occupancyTiers: [occupancyTierSchema],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ratePlanSchema.index({ roomTypeId: 1, isActive: 1 });

ratePlanSchema.plugin(tenantPlugin);

export default mongoose.model<IRatePlan>('RatePlan', ratePlanSchema);
