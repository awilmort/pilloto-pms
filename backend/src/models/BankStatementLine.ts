import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * One movement on a bank statement (imported from the bank's file or typed in). Reconciling is
 * matching each one to the journal lines it corresponds to on the bank account's GL account —
 * a deposit to debits, a withdrawal to credits — or creating the entry it is missing (a bank fee),
 * or ignoring it. Journal lines are never changed: whether one is cleared is read from here.
 */
export type StatementLineStatus = 'unmatched' | 'matched' | 'ignored';

export interface IStatementMatch {
  entry: Types.ObjectId; // ref 'JournalEntry'
  line: Types.ObjectId; // the JournalEntry line _id
  amount: number; // signed like the statement: + deposit, − withdrawal
}

export interface IBankStatementLine extends Document {
  bankAccount: Types.ObjectId; // ref 'BankAccount'
  /** `YYYY-MM-DD`, the bank's date. */
  date: string;
  description: string;
  reference?: string;
  /** + money in (deposit), − money out (withdrawal). */
  amount: number;
  source: 'import' | 'manual';
  /** Detects a line imported twice: date|amount|reference|description. */
  fingerprint: string;
  status: StatementLineStatus;
  matches: IStatementMatch[];
  /** Set once a reconciliation that covers it is closed: it can no longer change. */
  reconciliation?: Types.ObjectId; // ref 'BankReconciliation'
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const statementLineSchema = new Schema<IBankStatementLine>(
  {
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    reference: { type: String, trim: true, maxlength: 100 },
    amount: { type: Number, required: true },
    source: { type: String, enum: ['import', 'manual'], default: 'import' },
    fingerprint: { type: String, required: true },
    status: { type: String, enum: ['unmatched', 'matched', 'ignored'], default: 'unmatched' },
    matches: {
      type: [new Schema<IStatementMatch>({
        entry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
        line: { type: Schema.Types.ObjectId, required: true },
        amount: { type: Number, required: true },
      }, { _id: false })],
      default: [],
    },
    reconciliation: { type: Schema.Types.ObjectId, ref: 'BankReconciliation' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

statementLineSchema.plugin(tenantPlugin);
statementLineSchema.index({ tenantId: 1, bankAccount: 1, date: 1 });
statementLineSchema.index({ tenantId: 1, bankAccount: 1, fingerprint: 1 });
statementLineSchema.index({ tenantId: 1, 'matches.line': 1 });

export default mongoose.model<IBankStatementLine>('BankStatementLine', statementLineSchema);
