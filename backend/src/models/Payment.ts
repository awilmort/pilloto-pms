import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'credit' | 'check';
export type PaymentStatus = 'completed' | 'pending' | 'reversed';

export interface IPayment extends Document {
  folioId: mongoose.Types.ObjectId;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  creditPaymentMethod?: Exclude<PaymentMethod, 'credit'>;
  creditPaymentDate?: Date;
  reference?: string;
  note?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>({
  folioId: {
    type: Schema.Types.ObjectId,
    ref: 'Folio',
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01,
  },
  method: {
    type: String,
    enum: ['cash', 'card', 'transfer', 'credit', 'check'],
    required: true,
  },
  status: {
    type: String,
    enum: ['completed', 'pending', 'reversed'],
    required: true,
  },
  creditPaymentMethod: {
    type: String,
    enum: ['cash', 'card', 'transfer', 'check'],
    required: false,
  },
  creditPaymentDate: {
    type: Date,
    required: false,
  },
  reference: {
    type: String,
    trim: true,
    maxlength: 120,
  },
  note: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
}, { timestamps: true });

paymentSchema.pre('validate', function (next) {
  if (!this.method) return next();
  if (this.method === 'credit') {
    if (!this.status) this.status = 'pending';
  } else if (!this.status) {
    this.status = 'completed';
  }
  next();
});

// ── Multi-tenancy ────────────────────────────────────────────
paymentSchema.plugin(tenantPlugin);

export default mongoose.model<IPayment>('Payment', paymentSchema);
