import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * AP vendor/payee record. Deliberately separate from the PMS-side `Company.ts` —
 * a `Bill` is owed *to* a `Supplier`, never a `Company`, the same way an
 * `Invoice` is owed *by* a `Customer`/individual, never a `Supplier`.
 */
export interface ISupplier extends Document {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  paymentTermsDays?: number; // prefills a new Bill's dueDate from issueDate; falls back to net-15 in the controller
  taxId?: string; // supplier's own RNC/tax ID, informational — not part of the e-CF pipeline (Bills never issue e-CF)
  isActive: boolean; // archived instead of deleted — Bill/InventoryTransaction rows reference suppliers permanently
  createdAt: Date;
  updatedAt: Date;
}

const supplierSchema = new Schema<ISupplier>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    contactName: { type: String, trim: true, maxlength: 100 },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true, maxlength: 300 },
    notes: { type: String, trim: true, maxlength: 1000 },
    paymentTermsDays: { type: Number, min: 0 },
    taxId: { type: String, trim: true, maxlength: 50 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

supplierSchema.index({ name: 'text', email: 'text', contactName: 'text' });

// ── Multi-tenancy ────────────────────────────────────────────
supplierSchema.plugin(tenantPlugin);
supplierSchema.index({ tenantId: 1, isActive: 1 });

export default mongoose.model<ISupplier>('Supplier', supplierSchema);
