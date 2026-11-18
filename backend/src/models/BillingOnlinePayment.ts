import mongoose, { Document, Schema } from 'mongoose';

/**
 * An online payment a tenant started for one of Pilloto's charges: one HandyPay checkout session.
 * It becomes a `BillingPayment` (which issues the e-CF) once HandyPay confirms the session is paid.
 * Not tenant-scoped, with an explicit `tenantId` (like `BillingCharge`).
 */
export const ONLINE_PAYMENT_STATUSES = ['open', 'paid', 'expired', 'failed', 'needs_review'] as const;
export type OnlinePaymentStatus = (typeof ONLINE_PAYMENT_STATUSES)[number];

export interface IBillingOnlinePayment extends Document {
  tenantId: mongoose.Types.ObjectId;
  chargeId: mongoose.Types.ObjectId;
  provider: 'handypay';
  sessionId: string;
  url?: string;
  /** DOP, ITBIS included: the charge balance when the session was created. */
  amount: number;
  currency: string;
  status: OnlinePaymentStatus;
  /** The payment recorded from it. */
  paymentId?: mongoose.Types.ObjectId;
  /** Why it could not be recorded (e.g. the charge changed meanwhile). */
  error?: string;
  startedByEmail?: string;
  /** HandyPay webhook event ids already handled (they can be delivered more than once). */
  eventIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const onlinePaymentSchema = new Schema<IBillingOnlinePayment>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    chargeId: { type: Schema.Types.ObjectId, ref: 'BillingCharge', required: true },
    provider: { type: String, enum: ['handypay'], default: 'handypay' },
    sessionId: { type: String, required: true },
    url: { type: String },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    status: { type: String, enum: ONLINE_PAYMENT_STATUSES, default: 'open', required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'BillingPayment' },
    error: { type: String, maxlength: 500 },
    startedByEmail: { type: String, trim: true },
    eventIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

onlinePaymentSchema.index({ provider: 1, sessionId: 1 }, { unique: true });
onlinePaymentSchema.index({ chargeId: 1, status: 1 });

export default mongoose.model<IBillingOnlinePayment>('BillingOnlinePayment', onlinePaymentSchema);
