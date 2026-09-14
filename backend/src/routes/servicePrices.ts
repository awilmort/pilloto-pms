import express, { Response } from 'express';
import { authenticate, authorize, authorizeAppAccess, AuthRequest } from '../middleware/auth';
import ServicePrice from '../models/ServicePrice';

const router = express.Router();

// ── GET /service-prices ───────────────────────────────────────
router.get('/', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { serviceId, active, category } = req.query as {
      serviceId?: string;
      active?: string;
      category?: string;
    };
    const filter: any = {};
    if (serviceId) filter.serviceId = serviceId;
    if (active !== undefined) filter.isActive = active === 'true';
    if (category) filter.category = category;

    const prices = await ServicePrice.find(filter)
      .sort({ category: 1, startDate: 1 })
      .populate('serviceId', 'name kind code')
      .populate('companyId', 'name')
      .exec();
    res.status(200).json({ success: true, data: prices });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to retrieve service prices' });
  }
});

// ── GET /service-prices/:id ───────────────────────────────────
router.get('/:id', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const price = await ServicePrice.findById(req.params.id)
      .populate('serviceId', 'name kind code')
      .populate('companyId', 'name')
      .exec();
    if (!price) return res.status(404).json({ success: false, message: 'Service price not found' });
    res.status(200).json({ success: true, data: price });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to retrieve service price' });
  }
});

// ── POST /service-prices ──────────────────────────────────────
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const price = await ServicePrice.create(req.body);
    res.status(201).json({ success: true, data: price });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to create service price' });
  }
});

// ── PUT /service-prices/:id ───────────────────────────────────
router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const price = await ServicePrice.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).exec();
    if (!price) return res.status(404).json({ success: false, message: 'Service price not found' });
    res.status(200).json({ success: true, data: price });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update service price' });
  }
});

// ── DELETE /service-prices/:id ────────────────────────────────
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const price = await ServicePrice.findByIdAndDelete(req.params.id).exec();
    if (!price) return res.status(404).json({ success: false, message: 'Service price not found' });
    res.status(200).json({ success: true, message: 'Service price deleted' });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to delete service price' });
  }
});

export default router;
