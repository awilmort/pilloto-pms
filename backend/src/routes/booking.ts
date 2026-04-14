/**
 * Public Booking Engine API Routes
 *
 * All endpoints serve the guest-facing booking flow.
 * No authentication required — tenant isolation is enforced by tenantContext middleware.
 * Plan gating ensures only Pro+ tenants can use the booking engine.
 *
 * Endpoints:
 *   GET  /api/booking/config         — booking page configuration (branding, contact, etc.)
 *   GET  /api/booking/availability   — available room types for a date range
 *   POST /api/booking/quote          — price quote for selected room type + dates
 *   GET  /api/booking/services       — online-bookable standalone services
 *   POST /api/booking/services/quote — price quote for a service
 *   POST /api/booking/verify/send    — send 4-digit email verification code
 *   POST /api/booking/verify/confirm — confirm the 4-digit code
 *   POST /api/booking/reserve        — finalize booking (requires verified email)
 *   GET  /api/booking/legal/terms    — booking terms of service (content)
 *   GET  /api/booking/legal/privacy  — booking privacy policy (content)
 */

import express, { Request, Response } from 'express';
import { body, query } from 'express-validator';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { handleValidationErrors } from '../middleware/validation';
import { TenantRequest } from '../middleware/tenantContext';
import { getPlanFeatures } from '../config/plans';
import AppSettings from '../models/AppSettings';
import RoomType from '../models/RoomType';
import Room from '../models/Room';
import RatePlan from '../models/RatePlan';
import Reservation from '../models/Reservation';
import Service from '../models/Service';
import ServicePrice from '../models/ServicePrice';
import Guest from '../models/Guest';
import BookingVerification from '../models/BookingVerification';
import GuestTermsAcceptance from '../models/GuestTermsAcceptance';
import Amenity from '../models/Amenity';
import Review from '../models/Review';
import { calculateTieredPrice } from '../utils/pricing';
import { calculateServicePrice } from '../utils/servicePricing';
import { sendEmail } from '../utils/email';
import { renderBookingVerification } from '../utils/emailTemplates/bookingVerification';
import { renderReservationConfirmation } from '../utils/emailTemplates/reservationConfirmation';
import Tenant from '../models/Tenant';

const router = express.Router();

// ── Rate limiting ────────────────────────────────────────────────────────────

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  message: 'Too many booking requests from this IP. Please try again later.',
});

const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Tighter limit for verification code sends
  message: 'Too many verification requests. Please try again later.',
});

const reservationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'Too many reservation attempts. Please try again later.',
});

// ── Plan gate middleware ─────────────────────────────────────────────────────

function requireBookingEngine(req: TenantRequest, res: Response, next: express.NextFunction): void {
  const plan = req.tenant?.plan;
  if (!plan) {
    res.status(403).json({ success: false, message: 'Tenant context required.' });
    return;
  }
  const features = getPlanFeatures(plan);
  if (!features.bookingEngine) {
    res.status(403).json({ success: false, message: 'Booking engine is not available on your current plan.' });
    return;
  }
  next();
}

// ── Booking enabled check ────────────────────────────────────────────────────

async function requireBookingEnabled(req: TenantRequest, res: Response, next: express.NextFunction): Promise<void> {
  try {
    const settings = await AppSettings.findOne({ key: 'global' }).lean<any>();
    if (!settings?.bookingSettings?.enabled) {
      res.status(403).json({ success: false, message: 'Online booking is not enabled for this property.' });
      return;
    }
    // Attach settings for downstream handlers
    (req as any).bookingSettings = settings.bookingSettings;
    (req as any).appSettings = settings;
    next();
  } catch {
    res.status(500).json({ success: false, message: 'Failed to check booking configuration.' });
  }
}

