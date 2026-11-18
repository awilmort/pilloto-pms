import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * A bank account the company keeps its money in. Each one is a Chart-of-Accounts asset account
 * (`glAccount`): payments by transfer, card or check land there, and its statement is reconciled
 * against that account's journal lines. The seeded "Bancos" (1010) is the first, default one.
 */
export interface IBankAccount extends Document {
  name: string;
  bankName?: string;
  /** Last digits only, for recognising it. */
  accountNumberLast4?: string;
  currency: 'DOP' | 'USD' | 'EUR';
  glAccount: Types.ObjectId; // ref 'Account'
  /** Where non-cash payments go when no account is chosen. Exactly one is the default. */
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const bankAccountSchema = new Schema<IBankAccount>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    bankName: { type: String, trim: true, maxlength: 100 },
    accountNumberLast4: { type: String, trim: true, match: /^\d{2,6}$/ },
    currency: { type: String, enum: ['DOP', 'USD', 'EUR'], default: 'DOP' },
    glAccount: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

bankAccountSchema.plugin(tenantPlugin);
bankAccountSchema.index({ tenantId: 1, glAccount: 1 }, { unique: true });
bankAccountSchema.index({ tenantId: 1, isDefault: 1 });

export default mongoose.model<IBankAccount>('BankAccount', bankAccountSchema);
