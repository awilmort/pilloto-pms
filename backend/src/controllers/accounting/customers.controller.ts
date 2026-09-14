import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../../middleware/auth';
import Customer from '../../models/Customer';
import Company from '../../models/Company';

/**
 * Accounting-scoped Customer management (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md
 * Phase 5.2, superseded by the §11 architecture amendment / Phase 10.3 — `Invoice.customer`
 * now refs a dedicated `Customer` model, not the PMS-side `Company` model). Guarded by
 * `accounting.customers.manage` — the pre-existing `/api/companies` routes stay PMS-
 * `authorize('admin')`-gated and are unaffected.
 *
 * `linkedCompanyId` optionally bridges a Customer to a real PMS `Company` (the direct-bill
 * account case, §11) — validated against `Company` when provided, but Customer always keeps
 * its own denormalized fields rather than a live join.
 */

export const listCustomers = async (req: AuthRequest, res: Response) => {
  try {
    const { search, active, page = '1', limit = '50' } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (active !== undefined && active !== 'all') filter.isActive = active === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contactName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { rnc: { $regex: search, $options: 'i' } },
      ];
    }
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [customers, total] = await Promise.all([
      Customer.find(filter).sort({ name: 1 }).skip((pageNum - 1) * limitNum).limit(limitNum).populate('linkedCompanyId', 'name'),
      Customer.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: customers, meta: { total, page: pageNum, limit: limitNum } });
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching customers' });
  }
};

export const getCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const customer = await Customer.findById(req.params.id).populate('linkedCompanyId', 'name');
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.status(200).json({ success: true, data: customer });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    console.error('Get customer error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching customer' });
  }
};

export const createCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { name, contactName, email, phone, address, notes, rnc, razonSocial, linkedCompanyId } =
      req.body as Record<string, string | undefined>;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'name is required' });

    if (linkedCompanyId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(linkedCompanyId)) {
        return res.status(400).json({ success: false, message: 'linkedCompanyId must be a valid Company ID' });
      }
      const company = await Company.findById(linkedCompanyId).select('_id').lean();
      if (!company) return res.status(404).json({ success: false, message: 'Linked company not found' });
    }

    const customer = await Customer.create({
      name: name.trim(), contactName, email, phone, address, notes, rnc, razonSocial,
      linkedCompanyId: linkedCompanyId || undefined,
    });
    res.status(201).json({ success: true, message: 'Customer created successfully', data: customer });
  } catch (error: any) {
    console.error('Create customer error:', error);
    res.status(400).json({ success: false, message: error.message || 'Server error while creating customer' });
  }
};

export const updateCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { name, contactName, email, phone, address, notes, rnc, razonSocial, isActive, linkedCompanyId } =
      req.body as Record<string, unknown>;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ success: false, message: 'name is required' });
      customer.name = String(name).trim();
    }
    if (contactName !== undefined) customer.contactName = contactName as string;
    if (email !== undefined) customer.email = email as string;
    if (phone !== undefined) customer.phone = phone as string;
    if (address !== undefined) customer.address = address as string;
    if (notes !== undefined) customer.notes = notes as string;
    if (rnc !== undefined) customer.rnc = rnc as string;
    if (razonSocial !== undefined) customer.razonSocial = razonSocial as string;
    if (isActive !== undefined) customer.isActive = Boolean(isActive);
    if (linkedCompanyId !== undefined) {
      if (linkedCompanyId === null || linkedCompanyId === '') {
        customer.linkedCompanyId = undefined;
      } else {
        if (!mongoose.Types.ObjectId.isValid(linkedCompanyId as string)) {
          return res.status(400).json({ success: false, message: 'linkedCompanyId must be a valid Company ID' });
        }
        const company = await Company.findById(linkedCompanyId as string).select('_id').lean();
        if (!company) return res.status(404).json({ success: false, message: 'Linked company not found' });
        customer.linkedCompanyId = new mongoose.Types.ObjectId(linkedCompanyId as string);
      }
    }

    await customer.save();
    res.status(200).json({ success: true, message: 'Customer updated successfully', data: customer });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    console.error('Update customer error:', error);
    res.status(400).json({ success: false, message: error.message || 'Server error while updating customer' });
  }
};

// Archives (isActive:false) rather than hard-deletes — an Invoice may already reference
// this customer, unlike the PMS /api/companies route which hard-deletes.
export const archiveCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    customer.isActive = false;
    await customer.save();
    res.status(200).json({ success: true, message: 'Customer archived successfully', data: customer });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    console.error('Archive customer error:', error);
    res.status(500).json({ success: false, message: 'Server error while archiving customer' });
  }
};
