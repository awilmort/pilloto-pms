import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type ChargeType = 'base' | 'manual' | 'auto_rule';
export type ChargeCategory = 'room' | 'late_fee' | 'service' | 'damage' | 'adjustment';

export interface ICharge extends Document {
  folioId: mongoose.Types.ObjectId;
  description: string;
  amount: number;
  type: ChargeType;
  category?: ChargeCategory;
  chargeTemplateId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const chargeSchema = new Schema<ICharge>({
  folioId: {
    type: Schema.Types.ObjectId,
    ref: 'Folio',
    required: true,
    index: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  type: {
    type: String,
    enum: ['base', 'manual', 'auto_rule'],
    default: 'base',
    required: true,
  },
  category: {
    type: String,
    enum: ['room', 'late_fee', 'service', 'damage', 'adjustment'],
  },
  chargeTemplateId: {
    type: Schema.Types.ObjectId,
    ref: 'ChargeTemplate',
  },
}, { timestamps: true });

// ── Multi-tenancy ────────────────────────────────────────────
chargeSchema.plugin(tenantPlugin);

export default mongoose.model<ICharge>('Charge', chargeSchema);
