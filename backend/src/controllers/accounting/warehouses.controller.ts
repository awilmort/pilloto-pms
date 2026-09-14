import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import Warehouse from '../../models/Warehouse';
import ProductStock from '../../models/ProductStock';
import { getAccountingPlanFeatures } from '../../config/accountingPlans';

export const listWarehouses = async (req: AuthRequest, res: Response) => {
  try {
    const { active, search } = req.query as { active?: string; search?: string };
    const filter: any = {};
    if (active === undefined) filter.isActive = true;
    else if (active !== 'all') filter.isActive = active === 'true';
    if (search) filter.name = { $regex: String(search), $options: 'i' };

    const warehouses = await Warehouse.find(filter).sort({ isDefault: -1, name: 1 }).lean();
    res.status(200).json({ success: true, data: warehouses });
  } catch (error) {
    console.error('List warehouses error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching warehouses' });
  }
};

export const getWarehouse = async (req: AuthRequest, res: Response) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    if (!warehouse) return res.status(404).json({ success: false, message: 'Warehouse not found' });
    res.status(200).json({ success: true, data: warehouse });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid warehouse ID' });
    console.error('Get warehouse error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching warehouse' });
  }
};

// The first warehouse ever created for a tenant automatically becomes the default (no
// separate "set default" step needed for a fresh Accounting-only tenant). Subsequent ones
// default to false unless the caller explicitly requests isDefault, in which case the
// previous default is unset.
export const createWarehouse = async (req: AuthRequest, res: Response) => {
  try {
    const { name, code, address, notes, isDefault } = req.body as {
      name?: string; code?: string; address?: string; notes?: string; isDefault?: boolean;
    };
    if (!name || !code) return res.status(400).json({ success: false, message: 'name and code are required' });

    const existingCount = await Warehouse.countDocuments({});
    const { maxWarehouses } = getAccountingPlanFeatures(req.tenant?.plans?.accounting);
    if (maxWarehouses !== null && existingCount >= maxWarehouses) {
      return res.status(403).json({
        success: false,
        message: `Your Accounting plan allows up to ${maxWarehouses} warehouse(s). Upgrade your plan to add more.`,
      });
    }
    const shouldBeDefault = existingCount === 0 || !!isDefault;
    if (shouldBeDefault) {
      await Warehouse.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }

    const warehouse = await Warehouse.create({ name, code, address, notes, isDefault: shouldBeDefault });
    res.status(201).json({ success: true, message: 'Warehouse created successfully', data: warehouse });
  } catch (error: any) {
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'A warehouse with this code already exists' });
    console.error('Create warehouse error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating warehouse' });
  }
};

export const updateWarehouse = async (req: AuthRequest, res: Response) => {
  try {
    const { name, code, address, notes, isActive, isDefault } = req.body as {
      name?: string; code?: string; address?: string; notes?: string; isActive?: boolean; isDefault?: boolean;
    };

    const warehouse = await Warehouse.findById(req.params.id);
    if (!warehouse) return res.status(404).json({ success: false, message: 'Warehouse not found' });

    if (name !== undefined) warehouse.name = name;
    if (code !== undefined) warehouse.code = code;
    if (address !== undefined) warehouse.address = address;
    if (notes !== undefined) warehouse.notes = notes;
    if (isActive !== undefined) warehouse.isActive = isActive;

    if (isDefault === true && !warehouse.isDefault) {
      await Warehouse.updateMany({ _id: { $ne: warehouse._id }, isDefault: true }, { $set: { isDefault: false } });
      warehouse.isDefault = true;
    } else if (isDefault === false && warehouse.isDefault) {
      return res.status(400).json({ success: false, message: 'Set a different warehouse as default instead of unsetting this one' });
    }

    await warehouse.save();
    res.status(200).json({ success: true, message: 'Warehouse updated successfully', data: warehouse });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid warehouse ID' });
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'A warehouse with this code already exists' });
    console.error('Update warehouse error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating warehouse' });
  }
};

// Archives rather than deletes — warehouses are referenced permanently by ProductStock/
// InventoryTransaction history. Rejected while it's the default or still holds stock.
export const deleteWarehouse = async (req: AuthRequest, res: Response) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    if (!warehouse) return res.status(404).json({ success: false, message: 'Warehouse not found' });
    if (warehouse.isDefault) {
      return res.status(400).json({ success: false, message: 'Cannot archive the default warehouse — set a different warehouse as default first' });
    }
    const stockedCount = await ProductStock.countDocuments({ warehouse: warehouse._id, onHandQty: { $gt: 0 } });
    if (stockedCount > 0) {
      return res.status(400).json({ success: false, message: 'Cannot archive a warehouse that still holds stock' });
    }

    warehouse.isActive = false;
    await warehouse.save();
    res.status(200).json({ success: true, message: 'Warehouse archived successfully', data: warehouse });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid warehouse ID' });
    console.error('Archive warehouse error:', error);
    res.status(500).json({ success: false, message: 'Server error while archiving warehouse' });
  }
};

export const getWarehouseStock = async (req: AuthRequest, res: Response) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    if (!warehouse) return res.status(404).json({ success: false, message: 'Warehouse not found' });

    const stock = await ProductStock.find({ warehouse: warehouse._id, onHandQty: { $gt: 0 } })
      .populate('product', 'name sku unitOfMeasure reorderPoint isActive')
      .sort({ onHandQty: -1 })
      .lean();

    res.status(200).json({ success: true, data: stock });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid warehouse ID' });
    console.error('Get warehouse stock error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching warehouse stock' });
  }
};
