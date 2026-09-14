import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import Supplier from '../../models/Supplier';

/**
 * Supplier CRUD (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6.1). Unlike
 * `customers.controller.ts` (Phase 5.2), this isn't a thin wrapper around a
 * pre-existing PMS model — `Supplier` is a real new AP-side model (locked-in
 * decision #5), so this is plain CRUD directly against it, guarded entirely by
 * `accounting.suppliers.manage`.
 */

export const listSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const { search, active, page = '1', limit = '50' } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (active !== undefined && active !== 'all') filter.isActive = active === 'true';
    else if (active === undefined) filter.isActive = true;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contactName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { taxId: { $regex: search, $options: 'i' } },
      ];
    }
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [suppliers, total] = await Promise.all([
      Supplier.find(filter).sort({ name: 1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
      Supplier.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: suppliers, meta: { total, page: pageNum, limit: limitNum } });
  } catch (error) {
    console.error('List suppliers error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching suppliers' });
  }
};

export const getSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
    res.status(200).json({ success: true, data: supplier });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
    console.error('Get supplier error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching supplier' });
  }
};

export const createSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const { name, contactName, email, phone, address, notes, paymentTermsDays, taxId } = req.body as Record<string, unknown>;
    if (!String(name || '').trim()) return res.status(400).json({ success: false, message: 'name is required' });
    if (paymentTermsDays !== undefined && paymentTermsDays !== null && Number(paymentTermsDays) < 0) {
      return res.status(400).json({ success: false, message: 'paymentTermsDays must be >= 0' });
    }

    const supplier = await Supplier.create({
      name: String(name).trim(), contactName, email, phone, address, notes,
      paymentTermsDays: paymentTermsDays !== undefined && paymentTermsDays !== null ? Number(paymentTermsDays) : undefined,
      taxId,
    });
    res.status(201).json({ success: true, message: 'Supplier created successfully', data: supplier });
  } catch (error: any) {
    console.error('Create supplier error:', error);
    res.status(400).json({ success: false, message: error.message || 'Server error while creating supplier' });
  }
};

export const updateSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const { name, contactName, email, phone, address, notes, paymentTermsDays, taxId, isActive } = req.body as Record<string, unknown>;
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ success: false, message: 'name is required' });
      supplier.name = String(name).trim();
    }
    if (contactName !== undefined) supplier.contactName = contactName as string;
    if (email !== undefined) supplier.email = email as string;
    if (phone !== undefined) supplier.phone = phone as string;
    if (address !== undefined) supplier.address = address as string;
    if (notes !== undefined) supplier.notes = notes as string;
    if (taxId !== undefined) supplier.taxId = taxId as string;
    if (paymentTermsDays !== undefined) {
      if (paymentTermsDays !== null && Number(paymentTermsDays) < 0) {
        return res.status(400).json({ success: false, message: 'paymentTermsDays must be >= 0' });
      }
      supplier.paymentTermsDays = paymentTermsDays === null ? undefined : Number(paymentTermsDays);
    }
    if (isActive !== undefined) supplier.isActive = Boolean(isActive);

    await supplier.save();
    res.status(200).json({ success: true, message: 'Supplier updated successfully', data: supplier });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
    console.error('Update supplier error:', error);
    res.status(400).json({ success: false, message: error.message || 'Server error while updating supplier' });
  }
};

// Archives (isActive:false) rather than hard-deletes — Bill/InventoryTransaction rows may
// already reference this supplier.
export const archiveSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
    supplier.isActive = false;
    await supplier.save();
    res.status(200).json({ success: true, message: 'Supplier archived successfully', data: supplier });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
    console.error('Archive supplier error:', error);
    res.status(500).json({ success: false, message: 'Server error while archiving supplier' });
  }
};
