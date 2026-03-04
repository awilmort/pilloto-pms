import express, { Response } from 'express';
import Company from '../models/Company';
import Reservation from '../models/Reservation';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/companies — list companies (admin only)
router.get('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { search, active, page = 1, limit = 50 } = req.query as any;
    const filter: any = {};
    if (active !== undefined) filter.isActive = active === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contactName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [companies, total] = await Promise.all([
      Company.find(filter).sort({ name: 1 }).skip(skip).limit(Number(limit)),
      Company.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: companies, total });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve companies' });
  }
});

// GET /api/companies/:id — get single company + its reservations
router.get('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    const reservations = await Reservation.find({ company: company._id })
      .populate('user', 'firstName lastName email')
      .populate('room', 'name')
      .sort({ createdAt: -1 })
      .limit(50);
    res.status(200).json({ success: true, data: { company, reservations } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve company' });
  }
});

// POST /api/companies — create company (admin only)
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const company = await Company.create(req.body);
    res.status(201).json({ success: true, data: company });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to create company' });
  }
});

// PUT /api/companies/:id — update company (admin only)
router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const company = await Company.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    res.status(200).json({ success: true, data: company });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update company' });
  }
});

// DELETE /api/companies/:id — delete company (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const company = await Company.findByIdAndDelete(req.params.id);
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    res.status(200).json({ success: true, message: 'Company deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to delete company' });
  }
});

export default router;
