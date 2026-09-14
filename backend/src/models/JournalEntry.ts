import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * General ledger. Journal entries are an immutable audit record — never edited
 * or hard-deleted once saved; a correction is a reversing entry, not a
 * mutation. This model is the double-entry primitive every auto-posting hook
 * and the manual entry endpoint write through via `ledger.service.ts`'s
 * `postJournalEntry`.
 *
 * `source`/`sourceModel` are grown incrementally as each triggering feature
 * comes online (same lattice-growth pattern as `InventoryTransaction.type`)
 * rather than pre-listing sources nothing can produce yet.
 *
 * `*_void` sources are used on the reversing entry itself, while the original
 * entry being reversed is marked `isVoid` in place (see `ledger.service.ts`'s
 * `reversePostedEntries`).
 *
 * `credit_note_issue` posts the contra-revenue (+COGS-reversal) entry;
 * `credit_note_refund` posts a real `Dr AR/Cr Bank` entry when unapplied credit
 * is paid back in cash; `credit_note_void` is the reversal source for
 * `credit_note_issue`. `apply`-ing a credit note to an invoice deliberately
 * posts **no** JournalEntry (it's a subsidiary-ledger allocation, not a new GL
 * event — the AR control account was already credited in full at issue time)
 * so there is no `credit_note_apply` source.
 */
export type JournalEntrySource =
  | 'manual'
  | 'invoice_sent'
  | 'invoice_payment'
  | 'invoice_void'
  | 'bill_received'
  | 'bill_payment'
  | 'bill_void'
  | 'credit_note_issue'
  | 'credit_note_refund'
  | 'credit_note_void'
  | 'debit_note_issue'
  | 'debit_note_payment'
  | 'debit_note_void'
  // PMS→GL auto-posting hooks, only fire for a pms+accounting tenant
  // (see backend/src/services/accounting/pmsLedgerHooks.ts). `pms_folio_credit_note`/
  // `pms_folio_debit_note` are the Folio-driven e-CF E34/E33 flow (`ecf.ts`),
  // distinct from the standalone Accounting product's `credit_note_issue`/`debit_note_issue`.
  | 'pms_charge_added'
  | 'pms_payment_recorded'
  | 'pms_payment_reversed'
  | 'pms_cashier_closure'
  | 'pms_folio_credit_note'
  | 'pms_folio_debit_note';

export type JournalEntrySourceModel = 'JournalEntry' | 'Invoice' | 'Bill' | 'CreditNote' | 'DebitNote' | 'Charge' | 'Payment' | 'CashierClosure' | 'ElectronicInvoice';

export interface IJournalEntryLine {
  _id?: Types.ObjectId;
  account: Types.ObjectId; // ref 'Account'
  debit: number; // exactly one of debit/credit is non-zero per line
  credit: number;
  memo?: string;
}

export interface IJournalEntry extends Document {
  entryNumber: string; // server-assigned via Counter('journalEntryNumber') → JE-000123, immutable
  date: Date;
  memo: string;
  source: JournalEntrySource;
  sourceModel?: JournalEntrySourceModel; // set for non-manual entries, for drill-down
  sourceId?: Types.ObjectId;
  lines: IJournalEntryLine[]; // must have >=2 lines; sum(debit) === sum(credit), validated pre-save
  isVoid: boolean;
  voidedAt?: Date;
  voidReason?: string;
  createdBy: Types.ObjectId; // ref 'User'
  createdAt: Date;
  updatedAt: Date;
}

const lineSchema = new Schema<IJournalEntryLine>(
  {
    account: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    debit: { type: Number, required: true, min: 0, default: 0 },
    credit: { type: Number, required: true, min: 0, default: 0 },
    memo: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true }
);

// The fundamental double-entry rule for a single line — enforced here so it can never be
// bypassed regardless of caller, same rigor Account applies to normalBalance derivation.
lineSchema.pre('validate', function (this: IJournalEntryLine & Document, next) {
  const hasDebit = this.debit > 0;
  const hasCredit = this.credit > 0;
  if (hasDebit === hasCredit) {
    return next(new Error('Each journal entry line must have exactly one of debit or credit greater than zero'));
  }
  next();
});

const journalEntrySchema = new Schema<IJournalEntry>(
  {
    entryNumber: { type: String, required: true, trim: true },
    date: { type: Date, required: true, default: Date.now },
    memo: { type: String, required: true, trim: true, maxlength: 500 },
    source: {
      type: String,
      enum: [
        'manual', 'invoice_sent', 'invoice_payment', 'invoice_void',
        'bill_received', 'bill_payment', 'bill_void',
        'credit_note_issue', 'credit_note_refund', 'credit_note_void',
        'debit_note_issue', 'debit_note_payment', 'debit_note_void',
        'pms_charge_added', 'pms_payment_recorded', 'pms_payment_reversed',
        'pms_cashier_closure', 'pms_folio_credit_note', 'pms_folio_debit_note',
      ],
      required: true,
    },
    sourceModel: { type: String, enum: ['JournalEntry', 'Invoice', 'Bill', 'CreditNote', 'DebitNote', 'Charge', 'Payment', 'CashierClosure', 'ElectronicInvoice'] },
    sourceId: { type: Schema.Types.ObjectId, refPath: 'sourceModel' },
    lines: {
      type: [lineSchema],
      validate: {
        validator: (lines: IJournalEntryLine[]) => Array.isArray(lines) && lines.length >= 2,
        message: 'A journal entry requires at least 2 lines',
      },
    },
    isVoid: { type: Boolean, default: false },
    voidedAt: { type: Date },
    voidReason: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
journalEntrySchema.plugin(tenantPlugin);
journalEntrySchema.index({ tenantId: 1, entryNumber: 1 }, { unique: true });
journalEntrySchema.index({ tenantId: 1, date: 1 });
journalEntrySchema.index({ tenantId: 1, source: 1 });
journalEntrySchema.index({ tenantId: 1, sourceModel: 1, sourceId: 1 });

const BALANCE_TOLERANCE = 0.005; // half a cent — floating-point rounding slack, not real imbalance

// The debit=credit invariant is enforced on the model itself (not only in postJournalEntry)
// so it can never be bypassed by a future caller that writes a JournalEntry directly.
journalEntrySchema.pre('validate', function (this: IJournalEntry, next) {
  const totalDebit = this.lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredit = this.lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    return next(new Error(`Journal entry is not balanced: total debits ${totalDebit} do not equal total credits ${totalCredit}`));
  }
  next();
});

// Posted entries are an immutable audit record — a correction is a reversing entry (the
// void action), never an edit to `lines`/`entryNumber`. `isVoid`/`voidedAt`/`voidReason`
// are the one legitimate post-creation mutation and are deliberately left unguarded here.
journalEntrySchema.pre('save', function (this: IJournalEntry, next) {
  if (!this.isNew && this.isModified('lines')) {
    return next(new Error('Journal entry lines are immutable once posted — void with a reversing entry instead'));
  }
  next();
});

export default mongoose.model<IJournalEntry>('JournalEntry', journalEntrySchema);
