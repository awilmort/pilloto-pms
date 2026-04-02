import express, { Response } from 'express';
import sanitizeHtml from 'sanitize-html';
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
    const { services, sections, nightAuditEnabled, nightAuditTime, checkoutTime, emailSettings } = req.body;
    const update: any = {};
    if (services) update.services = services;
    if (sections !== undefined) update.sections = sections;
    if (nightAuditEnabled !== undefined) update.nightAuditEnabled = nightAuditEnabled;
    if (nightAuditTime !== undefined) update.nightAuditTime = nightAuditTime;
    if (checkoutTime !== undefined) {
      // Validate HH:MM format
      if (typeof checkoutTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(checkoutTime)) {
        update.checkoutTime = checkoutTime;
      }
    }
    if (emailSettings !== undefined) {
      const allowedTags = ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'span'];
      update.emailSettings = {
        fromDisplayName: typeof emailSettings.fromDisplayName === 'string'
          ? emailSettings.fromDisplayName.trim().slice(0, 100)
          : '',
        replyTo: typeof emailSettings.replyTo === 'string'
          ? emailSettings.replyTo.trim().slice(0, 254)
          : '',
        footerHtml: typeof emailSettings.footerHtml === 'string'
          ? sanitizeHtml(emailSettings.footerHtml, {
              allowedTags,
              allowedAttributes: { a: ['href', 'target', 'rel'], span: ['style'] },
            })
          : '',
        footerText: typeof emailSettings.footerText === 'string'
          ? emailSettings.footerText.trim().slice(0, 2000)
          : '',
      };
    }

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
