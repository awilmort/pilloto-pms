import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { IIndividualCustomer } from './Invoice';

/**
 * AR debit note for the standalone Accounting product.
 *
 * Unlike `CreditNote`, this is **not** shaped around an unapplied-credit-balance
 * ledger (`applications[]`) — a debit note has no such ambiguity: it is simply new
 * AR the customer now owes, tied to (but issued independently of) an original
 * invoice. So its shape mirrors `Invoice`/`Bill` instead — its own `payments[]`
 * ledger, `draft→issued→partial→paid→void` lifecycle — collected the normal way
 * via `recordPayment`, never "applied" or "refunded". `lineItems[]` has no
 * return/allowance discriminator either: a debit note never touches inventory (it
 * recovers cost or corrects an undercharge, it doesn't accept returned goods), so
 * every line is a flat description/taxRate/lineTotal, with an optional purely-
 * informational `product` reference carrying no quantity/stock semantics.
 *
 * `fiscalModificationCode` reuses the same DGII `'1'|'2'|'3'|'4'` catalog
 * `CreditNote` already models on `ElectronicInvoice.codigoModificacion`: `3`
 * ("Corrección de Montos") is the code every normal debit note will use (interest,
 * freight, or other costs recovered after the original e-CF was issued); `1`/`2`/`4`
 * exist for completeness/symmetry with CreditNote but are edge cases a debit note
 * will rarely if ever need. `issue()` calls the same e-CF pipeline with `tipo: 'E33'`.
 */
export type DebitNoteStatus = 'draft' | 'issued' | 'partial' | 'paid' | 'void';
export type DebitNoteReason =
  | 'interest-on-overdue'
  | 'price-correction'
  | 'quantity-correction'
  | 'additional-charge'
  | 'other';
/** DGII's own e-CF modification codes (same catalog CreditNote uses) — never invented independently. */
export type DebitNoteFiscalModificationCode = '1' | '2' | '3' | '4';
export type DebitNotePaymentMethod = 'cash' | 'card' | 'transfer' | 'check' | 'credit';

export interface IDebitNoteLineItem {
  _id?: Types.ObjectId;
  description: string; // snapshot text — same "never let history silently change" rule as Invoice/CreditNote lines
  taxRate: number; // percent, e.g. 18 or 0 — every line carries its own rate
  lineTotal: number; // client-entered, tax-exclusive amount — no return/quantity/unitPrice math, unlike Invoice/CreditNote's 'return' lines
  taxAmount: number; // server-recomputed: lineTotal*taxRate/100
  total: number; // server-recomputed: lineTotal+taxAmount
  product?: Types.ObjectId; // ref 'Product' — optional, informational only (e.g. "price correction on Widget X"); no quantity/stock semantics
}

export interface IDebitNotePayment {
  _id?: Types.ObjectId;
  amount: number;
  method: DebitNotePaymentMethod;
  date: Date;
  reference?: string;
  recordedBy: Types.ObjectId; // ref 'User'
}

