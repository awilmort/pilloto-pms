import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

interface ICashDistributionItem {
  denomination: number;
  count: number;
  subtotal: number;
}

interface IPaymentTotals {
  cash: number;
  card: number;
  transfer: number;
  check: number;
  total: number;
}

export interface ICashierClosure extends Document {
  user: mongoose.Types.ObjectId;
  periodStart: Date;
  periodEnd: Date;
  paymentTotals: IPaymentTotals;
  cashDistribution: ICashDistributionItem[];
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const cashierClosureSchema = new Schema<ICashierClosure>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  periodStart: {
    type: Date,
    required: true,
    index: true,
  },
  periodEnd: {
    type: Date,
    required: true,
    index: true,
  },
  paymentTotals: {
    cash: { type: Number, required: true, min: 0, default: 0 },
    card: { type: Number, required: true, min: 0, default: 0 },
    transfer: { type: Number, required: true, min: 0, default: 0 },
    check: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },
  },
  cashDistribution: {
    type: [
      {
        denomination: { type: Number, required: true },
        count: { type: Number, required: true, min: 0, default: 0 },
        subtotal: { type: Number, required: true, min: 0, default: 0 },
      }
    ],
    default: [],
  },
  note: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
}, { timestamps: true });

// ── Multi-tenancy ────────────────────────────────────────────
cashierClosureSchema.plugin(tenantPlugin);
// Per-tenant unique closure per user+period
cashierClosureSchema.index({ user: 1, periodStart: 1, periodEnd: 1, tenantId: 1 }, { unique: true });

export default mongoose.model<ICashierClosure>('CashierClosure', cashierClosureSchema);
