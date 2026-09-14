import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { UNIT_OF_MEASURE_CODES, UnitOfMeasureCode } from '../constants/unitsOfMeasure';

/**
 * A stocked item. `cost`/`onHandQty` are system-maintained — only ever moved via
 * the inventory service's `receiveStock`/adjustment path, so the
 * `InventoryTransaction` ledger stays the authoritative source of both, the same
 * way `Account.normalBalance` is derived rather than client-supplied.
 *
 * `primarySupplier` is deliberately not on this model — a placeholder field
 * would just be a throwaway to migrate away from later. Add it as a proper
 * `ObjectId` ref to `Supplier` if/when it's needed.
 */
export interface IProduct extends Document {
  name: string;
  sku: string;
  category?: string;
  unitOfMeasure: UnitOfMeasureCode;
  cost: number; // system-maintained perpetual weighted-average unit cost — set via receiveStock, not directly editable
  defaultUnitPrice: number; // editable sale price, prefills invoice line items
  onHandQty: number; // denormalized cross-warehouse total, reconciled by InventoryTransaction rows — see ProductStock for the per-warehouse split
  reorderPoint: number; // low-stock threshold for reporting/alerts
  description?: string;
  isSellable: boolean; // gates whether this product can be added to an invoice
  isPurchasable: boolean; // gates whether this product can be added to a supplier bill
  notes?: string;
  isActive: boolean; // archived instead of deleted — InventoryTransaction rows reference products permanently
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 50 },
    category: { type: String, trim: true, maxlength: 100, default: '' },
    unitOfMeasure: { type: String, required: true, enum: UNIT_OF_MEASURE_CODES },
    cost: { type: Number, required: true, min: 0, default: 0 },
    defaultUnitPrice: { type: Number, required: true, min: 0, default: 0 },
    onHandQty: { type: Number, required: true, min: 0, default: 0 },
    reorderPoint: { type: Number, min: 0, default: 0 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    isSellable: { type: Boolean, default: false },
    isPurchasable: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
productSchema.plugin(tenantPlugin);
productSchema.index({ tenantId: 1, sku: 1 }, { unique: true });
productSchema.index({ tenantId: 1, name: 1 });
productSchema.index({ tenantId: 1, isActive: 1 });
productSchema.index({ tenantId: 1, category: 1 });

export default mongoose.model<IProduct>('Product', productSchema);
