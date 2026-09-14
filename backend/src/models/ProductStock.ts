import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * Per-(product, warehouse) stock balance — the source of truth for where a
 * product's quantity physically sits. `Product.onHandQty` is the denormalized
 * cross-warehouse sum, reconciled from this collection the same way it's
 * always reconciled by `InventoryTransaction` rows.
 */
export interface IProductStock extends Document {
  product: Types.ObjectId; // ref 'Product'
  warehouse: Types.ObjectId; // ref 'Warehouse'
  onHandQty: number;
  createdAt: Date;
  updatedAt: Date;
}

const productStockSchema = new Schema<IProductStock>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    onHandQty: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
productStockSchema.plugin(tenantPlugin);
productStockSchema.index({ tenantId: 1, product: 1, warehouse: 1 }, { unique: true });
productStockSchema.index({ tenantId: 1, warehouse: 1 });

export default mongoose.model<IProductStock>('ProductStock', productStockSchema);
