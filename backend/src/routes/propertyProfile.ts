/**
 * Property profile — /api/property-profile (services/propertyProfile.ts)
 *
 *   GET /  — the property's details, plus whether the currency can still change (any PMS user:
 *            every screen formats money in this currency)
 *   PUT /  — update (admin.settings); partial bodies allowed. An unset currency can be chosen
 *            once; a saved currency cannot change while there are reservations or the channel
 *            manager is connected. When the channel manager is connected, the new name/time
 *            zone/contact data are sent to it.
 */

import express, { Response } from 'express';
import { authenticate, authorizeAppAccess, authorizePermission, AuthRequest } from '../middleware/auth';
import Tenant from '../models/Tenant';
import {
  currencyDataReason, currencyLock, parseProfileUpdate, profileView, tenantCurrency,
} from '../services/propertyProfile';
import { pushPropertyDetails } from '../services/channex/provisioning';

const router = express.Router();
router.use(authenticate);

async function view(tenant: any) {
  const data = await currencyDataReason();
  const lock = currencyLock(tenant.settings?.currency, data);
  return {
    ...profileView(tenant),
    currencyLocked: Boolean(lock),
    currencyLockReason: lock ?? undefined,
    // Unset currency on a property that already has data: choosing it now makes it permanent
    currencyLocksOnSave: !tenant.settings?.currency && data ? data : undefined,
  };
}

router.get('/', authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).lean();
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    res.json({ success: true, data: await view(tenant) });
  } catch (err) {
    console.error('Get property profile error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/', authorizePermission('pms', 'admin.settings'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseProfileUpdate(req.body);
    if ('errors' in parsed) return res.status(400).json({ success: false, message: parsed.errors[0], errors: parsed.errors });

    const before = await Tenant.findById(req.tenantId).lean();
    if (!before) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    const newCurrency = parsed.set['settings.currency'];
    if (newCurrency !== undefined && newCurrency !== tenantCurrency(before)) {
      const lock = currencyLock(before.settings?.currency, await currencyDataReason());
      if (lock) {
        return res.status(409).json({
          success: false, reason: lock,
          message: lock === 'channel_manager'
            ? 'The currency cannot change while the property is connected to the channel manager.'
            : 'The currency cannot change once the property has reservations.',
        });
      }
    }

    if (Object.keys(parsed.set).length) await Tenant.updateOne({ _id: req.tenantId }, { $set: parsed.set }, { runValidators: true });
    const tenant = await Tenant.findById(req.tenantId).lean();
    // Channel listings carry the name and contact data: keep them in step (best effort, never fails the save)
    pushPropertyDetails(tenant as any).catch((e) => console.error('[Channex] property details push failed:', e.message));
    res.json({ success: true, data: await view(tenant) });
  } catch (err: any) {
    if (err?.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    console.error('Update property profile error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
