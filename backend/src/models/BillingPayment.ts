import mongoose, { Document, Schema } from 'mongoose';

/**
 * Money Pilloto received from a tenant against a `BillingCharge`. Recording one is what issues the
 * e-CF (a credit-fiscal invoice for the amount received), so each payment carries the link to it.
 *
 * `source` is how the payment reached Pilloto: `manual` (a person recorded it in the console) now;
 * PortalDom will record its collections the same way, with `source: 'portaldom'`.
 * Not tenant-scoped, with an explicit `tenantId`.
 */
export const BILLING_PAYMENT_METHODS = ['transfer', 'deposit', 'cash', 'check', 'card', 'other'] as const;
export type BillingPaymentMethod = (typeof BILLING_PAYMENT_METHODS)[number];

export type BillingPaymentSource = 'manual' | 'portaldom';

export interface IBillingPayment extends Document {
  tenantId: mongoose.Types.ObjectId;
  chargeId: mongoose.Types.ObjectId;
  /** Dominican pesos received, ITBIS included. */
  amount: number;
  paidAt: Date;
  method: BillingPaymentMethod;
  /** Bank reference, check number… */
  reference?: string;
  notes?: string;
  source: BillingPaymentSource;
  recordedBy?: { userId?: mongoose.Types.ObjectId; email?: string };

  status: 'recorded' | 'reversed';
  /** The e-CF issued for this payment (an `ElectronicInvoice` of the platform issuer). */
  electronicInvoiceId?: mongoose.Types.ObjectId;
  /** Which attempt at issuing the e-CF this is; a rejected one is issued again under a new key. */
  ecfAttempt: number;
  /** Why the e-CF could not be issued yet (BillingSoft refusal, issuer not certified…). */
  ecfError?: string;
  ecfEmailedAt?: Date;
  /** Why the e-CF was not emailed (a test-environment document is never sent). */
  ecfEmailError?: string;

  reversal?: {
    at: Date;
    reason: string;
    byEmail?: string;
    /** The credit note that cancelled the e-CF. */
    creditNoteId?: mongoose.Types.ObjectId;
  };
  createdAt: Date;
  updatedAt: Date;
}

const billingPaymentSchema = new Schema<IBillingPayment>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    chargeId: { type: Schema.Types.ObjectId, ref: 'BillingCharge', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    paidAt: { type: Date, required: true },
    method: { type: String, enum: BILLING_PAYMENT_METHODS, required: true },
    reference: { type: String, trim: true, maxlength: 100 },
    notes: { type: String, trim: true, maxlength: 500 },
    source: { type: String, enum: ['manual', 'portaldom'], default: 'manual' },
    recordedBy: {
      type: new Schema({ userId: { type: Schema.Types.ObjectId }, email: { type: String, trim: true } }, { _id: false }),
    },
    status: { type: String, enum: ['recorded', 'reversed'], default: 'recorded', required: true },
    electronicInvoiceId: { type: Schema.Types.ObjectId, ref: 'ElectronicInvoice' },
    ecfAttempt: { type: Number, default: 1, min: 1 },
    ecfError: { type: String, trim: true, maxlength: 1000 },
    ecfEmailedAt: { type: Date },
    ecfEmailError: { type: String, trim: true, maxlength: 300 },
    reversal: {
      type: new Schema(
        {
          at: { type: Date, required: true },
          reason: { type: String, required: true, trim: true, maxlength: 500 },
          byEmail: { type: String, trim: true },
          creditNoteId: { type: Schema.Types.ObjectId, ref: 'ElectronicInvoice' },
        },
        { _id: false }
      ),
    },
  },
  { timestamps: true }
);

billingPaymentSchema.index({ chargeId: 1, createdAt: 1 });
billingPaymentSchema.index({ tenantId: 1, paidAt: -1 });
billingPaymentSchema.index({ paidAt: -1 });

export default mongoose.model<IBillingPayment>('BillingPayment', billingPaymentSchema);
