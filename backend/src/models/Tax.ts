import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type TaxType = 'percentage' | 'fixed';
export type TaxScope = 'room' | 'guest' | 'total';

export interface ITax extends Document {
  name: string;
  type: TaxType;
  value: number;
  appliesTo: TaxScope;
  isInclusive: boolean; // true = already in price; false = added on top
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const taxSchema = new Schema<ITax>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: ['percentage', 'fixed'], required: true },
    value: { type: Number, required: true, min: 0 },
    appliesTo: { type: String, enum: ['room', 'guest', 'total'], required: true },
    isInclusive: { type: Boolean, default: false },
    priority: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

taxSchema.plugin(tenantPlugin);

export default mongoose.model<ITax>('Tax', taxSchema);
