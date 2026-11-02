/**
 * Rate calendar — /api/rate-calendar (CHANNEX_IMPLEMENTATION_PLAN.md Phase 4.3)
 *
 *   GET /api/rate-calendar?from&to[&roomTypeIds=a,b]  — at most 60 days
 *       Per room type: availability per night (InventoryService). Per rate plan and night: the
 *       price (editable base, 1 guest, full occupancy, every occupancy) and the five booking
 *       rules, each tagged with where it comes from (plan price, named rule, calendar
 *       adjustment, booking rule, default). Money in currency units.
 *
 *   GET /api/rate-calendar/availability?roomTypeId&date
 *       "Why?" for one availability cell: the type's rooms (free / out of service / booked, with
 *       the booking or block) and the bookings still waiting for a room.
 *
 *   PUT /api/rate-calendar/bulk  { changes: [{ ratePlanIds, dateFrom, dateTo, days?, set?, reset? }] }
 *       One save from the Calendar: writes calendar price adjustments and calendar booking rules,
 *       trims them for `reset`, and removes calendar rules fully covered by newer ones. Named
 *       (manual) rules are never modified. All changes are validated before anything is written.
 *
 * Permission: admin.pricing.
 */

import express, { Response } from 'express';
import mongoose from 'mongoose';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import RatePlan from '../models/RatePlan';
import AppSettings from '../models/AppSettings';
import { isChannexDate, todayInTz } from '../services/channex/dates';
import {
  applyBulkChanges, getNightDetails, getRateCalendar, parseBulkChanges, viewLength, MAX_CALENDAR_VIEW_DAYS,
} from '../services/rateCalendar';

const router = express.Router();

/** The property's local date (tenant timezone, falling back to UTC). */
function propertyToday(req: AuthRequest): string {
  const tz = (req.tenant as any)?.settings?.timezone;
  try { return todayInTz(tz || 'UTC'); } catch { return todayInTz('UTC'); }
}

// @route   GET /api/rate-calendar
router.get('/', authenticate, authorizePermission('pms', 'admin.pricing'), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, roomTypeIds } = req.query;
    if (!isChannexDate(from) || !isChannexDate(to) || to < from) {
      return res.status(400).json({ success: false, message: 'from and to must be YYYY-MM-DD dates, with to on or after from' });
    }
    if (viewLength(from, to) > MAX_CALENDAR_VIEW_DAYS) {
      return res.status(400).json({ success: false, message: `The calendar shows at most ${MAX_CALENDAR_VIEW_DAYS} days at a time` });
    }
    let typeIds: string[] | undefined;
    if (roomTypeIds !== undefined) {
      typeIds = String(roomTypeIds).split(',').map((s) => s.trim()).filter(Boolean);
      if (typeIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        return res.status(400).json({ success: false, message: 'Invalid roomTypeIds' });
      }
    }
    const settings = await AppSettings.findOne({}).select('channelManager.ratesIncludeTaxes').lean();
    const view = await getRateCalendar({
      from, to, roomTypeIds: typeIds, ratesIncludeTaxes: Boolean(settings?.channelManager?.ratesIncludeTaxes),
    });
    res.json({ success: true, data: view });
  } catch (err) {
    console.error('Get rate-calendar error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/rate-calendar/availability
router.get('/availability', authenticate, authorizePermission('pms', 'admin.pricing'), async (req: AuthRequest, res: Response) => {
  try {
    const { roomTypeId, date } = req.query;
    if (!isChannexDate(date) || typeof roomTypeId !== 'string' || !mongoose.Types.ObjectId.isValid(roomTypeId)) {
      return res.status(400).json({ success: false, message: 'roomTypeId and date (YYYY-MM-DD) are required' });
    }
    res.json({ success: true, data: await getNightDetails(roomTypeId, date) });
  } catch (err) {
    console.error('Get rate-calendar availability error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/rate-calendar/bulk
router.put('/bulk', authenticate, authorizePermission('pms', 'admin.pricing'), async (req: AuthRequest, res: Response) => {
  try {
    const plans = await RatePlan.find({}).select('_id').lean();
    const parsed = parseBulkChanges(req.body, {
      today: propertyToday(req),
      ratePlanIds: new Set(plans.map((p) => String(p._id))),
    });
    if ('errors' in parsed) {
      return res.status(400).json({ success: false, message: parsed.errors[0], errors: parsed.errors });
    }
    const result = await applyBulkChanges(parsed.changes, req.user?.id);
    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('Bulk rate-calendar error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
