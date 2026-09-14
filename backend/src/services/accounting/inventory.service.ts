import { Types } from 'mongoose';
import Product, { IProduct } from '../../models/Product';
import ProductStock from '../../models/ProductStock';
import InventoryTransaction, { IInventoryTransaction, InventoryTransactionType } from '../../models/InventoryTransaction';
import Warehouse from '../../models/Warehouse';

/**
 * Inventory stock-movement primitives (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md
 * Phase 4.1). `receiveStock` is extracted as a standalone service — not buried in a
 * controller — from day one, per the plan's explicit instruction, since Phase 6's
 * `Bill.receive` action needs to call the exact same stock-receipt path a formal
 * purchase does; retrofitting that reuse later would mean touching every existing
 * caller.
 */

// Resolves an explicit warehouseId, or falls back to the tenant's default warehouse.
// Throws { status, message } — callers wrap in try/catch, same convention as receiveStock.
export async function resolveWarehouseId(warehouseId?: string): Promise<string> {
  if (warehouseId) {
    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse || !warehouse.isActive) throw { status: 400, message: 'Invalid or inactive warehouse' };
    return String(warehouse._id);
  }
  const defaultWarehouse = await Warehouse.findOne({ isDefault: true });
  if (!defaultWarehouse) throw { status: 400, message: 'No warehouse specified and no default warehouse is configured' };
  return String(defaultWarehouse._id);
}

export interface ReceiveStockParams {
  productId: Types.ObjectId | string;
  warehouseId: Types.ObjectId | string;
  quantity: number;
  unitCost: number;
  supplierId?: Types.ObjectId | string; // Phase 6.1 — traces this receipt back to a Supplier, whether via a Bill or the ad hoc purchase endpoint
  bill?: Types.ObjectId | string; // Phase 6.1 — set when this receipt comes from Bill.receive
  notes?: string;
  recordedBy: Types.ObjectId | string;
}

export interface ReceiveStockResult {
  product: IProduct;
  transaction: IInventoryTransaction;
}

// The single write path for stock receipt: creates a 'purchase' InventoryTransaction,
// increments onHandQty (global + per-warehouse), and recalculates the product's perpetual
// weighted-average cost
export async function receiveStock(params: ReceiveStockParams): Promise<ReceiveStockResult> {
  const { productId, warehouseId, quantity, unitCost, supplierId, bill, notes, recordedBy } = params;

  if (!quantity || quantity <= 0) throw { status: 400, message: 'Quantity must be greater than 0' };
  if (unitCost === undefined || unitCost === null || unitCost < 0) {
    throw { status: 400, message: 'Unit cost is required and must be greater than or equal to 0' };
  }

  const product = await Product.findById(productId);
  if (!product) throw { status: 404, message: 'Product not found' };

  const newQty = product.onHandQty + quantity;
  const newCost = product.onHandQty > 0
    ? ((product.onHandQty * product.cost) + (quantity * unitCost)) / newQty
    : unitCost;

  const updated = await Product.findOneAndUpdate(
    { _id: product._id, onHandQty: product.onHandQty }, // optimistic guard against a concurrent write racing this calculation
    { $set: { onHandQty: newQty, cost: newCost } },
    { new: true }
  );
  if (!updated) {
    throw { status: 409, message: 'The product was modified concurrently by another operation — try again' };
  }

  const updatedStock = await ProductStock.findOneAndUpdate(
    { product: product._id, warehouse: warehouseId },
    { $inc: { onHandQty: quantity } },
    { new: true, upsert: true }
  );

  const transaction = await InventoryTransaction.create({
    product: product._id,
    warehouse: warehouseId,
    type: 'purchase',
    quantityDelta: quantity,
    balanceAfter: updatedStock.onHandQty,
    unitCost,
    supplier: supplierId,
    bill,
    notes,
    recordedBy,
  });

  return { product: updated, transaction };
}

// Available quantity for a product in a specific warehouse — a non-mutating pre-check so a
// caller (Invoice.send, Phase 5.1) can validate every line has enough stock before doing
// anything externally irreversible (e.g. issuing a fiscal e-CF), without touching inventory yet.
export async function getAvailableQty(productId: Types.ObjectId | string, warehouseId: Types.ObjectId | string): Promise<number> {
  const stock = await ProductStock.findOne({ product: productId, warehouse: warehouseId });
  return stock?.onHandQty || 0;
}

export interface DeductStockParams {
  productId: Types.ObjectId | string;
  warehouseId: Types.ObjectId | string;
  quantity: number;
  type?: InventoryTransactionType; // defaults to 'sale-deduction'; Bill.void (Phase 6.1) passes 'purchase-reversal', CreditNote.void (Phase 8.1) passes 'return-reversal', to reuse the same guarded decrement
  supplier?: Types.ObjectId | string; // Phase 6.1 — set on a 'purchase-reversal' row
  bill?: Types.ObjectId | string; // Phase 6.1 — set on a 'purchase-reversal' row
  invoice?: Types.ObjectId | string; // Phase 5.1/8.1 — set on 'sale-deduction' rows (traceability for a later return) and on 'return-reversal' rows
  creditNote?: Types.ObjectId | string; // Phase 8.1 — set on a 'return-reversal' row
  notes?: string;
  recordedBy: Types.ObjectId | string;
}

