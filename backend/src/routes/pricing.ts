import { hardDeleteBlockReason } from '../services/channex/structuralSync';
import { getChannexConfig } from '../services/channex/config';
import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { authenticate, authorize, authorizeAppAccess, AuthRequest } from '../middleware/auth';
import RatePlan from '../models/RatePlan';
import PricingRule from '../models/PricingRule';
import RoomType from '../models/RoomType';
import Tax from '../models/Tax';
import { calculateTieredPrice } from '../utils/pricing';
import { calculateServicePrice } from '../utils/servicePricing';
import { ACCESS_CODE_RE, normalizeAccessCode } from '../models/RatePlan';
import { optionView, quoteRooms, RateSelectionError } from '../services/ratePlanSelection';
import { TenantRequest } from '../middleware/tenantContext';

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Rate plan payloads
// ─────────────────────────────────────────────────────────────

const RATE_PLAN_FIELDS = [
  'name', 'roomTypeId', 'basePrice', 'pricingMode', 'occupancyTiers', 'isActive', 'sellOnChannels',
  'isDefault', 'visibility', 'accessCodes', 'description',
] as const;

/**
 * The editable fields of a rate plan, validated. Promo codes only exist on private plans
 * (a public plan is offered to everyone); `existing` is the stored plan on updates.
 */
export function ratePlanPayload(body: any, existing?: { visibility?: string; accessCodes?: string[] }): { data: Record<string, any> } | { error: string } {
  const data: Record<string, any> = {};
  for (const key of RATE_PLAN_FIELDS) if (body?.[key] !== undefined) data[key] = body[key];
  if (data.visibility !== undefined && !['public', 'private'].includes(data.visibility)) {
    return { error: 'Visibility must be public or private.' };
  }
  if (data.accessCodes !== undefined) {
    const raw: unknown[] = Array.isArray(data.accessCodes)
      ? data.accessCodes
      : typeof data.accessCodes === 'string' ? data.accessCodes.split(/[\s,;]+/) : [];
    const codes = raw.map(normalizeAccessCode).filter(Boolean);
    const invalid = codes.filter((c) => !ACCESS_CODE_RE.test(c));
    if (invalid.length) {
      return { error: `Invalid promo code: ${invalid.join(', ')}. Use 3–30 letters, numbers, - or _.` };
    }
    data.accessCodes = [...new Set(codes)];
  }
  const visibility = data.visibility ?? existing?.visibility ?? 'public';
  if (visibility === 'public' && (data.accessCodes?.length || existing?.accessCodes?.length)) data.accessCodes = [];
  if (typeof data.description === 'string') data.description = data.description.trim();
  if (data.isDefault !== undefined) data.isDefault = data.isDefault === true;
  return { data };
}

/** One default plan per room type: setting it on a plan clears it on the room type's others. */
async function keepSingleDefault(plan: { _id: unknown; roomTypeId: unknown; isDefault?: boolean } | null) {
  if (!plan?.isDefault) return;
  await RatePlan.updateMany(
    { roomTypeId: plan.roomTypeId, _id: { $ne: plan._id }, isDefault: true },
    { $set: { isDefault: false } },
  );
}

// ─────────────────────────────────────────────────────────────
// Room Types
// ─────────────────────────────────────────────────────────────

router.get('/room-types', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { active } = req.query as { active?: string };
    const filter: any = {};
    if (active !== undefined) filter.isActive = active === 'true';
    const roomTypes = await RoomType.find(filter).sort({ name: 1 }).exec();
    res.status(200).json({ success: true, data: roomTypes });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve room types' });
  }
});

router.post('/room-types', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const roomType = await RoomType.create(req.body);
    res.status(201).json({ success: true, data: roomType });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to create room type' });
  }
});

router.put('/room-types/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const roomType = await RoomType.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!roomType) return res.status(404).json({ success: false, message: 'Room type not found' });
    res.status(200).json({ success: true, data: roomType });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update room type' });
  }
});

router.delete('/room-types/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const blocked = await hardDeleteBlockReason('room_type', req.params.id, getChannexConfig().environment);
    if (blocked) return res.status(409).json({ success: false, message: blocked });
    const roomType = await RoomType.findByIdAndDelete(req.params.id);
    if (!roomType) return res.status(404).json({ success: false, message: 'Room type not found' });
    res.status(200).json({ success: true, message: 'Room type deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to delete room type' });
  }
});

// ─────────────────────────────────────────────────────────────
// Rate Plans
// ─────────────────────────────────────────────────────────────

router.get('/rate-plans', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { roomTypeId, active } = req.query as { roomTypeId?: string; active?: string };
    const filter: any = {};
    if (roomTypeId) filter.roomTypeId = roomTypeId;
    if (active !== undefined) filter.isActive = active === 'true';
    const plans = await RatePlan.find(filter).sort({ name: 1 }).populate('roomTypeId', 'name capacity').exec();
    res.status(200).json({ success: true, data: plans });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve rate plans' });
  }
});

