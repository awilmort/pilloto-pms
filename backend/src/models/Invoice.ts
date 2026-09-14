import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * AR sales invoice for the standalone Accounting product. `customer` points at
 * the dedicated `Customer` model (not the PMS-side `Company` model; see
 * `Customer.ts`'s own header for why) — `individualCustomer` covers the
 * non-B2B case instead of extending `Customer`.
 *
 * Every line item carries its own `taxRate`/`discountPercent` — there is no
 * invoice-level flat rate — because DGII e-CF rules allow one invoice to mix
 * taxed, reduced-rate, and exempt lines, and discount is applied per line
 * before tax. `subtotal`/`taxAmount`/`total` are always server-recomputed
 * from `lineItems` (never trusted from the client), same discipline as
 * `Account.normalBalance`/`JournalEntry` balance validation.
 */
export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'void';
export type InvoicePaymentMethod = 'cash' | 'card' | 'transfer' | 'check' | 'credit' | 'credit-note';

export interface IIndividualCustomer {
  name: string;
  email?: string;
  phone?: string;
}

export interface IInvoiceLineItem {
  _id?: Types.ObjectId;
  description: string; // snapshotted at line-creation/edit time — never a live product-name lookup once sent
  product?: Types.ObjectId; // ref 'Product' — optional; a service line has no product
  quantity: number;
  unitPrice: number; // net, tax-exclusive
  discountPercent: number; // 0-100, applied to quantity*unitPrice before tax
  taxRate: number; // percent, e.g. 18 or 0 — defaults from Tenant.ecfConfig.defaultItbisRate at creation
  lineTotal: number; // server-recomputed: quantity*unitPrice*(1-discountPercent/100)
  taxAmount: number; // server-recomputed: lineTotal*taxRate/100
  total: number; // server-recomputed: lineTotal+taxAmount
}

export interface IInvoicePayment {
  _id?: Types.ObjectId;
  amount: number;
  method: InvoicePaymentMethod;
  date: Date;
  reference?: string;
  recordedBy: Types.ObjectId; // ref 'User'
}

// Present only on an Invoice created by the City Ledger checkout transfer.
// `authorizationStatus` starts 'pending' for an ad hoc (non-pre-approved) transfer —
// the Invoice stays `status: 'draft'` (invisible to AR aging/statements) until a manager
// authorizes it, which flips both fields together. A pre-approved transfer skips straight to
// 'authorized' since the credit decision already happened before arrival.
export interface IInvoiceCityLedger {
  sourceReservationId: Types.ObjectId; // ref 'Reservation'
  sourceFolioId: Types.ObjectId; // ref 'Folio'
  preApproved: boolean;
  authorizationStatus: 'pending' | 'authorized' | 'declined';
  authorizedBy?: Types.ObjectId; // ref 'User'
  authorizedAt?: Date;
  declinedReason?: string;
}

export interface IInvoice extends Document {
  invoiceNumber: string; // server-assigned via Counter('invoiceNumber') → INV-000123, immutable
  customer?: Types.ObjectId; // ref 'Customer' — required unless isIndividual
  isIndividual: boolean;
  individualCustomer?: IIndividualCustomer; // required when isIndividual
  issueDate: Date;
  dueDate?: Date;
  lineItems: IInvoiceLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  payments: IInvoicePayment[];
  amountPaid: number;
  balanceDue: number;
  status: InvoiceStatus;
  isOverdue: boolean; // virtual
  electronicInvoiceId?: Types.ObjectId; // ref 'ElectronicInvoice' — set once send() issues an e-CF
  notes?: string;
  createdBy: Types.ObjectId; // ref 'User'
  cityLedger?: IInvoiceCityLedger;
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

const invoiceLineItemSchema = new Schema<IInvoiceLineItem>(
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

const invoicePaymentSchema = new Schema<IInvoicePayment>(
  {
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: ['cash', 'card', 'transfer', 'check', 'credit', 'credit-note'], required: true },
    date: { type: Date, required: true, default: () => new Date() },
    reference: { type: String, trim: true, maxlength: 200 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: true },
);

const invoiceCityLedgerSchema = new Schema<IInvoiceCityLedger>(
  {
    sourceReservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
    sourceFolioId: { type: Schema.Types.ObjectId, ref: 'Folio', required: true },
    preApproved: { type: Boolean, required: true, default: false },
    authorizationStatus: { type: String, enum: ['pending', 'authorized', 'declined'], required: true, default: 'pending' },
    authorizedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    authorizedAt: { type: Date },
    declinedReason: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const invoiceSchema = new Schema<IInvoice>(
  {
    invoiceNumber: { type: String, required: true, trim: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    isIndividual: { type: Boolean, default: false },
    individualCustomer: { type: individualCustomerSchema },
    issueDate: { type: Date, required: true, default: () => new Date() },
    dueDate: { type: Date },
    lineItems: {
      type: [invoiceLineItemSchema],
      validate: {
        validator: (v: IInvoiceLineItem[]) => Array.isArray(v) && v.length > 0,
        message: 'An invoice must have at least one line item',
      },
    },
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },
    payments: { type: [invoicePaymentSchema], default: [] },
    amountPaid: { type: Number, required: true, min: 0, default: 0 },
    balanceDue: { type: Number, required: true, min: 0, default: 0 },
    status: { type: String, enum: ['draft', 'sent', 'partial', 'paid', 'void'], default: 'draft', index: true },
    electronicInvoiceId: { type: Schema.Types.ObjectId, ref: 'ElectronicInvoice' },
    notes: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cityLedger: { type: invoiceCityLedgerSchema },
  },
  { timestamps: true },
);

// A customer is exactly one of a Customer reference or an embedded individual — never both, never neither.
invoiceSchema.pre('validate', function (this: IInvoice, next) {
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

// Server-recomputed totals — never trusted from the client, same discipline as JournalEntry's
// balance validation. Runs on every save so editing draft lines or recording a payment both
// keep subtotal/tax/total/balanceDue/status internally consistent.
invoiceSchema.pre('validate', function (this: IInvoice, next) {
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

  this.amountPaid = round2(this.payments.reduce((sum, p) => sum + p.amount, 0));
  this.balanceDue = round2(Math.max(0, this.total - this.amountPaid));

  if (this.status !== 'draft' && this.status !== 'void') {
    if (this.balanceDue <= 0.005) this.status = 'paid';
    else if (this.amountPaid > 0) this.status = 'partial';
    else this.status = 'sent';
  }

  next();
});

invoiceSchema.virtual('isOverdue').get(function (this: IInvoice) {
  return Boolean(
    this.dueDate &&
    this.balanceDue > 0 &&
    this.status !== 'void' &&
    this.status !== 'paid' &&
    this.dueDate.getTime() < Date.now(),
  );
});
invoiceSchema.set('toJSON', { virtuals: true });
invoiceSchema.set('toObject', { virtuals: true });

// ── Multi-tenancy ────────────────────────────────────────────
invoiceSchema.plugin(tenantPlugin);
invoiceSchema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ tenantId: 1, status: 1 });
invoiceSchema.index({ tenantId: 1, customer: 1 });
invoiceSchema.index({ tenantId: 1, issueDate: -1 });
invoiceSchema.index({ tenantId: 1, 'cityLedger.authorizationStatus': 1 });

export default mongoose.model<IInvoice>('Invoice', invoiceSchema);
