import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { UNIT_OF_MEASURE_CODES, UnitOfMeasureCode } from '../constants/unitsOfMeasure';
import { EXPENSE_TYPE_CODES, ExpenseType, ISR_WITHHOLDING_CODES, IsrWithholdingType, NCF_PATTERN } from '../constants/dgii';

/**
 * AP supplier bill for the standalone Accounting product, mirroring `Invoice.ts`'s
 * AR shape: `Counter`-backed numbering, embedded `payments[]`, server-recomputed
 * totals, `draft|received|partial|paid|void`.
 *
 * - Every line item carries its own `taxRate`, not one bill-level flat rate.
 * - Inventory line items carry no `lotNumber`/`expirationDate` — food
 *   traceability fields that don't generalize to Pilloto's customer base
 *   (the same call made on `Product`/`InventoryTransaction`).
 *
 * `lineItems` are discriminated by `lineType`: an `inventory` line snapshots a
 * `Product` and carries its own purchase-unit/stock-unit economics (dual UOM);
 * an `expense` line codes straight to a Chart-of-Accounts `Account` (pure
 * overhead — rent, utilities — with no stock effect).
 *
 * DGII (Formato 606): `ncf` is the supplier's comprobante (B… or e-CF E…), `expenseType` the 606
 * "tipo de bienes y servicios", and an expense line says whether it bought goods or services
 * (inventory lines are goods). The ITBIS of the bill is deductible ("por adelantar") unless
 * `itbisToCost`, when it is part of the cost. Withholdings (`itbisWithheld`, `isrWithheld`) are
 * kept from the supplier and owed to the DGII instead, so the supplier is owed `payableTotal`
 * (total less withholdings) and `balanceDue` counts against that.
 */
export type BillStatus = 'draft' | 'received' | 'partial' | 'paid' | 'void';
export type BillPaymentMethod = 'cash' | 'card' | 'transfer' | 'check' | 'other';
export type BillLineType = 'inventory' | 'expense';

export interface IBillLineItem {
  _id?: Types.ObjectId;
  lineType: BillLineType;
  description: string; // snapshot text — same "never let history silently change" rule as Invoice lines
  taxRate: number; // percent, e.g. 18 or 0 — every line carries its own rate
  lineTotal: number; // server-recomputed, tax-exclusive
  taxAmount: number; // server-recomputed: lineTotal*taxRate/100
  total: number; // server-recomputed: lineTotal+taxAmount

  // present only when lineType === 'inventory':
  product?: Types.ObjectId; // ref 'Product'
  purchaseUnitOfMeasure?: UnitOfMeasureCode; // unit the goods were bought in
  purchaseQuantity?: number; // amount purchased in purchaseUnitOfMeasure
  purchaseUnitCost?: number; // client-entered cost per purchaseUnitOfMeasure; lineTotal = purchaseQuantity*purchaseUnitCost (server-computed, not client-settable)
  stockUnitOfMeasure?: UnitOfMeasureCode; // must equal product.unitOfMeasure (validated in the controller, where Product is loaded)
  stockQuantity?: number; // the actual amount added to stock, in stockUnitOfMeasure
  unitCost?: number; // per-stock-unit cost = lineTotal/stockQuantity, not client-settable

  // present only when lineType === 'expense':
  account?: Types.ObjectId; // ref 'Account' — Chart of Accounts coding
  isGoods?: boolean; // 606: the line bought goods (default: services)
}

export interface IBillPayment {
  _id?: Types.ObjectId;
  amount: number;
  /** Pesos per unit on the payment day (foreign-currency documents; the document's rate otherwise). */
  exchangeRate?: number;
  method: BillPaymentMethod;
  date: Date;
  reference?: string;
  recordedBy: Types.ObjectId; // ref 'User'
}