// Apply to all routes
router.use(bookingLimiter);
router.use(requireBookingEngine as any);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/booking/config
// Returns public-facing booking page configuration (branding, contact info)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/config', async (req: TenantRequest, res: Response) => {
  try {
    const settings = await AppSettings.findOne({ key: 'global' }).lean<any>();
    const tenant = req.tenant as any;
    const bs = settings?.bookingSettings || {};

    res.json({
      success: true,
      data: {
        enabled: !!bs.enabled,
        tenantName: tenant?.name || '',
        tenantSlug: tenant?.slug || '',
        logoUrl: tenant?.settings?.logoUrl || '',
        primaryColor: tenant?.settings?.primaryColor || '#2D3748',
        currency: tenant?.settings?.currency || 'USD',
        timezone: tenant?.settings?.timezone || 'UTC',
        language: tenant?.settings?.language || 'en',
        contactPhone: bs.contactPhone || '',
        contactEmail: bs.contactEmail || '',
        contactAddress: bs.contactAddress || '',
        minAdvanceHours: bs.minAdvanceHours ?? 24,
        maxAdvanceDays: bs.maxAdvanceDays ?? 365,
        termsVersion: bs.termsVersion || '1.0',
        privacyVersion: bs.privacyVersion || '1.0',
        checkoutTime: settings?.checkoutTime || '11:00',
      },
    });
  } catch (error: any) {
    console.error('Booking config error:', error);
    res.status(500).json({ success: false, message: 'Failed to load booking configuration.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/booking/room-types
// Returns active room types for the property showcase (public, no auth)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/room-types', async (_req: TenantRequest, res: Response) => {
  try {
    const roomTypes = await RoomType.find({ isActive: true })
      .sort({ name: 1 })
      .select('name capacity image')
      .lean();
    res.json({ success: true, data: roomTypes });
  } catch (error: any) {
    console.error('Booking room types error:', error);
    res.status(500).json({ success: false, message: 'Failed to load room types.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/booking/amenities
// Returns active amenities for the property (public, no auth)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/amenities', async (_req: TenantRequest, res: Response) => {
  try {
    const amenities = await Amenity.find({ isActive: true })
      .sort({ order: 1, name: 1 })
      .select('name description image category order')
      .lean();
    res.json({ success: true, data: amenities });
  } catch (error: any) {
    console.error('Booking amenities error:', error);
    res.status(500).json({ success: false, message: 'Failed to load amenities.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/booking/reviews
// Returns active guest reviews for the trust & credibility bar (public, no auth)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reviews', async (_req: TenantRequest, res: Response) => {
  try {
    const reviews = await Review.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: -1 })
      .select('guestName rating comment source createdAt')
      .limit(20)
      .lean();
    res.json({ success: true, data: reviews });
  } catch (error: any) {
    console.error('Booking reviews error:', error);
    res.status(500).json({ success: false, message: 'Failed to load reviews.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/booking/availability
// Returns room types with available rooms for a given date range
// Query: checkIn (ISO), checkOut (ISO), adults, children
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/availability',
  requireBookingEnabled as any,
  [
    query('checkIn').isISO8601().withMessage('checkIn must be a valid ISO date'),
    query('checkOut').isISO8601().withMessage('checkOut must be a valid ISO date'),
    query('adults').isInt({ min: 1, max: 50 }).withMessage('adults must be between 1 and 50'),
    query('children').optional().isInt({ min: 0, max: 50 }).withMessage('children must be between 0 and 50'),
  ],
  handleValidationErrors,
  async (req: TenantRequest, res: Response) => {
    try {
      const checkIn = new Date(req.query.checkIn as string);
      const checkOut = new Date(req.query.checkOut as string);
      const adults = parseInt(req.query.adults as string, 10);
      const children = parseInt(req.query.children as string || '0', 10);
      const totalGuests = adults + children;

      // Validate date range
      const now = new Date();
      const bs = (req as any).bookingSettings || {};
      const minAdvanceMs = (bs.minAdvanceHours || 24) * 60 * 60 * 1000;
      const maxAdvanceMs = (bs.maxAdvanceDays || 365) * 24 * 60 * 60 * 1000;

      if (checkIn < new Date(now.getTime() + minAdvanceMs)) {
        return res.status(400).json({
          success: false,
          message: `Check-in must be at least ${bs.minAdvanceHours || 24} hours in advance.`,
        });
      }
      if (checkOut <= checkIn) {
        return res.status(400).json({ success: false, message: 'Check-out must be after check-in.' });
      }
      if (checkIn.getTime() > now.getTime() + maxAdvanceMs) {
        return res.status(400).json({
          success: false,
          message: `Bookings cannot be made more than ${bs.maxAdvanceDays || 365} days in advance.`,
        });
      }

      // Get ALL active room types — guests may book multiple rooms to accommodate
      // their party (e.g. 5 guests across a 2-cap + 3-cap room).
      const roomTypes = await RoomType.find({ isActive: true })
        .sort({ name: 1 })
        .lean();

      if (roomTypes.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const roomTypeIds = roomTypes.map(rt => rt._id);

      // Get active rooms for these room types
      const rooms = await Room.find({
        roomTypeId: { $in: roomTypeIds },
        status: 'active',
      }).lean();

      // Get existing reservations overlapping the date range
      const overlapping = await Reservation.find({
        type: 'room',
        status: { $in: ['pending', 'confirmed', 'checked-in'] },
        checkInDate: { $lt: checkOut },
        $or: [
          { checkOutDate: { $gt: checkIn } },
          { checkOutDate: { $exists: false } },
        ],
      })
        .select('room rooms')
        .lean();

      // Collect all occupied room IDs
      const occupiedRoomIds = new Set<string>();
      for (const r of overlapping) {
        if (r.room) occupiedRoomIds.add(String(r.room));
        if (r.rooms) r.rooms.forEach((id: any) => occupiedRoomIds.add(String(id)));
      }

      // Calculate availability per room type
      const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));

      // Get rate plans for all room types
      const ratePlans = await RatePlan.find({
        roomTypeId: { $in: roomTypeIds },
        isActive: true,
      }).lean();

      const results = [];

      for (const rt of roomTypes) {
        const rtId = String(rt._id);
        const typeRooms = rooms.filter(r => String(r.roomTypeId) === rtId);
        const availableRooms = typeRooms.filter(r => !occupiedRoomIds.has(String(r._id)));

        if (availableRooms.length === 0) continue;

        // Get the best rate plan for this room type
        const rtRatePlans = ratePlans.filter(rp => String(rp.roomTypeId) === rtId);
        if (rtRatePlans.length === 0) continue;

        // Calculate price using the first active rate plan.
        // Clip guest count to room capacity so pricing reflects per-room cost.
        const bestPlan = rtRatePlans[0];
        const roomAdults = Math.min(adults, rt.capacity);
        const roomChildren = Math.min(children, Math.max(0, rt.capacity - roomAdults));
        try {
          const priceResult = await calculateTieredPrice({
            ratePlanId: String(bestPlan._id),
            adults: roomAdults,
            children: roomChildren,
            date: checkIn,
            nights,
          });

          // Get room images for this type (first available room with images)
          const roomWithImages = typeRooms.find(r => r.images && r.images.length > 0);

          results.push({
            roomType: {
              _id: rt._id,
              name: rt.name,
              capacity: rt.capacity,
              image: (rt as any).image || '',
            },
            availableCount: availableRooms.length,
            ratePlan: {
              _id: bestPlan._id,
              name: bestPlan.name,
            },
            pricing: {
              basePrice: priceResult.basePrice,
              occupancyCost: priceResult.occupancyCost,
              subtotal: priceResult.subtotal,
              adjustedSubtotal: priceResult.adjustedSubtotal,
              taxes: priceResult.taxes,
              totalTaxes: priceResult.totalTaxes,
              finalTotal: priceResult.finalTotal,
              nights: priceResult.nights,
              perNight: priceResult.nights > 0 ? priceResult.adjustedSubtotal / priceResult.nights : 0,
            },
            images: roomWithImages?.images || [],
            features: roomWithImages?.features || {},
            amenities: roomWithImages?.amenities || [],
            bedConfiguration: roomWithImages?.bedConfiguration || '',
          });
        } catch (err) {
          // Skip room types with pricing errors
          console.warn(`Pricing error for room type ${rtId}:`, err);
        }
      }

      // Sort by price ascending
      results.sort((a, b) => a.pricing.finalTotal - b.pricing.finalTotal);

      res.json({ success: true, data: results });
    } catch (error: any) {
      console.error('Availability search error:', error);
      res.status(500).json({ success: false, message: 'Failed to search availability.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/booking/quote
// Get a detailed price quote for a specific room type + date range
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/quote',
  requireBookingEnabled as any,
  [
    body('roomTypeId').isMongoId().withMessage('Valid room type ID required'),
    body('ratePlanId').optional().isMongoId().withMessage('Invalid rate plan ID'),
    body('checkIn').isISO8601().withMessage('checkIn must be a valid ISO date'),
    body('checkOut').isISO8601().withMessage('checkOut must be a valid ISO date'),
    body('adults').isInt({ min: 1, max: 50 }).withMessage('adults is required'),
    body('children').optional().isInt({ min: 0, max: 50 }),
    body('rooms').optional().isInt({ min: 1, max: 10 }),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { roomTypeId, ratePlanId, checkIn, checkOut, adults, children = 0, rooms = 1 } = req.body;
      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);
      const nights = Math.max(1, Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)));

      const priceResult = await calculateTieredPrice({
        roomTypeId,
        ratePlanId,
        adults,
        children,
        date: checkInDate,
        nights,
        rooms,
      });

      if (!priceResult.ratePlan) {
        return res.status(404).json({ success: false, message: 'No rate plan found for this room type.' });
      }

      res.json({ success: true, data: priceResult });
    } catch (error: any) {
      console.error('Quote error:', error);
      res.status(500).json({ success: false, message: 'Failed to calculate quote.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/booking/services
// Returns online-bookable services available for guests
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/services',
  requireBookingEnabled as any,
  async (req: Request, res: Response) => {
    try {
      const services = await Service.find({
        isActive: true,
        isOnlineBookable: true,
      })
        .select('code name kind chargeBasis reservationMode')
        .sort({ name: 1 })
        .lean();

      // Attach the standard everyday adult price for each service
      const serviceIds = services.map(s => s._id);
      const standardPrices = await ServicePrice.find({
        serviceId: { $in: serviceIds },
        category: 'standard',
        validity: 'everyday',
        isActive: true,
      }).select('serviceId adultPrice').lean();

      const priceMap: Record<string, number> = {};
      for (const sp of standardPrices) {
        priceMap[sp.serviceId.toString()] = sp.adultPrice;
      }

      const result = services.map(s => ({
        ...s,
        basePrice: priceMap[(s._id as any).toString()] ?? null,
      }));

      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Services list error:', error);
      res.status(500).json({ success: false, message: 'Failed to load services.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/booking/services/quote
// Get price for a specific service
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/services/quote',
  requireBookingEnabled as any,
  [
    body('serviceId').isMongoId().withMessage('Valid service ID required'),
    body('date').isISO8601().withMessage('date must be a valid ISO date'),
    body('adults').isInt({ min: 1, max: 50 }).withMessage('adults is required'),
    body('children').optional().isInt({ min: 0, max: 50 }),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { serviceId, date, adults, children = 0 } = req.body;

      // Verify it's actually online-bookable
      const service = await Service.findById(serviceId).lean();
      if (!service || !service.isActive || !service.isOnlineBookable) {
        return res.status(404).json({ success: false, message: 'Service not found or not available online.' });
      }

      const priceResult = await calculateServicePrice({
        serviceId,
        date: new Date(date),
        adults,
        children,
      });

      res.json({ success: true, data: priceResult });
    } catch (error: any) {
      console.error('Service quote error:', error);
      res.status(500).json({ success: false, message: 'Failed to calculate service price.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/booking/verify/send
// Send a 4-digit verification code to the guest's email
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/verify/send',
  verificationLimiter,
  requireBookingEnabled as any,
  [
    body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
    body('guestName').trim().isLength({ min: 1, max: 200 }).withMessage('Guest name is required'),
  ],
  handleValidationErrors,
  async (req: TenantRequest, res: Response) => {
    try {
      const { email, guestName } = req.body;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';

      // Check for existing unexpired, unverified code for this email
      // Prevent code flooding: max 3 active codes per email per 15 min
      const recentCodes = await BookingVerification.countDocuments({
        email,
        expiresAt: { $gt: new Date() },
      });
      if (recentCodes >= 3) {
        return res.status(429).json({
          success: false,
          message: 'Too many verification codes requested. Please wait before trying again.',
        });
      }

      // Generate secure 4-digit code
      const code = String(crypto.randomInt(1000, 9999));

      // Store verification record (expires in 15 minutes)
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await BookingVerification.create({
        email,
        code,
        ipAddress: ip,
        expiresAt,
      });

      // Get tenant info for email branding
      const tenant = req.tenant as any;
      const settings = await AppSettings.findOne({ key: 'global' }).lean<any>();

      const { html, text } = renderBookingVerification({
        code,
        email,
        tenantName: tenant?.name || 'Hotel',
        tenantLogoUrl: tenant?.settings?.logoUrl,
        customFooterHtml: settings?.emailSettings?.footerHtml,
        customFooterText: settings?.emailSettings?.footerText,
      });

      await sendEmail({
        to: email,
        subject: `${code} — Booking Verification Code`,
        html,
        text,
        replyTo: settings?.emailSettings?.replyTo || undefined,
        _logMeta: { emailType: 'booking-verification' },
      });

      res.json({
        success: true,
        message: 'Verification code sent to your email.',
        data: { expiresAt },
      });
    } catch (error: any) {
      console.error('Verification send error:', error);
      res.status(500).json({ success: false, message: 'Failed to send verification code.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/booking/verify/confirm
// Verify the 4-digit code
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/verify/confirm',
  verificationLimiter,
  requireBookingEnabled as any,
  [
    body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
    body('code').isLength({ min: 4, max: 4 }).isNumeric().withMessage('Code must be 4 digits'),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { email, code } = req.body;

      // Find the most recent unexpired verification for this email
      const verification = await BookingVerification.findOne({
        email,
        expiresAt: { $gt: new Date() },
        verified: false,
      }).sort({ createdAt: -1 });

      if (!verification) {
        return res.status(400).json({
          success: false,
          message: 'No active verification found. Please request a new code.',
        });
      }

      // Check attempts
      if (verification.attempts >= 5) {
        return res.status(429).json({
          success: false,
          message: 'Too many failed attempts. Please request a new code.',
        });
      }

      // Verify the code (timing-safe comparison)
      const codeBuffer = Buffer.from(code);
      const storedBuffer = Buffer.from(verification.code);
      if (codeBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(codeBuffer, storedBuffer)) {
        verification.attempts += 1;
        await verification.save();
        return res.status(400).json({
          success: false,
          message: 'Invalid verification code.',
          attemptsRemaining: 5 - verification.attempts,
        });
      }

      // Mark as verified
      verification.verified = true;
      await verification.save();

      res.json({
        success: true,
        message: 'Email verified successfully.',
        data: { verificationId: verification._id },
      });
    } catch (error: any) {
      console.error('Verification confirm error:', error);
      res.status(500).json({ success: false, message: 'Failed to verify code.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/booking/reserve
// Create a reservation from the public booking flow
// Requires a verified email (verificationId)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/reserve',
  reservationLimiter,
  requireBookingEnabled as any,
  [
    body('verificationId').isMongoId().withMessage('Email verification is required'),
    body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
    body('firstName').trim().isLength({ min: 1, max: 100 }).withMessage('First name is required'),
    body('lastName').trim().isLength({ min: 1, max: 100 }).withMessage('Last name is required'),
    body('phone').optional().matches(/^[+]?[1-9][\d]{0,15}$/).withMessage('Invalid phone number'),
    body('specialRequests').optional().trim().isLength({ max: 1000 }),
    // Room items
    body('items').isArray({ min: 1, max: 20 }).withMessage('At least one item is required'),
    body('items.*.kind').isIn(['room', 'service']).withMessage('Item kind must be room or service'),
    // Room items
    body('items.*.roomTypeId').optional().isMongoId(),
    body('items.*.ratePlanId').optional().isMongoId(),
    body('items.*.checkIn').optional().isISO8601(),
    body('items.*.checkOut').optional().isISO8601(),
    // Service items
    body('items.*.serviceId').optional().isMongoId(),
    body('items.*.date').optional().isISO8601(),
    // Common
    body('items.*.adults').optional().isInt({ min: 0, max: 50 }),
    body('items.*.children').optional().isInt({ min: 0, max: 50 }),
    body('items.*.quantity').optional().isInt({ min: 1, max: 10 }),
    // Terms acceptance
    body('acceptedTermsVersion').isString().isLength({ min: 1, max: 20 }).withMessage('Terms acceptance required'),
    body('acceptedPrivacyVersion').isString().isLength({ min: 1, max: 20 }).withMessage('Privacy policy acceptance required'),
  ],
  handleValidationErrors,
  async (req: TenantRequest, res: Response) => {
    try {
      const {
        verificationId,
        email,
        firstName,
        lastName,
        phone,
        specialRequests,
        items,
        acceptedTermsVersion,
        acceptedPrivacyVersion,
      } = req.body;

      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = (req.headers['user-agent'] || '').slice(0, 500);

      // ── 1. Validate email verification ──────────────────────
      const verification = await BookingVerification.findById(verificationId);
      if (
        !verification ||
        !verification.verified ||
        verification.email !== email.toLowerCase().trim() ||
        verification.expiresAt < new Date()
      ) {
        return res.status(400).json({
          success: false,
          message: 'Email verification is invalid or expired. Please verify your email again.',
        });
      }

      // ── 2. Validate booking settings ────────────────────────
      const settings = (req as any).appSettings;
      const tenant = req.tenant as any;

      // ── 3. Process items and calculate pricing ──────────────
      const processedItems: any[] = [];
      let totalEstimate = 0;
      let primaryCheckIn: Date | null = null;
      let primaryCheckOut: Date | null = null;
      let totalAdults = 0;
      let totalChildren = 0;
      let reservationType: 'room' | 'daypass' | 'PasaTarde' | 'event' = 'room';
      let primaryRoomTypeId: string | undefined;

      for (const item of items) {
        if (item.kind === 'room') {
          const checkIn = new Date(item.checkIn);
          const checkOut = new Date(item.checkOut);
          const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
          const adults = item.adults || 1;
          const children = item.children || 0;

          // Verify room type exists and has availability
          const roomType = await RoomType.findById(item.roomTypeId).lean();
          if (!roomType || !roomType.isActive) {
            return res.status(400).json({ success: false, message: `Room type not found: ${item.roomTypeId}` });
          }

          // Check capacity
          if (adults + children > roomType.capacity) {
            return res.status(400).json({
              success: false,
              message: `${roomType.name} has a maximum capacity of ${roomType.capacity} guests.`,
            });
          }

          // Verify availability (find an available room)
          const occupiedRooms = await Reservation.find({
            type: 'room',
            status: { $in: ['pending', 'confirmed', 'checked-in'] },
            checkInDate: { $lt: checkOut },
            $or: [
              { checkOutDate: { $gt: checkIn } },
              { checkOutDate: { $exists: false } },
            ],
          }).select('room rooms').lean();

          const occupiedIds = new Set<string>();
          for (const r of occupiedRooms) {
            if (r.room) occupiedIds.add(String(r.room));
            if (r.rooms) r.rooms.forEach((id: any) => occupiedIds.add(String(id)));
          }

          const availableRoom = await Room.findOne({
            roomTypeId: item.roomTypeId,
            status: 'active',
            _id: { $nin: Array.from(occupiedIds) },
          }).lean();

          if (!availableRoom) {
            return res.status(400).json({
              success: false,
              message: `No rooms available for ${roomType.name} on the selected dates.`,
            });
          }

          // Calculate price
          const priceResult = await calculateTieredPrice({
            roomTypeId: item.roomTypeId,
            ratePlanId: item.ratePlanId,
            adults,
            children,
            date: checkIn,
            nights,
          });

          if (!priceResult.ratePlan) {
            return res.status(400).json({
              success: false,
              message: `No rate plan found for ${roomType.name}.`,
            });
          }

          processedItems.push({
            kind: 'room',
            roomTypeId: new mongoose.Types.ObjectId(item.roomTypeId),
            ratePlanId: new mongoose.Types.ObjectId(priceResult.ratePlan._id),
            checkIn,
            checkOut,
            adults,
            children,
            quantity: 1,
            unitPrice: priceResult.adjustedSubtotal,
            subtotal: priceResult.adjustedSubtotal,
            taxes: priceResult.taxes.map(t => ({
              name: t.name,
              type: t.type,
              amount: t.amount,
              isInclusive: t.isInclusive,
            })),
            totalTaxes: priceResult.totalTaxes,
            total: priceResult.finalTotal,
            _assignedRoomId: availableRoom._id, // Internal — used to assign the room
          });

          totalEstimate += priceResult.finalTotal;
          if (!primaryCheckIn || checkIn < primaryCheckIn) primaryCheckIn = checkIn;
          if (!primaryCheckOut || checkOut > primaryCheckOut) primaryCheckOut = checkOut;
          totalAdults += adults;
          totalChildren += children;
          primaryRoomTypeId = item.roomTypeId;

        } else if (item.kind === 'service') {
          const service = await Service.findById(item.serviceId).lean();
          if (!service || !service.isActive || !service.isOnlineBookable) {
            return res.status(400).json({
              success: false,
              message: 'Selected service is not available for online booking.',
            });
          }

          const priceResult = await calculateServicePrice({
            serviceId: item.serviceId,
            date: new Date(item.date),
            adults: item.adults || 1,
            children: item.children || 0,
          });

          processedItems.push({
            kind: 'service',
            serviceId: new mongoose.Types.ObjectId(item.serviceId),
            date: new Date(item.date),
            adults: item.adults || 1,
            children: item.children || 0,
            quantity: priceResult.quantity || 1,
            unitPrice: priceResult.unitPrice,
            subtotal: priceResult.baseSubtotal,
            taxes: priceResult.taxes.map(t => ({
              name: t.name,
              type: t.type,
              amount: t.amount,
              isInclusive: t.isInclusive,
            })),
            totalTaxes: priceResult.totalTaxes,
            total: priceResult.finalTotal,
          });

          totalEstimate += priceResult.finalTotal;
          totalAdults += item.adults || 1;
          totalChildren += item.children || 0;
        }
      }

      // Determine reservation type based on items
      const hasRoom = processedItems.some(i => i.kind === 'room');
      const firstRoomItem = processedItems.find(i => i.kind === 'room');

      if (!hasRoom) {
        // Service-only reservation — determine type from first service
        const firstService = await Service.findById(items[0].serviceId).lean();
        if (firstService?.kind === 'daypass') reservationType = 'daypass';
        else if (firstService?.kind === 'pasatarde') reservationType = 'PasaTarde';
        else if (firstService?.kind === 'event') reservationType = 'event';
      }

      // ── 4. Generate confirmation token and code ──────────────
      const confirmationToken = crypto.randomBytes(32).toString('hex');
      const reservationCode = generateReservationCode();

      // ── 5. Assign rooms ──────────────────────────────────────
      const assignedRoomIds = processedItems
        .filter(i => i._assignedRoomId)
        .map(i => i._assignedRoomId);
      // Remove internal field before saving
      const cleanItems = processedItems.map(({ _assignedRoomId, ...rest }) => rest);

      // ── 6. Upsert guest record ──────────────────────────────
      let guestRecord;
      try {
        guestRecord = await Guest.findOneAndUpdate(
          { email: email.toLowerCase().trim() },
          {
            $setOnInsert: {
              firstName,
              lastName,
              email: email.toLowerCase().trim(),
            },
            $set: { phone: phone || undefined },
          },
          { upsert: true, new: true }
        );
      } catch (err) {
        // Duplicate key race condition — try find
        guestRecord = await Guest.findOne({ email: email.toLowerCase().trim() });
      }

      // ── 7. Build pricing snapshot for room reservations ─────
      let pricingSnapshot;
      if (firstRoomItem) {
        pricingSnapshot = {
          ratePlanId: String(firstRoomItem.ratePlanId),
          ratePlanName: '', // Will be populated
          roomTypeName: '',
          basePrice: firstRoomItem.subtotal,
          occupancyCost: 0,
          subtotal: firstRoomItem.subtotal,
          adjustedSubtotal: firstRoomItem.subtotal,
          taxes: firstRoomItem.taxes,
          totalTaxes: firstRoomItem.totalTaxes,
          finalTotal: firstRoomItem.total,
          nights: firstRoomItem.checkOut && firstRoomItem.checkIn
            ? Math.max(1, Math.ceil((firstRoomItem.checkOut.getTime() - firstRoomItem.checkIn.getTime()) / (1000 * 60 * 60 * 24)))
            : 1,
        };
        // Populate names
        const rp = await RatePlan.findById(firstRoomItem.ratePlanId).populate('roomTypeId', 'name').lean();
        if (rp) {
          pricingSnapshot.ratePlanName = rp.name;
          pricingSnapshot.roomTypeName = (rp.roomTypeId as any)?.name || '';
        }
      }

      // ── 8. Create reservation ───────────────────────────────
      const reservation = await Reservation.create({
        type: reservationType,
        status: 'pending',
        guestName: { firstName, lastName },
        confirmationToken,
        reservationCode,
        checkInDate: primaryCheckIn || new Date(items[0].checkIn || items[0].date),
        checkOutDate: primaryCheckOut,
        guests: totalAdults + totalChildren,
        guestDetails: {
          adults: totalAdults,
          children: totalChildren,
          infants: 0,
        },
        contactInfo: {
          email,
          phone: phone || '',
        },
        specialRequests: specialRequests || '',
        items: cleanItems,
        primaryKind: hasRoom ? 'room' : 'service',
        room: assignedRoomIds[0] || undefined,
        rooms: assignedRoomIds.length > 1 ? assignedRoomIds : undefined,
        roomCount: assignedRoomIds.length || undefined,
        estimatedTotal: totalEstimate,
        totalPayments: 0,
        pricingSnapshot,
        guestRecord: guestRecord?._id,
      });

      // ── 9. Record legal acceptance ──────────────────────────
      const guestFullName = `${firstName} ${lastName}`;
      await GuestTermsAcceptance.create([
        {
          email,
          guestName: guestFullName,
          documentType: 'booking-terms',
          documentVersion: acceptedTermsVersion,
          ipAddress: ip,
          userAgent,
          verificationId: verification._id,
        },
        {
          email,
          guestName: guestFullName,
          documentType: 'booking-privacy',
          documentVersion: acceptedPrivacyVersion,
          ipAddress: ip,
          userAgent,
          verificationId: verification._id,
        },
      ]);

      // ── 10. Send confirmation email ─────────────────────────
      try {
        const emailConfig = settings?.emailSettings || {};
        const { html, text } = renderReservationConfirmation({
          reservation: {
            ...reservation.toObject(),
            user: null,
          },
          tenantName: tenant?.name || 'Hotel',
          tenantSlug: tenant?.slug,
          tenantLogoUrl: tenant?.settings?.logoUrl,
          currency: tenant?.settings?.currency || 'DOP',
          customFooterHtml: emailConfig.footerHtml,
          customFooterText: emailConfig.footerText,
          replyTo: emailConfig.replyTo,
        });

        await sendEmail({
          to: email,
          subject: `Booking Confirmation — ${reservationCode}`,
          html,
          text,
          replyTo: emailConfig.replyTo || undefined,
          _logMeta: { emailType: 'booking-confirmation', referenceId: String(reservation._id) },
        });
      } catch (emailErr) {
        console.error('Confirmation email failed (reservation still created):', emailErr);
      }

      res.status(201).json({
        success: true,
        message: 'Reservation created successfully. Pay at the property.',
        data: {
          reservationId: reservation._id,
          reservationCode,
          confirmationToken,
          status: reservation.status,
          estimatedTotal: totalEstimate,
          checkIn: primaryCheckIn,
          checkOut: primaryCheckOut,
        },
      });
    } catch (error: any) {
      console.error('Reserve error:', error);
      res.status(500).json({ success: false, message: 'Failed to create reservation.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/booking/legal/terms
// Booking-specific Terms of Service
// ─────────────────────────────────────────────────────────────────────────────
router.get('/legal/terms', async (req: TenantRequest, res: Response) => {
  const tenant = req.tenant as any;
  const settings = await AppSettings.findOne({ key: 'global' }).lean<any>();
  const version = settings?.bookingSettings?.termsVersion || '1.0';

  res.json({
    success: true,
    data: {
      version,
      title: 'Booking Terms of Service',
      lastUpdated: '2026-04-09',
      content: generateBookingTerms(tenant?.name || 'the Property'),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/booking/legal/privacy
// Booking-specific Privacy Policy
// ─────────────────────────────────────────────────────────────────────────────
router.get('/legal/privacy', async (req: TenantRequest, res: Response) => {
  const tenant = req.tenant as any;
  const settings = await AppSettings.findOne({ key: 'global' }).lean<any>();
  const version = settings?.bookingSettings?.privacyVersion || '1.0';

  res.json({
    success: true,
    data: {
      version,
      title: 'Booking Privacy Policy',
      lastUpdated: '2026-04-09',
      content: generateBookingPrivacyPolicy(tenant?.name || 'the Property'),
    },
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateReservationCode(): string {
  const prefix = 'B';
  const year = new Date().getFullYear().toString().slice(-2);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `${prefix}${year}${code}`;
}

function generateBookingTerms(propertyName: string): string {
  const p = propertyName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<h1>Booking Terms of Service</h1>
<p><strong>Effective Date:</strong> April 9, 2026</p>
<p>These Booking Terms of Service (&ldquo;Terms&rdquo;) govern your use of the online booking service provided through the Pilloto platform on behalf of <strong>${p}</strong> (&ldquo;the Property&rdquo;).</p>

<h2>1. Booking &amp; Reservation</h2>
<ol>
<li>By completing a booking through this platform, you are making a reservation directly with the Property. Pilloto acts solely as a technology provider and is not a party to the accommodation contract between you and the Property.</li>
<li>All reservations are subject to availability. A confirmed booking creates a binding reservation between you and the Property.</li>
<li>Reservations are &ldquo;Reserve Now, Pay at Property&rdquo; &mdash; no payment is collected online. Full payment is due upon check-in or as otherwise communicated by the Property.</li>
</ol>

<h2>2. Guest Responsibilities</h2>
<ol>
<li>You must provide accurate personal information including a valid email address. Email verification is required to complete any booking.</li>
<li>You must be at least 18 years of age to make a reservation.</li>
<li>You agree to comply with the Property&rsquo;s house rules, check-in/check-out times, and any applicable local laws and regulations.</li>
</ol>

<h2>3. Cancellation &amp; Modifications</h2>
<ol>
<li>Cancellation and modification policies are determined by the Property. Contact the Property directly for cancellation or changes to your reservation.</li>
<li>The Property reserves the right to cancel reservations in cases of fraud, misrepresentation, or non-compliance with these Terms.</li>
</ol>

<h2>4. Pricing</h2>
<ol>
<li>Prices displayed are provided by the Property and may include applicable taxes and fees as indicated at the time of booking.</li>
<li>The final price confirmed at the time of booking is the price you will be charged, unless additional services are added during your stay.</li>
</ol>

<h2>5. Responsibility Split</h2>
<ol>
<li><strong>Pilloto</strong> is responsible for: providing the booking technology platform, processing email verification, securing booking data in transit and at rest, and maintaining platform uptime.</li>
<li><strong>The Property</strong> is responsible for: the accuracy of availability and pricing information, fulfilling the reservation, providing the accommodation and services, handling payments, managing cancellations, and complying with local hospitality regulations.</li>
<li>Pilloto is not liable for the Property&rsquo;s failure to honor a reservation, the condition of the accommodation, or any disputes arising from your stay.</li>
</ol>

<h2>6. Email Verification</h2>
<p>A valid email address and successful verification via a 4-digit code are required for all bookings. This helps prevent fraudulent reservations and ensures we can communicate important booking information.</p>

<h2>7. Limitation of Liability</h2>
<ol>
<li>To the maximum extent permitted by law, Pilloto&rsquo;s total liability shall not exceed the platform fees associated with your booking.</li>
<li>Neither Pilloto nor the Property shall be liable for indirect, incidental, or consequential damages.</li>
</ol>

<h2>8. Dispute Resolution</h2>
<ol>
<li>Any disputes related to your stay should be addressed directly with the Property.</li>
<li>Any disputes related to the booking platform should be directed to Pilloto at legal@pilloto.com.</li>
</ol>

<h2>9. Changes to These Terms</h2>
<p>Pilloto reserves the right to update these Terms. The version accepted at the time of your booking will apply to that reservation.</p>

<h2>10. Contact</h2>
<p>For platform-related inquiries: legal@pilloto.com<br/>For property-related inquiries: Contact the Property directly using the information provided on the booking page.</p>`;
}

function generateBookingPrivacyPolicy(propertyName: string): string {
  const p = propertyName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<h1>Booking Privacy Policy</h1>
<p><strong>Effective Date:</strong> April 9, 2026</p>
<p>This Privacy Policy describes how your personal information is collected, used, and shared when you make a booking through the Pilloto platform on behalf of <strong>${p}</strong> (&ldquo;the Property&rdquo;).</p>

<h2>1. Information We Collect</h2>
<p>When you make a booking, we collect:</p>
<ul>
<li><strong>Contact Information:</strong> Name, email address, phone number</li>
<li><strong>Booking Details:</strong> Check-in/check-out dates, number of guests, room preferences, special requests</li>
<li><strong>Verification Data:</strong> Email verification code usage, timestamp, IP address</li>
<li><strong>Technical Data:</strong> Browser type, device information, IP address (collected automatically)</li>
<li><strong>Legal Acceptance:</strong> Records of your acceptance of these terms including timestamp, IP address, and document version</li>
</ul>

<h2>2. How We Use Your Information</h2>
<p>Your information is used to:</p>
<ul>
<li>Process and confirm your reservation</li>
<li>Verify your email address for booking security</li>
<li>Communicate booking confirmations and updates</li>
<li>Share necessary booking details with the Property to fulfill your reservation</li>
<li>Prevent fraudulent bookings</li>
<li>Comply with legal obligations</li>
<li>Improve our booking platform</li>
</ul>

<h2>3. Information Sharing</h2>
<h3>With the Property</h3>
<p>Your booking details (name, contact info, dates, guest count, special requests) are shared with the Property to fulfill your reservation. The Property becomes an independent data controller for this information.</p>
<h3>With Service Providers</h3>
<p>We use Amazon Web Services (AWS) for email delivery and data hosting. These providers are bound by data processing agreements.</p>
<h3>Legal Requirements</h3>
<p>We may disclose information if required by law, court order, or to protect rights and safety.</p>

<h2>4. Data Retention</h2>
<ul>
<li><strong>Booking records:</strong> Retained for 7 years for legal and accounting purposes</li>
<li><strong>Verification codes:</strong> Automatically deleted 15 minutes after creation (TTL)</li>
<li><strong>Legal acceptance records:</strong> Retained indefinitely as proof of consent</li>
</ul>

<h2>5. Data Security</h2>
<p>We implement industry-standard security measures including:</p>
<ul>
<li>TLS encryption for all data in transit</li>
<li>Encrypted storage at rest</li>
<li>Rate limiting and bot protection on booking endpoints</li>
<li>Timing-safe code verification to prevent enumeration attacks</li>
<li>Tenant isolation ensuring your data is only accessible to the relevant Property</li>
</ul>

<h2>6. Your Rights</h2>
<p>Depending on your jurisdiction, you may have the right to:</p>
<ul>
<li><strong>Access</strong> your personal data</li>
<li><strong>Correct</strong> inaccurate information</li>
<li><strong>Delete</strong> your personal data (subject to legal retention requirements)</li>
<li><strong>Port</strong> your data to another service</li>
<li><strong>Object</strong> to certain processing activities</li>
</ul>
<p>To exercise these rights, contact us at privacy@pilloto.com or submit a request through the Property&rsquo;s privacy request form.</p>

<h2>7. Cookies</h2>
<p>The booking engine uses only essential cookies required for functionality (session management). No tracking or advertising cookies are used in the booking flow.</p>

<h2>8. International Transfers</h2>
<p>Your data may be processed in the United States where our servers are hosted. We ensure appropriate safeguards are in place for such transfers.</p>

<h2>9. Children&rsquo;s Privacy</h2>
<p>Our booking service is not directed to children under 18. We do not knowingly collect personal information from minors.</p>

<h2>10. Changes to This Policy</h2>
<p>We may update this policy periodically. The version accepted at the time of your booking will govern that reservation.</p>

<h2>11. Contact</h2>
<p><strong>Pilloto (Platform Provider):</strong> privacy@pilloto.com<br/><strong>${p}:</strong> Contact the Property using the information on the booking page.</p>`;
}

// ── View Reservation (public, token-gated) ───────────────────────────────────
router.get('/reservation/:code', bookingLimiter, requireBookingEngine, async (req: TenantRequest, res: Response) => {
  const { code } = req.params;
  const { token } = req.query as { token?: string };

  if (!token) {
    res.status(400).json({ success: false, message: 'Missing access token.' });
    return;
  }

  try {
    const reservation = await Reservation.findOne({
      tenantId: req.tenant!._id,
      reservationCode: code,
    }).populate('items.serviceId', 'name category').lean();

    if (!reservation) {
      res.status(404).json({ success: false, message: 'Reservation not found.' });
      return;
    }

    if (reservation.confirmationToken !== token) {
      res.status(403).json({ success: false, message: 'Invalid access token.' });
      return;
    }

    const tenant = req.tenant!;
    const currency: string = (tenant as any).settings?.currency || 'DOP';
    const snap = (reservation as any).pricingSnapshot;

    res.json({
      success: true,
      data: {
        reservationCode: reservation.reservationCode,
        status: reservation.status,
        type: reservation.type,
        primaryKind: (reservation as any).primaryKind || null,
        guestName: {
          firstName: reservation.guestName?.firstName || '',
          lastName: reservation.guestName?.lastName || '',
        },
        guestDetails: reservation.guestDetails ?? { adults: 1, children: 0, infants: 0 },
        checkInDate: reservation.checkInDate,
        checkOutDate: reservation.checkOutDate,
        totalNights: (reservation as any).totalNights ?? null,
        estimatedTotal: (reservation as any).estimatedTotal ?? 0,
        currency,
        tenantName: (tenant as any).name || '',
        tenantLogoUrl: (tenant as any).logoUrl || null,
        roomTypeName: snap?.roomTypeName || null,
        ratePlanName: snap?.ratePlanName || null,
        specialRequests: (reservation as any).specialRequests || null,
        items: (reservation.items ?? []).map((item: any) => ({
          kind: item.kind,
          serviceName: item.serviceId?.name || null,
          date: item.date,
          checkIn: item.checkIn,
          checkOut: item.checkOut,
          quantity: item.quantity,
          subtotal: item.subtotal,
        })),
      },
    });
  } catch (err) {
    console.error('[booking] GET /reservation/:code error:', err);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
