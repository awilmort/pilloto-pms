import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type CalculationMethod = 'fixed' | 'extra_night' | 'percent_of_nightly_rate';
export type ChargeCategory = 'room' | 'late_fee' | 'service' | 'damage' | 'adjustment';

export interface IChargeTemplate extends Document {
  name: string;
  /** Supports placeholders: {code}, {nights}, {rate} */
  descriptionTemplate: string;
  calculationMethod: CalculationMethod;
  /** Base amount or multiplier depending on calculationMethod */
  amount: number;
  category: ChargeCategory;
  taxApplicable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const chargeTemplateSchema = new Schema<IChargeTemplate>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  descriptionTemplate: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300,
  },
  calculationMethod: {
    type: String,
    enum: ['fixed', 'extra_night', 'percent_of_nightly_rate'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  category: {
    type: String,
    enum: ['room', 'late_fee', 'service', 'damage', 'adjustment'],
    required: true,
  },
  taxApplicable: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

// ── Multi-tenancy ────────────────────────────────────────────
chargeTemplateSchema.plugin(tenantPlugin);

export default mongoose.model<IChargeTemplate>('ChargeTemplate', chargeTemplateSchema);