export interface IBill extends Document {
  billNumber: string; // server-assigned via Counter('billNumber') → BILL-000123, immutable
  supplier: Types.ObjectId; // ref 'Supplier'
  warehouse?: Types.ObjectId; // ref 'Warehouse' — required only if >=1 inventory line exists (validated in the controller)
  vendorInvoiceNumber?: string; // the supplier's own invoice number — not globally unique
  ncf?: string; // the supplier's comprobante fiscal (B01…, E31…) — required on the 606
  expenseType?: ExpenseType; // 606 "tipo de bienes y servicios"
  itbisToCost: boolean; // the ITBIS is not deductible and is part of the cost (606 "ITBIS llevado al costo")
  itbisWithheld: number; // ITBIS kept from the supplier, owed to the DGII
  isrWithheld: number; // ISR kept from the supplier, owed to the DGII
  isrWithholdingType?: IsrWithholdingType; // 606 "tipo de retención en ISR" (required when isrWithheld > 0)
  payableTotal: number; // what the supplier is owed: total − withholdings (server-computed)
  issueDate: Date;
  dueDate: Date;
  status: BillStatus; // 'received' is the AP mirror of Invoice's 'sent'
  lineItems: IBillLineItem[];
  /** DOP (the books' currency), USD or EUR. Amounts on the document are in this currency. */
  currency: 'DOP' | 'USD' | 'EUR';
  /** Pesos per unit of `currency` the document was booked at (1 for DOP). */
  exchangeRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  payments: IBillPayment[];
  amountPaid: number;
  balanceDue: number;
  notes?: string;
  voidedAt?: Date;
  voidReason?: string;
  createdBy: Types.ObjectId; // ref 'User'
  createdAt: Date;
  updatedAt: Date;
  isOverdue: boolean; // virtual
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const billLineItemSchema = new Schema<IBillLineItem>(
  {
    lineType: { type: String, enum: ['inventory', 'expense'], required: true },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    taxRate: { type: Number, required: true, min: 0, max: 100 },
    lineTotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },

    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    purchaseUnitOfMeasure: { type: String, enum: UNIT_OF_MEASURE_CODES },
    purchaseQuantity: { type: Number, min: 0.0001 },
    purchaseUnitCost: { type: Number, min: 0 },
    stockUnitOfMeasure: { type: String, enum: UNIT_OF_MEASURE_CODES },
    stockQuantity: { type: Number, min: 0.0001 },
    unitCost: { type: Number, min: 0 },

    account: { type: Schema.Types.ObjectId, ref: 'Account' },
    isGoods: { type: Boolean },
  },
  { _id: true },
);

