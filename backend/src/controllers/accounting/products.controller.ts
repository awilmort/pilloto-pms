import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../../middleware/auth';
import Product from '../../models/Product';
import ProductStock from '../../models/ProductStock';
import InventoryTransaction, { InventoryAdjustmentReason } from '../../models/InventoryTransaction';
import { UNIT_OF_MEASURE_CODES } from '../../constants/unitsOfMeasure';
import { receiveStock, resolveWarehouseId } from '../../services/accounting/inventory.service';

// Reasons that can only ever reduce stock — a client can't misreport damage/theft/loss as a gain.
const FIXED_DECREASE_REASONS = new Set<InventoryAdjustmentReason>(['damaged', 'lost', 'theft']);

async function attachStockByWarehouse<T extends { _id: any }>(products: T[]): Promise<(T & { stockByWarehouse: { warehouse: any; onHandQty: number }[] })[]> {
  if (products.length === 0) return products as any;
  const stocks = await ProductStock.find({ product: { $in: products.map(p => p._id) }, onHandQty: { $gt: 0 } })
    .populate('warehouse', 'name code')
    .lean();
  const byProduct = new Map<string, { warehouse: any; onHandQty: number }[]>();
  for (const s of stocks) {
    const key = String(s.product);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push({ warehouse: s.warehouse, onHandQty: s.onHandQty });
  }
  return products.map(p => ({ ...p, stockByWarehouse: byProduct.get(String(p._id)) || [] }));
}

export const listProducts = async (req: AuthRequest, res: Response) => {
  try {
    const { active, category, search, lowStock, sellable, purchasable } = req.query as {
      active?: string; category?: string; search?: string; lowStock?: string; sellable?: string; purchasable?: string;
    };
    const filter: any = {};
    if (active === undefined) filter.isActive = true;
    else if (active !== 'all') filter.isActive = active === 'true';
    if (category) filter.category = category;
    if (sellable !== undefined) filter.isSellable = sellable === 'true';
    if (purchasable !== undefined) filter.isPurchasable = purchasable === 'true';
    if (search) filter.$or = [{ name: { $regex: String(search), $options: 'i' } }, { sku: { $regex: String(search), $options: 'i' } }];

    let products = await Product.find(filter).sort({ name: 1 }).lean();
    if (lowStock === 'true') {
      products = products.filter(p => p.reorderPoint > 0 && p.onHandQty <= p.reorderPoint);
    }
    const withStock = await attachStockByWarehouse(products);
    res.status(200).json({ success: true, data: withStock });
  } catch (error) {
    console.error('List products error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching products' });
  }
};

export const getProduct = async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const [withStock] = await attachStockByWarehouse([product]);
    res.status(200).json({ success: true, data: withStock });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid product ID' });
    console.error('Get product error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching product' });
  }
};

// A non-zero initialQuantity is recorded as a real 'opening-balance' InventoryTransaction
// (not just a raw field write) so the ledger stays the authoritative source of onHandQty/cost
// from the moment a product exists
export const createProduct = async (req: AuthRequest, res: Response) => {
  try {
    const {
      name, sku, category, unitOfMeasure, defaultUnitPrice, reorderPoint, description, isSellable, isPurchasable, notes,
      initialQuantity, initialUnitCost, warehouseId,
    } = req.body as {
      name?: string; sku?: string; category?: string; unitOfMeasure?: string; defaultUnitPrice?: number;
      reorderPoint?: number; description?: string; isSellable?: boolean; isPurchasable?: boolean; notes?: string;
      initialQuantity?: number; initialUnitCost?: number; warehouseId?: string;
    };
    if (!name || !sku || !unitOfMeasure) {
      return res.status(400).json({ success: false, message: 'name, sku, and unitOfMeasure are required' });
    }
    if (!UNIT_OF_MEASURE_CODES.includes(unitOfMeasure as any)) {
      return res.status(400).json({ success: false, message: `unitOfMeasure must be one of ${UNIT_OF_MEASURE_CODES.join(', ')}` });
    }
    const hasInitialStock = !!initialQuantity && initialQuantity > 0;
    if (hasInitialStock && (initialUnitCost === undefined || initialUnitCost === null || initialUnitCost < 0)) {
      return res.status(400).json({ success: false, message: 'initialUnitCost is required and must be >= 0 when initialQuantity is given' });
    }
    const resolvedWarehouseId = hasInitialStock ? await resolveWarehouseId(warehouseId) : undefined;

    const product = await Product.create({
      name, sku, category, unitOfMeasure,
      defaultUnitPrice: defaultUnitPrice || 0,
      reorderPoint: reorderPoint || 0,
      description,
      isSellable: !!isSellable,
      isPurchasable: !!isPurchasable,
      notes,
      cost: hasInitialStock ? initialUnitCost : 0,
      onHandQty: hasInitialStock ? initialQuantity : 0,
    });

    if (hasInitialStock) {
      await ProductStock.create({ product: product._id, warehouse: resolvedWarehouseId, onHandQty: initialQuantity });
      await InventoryTransaction.create({
        product: product._id,
        warehouse: resolvedWarehouseId,
        type: 'opening-balance',
        quantityDelta: initialQuantity,
        balanceAfter: initialQuantity,
        unitCost: initialUnitCost,
        recordedBy: req.user._id,
      });
    }

    res.status(201).json({ success: true, message: 'Product created successfully', data: product });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'A product with this SKU already exists' });
    console.error('Create product error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating product' });
  }
};