export interface DeductStockResult {
  product: IProduct;
  transaction: IInventoryTransaction;
}

// The single write path for any guarded stock decrease — creates the InventoryTransaction and
// decrements onHandQty (global + per-warehouse), snapshotting the product's current
// weighted-average cost onto the transaction (feeds Phase 7's COGS posting; a decrease never
// moves the average cost itself, only receipts do — see receiveStock above). Defaults to a
// 'sale-deduction' row for Invoice.send (Phase 5.1); Bill.void (Phase 6.1) passes
// type:'purchase-reversal' to reverse stock a voided Bill had added, and CreditNote.void
// (Phase 8.1) passes type:'return-reversal' to reverse stock an issued credit note's 'return'
// line had added back — the guard logic (can't take a warehouse or the product's global total
// below zero) is identical in every case.
export async function deductStockForSale(params: DeductStockParams): Promise<DeductStockResult> {
  const { productId, warehouseId, quantity, type = 'sale-deduction', supplier, bill, invoice, creditNote, notes, recordedBy } = params;

  if (!quantity || quantity <= 0) throw { status: 400, message: 'Quantity must be greater than 0' };

  const product = await Product.findById(productId);
  if (!product) throw { status: 404, message: 'Product not found' };

  const stock = await ProductStock.findOne({ product: product._id, warehouse: warehouseId });
  const currentWarehouseQty = stock?.onHandQty || 0;
  if (currentWarehouseQty < quantity) {
    throw { status: 400, message: `Insufficient stock for "${product.name}" in the selected warehouse (available: ${currentWarehouseQty}, requested: ${quantity})` };
  }

  const newGlobalQty = product.onHandQty - quantity;
  if (newGlobalQty < 0) {
    throw { status: 400, message: `Insufficient total stock for "${product.name}" (available: ${product.onHandQty}, requested: ${quantity})` };
  }

  const updated = await Product.findOneAndUpdate(
    { _id: product._id, onHandQty: product.onHandQty }, // optimistic guard against a concurrent write racing this calculation
    { $set: { onHandQty: newGlobalQty } },
    { new: true }
  );
  if (!updated) {
    throw { status: 409, message: 'The product was modified concurrently by another operation — try again' };
  }

  const updatedStock = await ProductStock.findOneAndUpdate(
    { product: product._id, warehouse: warehouseId, onHandQty: currentWarehouseQty },
    { $inc: { onHandQty: -quantity } },
    { new: true }
  );
  if (!updatedStock) {
    throw { status: 409, message: 'Stock was modified concurrently by another operation — try again' };
  }

  const transaction = await InventoryTransaction.create({
    product: product._id,
    warehouse: warehouseId,
    type,
    quantityDelta: -quantity,
    balanceAfter: updatedStock.onHandQty,
    unitCost: product.cost,
    supplier,
    bill,
    invoice,
    creditNote,
    notes,
    recordedBy,
  });

  return { product: updated, transaction };
}

export interface RestockReturnParams {
  productId: Types.ObjectId | string;
  warehouseId: Types.ObjectId | string;
  quantity: number;
  unitCost: number; // the original sale's snapshotted unitCost (read from its 'sale-deduction' row) — never Product.cost, which may have moved since
  invoice?: Types.ObjectId | string;
  creditNote?: Types.ObjectId | string;
  notes?: string;
  recordedBy: Types.ObjectId | string;
}

export interface RestockReturnResult {
  product: IProduct;
  transaction: IInventoryTransaction;
}

// The single write path for a CreditNote 'return' line (Phase 8.1): adds quantity back at a
// *given* unit cost without touching the product's weighted-average `cost` — a return undoes a
// prior sale, it isn't a new purchase at a new price, so unlike receiveStock() it must never
// feed the weighted-average recalculation (TIO_CREDIT_NOTES_PLAN.md §2.3).
export async function restockReturn(params: RestockReturnParams): Promise<RestockReturnResult> {
  const { productId, warehouseId, quantity, unitCost, invoice, creditNote, notes, recordedBy } = params;

  if (!quantity || quantity <= 0) throw { status: 400, message: 'Quantity must be greater than 0' };
  if (unitCost === undefined || unitCost === null || unitCost < 0) {
    throw { status: 400, message: 'Unit cost is required and must be greater than or equal to 0' };
  }

  const product = await Product.findById(productId);
  if (!product) throw { status: 404, message: 'Product not found' };

  const newQty = product.onHandQty + quantity;
  const updated = await Product.findOneAndUpdate(
    { _id: product._id, onHandQty: product.onHandQty }, // optimistic guard against a concurrent write racing this calculation
    { $set: { onHandQty: newQty } }, // cost is deliberately left untouched — see function comment
    { new: true }
  );
  if (!updated) {
    throw { status: 409, message: 'The product was modified concurrently by another operation — try again' };
  }

  const updatedStock = await ProductStock.findOneAndUpdate(
    { product: product._id, warehouse: warehouseId },
    { $inc: { onHandQty: quantity } },
    { new: true, upsert: true }
  );

  const transaction = await InventoryTransaction.create({
    product: product._id,
    warehouse: warehouseId,
    type: 'return',
    quantityDelta: quantity,
    balanceAfter: updatedStock.onHandQty,
    unitCost,
    invoice,
    creditNote,
    notes,
    recordedBy,
  });

  return { product: updated, transaction };
}
