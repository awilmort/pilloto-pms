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
  taxId?: string; // RNC (9 digits) or cédula (11 digits) — reported on the DGII 606 for every purchase
  /** 606 "Tipo de bienes y servicios" (01–11) a new bill from this supplier starts with. */
  defaultExpenseType?: string;
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
    taxId: {
      type: String,
      trim: true,
      set: (v: string) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : v),
      validate: { validator: (v: string) => !v || /^\d{9}$|^\d{11}$/.test(v), message: 'RNC must be 9 digits or cédula 11 digits' },
    },
    defaultExpenseType: { type: String, enum: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

supplierSchema.index({ name: 'text', email: 'text', contactName: 'text' });

// ── Multi-tenancy ────────────────────────────────────────────
supplierSchema.plugin(tenantPlugin);
supplierSchema.index({ tenantId: 1, isActive: 1 });

export default mongoose.model<ISupplier>('Supplier', supplierSchema);