const billPaymentSchema = new Schema<IBillPayment>(
  {
    amount: { type: Number, required: true, min: 0.01 },
    exchangeRate: { type: Number, min: 0.000001 },
    method: { type: String, enum: ['cash', 'card', 'transfer', 'check', 'other'], required: true },
    date: { type: Date, required: true, default: () => new Date() },
    reference: { type: String, trim: true, maxlength: 200 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: true },
);

const billSchema = new Schema<IBill>(
  {
    billNumber: { type: String, required: true, trim: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    vendorInvoiceNumber: { type: String, trim: true, maxlength: 100 },
    ncf: {
      type: String,
      trim: true,
      uppercase: true,
      validate: { validator: (v: string) => !v || NCF_PATTERN.test(v), message: 'NCF must be B + 10 digits or E + 12 digits' },
    },
    expenseType: { type: String, enum: EXPENSE_TYPE_CODES },
    itbisToCost: { type: Boolean, default: false },
    itbisWithheld: { type: Number, min: 0, default: 0 },
    isrWithheld: { type: Number, min: 0, default: 0 },
    isrWithholdingType: { type: String, enum: ISR_WITHHOLDING_CODES },
    payableTotal: { type: Number, min: 0, default: 0 },
    issueDate: { type: Date, required: true, default: () => new Date() },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ['draft', 'received', 'partial', 'paid', 'void'], default: 'draft', index: true },
    lineItems: {
      type: [billLineItemSchema],
      validate: {
        validator: (v: IBillLineItem[]) => Array.isArray(v) && v.length > 0,
        message: 'A bill must have at least one line item',
      },
    },
    currency: { type: String, enum: ['DOP', 'USD', 'EUR'], default: 'DOP' },
    exchangeRate: { type: Number, default: 1, min: 0.000001 },
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },
    payments: { type: [billPaymentSchema], default: [] },
    amountPaid: { type: Number, required: true, min: 0, default: 0 },
    balanceDue: { type: Number, required: true, min: 0, default: 0 },
    notes: { type: String, trim: true, maxlength: 1000 },
    voidedAt: { type: Date },
    voidReason: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// Discriminated per-line validation + math (mirrors Invoice.ts's pre-validate discipline:
// server-recomputed, never trusted from the client), plus the bill-level rollup. Only
// synchronous math lives here — the async existence/validity checks that need a DB lookup
// (does this product/account still exist, is it active, does the unit match) live in the
// controller, which builds lineItems before they're ever assigned to the document.
billSchema.pre('validate', function (this: IBill, next) {
  let subtotal = 0;
  let taxAmount = 0;

  for (const line of this.lineItems) {
    if (line.lineType === 'inventory') {
      if (
        !line.product || !line.purchaseUnitOfMeasure
        || line.purchaseQuantity === undefined || line.purchaseQuantity === null
        || line.purchaseUnitCost === undefined || line.purchaseUnitCost === null
        || !line.stockUnitOfMeasure
        || line.stockQuantity === undefined || line.stockQuantity === null
      ) {
        return next(new Error('Inventory line items require product, purchaseUnitOfMeasure, purchaseQuantity, purchaseUnitCost, stockUnitOfMeasure and stockQuantity'));
      }
      line.lineTotal = round2(line.purchaseQuantity * line.purchaseUnitCost);
      line.unitCost = line.lineTotal / line.stockQuantity;
    } else if (line.lineType === 'expense') {
      if (!line.account) return next(new Error('Expense line items require an account'));
      if (line.lineTotal === undefined || line.lineTotal === null || line.lineTotal < 0) {
        return next(new Error('Expense line items require a non-negative lineTotal'));
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

  this.itbisWithheld = round2(this.itbisWithheld || 0);
  this.isrWithheld = round2(this.isrWithheld || 0);
  // Named ValidationError so the controllers answer 400 like any other invalid field.
  const invalid = (message: string) => Object.assign(new Error(message), { name: 'ValidationError' });
  if (this.itbisWithheld > this.taxAmount + 0.005) return next(invalid('The ITBIS withheld cannot exceed the ITBIS of the bill'));
  if (this.isrWithheld > this.subtotal + 0.005) return next(invalid('The ISR withheld cannot exceed the bill before tax'));
  if (this.isrWithheld > 0 && !this.isrWithholdingType) return next(invalid('Choose the type of ISR withholding'));
  if (this.isrWithheld === 0) this.isrWithholdingType = undefined;
  this.payableTotal = round2(this.total - this.itbisWithheld - this.isrWithheld);

  this.amountPaid = round2(this.payments.reduce((sum, p) => sum + p.amount, 0));
  this.balanceDue = round2(Math.max(0, this.payableTotal - this.amountPaid));

  if (this.status !== 'draft' && this.status !== 'void') {
    if (this.balanceDue <= 0.005) this.status = 'paid';
    else if (this.amountPaid > 0) this.status = 'partial';
    else this.status = 'received';
  }

  next();
});

billSchema.virtual('isOverdue').get(function (this: IBill) {
  return Boolean(
    this.dueDate &&
    this.balanceDue > 0 &&
    this.status !== 'void' &&
    this.status !== 'paid' &&
    this.dueDate.getTime() < Date.now(),
  );
});
billSchema.set('toJSON', { virtuals: true });
billSchema.set('toObject', { virtuals: true });


// A DOP document is always at rate 1.
billSchema.pre('validate', function (this: any, next) {
  if (!this.currency || this.currency === 'DOP') {
    this.currency = 'DOP';
    this.exchangeRate = 1;
  }
  next();
});

// ── Multi-tenancy ────────────────────────────────────────────
billSchema.plugin(tenantPlugin);
billSchema.index({ tenantId: 1, billNumber: 1 }, { unique: true });
billSchema.index({ tenantId: 1, status: 1 });
billSchema.index({ tenantId: 1, supplier: 1 });
billSchema.index({ tenantId: 1, dueDate: 1 });

export default mongoose.model<IBill>('Bill', billSchema);