export interface IDebitNote extends Document {
  debitNoteNumber: string; // server-assigned via Counter('debitNoteNumber') → DN-000123, immutable
  invoice: Types.ObjectId; // ref 'Invoice' — the originating invoice this adds a charge to; required, same DGII NCFModificado rule as CreditNote
  customer?: Types.ObjectId; // ref 'Customer' — snapshotted from invoice.customer at creation, immutable thereafter
  isIndividual: boolean; // snapshotted from invoice.isIndividual at creation
  individualCustomer?: IIndividualCustomer; // snapshotted from invoice.individualCustomer at creation
  reason: DebitNoteReason; // internal business-classification field, distinct from fiscalModificationCode
  fiscalModificationCode: DebitNoteFiscalModificationCode; // DGII's own code — passed straight through to ElectronicInvoice.codigoModificacion at issue()
  issueDate: Date;
  dueDate?: Date;
  status: DebitNoteStatus;
  lineItems: IDebitNoteLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  payments: IDebitNotePayment[];
  amountPaid: number;
  balanceDue: number;
  isOverdue: boolean; // virtual, same shape as Invoice.isOverdue
  electronicInvoiceId?: Types.ObjectId; // ref 'ElectronicInvoice' — set once issue() issues the E33
  notes?: string;
  voidedAt?: Date;
  voidReason?: string;
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

const debitNoteLineItemSchema = new Schema<IDebitNoteLineItem>(
  {
    description: { type: String, required: true, trim: true, maxlength: 300 },
    taxRate: { type: Number, required: true, min: 0, max: 100 },
    lineTotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
  },
  { _id: true },
);

const debitNotePaymentSchema = new Schema<IDebitNotePayment>(
  {
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: ['cash', 'card', 'transfer', 'check', 'credit'], required: true },
    date: { type: Date, required: true, default: () => new Date() },
    reference: { type: String, trim: true, maxlength: 200 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: true },
);

const debitNoteSchema = new Schema<IDebitNote>(
  {
    debitNoteNumber: { type: String, required: true, trim: true },
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    isIndividual: { type: Boolean, default: false },
    individualCustomer: { type: individualCustomerSchema },
    reason: {
      type: String,
      enum: ['interest-on-overdue', 'price-correction', 'quantity-correction', 'additional-charge', 'other'],
      required: true,
    },
    fiscalModificationCode: { type: String, enum: ['1', '2', '3', '4'], required: true },
    issueDate: { type: Date, required: true, default: () => new Date() },
    dueDate: { type: Date },
    lineItems: {
      type: [debitNoteLineItemSchema],
      validate: {
        validator: (v: IDebitNoteLineItem[]) => Array.isArray(v) && v.length > 0,
        message: 'A debit note must have at least one line item',
      },
    },
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },
    payments: { type: [debitNotePaymentSchema], default: [] },
    amountPaid: { type: Number, required: true, min: 0, default: 0 },
    balanceDue: { type: Number, required: true, min: 0, default: 0 },
    status: { type: String, enum: ['draft', 'issued', 'partial', 'paid', 'void'], default: 'draft', index: true },
    electronicInvoiceId: { type: Schema.Types.ObjectId, ref: 'ElectronicInvoice' },
    notes: { type: String, trim: true, maxlength: 1000 },
    voidedAt: { type: Date },
    voidReason: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// Server-recomputed totals — never trusted from the client, same discipline as
// Invoice/Bill/CreditNote's own pre-validate hooks. No discount-then-tax math (no
// discountPercent field exists here — a debit note is an addition, not a sale line).
debitNoteSchema.pre('validate', function (this: IDebitNote, next) {
  let subtotal = 0;
  let taxAmount = 0;

  for (const line of this.lineItems) {
    if (line.lineTotal === undefined || line.lineTotal === null || line.lineTotal < 0) {
      return next(new Error('Every line item requires a non-negative lineTotal'));
    }
    const lineTotal = round2(line.lineTotal);
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
    else this.status = 'issued';
  }

  next();
});

debitNoteSchema.virtual('isOverdue').get(function (this: IDebitNote) {
  return Boolean(
    this.dueDate &&
    this.balanceDue > 0 &&
    this.status !== 'void' &&
    this.status !== 'paid' &&
    this.dueDate.getTime() < Date.now(),
  );
});
debitNoteSchema.set('toJSON', { virtuals: true });
debitNoteSchema.set('toObject', { virtuals: true });

// ── Multi-tenancy ────────────────────────────────────────────
debitNoteSchema.plugin(tenantPlugin);
debitNoteSchema.index({ tenantId: 1, debitNoteNumber: 1 }, { unique: true });
debitNoteSchema.index({ tenantId: 1, status: 1 });
debitNoteSchema.index({ tenantId: 1, invoice: 1 });
debitNoteSchema.index({ tenantId: 1, customer: 1 });

export default mongoose.model<IDebitNote>('DebitNote', debitNoteSchema);