router.post('/rate-plans', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const payload = ratePlanPayload(req.body);
    if ('error' in payload) return res.status(400).json({ success: false, message: payload.error });
    const plan = await RatePlan.create(payload.data);
    await keepSingleDefault(plan);
    res.status(201).json({ success: true, data: plan });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to create rate plan' });
  }
});

router.put('/rate-plans/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await RatePlan.findById(req.params.id).select('visibility accessCodes').lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Rate plan not found' });
    const payload = ratePlanPayload(req.body, existing);
    if ('error' in payload) return res.status(400).json({ success: false, message: payload.error });
    const plan = await RatePlan.findByIdAndUpdate(req.params.id, payload.data, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Rate plan not found' });
    await keepSingleDefault(plan);
    res.status(200).json({ success: true, data: plan });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update rate plan' });
  }
});

router.delete('/rate-plans/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const blocked = await hardDeleteBlockReason('rate_plan', req.params.id, getChannexConfig().environment);
    if (blocked) return res.status(409).json({ success: false, message: blocked });
    const plan = await RatePlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Rate plan not found' });
    res.status(200).json({ success: true, message: 'Rate plan deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to delete rate plan' });
  }
});

// ─────────────────────────────────────────────────────────────
// Pricing Rules (adjustments)
// ─────────────────────────────────────────────────────────────

router.get('/rules', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const rules = await PricingRule.find({}).sort({ name: 1 }).populate('ratePlanId', 'name roomTypeId').populate('companyId', 'name').exec();
    res.status(200).json({ success: true, data: rules });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve pricing rules' });
  }
});

router.post('/rules', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    // Calendar adjustments are written only by the Calendar (rate-calendar API)
    const rule = await PricingRule.create({ ...req.body, origin: 'manual' });
    res.status(201).json({ success: true, data: rule });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to create pricing rule' });
  }
});

router.put('/rules/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { origin: _origin, ...changes } = req.body ?? {};
    const rule = await PricingRule.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true });
    if (!rule) return res.status(404).json({ success: false, message: 'Pricing rule not found' });
    res.status(200).json({ success: true, data: rule });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update pricing rule' });
  }
});

router.delete('/rules/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const rule = await PricingRule.findByIdAndDelete(req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Pricing rule not found' });
    res.status(200).json({ success: true, message: 'Pricing rule deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to delete pricing rule' });
  }
});

// ─────────────────────────────────────────────────────────────
// Taxes
// ─────────────────────────────────────────────────────────────

router.get('/taxes', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const taxes = await Tax.find({}).sort({ priority: -1, name: 1 }).exec();
    res.status(200).json({ success: true, data: taxes });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve taxes' });
  }
});

router.post('/taxes', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tax = await Tax.create(req.body);
    res.status(201).json({ success: true, data: tax });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to create tax' });
  }
});

router.put('/taxes/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tax = await Tax.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!tax) return res.status(404).json({ success: false, message: 'Tax not found' });
    res.status(200).json({ success: true, data: tax });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update tax' });
  }
});

router.delete('/taxes/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tax = await Tax.findByIdAndDelete(req.params.id);
    if (!tax) return res.status(404).json({ success: false, message: 'Tax not found' });
    res.status(200).json({ success: true, message: 'Tax deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to delete tax' });
  }
});

// ─────────────────────────────────────────────────────────────
// Price Calculation endpoint
// ─────────────────────────────────────────────────────────────

router.post('/calculate', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { ratePlanId, roomTypeId, adults = 1, children = 0, date, nights = 1, rooms = 1, companyId, guestEmail } = req.body;

    if (!ratePlanId && !roomTypeId) {
      return res.status(400).json({ success: false, message: 'ratePlanId or roomTypeId is required' });
    }

    const result = await calculateTieredPrice({
      ratePlanId,
      roomTypeId,
      adults: Number(adults),
      children: Number(children),
      date: date ? new Date(date) : new Date(),
      nights: Number(nights),
      rooms: Number(rooms),
      companyId,
      guestEmail,
      channel: 'admin',
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to calculate price' });
  }
});

// ─────────────────────────────────────────────────────────────
// Service Price Calculation endpoint
// ─────────────────────────────────────────────────────────────

router.post('/calculate-service', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      serviceId,
      date,
      adults = 1,
      children = 0,
      rooms = 1,
      companyId,
      guestEmail,
    } = req.body;

    if (!serviceId) {
      return res.status(400).json({ success: false, message: 'serviceId is required' });
    }

    const result = await calculateServicePrice({
      serviceId,
      date: date ? new Date(date) : new Date(),
      adults: Number(adults),
      children: Number(children),
      rooms: Number(rooms),
      companyId,
      guestEmail,
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to calculate service price' });
  }
});

// ─────────────────────────────────────────────────────────────
// Rate options for the rooms of a new reservation (staff)
// Every active rate plan of each room's type, priced night by night for the stay (with the
// company's and guest's negotiated rules), plus the pre-selected plan and why it was chosen
// (services/ratePlanSelection.ts). `selections` (roomId → ratePlanId) keeps the user's
// choices; one that no longer applies falls back to the pre-selection.
// ─────────────────────────────────────────────────────────────

