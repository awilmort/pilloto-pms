import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import RatePlan from '../models/RatePlan';
import PricingRule from '../models/PricingRule';
import RoomType from '../models/RoomType';
import Room from '../models/Room';
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
    const rules = await PricingRule.find({}).sort({ name: 1 }).populate('ratePlanId', 'name roomTypeId').populate('companyId', 'name').exec();
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

// ─────────────────────────────────────────────────────────────
// Rooms-based Price Calculation
// Accepts an array of room IDs + dates + guest counts and returns
// a price breakdown derived from each room's associated rate plan.
// Guests are distributed across rooms in capacity order.
// ─────────────────────────────────────────────────────────────

router.post('/calculate-rooms', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { roomIds, checkInDate, checkOutDate, adults = 1, children = 0, companyId, guestEmail } = req.body;

    if (!Array.isArray(roomIds) || roomIds.length === 0) {
      return res.status(400).json({ success: false, message: 'roomIds array is required' });
    }
    if (!checkInDate || !checkOutDate) {
      return res.status(400).json({ success: false, message: 'checkInDate and checkOutDate are required' });
    }

    const parseLocalDate = (s: string) => {
      const parts = String(s).split('-').map(Number);
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    };
    const start = parseLocalDate(checkInDate);
    const end = parseLocalDate(checkOutDate);
    const nights = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

    // Load rooms with populated room type capacity
    const rooms: any[] = await Room.find({ _id: { $in: roomIds } }).populate('roomTypeId', 'name capacity').lean();

    // Sort rooms by capacity ascending so we fill smallest rooms first
    const sorted = [...rooms].sort((a, b) => {
      const capA = (a.roomTypeId as any)?.capacity ?? 1;
      const capB = (b.roomTypeId as any)?.capacity ?? 1;
      return capA - capB;
    });

    let remainingAdults = Number(adults);
    let remainingChildren = Number(children);
    let grandTotal = 0;
    let grandBase = 0;
    let grandOccupancy = 0;
    let grandSubtotal = 0;
    let grandTaxes = 0;
    const perRoom: any[] = [];

    for (const room of sorted) {
      const roomTypeDoc = room.roomTypeId as any;
      const roomTypeId = roomTypeDoc?._id ?? room.roomTypeId;
      if (!roomTypeId) {
        perRoom.push({ roomId: String(room._id), roomName: room.name, error: 'No room type assigned' });
        continue;
      }

      const ratePlan = await RatePlan.findOne({ roomTypeId, isActive: true }).lean();
      if (!ratePlan) {
        perRoom.push({ roomId: String(room._id), roomName: room.name, roomTypeName: roomTypeDoc?.name, error: 'No active rate plan for this room type' });
        continue;
      }

      const capacity = roomTypeDoc?.capacity ?? 1;
      const roomAdults = Math.min(remainingAdults, capacity);
      const roomChildren = Math.min(remainingChildren, Math.max(0, capacity - roomAdults));
      remainingAdults = Math.max(0, remainingAdults - roomAdults);
      remainingChildren = Math.max(0, remainingChildren - roomChildren);

      const result = await calculateTieredPrice({
        ratePlanId: String(ratePlan._id),
        adults: roomAdults,
        children: roomChildren,
        date: start,
        nights,
        rooms: 1,
        companyId: companyId || undefined,
        guestEmail: guestEmail || undefined,
        channel: 'admin',
      });

      grandTotal += result.finalTotal;
      grandBase += result.basePrice;
      grandOccupancy += result.occupancyCost;
      grandSubtotal += result.subtotal;
      grandTaxes += result.totalTaxes;

      perRoom.push({
        roomId: String(room._id),
        roomName: room.name,
        roomTypeName: roomTypeDoc?.name ?? '',
        ratePlanId: String(ratePlan._id),
        ratePlanName: (ratePlan as any).name,
        assignedAdults: roomAdults,
        assignedChildren: roomChildren,
        basePrice: result.basePrice,
        occupancyCost: result.occupancyCost,
        subtotal: result.subtotal,
        taxes: result.taxes,
        totalTaxes: result.totalTaxes,
        finalTotal: result.finalTotal,
        nights,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        perRoom,
        nights,
        basePrice: grandBase,
        occupancyCost: grandOccupancy,
        subtotal: grandSubtotal,
        totalTaxes: grandTaxes,
        finalTotal: grandTotal,
        unassignedAdults: remainingAdults,
        unassignedChildren: remainingChildren,
      },
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to calculate room prices' });
  }
});

export default router;

