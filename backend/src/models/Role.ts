import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { APP_CODES, AppCode } from '../constants/apps';

export interface IRole extends Document {
  name: string; // e.g., 'admin', 'customer', 'maintenance', 'staff'
  /** Which app this role belongs to. A role grants access to exactly one app. */
  app: AppCode;
  description?: string;
  permissions: string[]; // e.g., ['admin.access', 'accommodations.manage', 'schedule.view']
  /** Max discount % a user with this role can apply (0-100). Only relevant when admin.reservations.discount permission is granted. */
  discountLimit?: number;
  /** System-seeded role (provisionTenant.ts). Cannot be deleted. */
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>({
  name: {
    type: String,
    required: true,
    // Uniqueness enforced by compound index { tenantId, app, name } below
    trim: true,
    lowercase: true,
    maxlength: 50,
  },
  app: {
    type: String,
    enum: APP_CODES,
    required: true,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 200,
    default: ''
  },
  permissions: [{ type: String, trim: true }],
  discountLimit: { type: Number, min: 0, max: 100, default: 0 },
  isSystem: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

// ── Multi-tenancy ────────────────────────────────────────────
roleSchema.plugin(tenantPlugin);
// Per-tenant, per-app unique role name
roleSchema.index({ tenantId: 1, app: 1, name: 1 }, { unique: true });

export default mongoose.model<IRole>('Role', roleSchema);