// Note: `cost` and `onHandQty` are intentionally not accepted here — they only ever move
// via /purchase and /adjust so the InventoryTransaction ledger stays authoritative.
export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { name, sku, category, unitOfMeasure, defaultUnitPrice, reorderPoint, description, isSellable, isPurchasable, notes, isActive } = req.body;
    if (unitOfMeasure !== undefined && !UNIT_OF_MEASURE_CODES.includes(unitOfMeasure)) {
      return res.status(400).json({ success: false, message: `unitOfMeasure must be one of ${UNIT_OF_MEASURE_CODES.join(', ')}` });
    }
    const update: any = {};
    if (name !== undefined) update.name = name;
    if (sku !== undefined) update.sku = sku;
    if (category !== undefined) update.category = category;
    if (unitOfMeasure !== undefined) update.unitOfMeasure = unitOfMeasure;
    if (defaultUnitPrice !== undefined) update.defaultUnitPrice = defaultUnitPrice;
    if (reorderPoint !== undefined) update.reorderPoint = reorderPoint;
    if (description !== undefined) update.description = description;
    if (isSellable !== undefined) update.isSellable = isSellable;
    if (isPurchasable !== undefined) update.isPurchasable = isPurchasable;
    if (notes !== undefined) update.notes = notes;
    if (isActive !== undefined) update.isActive = isActive;

    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.status(200).json({ success: true, message: 'Product updated successfully', data: product });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid product ID' });
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'A product with this SKU already exists' });
    console.error('Update product error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating product' });
  }
};

// Archives rather than deletes — products are referenced permanently by InventoryTransaction history.
export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.status(200).json({ success: true, message: 'Product archived successfully', data: product });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid product ID' });
    console.error('Archive product error:', error);
    res.status(500).json({ success: false, message: 'Server error while archiving product' });
  }
};

// Receives stock from the ad hoc, no-formal-Bill fast path — Phase 6's Bill.receive
// action calls the same underlying receiveStock() service instead of duplicating this.
// `supplierId` is optional (this endpoint predates Supplier and stays usable without one —
// not every ad hoc purchase has a formal vendor on file) but is wired through now that
// Supplier exists (Phase 6.1), same as Bill.receive, so the InventoryTransaction traces
// back to a vendor whenever the caller has one.
export const purchaseProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { quantity, unitCost, supplierId, notes, warehouseId } = req.body as {
      quantity?: number; unitCost?: number; supplierId?: string; notes?: string; warehouseId?: string;
    };
    const resolvedWarehouseId = await resolveWarehouseId(warehouseId);

    const { product: updated, transaction } = await receiveStock({
      productId: req.params.id,
      warehouseId: resolvedWarehouseId,
      quantity: quantity as number,
      unitCost: unitCost as number,
      supplierId: supplierId && mongoose.Types.ObjectId.isValid(supplierId) ? supplierId : undefined,
      notes,
      recordedBy: req.user._id,
    });

    res.status(201).json({ success: true, message: 'Purchase recorded successfully', data: { product: updated, transaction } });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid ID' });
    console.error('Purchase product error:', error);
    res.status(500).json({ success: false, message: 'Server error while recording purchase' });
  }
};

