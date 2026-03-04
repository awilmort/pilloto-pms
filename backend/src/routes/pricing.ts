import express, { Request, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import Pricing from '../models/Pricing';

const router = express.Router();

// List pricing rules
// Public: returns only active rules.
// If authenticated as admin, returns all rules.
router.get('/', async (req: Request, res: Response) => {
  try {
    const { service, category } = req.query as { service?: string; category?: string };

    let isAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        await new Promise<void>((resolve, reject) => {
          authenticate(req as AuthRequest, res as any, (err: any) => {
            if (err || !(req as AuthRequest).user) {
              return reject(err || new Error('Auth failed'));
            }
            const u = (req as AuthRequest).user;
            isAdmin = !!u && u.role === 'admin';
            resolve();
          });
        });
      } catch {
        // Not authenticated; keep isAdmin=false
      }
    }

    const filter: any = {};
    if (service) filter.service = service;
    if (category) filter.category = category;
    if (!isAdmin) filter.isActive = true;

    const rules = await Pricing.find(filter).sort({ createdAt: -1 }).exec();
    res.status(200).json({ success: true, data: rules });
  } catch (error: any) {
    console.error('Get pricing error:', error);
    res.status(500).json({ success: false, message: 'Server error while retrieving pricing' });
  }
});

// Create pricing rule (Admin)
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const rule = await Pricing.create(req.body);
    res.status(201).json({ success: true, data: rule });
  } catch (error: any) {
    console.error('Create pricing error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create pricing rule' });
  }
});

// Update pricing rule (Admin)
router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const rule = await Pricing.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!rule) return res.status(404).json({ success: false, message: 'Pricing rule not found' });
    res.status(200).json({ success: true, data: rule });
  } catch (error: any) {
    console.error('Update pricing error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update pricing rule' });
  }
});

// Delete pricing rule (Admin)
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const rule = await Pricing.findByIdAndDelete(req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Pricing rule not found' });
    res.status(200).json({ success: true, message: 'Pricing rule deleted' });
  } catch (error: any) {
    console.error('Delete pricing error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete pricing rule' });
  }
});

export default router;
