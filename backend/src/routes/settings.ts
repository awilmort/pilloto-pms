import express, { Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import AppSettings from '../models/AppSettings';

const router = express.Router();

// GET /api/settings — returns the singleton settings document (admin only)
router.get('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    let settings = await AppSettings.findOne({ key: 'global' });
    if (!settings) {
      settings = await AppSettings.create({ key: 'global' });
    }
    res.status(200).json({ success: true, data: settings });
  } catch (error: any) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve settings' });
  }
});

// PUT /api/settings — update settings (admin only)
router.put('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { services, sections } = req.body;
    const update: any = {};
    if (services) update.services = services;
    if (sections !== undefined) update.sections = sections;

    const settings = await AppSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    );
    res.status(200).json({ success: true, data: settings });
  } catch (error: any) {
    console.error('Update settings error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update settings' });
  }
});

export default router;
