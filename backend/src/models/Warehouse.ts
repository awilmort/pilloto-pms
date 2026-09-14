import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * A physical stock location. Every tenant that uses Inventory needs at least
 * one — kept deliberately generic (not scoped to any one business type).
 */
export interface IWarehouse extends Document {
  name: string;
  code: string; // short unique code, e.g. 'MAIN' — used in compact UI labels
  address?: string;
  isDefault: boolean; // exactly one warehouse is default; prefills purchase/adjust pickers. Enforced in the controller, not the schema.
  isActive: boolean; // archived instead of deleted — ProductStock/InventoryTransaction reference warehouses permanently
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const warehouseSchema = new Schema<IWarehouse>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
warehouseSchema.plugin(tenantPlugin);
warehouseSchema.index({ tenantId: 1, code: 1 }, { unique: true });
warehouseSchema.index({ tenantId: 1, isActive: 1 });

export default mongoose.model<IWarehouse>('Warehouse', warehouseSchema);
