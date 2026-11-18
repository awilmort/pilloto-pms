import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * A bank reconciliation up to a statement date: the statement's ending balance must equal the
 * previous reconciliation's ending balance plus the statement lines dated up to then. Closing it
 * locks those lines. One open reconciliation per bank account at a time.
 */
export interface IBankReconciliation extends Document {
  bankAccount: Types.ObjectId;
  /** `YYYY-MM-DD`. */
  statementDate: string;
  statementEndingBalance: number;
  /** The previous closed reconciliation's ending balance (the opening one: 0 or what was entered). */
  beginningBalance: number;
  status: 'open' | 'closed';
  closedAt?: Date;
  closedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const reconciliationSchema = new Schema<IBankReconciliation>(
  {
    bankAccount: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true },
    statementDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    statementEndingBalance: { type: Number, required: true },
    beginningBalance: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    closedAt: { type: Date },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

reconciliationSchema.plugin(tenantPlugin);
reconciliationSchema.index({ tenantId: 1, bankAccount: 1, statementDate: -1 });

export default mongoose.model<IBankReconciliation>('BankReconciliation', reconciliationSchema);