const ID_RE = /^[a-f0-9]{24}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readRoomsQuoteBody(body: any): { error: string } | { input: Parameters<typeof quoteRooms>[0] } {
  const { roomIds, checkInDate, checkOutDate, adults = 1, children = 0, companyId, guestEmail, promoCode, selections } = body ?? {};
  if (!Array.isArray(roomIds) || roomIds.length === 0 || roomIds.some((id: unknown) => !ID_RE.test(String(id)))) {
    return { error: 'roomIds array is required' };
  }
  if (!DATE_RE.test(String(checkInDate)) || !DATE_RE.test(String(checkOutDate))) {
    return { error: 'checkInDate and checkOutDate (YYYY-MM-DD) are required' };
  }
  if (companyId && !ID_RE.test(String(companyId))) return { error: 'Invalid company id' };
  const picked: Record<string, string> = {};
  if (selections && typeof selections === 'object') {
    for (const [roomId, planId] of Object.entries(selections)) {
      if (ID_RE.test(roomId) && ID_RE.test(String(planId))) picked[roomId] = String(planId);
    }
  }
  return {
    input: {
      roomIds: roomIds.map(String),
      checkIn: String(checkInDate),
      checkOut: String(checkOutDate),
      adults: Math.max(0, Number(adults) || 0),
      children: Math.max(0, Number(children) || 0),
      companyId: companyId ? String(companyId) : undefined,
      guestEmail: typeof guestEmail === 'string' ? guestEmail : undefined,
      promoCode: typeof promoCode === 'string' ? promoCode : undefined,
      selections: picked,
      audience: 'staff',
    },
  };
}

router.post('/rate-options', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = readRoomsQuoteBody(req.body);
    if ('error' in parsed) return res.status(400).json({ success: false, message: parsed.error });
    const result = await quoteRooms(parsed.input);
    const lang = (req as TenantRequest).tenant?.settings?.language === 'es' ? 'es' : 'en';
    res.status(200).json({
      success: true,
      data: {
        checkIn: result.stay.checkIn,
        checkOut: result.stay.checkOut,
        nights: result.nights,
        rooms: result.lines.map((l) => ({
          roomId: l.roomId,
          roomName: l.roomName,
          roomTypeId: l.roomTypeId,
          roomTypeName: l.roomTypeName,
          capacity: l.capacity,
          assignedAdults: l.adults,
          assignedChildren: l.children,
          options: l.options.map((o) => optionView(o, lang)),
          recommended: l.recommended,
          selected: l.selected,
          error: l.error ?? null,
        })),
        totals: result.totals,
        unassignedAdults: result.unassignedAdults,
        unassignedChildren: result.unassignedChildren,
        promo: result.promo,
      },
    });
  } catch (error: any) {
    if (error instanceof RateSelectionError) return res.status(400).json({ success: false, message: error.message });
    console.error('Rate options error:', error);
    res.status(500).json({ success: false, message: 'Failed to load rate options' });
  }
});

// ─────────────────────────────────────────────────────────────
// Rooms-based Price Calculation (compact form of /rate-options)
// Each room priced on its selected plan — `ratePlans` (roomId → ratePlanId) or the
// pre-selection. Guests are distributed across rooms in capacity order.
// ─────────────────────────────────────────────────────────────

router.post('/calculate-rooms', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = readRoomsQuoteBody({ ...req.body, selections: req.body?.ratePlans ?? req.body?.selections });
    if ('error' in parsed) return res.status(400).json({ success: false, message: parsed.error });
    const result = await quoteRooms(parsed.input);
    res.status(200).json({
      success: true,
      data: {
        perRoom: result.lines.map((l) => (l.quote
          ? {
            roomId: l.roomId,
            roomName: l.roomName,
            roomTypeName: l.roomTypeName,
            ratePlanId: l.selected!.ratePlanId,
            ratePlanName: l.quote.ratePlan.name,
            rateSelection: l.selected!.reason,
            assignedAdults: l.adults,
            assignedChildren: l.children,
            basePrice: l.quote.basePrice,
            occupancyCost: l.quote.occupancyCost,
            subtotal: l.quote.subtotal,
            adjustedSubtotal: l.quote.adjustedSubtotal,
            taxes: l.quote.taxes,
            totalTaxes: l.quote.totalTaxes,
            finalTotal: l.quote.finalTotal,
            nights: l.quote.nights,
          }
          : {
            roomId: l.roomId,
            roomName: l.roomName,
            roomTypeName: l.roomTypeName,
            error: l.error === 'no_room_type' ? 'No room type assigned' : 'No active rate plan for this room type',
          })),
        nights: result.nights,
        basePrice: result.totals.basePrice,
        occupancyCost: result.totals.occupancyCost,
        subtotal: result.totals.subtotal,
        totalTaxes: result.totals.totalTaxes,
        finalTotal: result.totals.finalTotal,
        unassignedAdults: result.unassignedAdults,
        unassignedChildren: result.unassignedChildren,
      },
    });
  } catch (error: any) {
    if (error instanceof RateSelectionError) return res.status(400).json({ success: false, message: error.message });
    res.status(400).json({ success: false, message: error.message || 'Failed to calculate room prices' });
  }
});

export default router;

