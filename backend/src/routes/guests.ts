import express, { Response } from 'express';
import Guest from '../models/Guest';
import Reservation from '../models/Reservation';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/guests — list guests (admin only)
router.get('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { search, page = 1, limit = 50 } = req.query as any;
    const filter: any = {};
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [guests, total] = await Promise.all([
      Guest.find(filter)
        .populate({ path: 'companyLinks.companyId', select: 'name' })
        .sort({ lastName: 1, firstName: 1 })
        .skip(skip)
        .limit(Number(limit)),
      Guest.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: guests, total });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve guests' });
  }
});

// GET /api/guests/:id — get single guest + reservation history
router.get('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const guest = await Guest.findById(req.params.id)
      .populate({ path: 'companyLinks.companyId', select: 'name' });
    if (!guest) return res.status(404).json({ success: false, message: 'Guest not found' });
    const reservations = await Reservation.find({ guestRecord: guest._id })
      .populate('room', 'name')
      .populate('rooms', 'name')
      .sort({ createdAt: -1 })
      .limit(50);
    res.status(200).json({ success: true, data: { guest, reservations } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve guest' });
  }
});

// POST /api/guests — create guest (admin only)
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const guest = await Guest.create(req.body);
    await guest.populate({ path: 'companyLinks.companyId', select: 'name' });
    res.status(201).json({ success: true, data: guest });
  } catch (error: any) {
    const msg = error.code === 11000 ? 'A guest with that email already exists' : error.message || 'Failed to create guest';
    res.status(400).json({ success: false, message: msg });
  }
});

// PUT /api/guests/:id — update guest (admin only)
router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const guest = await Guest.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate({ path: 'companyLinks.companyId', select: 'name' });
    if (!guest) return res.status(404).json({ success: false, message: 'Guest not found' });
    res.status(200).json({ success: true, data: guest });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update guest' });
  }
});

// DELETE /api/guests/:id — delete guest (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const guest = await Guest.findByIdAndDelete(req.params.id);
    if (!guest) return res.status(404).json({ success: false, message: 'Guest not found' });
    res.status(200).json({ success: true, message: 'Guest deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to delete guest' });
  }
});

// POST /api/guests/:id/company-links — add a company link to a guest
router.post('/:id/company-links', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { companyId, autoApproveCorporateRate = false } = req.body;
    if (!companyId) return res.status(400).json({ success: false, message: 'companyId is required' });

    const guest = await Guest.findById(req.params.id);
    if (!guest) return res.status(404).json({ success: false, message: 'Guest not found' });

    const alreadyLinked = guest.companyLinks.some(
      (l) => l.companyId.toString() === String(companyId)
    );
    if (alreadyLinked) {
      return res.status(400).json({ success: false, message: 'Company already linked to this guest' });
    }

    guest.companyLinks.push({ companyId, autoApproveCorporateRate: !!autoApproveCorporateRate } as any);
    await guest.save();
    await guest.populate({ path: 'companyLinks.companyId', select: 'name' });
    res.status(200).json({ success: true, data: guest });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to add company link' });
  }
});

// PUT /api/guests/:id/company-links/:companyId — update autoApproveCorporateRate for a link
router.put('/:id/company-links/:companyId', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { autoApproveCorporateRate } = req.body;
    const guest = await Guest.findOneAndUpdate(
      { _id: req.params.id, 'companyLinks.companyId': req.params.companyId },
      { $set: { 'companyLinks.$.autoApproveCorporateRate': !!autoApproveCorporateRate } },
      { new: true }
    ).populate({ path: 'companyLinks.companyId', select: 'name' });
    if (!guest) return res.status(404).json({ success: false, message: 'Guest or company link not found' });
    res.status(200).json({ success: true, data: guest });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update company link' });
  }
});

// DELETE /api/guests/:id/company-links/:companyId — remove a company link
router.delete('/:id/company-links/:companyId', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const guest = await Guest.findByIdAndUpdate(
      req.params.id,
      { $pull: { companyLinks: { companyId: req.params.companyId } } },
      { new: true }
    ).populate({ path: 'companyLinks.companyId', select: 'name' });
    if (!guest) return res.status(404).json({ success: false, message: 'Guest not found' });
    res.status(200).json({ success: true, data: guest });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to remove company link' });
  }
});

export default router;
