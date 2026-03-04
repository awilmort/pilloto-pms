import express, { Request, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import EventType from '../models/EventType';

const router = express.Router();

// @route   GET /api/event-types
// @desc    Get all active event types (public)
// @access  Public
router.get('/', async (req: Request, res: Response) => {
  try {
    const { active = 'true' } = req.query;

    const filter: any = {};
    if (active === 'true') filter.isActive = true;

    const eventTypes = await EventType.find(filter).sort({ priceFrom: 1 }).exec();

    res.status(200).json({
      success: true,
      count: eventTypes.length,
      data: eventTypes
    });
  } catch (error: any) {
    console.error('Get event types error:', error);
    res.status(500).json({ success: false, message: 'Server error while retrieving event types' });
  }
});

// @route   GET /api/event-types/:id
// @desc    Get single event type (public)
// @access  Public
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const eventType = await EventType.findById(req.params.id);
    if (!eventType) {
      return res.status(404).json({ success: false, message: 'Event type not found' });
    }
    res.status(200).json({ success: true, data: eventType });
  } catch (error: any) {
    console.error('Get event type error:', error);
    res.status(500).json({ success: false, message: 'Server error while retrieving event type' });
  }
});

// @route   POST /api/event-types
// @desc    Create new event type
// @access  Private (Admin)
router.post('/', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { type, title, description, features = [], priceFrom, maxGuests, maxChildren = 0, maxAdults, isActive = true } = req.body;

    if (!type || !title || priceFrom === undefined || maxGuests === undefined) {
      return res.status(400).json({ success: false, message: 'type, title, priceFrom, and maxGuests are required' });
    }

    const existing = await EventType.findOne({ type: type.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Event type with this identifier already exists' });
    }

    const created = await EventType.create({
      type: String(type).toLowerCase().trim(),
      title: String(title).trim(),
      description: description ? String(description).trim() : undefined,
      features: Array.isArray(features) ? features : [],
      priceFrom: Number(priceFrom),
      maxGuests: Number(maxGuests),
      maxChildren: Number(maxChildren) || 0,
      maxAdults: maxAdults !== undefined && maxAdults !== null ? Number(maxAdults) : undefined,
      isActive: Boolean(isActive)
    });

    res.status(201).json({ success: true, message: 'Event type created', data: created });
  } catch (error: any) {
    console.error('Create event type error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating event type' });
  }
});

// @route   PUT /api/event-types/:id
// @desc    Update event type
// @access  Private (Admin)
router.put('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { type, title, description, features, priceFrom, maxGuests, maxChildren, maxAdults, isActive } = req.body;
    const eventType = await EventType.findById(req.params.id);
    if (!eventType) {
      return res.status(404).json({ success: false, message: 'Event type not found' });
    }

    if (type !== undefined) eventType.type = String(type).toLowerCase().trim();
    if (title !== undefined) eventType.title = String(title).trim();
    if (description !== undefined) eventType.description = description ? String(description).trim() : undefined;
    if (features !== undefined) eventType.features = Array.isArray(features) ? features : eventType.features;
    if (priceFrom !== undefined) eventType.priceFrom = Number(priceFrom);
    if (maxGuests !== undefined) eventType.maxGuests = Number(maxGuests);
    if (maxChildren !== undefined) eventType.maxChildren = Number(maxChildren);
    if (maxAdults !== undefined) eventType.maxAdults = maxAdults === null ? undefined as any : Number(maxAdults);
    if (isActive !== undefined) eventType.isActive = Boolean(isActive);

    await eventType.save();
    res.status(200).json({ success: true, message: 'Event type updated', data: eventType });
  } catch (error: any) {
    console.error('Update event type error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating event type' });
  }
});

// @route   DELETE /api/event-types/:id
// @desc    Delete event type
// @access  Private (Admin)
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const eventType = await EventType.findById(req.params.id);
    if (!eventType) {
      return res.status(404).json({ success: false, message: 'Event type not found' });
    }
    await EventType.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Event type deleted' });
  } catch (error: any) {
    console.error('Delete event type error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting event type' });
  }
});

export default router;
