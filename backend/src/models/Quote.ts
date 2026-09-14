import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * AR quote/estimate (Cotización) for the standalone Accounting product.
 * Deliberately lightweight — no payments ledger, no e-CF, no GL posting,
 * since a quote is a pre-sale document, not a fiscal or accounting event.
 * Mirrors `Invoice`'s customer shape and per-line tax/discount math so
 * `convert()` can carry every line over onto a new draft `Invoice` without
 * translation.
 */
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';

export interface IIndividualCustomer {
  name: string;
  email?: string;
  phone?: string;
}

export interface IQuoteLineItem {
  _id?: Types.ObjectId;
  description: string;
  product?: Types.ObjectId; // ref 'Product' — optional; a service line has no product
  quantity: number;
  unitPrice: number; // net, tax-exclusive
  discountPercent: number; // 0-100, applied to quantity*unitPrice before tax
  taxRate: number; // percent, e.g. 18 or 0 — defaults from Tenant.ecfConfig.defaultItbisRate at creation
  lineTotal: number; // server-recomputed: quantity*unitPrice*(1-discountPercent/100)
  taxAmount: number; // server-recomputed: lineTotal*taxRate/100
  total: number; // server-recomputed: lineTotal+taxAmount
}

export interface IQuote extends Document {
  quoteNumber: string; // server-assigned via Counter('quoteNumber') → QUO-000123, immutable
  customer?: Types.ObjectId; // ref 'Customer' — required unless isIndividual
  isIndividual: boolean;
  individualCustomer?: IIndividualCustomer; // required when isIndividual
  issueDate: Date;
  expiryDate?: Date;
  lineItems: IQuoteLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  status: QuoteStatus;
  notes?: string;
  convertedInvoiceId?: Types.ObjectId; // ref 'Invoice' — set once converted; quote becomes read-only
  createdBy: Types.ObjectId; // ref 'User'
  createdAt: Date;
  updatedAt: Date;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const individualCustomerSchema = new Schema<IIndividualCustomer>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
  },
  { _id: false },
);

const quoteLineItemSchema = new Schema<IQuoteLineItem>(
  {
    description: { type: String, required: true, trim: true, maxlength: 300 },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitPrice: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    taxRate: { type: Number, required: true, min: 0, max: 100 },
    lineTotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

const quoteSchema = new Schema<IQuote>(
  {
    quoteNumber: { type: String, required: true, trim: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    isIndividual: { type: Boolean, default: false },
    individualCustomer: { type: individualCustomerSchema },
    issueDate: { type: Date, required: true, default: () => new Date() },
    expiryDate: { type: Date },
    lineItems: {
      type: [quoteLineItemSchema],
      validate: {
        validator: (v: IQuoteLineItem[]) => Array.isArray(v) && v.length > 0,
        message: 'A quote must have at least one line item',
      },
    },
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },
    status: { type: String, enum: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'], default: 'draft', index: true },
    notes: { type: String, trim: true, maxlength: 1000 },
    convertedInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// A customer is exactly one of a Customer reference or an embedded individual — never both, never neither.
quoteSchema.pre('validate', function (this: IQuote, next) {
  if (this.isIndividual) {
    if (!this.individualCustomer?.name) {
      return next(new Error('individualCustomer.name is required when isIndividual is true'));
    }
    this.customer = undefined;
  } else if (!this.customer) {
    return next(new Error('customer is required unless isIndividual is true'));
  } else {
    this.individualCustomer = undefined;
  }
  next();
});

// Server-recomputed totals — never trusted from the client, same discipline as Invoice.
quoteSchema.pre('validate', function (this: IQuote, next) {
  let subtotal = 0;
  let taxAmount = 0;

  for (const line of this.lineItems) {
    const lineTotal = round2(line.quantity * line.unitPrice * (1 - (line.discountPercent || 0) / 100));
    const lineTax = round2(lineTotal * (line.taxRate || 0) / 100);
    line.lineTotal = lineTotal;
    line.taxAmount = lineTax;
    line.total = round2(lineTotal + lineTax);
    subtotal += lineTotal;
    taxAmount += lineTax;
  }

  this.subtotal = round2(subtotal);
  this.taxAmount = round2(taxAmount);
  this.total = round2(this.subtotal + this.taxAmount);

  next();
});

// ── Multi-tenancy ────────────────────────────────────────────
quoteSchema.plugin(tenantPlugin);
quoteSchema.index({ tenantId: 1, quoteNumber: 1 }, { unique: true });
quoteSchema.index({ tenantId: 1, status: 1 });
quoteSchema.index({ tenantId: 1, customer: 1 });
quoteSchema.index({ tenantId: 1, issueDate: -1 });

export default mongoose.model<IQuote>('Quote', quoteSchema);
