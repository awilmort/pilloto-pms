import express, { Response } from 'express';
import { authenticate, authorize, authorizeAppAccess, AuthRequest } from '../middleware/auth';
import Service from '../models/Service';

const router = express.Router();

// ── GET /services ─────────────────────────────────────────────
router.get('/', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { active, kind } = req.query as { active?: string; kind?: string };
    const filter: any = {};
    if (active !== undefined) filter.isActive = active === 'true';
    if (kind) filter.kind = kind;
    const services = await Service.find(filter).sort({ kind: 1, name: 1 }).exec();
    res.status(200).json({ success: true, data: services });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to retrieve services' });
  }
});

// ── GET /services/:id ─────────────────────────────────────────
router.get('/:id', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const service = await Service.findById(req.params.id).exec();
    if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
    res.status(200).json({ success: true, data: service });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to retrieve service' });
  }
});

// ── POST /services ────────────────────────────────────────────
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const service = await Service.create(req.body);
    res.status(201).json({ success: true, data: service });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to create service' });
  }
});

// ── PUT /services/:id ─────────────────────────────────────────
router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const service = await Service.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).exec();
    if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
    res.status(200).json({ success: true, data: service });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update service' });
  }
});

// ── DELETE /services/:id ──────────────────────────────────────
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const service = await Service.findByIdAndDelete(req.params.id).exec();
    if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
    res.status(200).json({ success: true, message: 'Service deleted' });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to delete service' });
  }
});

export default router;
