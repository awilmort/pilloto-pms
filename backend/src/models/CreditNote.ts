import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { IIndividualCustomer } from './Invoice';

/**
 * AR credit note for the standalone Accounting product: discriminated `return`/
 * `allowance` lines, an `applications[]` ledger playing the role `payments`
 * plays on `Invoice`, contra-revenue posting, and reason codes. Built directly
 * against the e-CF pipeline — `ElectronicInvoice` already models `E34` natively,
 * and every `Invoice` always issues a real e-CF on `send()`, so every
 * `CreditNote` correcting one always issues a real `E34` too, and `invoice`
 * is required rather than optional.
 *
 * `applying` a credit note to an invoice posts no new `JournalEntry` — the AR
 * control account was already credited in full at `issue()` time; allocating
 * that credit to a specific invoice is a subsidiary-ledger allocation only
 * (a `credit-note`-method entry pushed onto `Invoice.payments`), never a
 * second GL transaction. Refunding unapplied credit *does* post a new entry
 * (`Dr Accounts Receivable, Cr Bank`), since actual cash leaves the business
 * at that point. See `creditNotes.controller.ts`.
 */
export type CreditNoteStatus = 'draft' | 'issued' | 'partial' | 'closed' | 'void';
export type CreditNoteLineType = 'return' | 'allowance';
export type CreditNoteReason =
  | 'billing-error'
  | 'price-adjustment'
  | 'goods-returned'
  | 'service-not-rendered'
  | 'duplicate-charge'
  | 'goodwill'
  | 'other';
/** DGII's own e-CF modification codes — never invented independently. '5' (Otros) is deliberately excluded; `reason` above already covers a freeform "other" case internally. */
export type CreditNoteFiscalModificationCode = '1' | '2' | '3' | '4';
export type CreditNoteApplicationType = 'invoice' | 'refund';
export type CreditNoteRefundMethod = 'cash' | 'card' | 'transfer' | 'check' | 'other';

export interface ICreditNoteLineItem {
  _id?: Types.ObjectId;
  lineType: CreditNoteLineType;
  description: string; // snapshot text — same "never let history silently change" rule as Invoice/Bill lines
  taxRate: number; // percent, e.g. 18 or 0 — every line carries its own rate
  lineTotal: number; // server-recomputed: quantity*unitPrice for 'return', the entered amount for 'allowance'
  taxAmount: number; // server-recomputed: lineTotal*taxRate/100
  total: number; // server-recomputed: lineTotal+taxAmount

  // present only when lineType === 'return':
  product?: Types.ObjectId; // ref 'Product' — required for 'return'
  quantity?: number;
  unitPrice?: number; // defaults to the matching invoice line's unitPrice, editable (e.g. a partial-quantity return)
  unitCost?: number; // NOT client-settable — read from the originating invoice's 'sale-deduction' InventoryTransaction.unitCost

  // present only when lineType === 'allowance':
  // `product` may also be set here, informational only — no quantity/stock semantics.
}

export interface ICreditNoteApplication {
  _id?: Types.ObjectId;
  type: CreditNoteApplicationType;
  amount: number;
  invoice?: Types.ObjectId; // ref 'Invoice' — required when type === 'invoice'; the invoice this allocation reduces (may differ from the originating invoice)
  method?: CreditNoteRefundMethod; // required when type === 'refund'
  reference?: string;
  note?: string;
  createdAt: Date;
  createdBy: Types.ObjectId; // ref 'User'
}

export interface ICreditNote extends Document {
  creditNoteNumber: string; // server-assigned via Counter('creditNoteNumber') → CN-000123, immutable
  invoice: Types.ObjectId; // ref 'Invoice' — the originating invoice this corrects; required (see model comment)
  customer?: Types.ObjectId; // ref 'Customer' — snapshotted from invoice.customer at creation, immutable thereafter
  isIndividual: boolean; // snapshotted from invoice.isIndividual at creation
  individualCustomer?: IIndividualCustomer; // snapshotted from invoice.individualCustomer at creation
  warehouse?: Types.ObjectId; // ref 'Warehouse' — required only if >=1 'return' line exists
  reason: CreditNoteReason; // internal business-classification field, distinct from fiscalModificationCode
  fiscalModificationCode: CreditNoteFiscalModificationCode; // DGII's own code — passed straight through to ElectronicInvoice.codigoModificacion at issue()
  issueDate: Date;
  status: CreditNoteStatus;
  lineItems: ICreditNoteLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  applications: ICreditNoteApplication[];
  amountApplied: number; // server-recomputed = sum(applications[].amount), regardless of type
  remainingCredit: number; // server-recomputed = total - amountApplied
  electronicInvoiceId?: Types.ObjectId; // ref 'ElectronicInvoice' — set once issue() issues the E34
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

const creditNoteLineItemSchema = new Schema<ICreditNoteLineItem>(
  {
    lineType: { type: String, enum: ['return', 'allowance'], required: true },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    taxRate: { type: Number, required: true, min: 0, max: 100 },
    lineTotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },

    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    quantity: { type: Number, min: 0.0001 },
    unitPrice: { type: Number, min: 0 },
    unitCost: { type: Number, min: 0 },
  },
  { _id: true },
);

