import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IRole extends Document {
  name: string; // e.g., 'admin', 'customer', 'maintenance', 'staff'
  description?: string;
  permissions: string[]; // e.g., ['admin.access', 'accommodations.manage', 'schedule.view']
  /** Max discount % a user with this role can apply (0-100). Only relevant when admin.reservations.discount permission is granted. */
  discountLimit?: number;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>({
  name: {
    type: String,
    required: true,
    // Uniqueness enforced by compound index { name, tenantId } below
    trim: true,
    lowercase: true,
    maxlength: 50,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 200,
    default: ''
  },
  permissions: [{ type: String, trim: true }],
  discountLimit: { type: Number, min: 0, max: 100, default: 0 },
}, { timestamps: true });

// ── Multi-tenancy ────────────────────────────────────────────
roleSchema.plugin(tenantPlugin);
// Per-tenant unique role name
roleSchema.index({ name: 1, tenantId: 1 }, { unique: true });

export default mongoose.model<IRole>('Role', roleSchema);
