import mongoose, { Document, Schema } from 'mongoose';
import { BILLING_PRODUCTS, BillingProduct } from './Tenant';
import { BILLING_TAXES, BillingTax } from './PlatformSettings';

/**
 * What a tenant owes Pilloto for one month (Dominican time). It is the amount to collect — not a
 * fiscal document: the e-CF is issued when a payment is recorded (`BillingPayment`), because
 * Pilloto issues its comprobante for money received.
 *
 * Amounts are Dominican pesos. Figures never change once created; only payment fields and `status`
 * do. Not tenant-scoped (it is Pilloto's own record, with an explicit `tenantId`).
 */
export const BILLING_CHARGE_STATUSES = ['open', 'partial', 'paid', 'void'] as const;
export type BillingChargeStatus = (typeof BILLING_CHARGE_STATUSES)[number];

export const BILLING_LINE_KINDS = ['subscription', 'fiscal_plan', 'fiscal_overage'] as const;
export type BillingLineKind = (typeof BILLING_LINE_KINDS)[number];

export interface IBillingChargeLine {
  kind: BillingLineKind;
  product?: BillingProduct;
  description: string;
  /** Net amount (before ITBIS) of the line, after any discount. */
  amount: number;
  /** The subscription discount taken off this line: what was granted and the pesos it came to. */
  discount?: { type: 'percent' | 'amount'; value: number; amount: number };
  /** Share of the month charged, when the subscription started mid-month (0–1). */
  proration?: number;
}

export interface IBillingCharge extends Document {
  tenantId: mongoose.Types.ObjectId;
  /** `COB-000001`. */
  number: string;
  /** `YYYY-MM` the charge is for. */
  period: string;
  currency: 'DOP';
  lines: IBillingChargeLine[];
  subtotal: number;
  tax: BillingTax;
  itbis: number;
  total: number;
  paidAmount: number;
  balance: number;
  status: BillingChargeStatus;
  /** `YYYY-MM-DD`, Dominican time. */
  dueDate: string;
  /** The e-invoicing statement whose figures are on this charge. */
  fiscalStatementId?: mongoose.Types.ObjectId;
  /** False once voided: only a current charge counts as the tenant's charge for the month. */
  isCurrent: boolean;
  notifiedAt?: Date;
  voidedAt?: Date;
  voidReason?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const lineSchema = new Schema<IBillingChargeLine>(
  {
    kind: { type: String, enum: BILLING_LINE_KINDS, required: true },
    product: { type: String, enum: BILLING_PRODUCTS },
    description: { type: String, required: true, trim: true, maxlength: 200 },
    amount: { type: Number, required: true, min: 0 },
    discount: {
      type: new Schema({ type: { type: String, enum: ['percent', 'amount'], required: true }, value: { type: Number, required: true }, amount: { type: Number, required: true } }, { _id: false }),
    },
    proration: { type: Number, min: 0, max: 1 },
  },
  { _id: false }
);

const billingChargeSchema = new Schema<IBillingCharge>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    number: { type: String, required: true, unique: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    currency: { type: String, enum: ['DOP'], default: 'DOP' },
    lines: { type: [lineSchema], validate: (v: unknown[]) => v.length > 0 },
    subtotal: { type: Number, required: true, min: 0 },
    tax: { type: String, enum: BILLING_TAXES, required: true },
    itbis: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    balance: { type: Number, required: true, min: 0 },
    status: { type: String, enum: BILLING_CHARGE_STATUSES, default: 'open', required: true },
    dueDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    fiscalStatementId: { type: Schema.Types.ObjectId, ref: 'FiscalStatement' },
    isCurrent: { type: Boolean, default: true },
    notifiedAt: { type: Date },
    voidedAt: { type: Date },
    voidReason: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: String, trim: true },
  },
  { timestamps: true }
);

// A tenant is charged once per month (a voided charge is replaced by a new one for the same period;
// MongoDB's partial indexes cannot say `status != void`, hence the flag).
billingChargeSchema.index({ tenantId: 1, period: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
billingChargeSchema.index({ status: 1, dueDate: 1 });
billingChargeSchema.index({ period: 1 });

export default mongoose.model<IBillingCharge>('BillingCharge', billingChargeSchema);
