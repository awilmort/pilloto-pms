import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * Chart of Accounts. Every Accounting module (Inventory, AR, AP, GL auto-posting)
 * posts against these accounts.
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type AccountNormalBalance = 'debit' | 'credit';

export interface IAccount extends Document {
  code: string; // unique per tenant, e.g. "1000" — short numeric string, sortable
  name: string;
  type: AccountType;
  normalBalance: AccountNormalBalance; // derived from type — never accepted from the client
  parentAccount?: Types.ObjectId; // ref 'Account' (self) — optional hierarchy for subtotaled reporting
  isSystem: boolean; // seeded default account — protected from deletion, same pattern as Role.isSystem
  isActive: boolean; // archived, not deleted — JournalEntry lines reference accounts permanently
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<IAccount>(
  {
    code: { type: String, required: true, trim: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    type: { type: String, enum: ['asset', 'liability', 'equity', 'revenue', 'expense'], required: true },
    normalBalance: { type: String, enum: ['debit', 'credit'], required: true },
    parentAccount: { type: Schema.Types.ObjectId, ref: 'Account' },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
accountSchema.plugin(tenantPlugin);
accountSchema.index({ tenantId: 1, code: 1 }, { unique: true });
accountSchema.index({ tenantId: 1, type: 1 });
accountSchema.index({ tenantId: 1, isActive: 1 });

export default mongoose.model<IAccount>('Account', accountSchema);