// Manual stock correction (count fix, damage, loss, theft). No cost impact — see purchaseProduct
// for that. Accepts either a raw quantityDelta or a countedQuantity (the physical count result) , 
// so the caller doesn't have to do
// the subtraction themselves; the server derives the delta either way.
export const adjustProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { quantityDelta: rawDelta, countedQuantity, reason, notes, warehouseId } = req.body as {
      quantityDelta?: number; countedQuantity?: number; reason?: string; notes?: string; warehouseId?: string;
    };
    const resolvedWarehouseId = await resolveWarehouseId(warehouseId);

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const stock = await ProductStock.findOne({ product: product._id, warehouse: resolvedWarehouseId });
    const currentWarehouseQty = stock?.onHandQty || 0;

    let quantityDelta: number;
    if (countedQuantity !== undefined && countedQuantity !== null) {
      quantityDelta = countedQuantity - currentWarehouseQty;
    } else if (rawDelta !== undefined && rawDelta !== null) {
      quantityDelta = rawDelta;
    } else {
      return res.status(400).json({ success: false, message: 'quantityDelta or countedQuantity is required' });
    }
    if (quantityDelta === 0) {
      return res.status(400).json({ success: false, message: 'The adjustment must result in a non-zero quantity change' });
    }

    const resolvedReason: InventoryAdjustmentReason = (reason as InventoryAdjustmentReason) || 'other';
    if (FIXED_DECREASE_REASONS.has(resolvedReason) && quantityDelta > 0) {
      return res.status(400).json({ success: false, message: `Reason '${resolvedReason}' can only decrease stock` });
    }

    const newWarehouseQty = currentWarehouseQty + quantityDelta;
    if (newWarehouseQty < 0) {
      return res.status(400).json({ success: false, message: `This adjustment would take stock below zero in this warehouse (current: ${currentWarehouseQty})` });
    }
    const newGlobalQty = product.onHandQty + quantityDelta;
    if (newGlobalQty < 0) {
      return res.status(400).json({ success: false, message: `This adjustment would take total stock below zero (current: ${product.onHandQty})` });
    }

    const updated = await Product.findOneAndUpdate(
      { _id: product._id, onHandQty: product.onHandQty }, // optimistic guard against a concurrent write racing this calculation
      { $set: { onHandQty: newGlobalQty } },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ success: false, message: 'The product was modified concurrently by another operation — try again' });
    }

    const updatedStock = await ProductStock.findOneAndUpdate(
      { product: product._id, warehouse: resolvedWarehouseId, onHandQty: currentWarehouseQty },
      { $set: { onHandQty: newWarehouseQty } },
      { new: true, upsert: true }
    );
    if (!updatedStock) {
      return res.status(409).json({ success: false, message: 'Stock was modified concurrently by another operation — try again' });
    }

    const transaction = await InventoryTransaction.create({
      product: product._id,
      warehouse: resolvedWarehouseId,
      type: 'adjustment',
      quantityDelta,
      balanceAfter: updatedStock.onHandQty,
      reason: resolvedReason,
      notes,
      recordedBy: req.user._id,
    });

    res.status(201).json({ success: true, message: 'Stock adjusted successfully', data: { product: updated, transaction } });
  } catch (error: any) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid product ID' });
    console.error('Adjust product error:', error);
    res.status(500).json({ success: false, message: 'Server error while adjusting stock' });
  }
};

export const getProductTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 20 } = req.query as { page?: string; limit?: string };
    const pageNum = parseInt(page as unknown as string) || 1;
    const limitNum = parseInt(limit as unknown as string) || 20;

    const filter = { product: req.params.id };
    const [transactions, total] = await Promise.all([
      InventoryTransaction.find(filter)
        .populate('warehouse', 'name code')
        .populate('recordedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .skip((pageNum - 1) * limitNum)
        .lean(),
      InventoryTransaction.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        hasNextPage: pageNum * limitNum < total,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid product ID' });
    console.error('Get product transactions error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching transaction history' });
  }
};

export const getProductStockByWarehouse = async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const stock = await ProductStock.find({ product: product._id })
      .populate('warehouse', 'name code isActive')
      .sort({ onHandQty: -1 })
      .lean();

    res.status(200).json({ success: true, data: stock });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid product ID' });
    console.error('Get product stock by warehouse error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching stock by warehouse' });
  }
};
