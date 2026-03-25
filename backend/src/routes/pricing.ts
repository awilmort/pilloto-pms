import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import RatePlan from '../models/RatePlan';
import PricingRule from '../models/PricingRule';
import RoomType from '../models/RoomType';
import Tax from '../models/Tax';
import { calculateTieredPrice } from '../utils/pricing';
import { calculateServicePrice } from '../utils/servicePricing';

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Room Types
// ─────────────────────────────────────────────────────────────

router.get('/room-types', authenticate, async (req: AuthRequest, res: Response) => {
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

router.get('/rate-plans', authenticate, async (req: AuthRequest, res: Response) => {
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
    const plan = await RatePlan.create(req.body);
    res.status(201).json({ success: true, data: plan });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to create rate plan' });
  }
});

router.put('/rate-plans/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const plan = await RatePlan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Rate plan not found' });
    res.status(200).json({ success: true, data: plan });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to update rate plan' });
  }
});

router.delete('/rate-plans/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
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

router.get('/rules', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const rules = await PricingRule.find({}).sort({ priority: -1, name: 1 }).populate('ratePlanId', 'name roomTypeId').populate('roomTypeId', 'name capacity').populate('companyId', 'name').exec();
    res.status(200).json({ success: true, data: rules });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve pricing rules' });
  }
});

router.post('/rules', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const rule = await PricingRule.create(req.body);
    res.status(201).json({ success: true, data: rule });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to create pricing rule' });
  }
});

router.put('/rules/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const rule = await PricingRule.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
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

router.get('/taxes', authenticate, async (req: AuthRequest, res: Response) => {
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

router.post('/calculate', authenticate, async (req: AuthRequest, res: Response) => {
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
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to calculate price' });
  }
});

// ─────────────────────────────────────────────────────────────
// Service Price Calculation endpoint
// ─────────────────────────────────────────────────────────────

router.post('/calculate-service', authenticate, async (req: AuthRequest, res: Response) => {
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

export default router;