const creditNoteApplicationSchema = new Schema<ICreditNoteApplication>(
  {
    type: { type: String, enum: ['invoice', 'refund'], required: true },
    amount: { type: Number, required: true, min: 0.01 },
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    method: { type: String, enum: ['cash', 'card', 'transfer', 'check', 'other'] },
    reference: { type: String, trim: true, maxlength: 200 },
    note: { type: String, trim: true, maxlength: 500 },
    createdAt: { type: Date, required: true, default: () => new Date() },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: true },
);

const creditNoteSchema = new Schema<ICreditNote>(
  {
    creditNoteNumber: { type: String, required: true, trim: true },
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    isIndividual: { type: Boolean, default: false },
    individualCustomer: { type: individualCustomerSchema },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    reason: {
      type: String,
      enum: ['billing-error', 'price-adjustment', 'goods-returned', 'service-not-rendered', 'duplicate-charge', 'goodwill', 'other'],
      required: true,
    },
    fiscalModificationCode: { type: String, enum: ['1', '2', '3', '4'], required: true },
    issueDate: { type: Date, required: true, default: () => new Date() },
    lineItems: {
      type: [creditNoteLineItemSchema],
      validate: {
        validator: (v: ICreditNoteLineItem[]) => Array.isArray(v) && v.length > 0,
        message: 'A credit note must have at least one line item',
      },
    },
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },
    applications: { type: [creditNoteApplicationSchema], default: [] },
    amountApplied: { type: Number, required: true, min: 0, default: 0 },
    remainingCredit: { type: Number, required: true, min: 0, default: 0 },
    status: { type: String, enum: ['draft', 'issued', 'partial', 'closed', 'void'], default: 'draft', index: true },
    electronicInvoiceId: { type: Schema.Types.ObjectId, ref: 'ElectronicInvoice' },
    notes: { type: String, trim: true, maxlength: 1000 },
    voidedAt: { type: Date },
    voidReason: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// Discriminated per-line validation + math (mirrors Invoice/Bill's pre-validate discipline:
// server-recomputed, never trusted from the client), plus the document-level rollup. Only
// synchronous math lives here — the async lookups a 'return' line needs (does the product still
// exist, what was its original sale-deduction unitCost) live in the controller, which resolves
// them before lineItems are ever assigned to the document.
creditNoteSchema.pre('validate', function (this: ICreditNote, next) {
  let subtotal = 0;
  let taxAmount = 0;

  for (const line of this.lineItems) {
    if (line.lineType === 'return') {
      if (!line.product || line.quantity === undefined || line.quantity === null || line.unitPrice === undefined || line.unitPrice === null) {
        return next(new Error("Return line items require product, quantity and unitPrice"));
      }
      line.lineTotal = round2(line.quantity * line.unitPrice);
    } else if (line.lineType === 'allowance') {
      if (line.lineTotal === undefined || line.lineTotal === null || line.lineTotal < 0) {
        return next(new Error('Allowance line items require a non-negative lineTotal'));
      }
      line.lineTotal = round2(line.lineTotal);
    } else {
      return next(new Error(`Invalid lineType: ${(line as { lineType?: string }).lineType}`));
    }

    const lineTax = round2(line.lineTotal * (line.taxRate || 0) / 100);
    line.taxAmount = lineTax;
    line.total = round2(line.lineTotal + lineTax);
    subtotal += line.lineTotal;
    taxAmount += lineTax;
  }

  this.subtotal = round2(subtotal);
  this.taxAmount = round2(taxAmount);
  this.total = round2(this.subtotal + this.taxAmount);

  this.amountApplied = round2(this.applications.reduce((sum, a) => sum + a.amount, 0));
  this.remainingCredit = round2(Math.max(0, this.total - this.amountApplied));

  if (this.status !== 'draft' && this.status !== 'void') {
    if (this.remainingCredit <= 0.005) this.status = 'closed';
    else if (this.amountApplied > 0) this.status = 'partial';
    else this.status = 'issued';
  }

  next();
});

// warehouse is required only once a 'return' line exists — same conditional-requirement
// pattern Bill.warehouse already uses.
creditNoteSchema.pre('validate', function (this: ICreditNote, next) {
  const hasReturnLine = this.lineItems.some((l) => l.lineType === 'return');
  if (hasReturnLine && !this.warehouse) {
    return next(new Error('warehouse is required when the credit note has at least one "return" line item'));
  }
  next();
});

// ── Multi-tenancy ────────────────────────────────────────────
creditNoteSchema.plugin(tenantPlugin);
creditNoteSchema.index({ tenantId: 1, creditNoteNumber: 1 }, { unique: true });
creditNoteSchema.index({ tenantId: 1, status: 1 });
creditNoteSchema.index({ tenantId: 1, invoice: 1 });
creditNoteSchema.index({ tenantId: 1, customer: 1 });

export default mongoose.model<ICreditNote>('CreditNote', creditNoteSchema);
