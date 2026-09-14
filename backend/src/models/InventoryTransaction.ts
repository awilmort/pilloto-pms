import mongoose, { Document, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * Append-only stock-movement ledger — `Product.onHandQty`/`ProductStock.onHandQty`
 * are reconciled *from* these rows, never written independently of one.
 *
 * `purchase-reversal` voids a received Bill that added stock. `return` (a CreditNote
 * restocking goods at the original sale's snapshotted cost — no weighted-average
 * recalculation, since a return undoes a prior sale rather than receiving a new
 * purchase) and `return-reversal` (its mirror, used when voiding an issued,
 * unconsumed credit note) round out the movement types alongside `purchase`/
 * `adjustment`/`sale-deduction`/`opening-balance`.
 */
export type InventoryTransactionType = 'purchase' | 'adjustment' | 'sale-deduction' | 'opening-balance' | 'purchase-reversal' | 'return' | 'return-reversal';
export type InventoryAdjustmentReason = 'count-correction' | 'damaged' | 'lost' | 'theft' | 'other';

export interface IInventoryTransaction extends Document {
  product: Types.ObjectId; // ref 'Product'
  warehouse: Types.ObjectId; // ref 'Warehouse' — the location this movement happened at
  type: InventoryTransactionType;
  quantityDelta: number; // signed — positive for purchase/opening-balance/return/positive adjustment, negative for sale-deduction/purchase-reversal/return-reversal/negative adjustment
  balanceAfter: number; // that warehouse's ProductStock.onHandQty snapshot immediately after this transaction — audit trail, no ledger replay needed
  unitCost?: number; // set for 'purchase'/'opening-balance' (feeds the weighted-average recalc) and for 'sale-deduction'/'return'/'return-reversal' (a snapshot only, never recalculated into the average)
  reason?: InventoryAdjustmentReason; // set for 'adjustment'
  supplier?: Types.ObjectId; // ref 'Supplier' — set for 'purchase'/'purchase-reversal' rows that trace back to a Bill or a Phase 4 ad hoc purchase
  bill?: Types.ObjectId; // ref 'Bill' — set for 'purchase'/'purchase-reversal' rows produced by Bill.receive/Bill.void
  invoice?: Types.ObjectId; // ref 'Invoice' — set on 'sale-deduction' rows (Invoice.send) and on 'return'/'return-reversal' rows, so a credit note can look up the original sale's snapshotted unitCost
  creditNote?: Types.ObjectId; // ref 'CreditNote' — set on 'return'/'return-reversal' rows produced by CreditNote.issue/CreditNote.void
  notes?: string;
  recordedBy: Types.ObjectId; // ref 'User'
  createdAt: Date;
  updatedAt: Date;
}

const inventoryTransactionSchema = new Schema<IInventoryTransaction>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    type: { type: String, enum: ['purchase', 'adjustment', 'sale-deduction', 'opening-balance', 'purchase-reversal', 'return', 'return-reversal'], required: true },
    quantityDelta: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, min: 0 },
    reason: { type: String, enum: ['count-correction', 'damaged', 'lost', 'theft', 'other'] },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    bill: { type: Schema.Types.ObjectId, ref: 'Bill' },
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    creditNote: { type: Schema.Types.ObjectId, ref: 'CreditNote' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
inventoryTransactionSchema.plugin(tenantPlugin);
inventoryTransactionSchema.index({ tenantId: 1, product: 1, createdAt: -1 });
inventoryTransactionSchema.index({ tenantId: 1, warehouse: 1, createdAt: -1 });
inventoryTransactionSchema.index({ tenantId: 1, type: 1 });

export default mongoose.model<IInventoryTransaction>('InventoryTransaction', inventoryTransactionSchema);
