import { tenantBaseUrl } from '../utils/appUrls';
import express, { Request, Response } from 'express';
import Reservation from '../models/Reservation';
import Room from '../models/Room';
import Role from '../models/Role';
import { authenticate, authorize, authorizePermission, authorizeAppAccess, AuthRequest, userHasPermission } from '../middleware/auth';
import { validateReservation } from '../middleware/validation';
import { getSortObject } from '../utils/helpers';
import { sendReservationConfirmationEmail, sendInvoiceEmail, sendCorporatePriceRequestEmail } from '../utils/email';
import EventType from '../models/EventType';
import { calculateTieredPrice } from '../utils/pricing';
import AppSettings from '../models/AppSettings';
import Company from '../models/Company';
import Guest from '../models/Guest';
import Charge from '../models/Charge';
import Payment from '../models/Payment';
import CreditAccount from '../models/CreditAccount';
import User from '../models/User';
import { postChargeAddedEntry, postPaymentCompletedEntry, reversePaymentEntry, tenantHasAccounting } from '../services/accounting/pmsLedgerHooks';
import { transferFolioBalanceToCityLedger } from '../services/accounting/cityLedger.service';
import { validateRoomAssignment } from '../services/roomAssignment';
import { stayRestrictionWarnings, toStay, StayWarning } from '../services/stayQuote';
import { BOOKING_ENGINE_TOKEN_RE, ensureFolio, generateReservationCode, realignRoomItems } from '../services/reservationRecords';
import {
  pricingSnapshotFrom, quoteRooms, RateSelectionError, requoteRoomItems, roomItemsFromQuote, RoomRatesResult,
} from '../services/ratePlanSelection';
import mongoose from 'mongoose';
import { loadChannelHistory } from '../services/channex/tenantViews';
import { actorFromRequest, diffSnapshots, GUEST_ACTOR, loadReservationHistory, recordReservationEvent, snapshotReservation } from '../services/reservationHistory';

const router = express.Router();

/**
 * The signed-in user on a route that also accepts anonymous calls (public booking, email
 * action links); null when there is no token or it is rejected. A rejected token answers on a
 * stand-in response, never the real one, so the caller carries on as anonymous.
 */
function optionalUser(req: Request): Promise<any> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const rejected: any = { status: () => rejected, json: () => { resolve(null); return rejected; } };
    authenticate(req as AuthRequest, rejected, (err?: any) => resolve(err ? null : (req as AuthRequest).user ?? null));
  });
}

async function getFolioSummary(folioId: string | any) {
  const [chargeAgg, paymentAgg, depositAgg] = await Promise.all([
    Charge.aggregate([
      { $match: { folioId } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { folioId, status: { $ne: 'reversed' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { folioId, status: { $ne: 'reversed' }, paymentStage: 'deposit' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);
  const totalCharges = Number(chargeAgg?.[0]?.total || 0);
  const totalPayments = Number(paymentAgg?.[0]?.total || 0);
  const depositTotal = Number(depositAgg?.[0]?.total || 0);
  const balance = Math.max(0, totalCharges - totalPayments);
  return { totalCharges, totalPayments, depositTotal, balance };
}

async function getReservationFinancialSnapshot(reservation: any) {
  const folio = await ensureFolio(reservation._id);
  const { totalCharges, totalPayments, depositTotal, balance } = await getFolioSummary(folio._id);

  // Determine reservation stage
  let stage: 'pre_arrival' | 'in_house' | 'checked_out';
  if (reservation.actualCheckOutAt || reservation.status === 'completed') {
    stage = 'checked_out';
  } else if (reservation.actualCheckInAt) {
    stage = 'in_house';
  } else {
    stage = 'pre_arrival';
  }

  const estimatedTotal = Number(reservation.estimatedTotal ?? reservation.totalPrice ?? 0);
  // Pre-arrival balance: what the guest still owes at arrival after deposits
  const balanceOnArrival = stage === 'pre_arrival'
    ? Math.max(0, estimatedTotal - depositTotal)
    : 0;

  let creditAvailability = 0;
  let creditAccount: any = null;
  if (reservation.company) {
    creditAccount = await CreditAccount.findOne({ scope: 'company', referenceId: reservation.company, status: 'active' });
  }
  if (!creditAccount && reservation.guestRecord) {
    creditAccount = await CreditAccount.findOne({ scope: 'guest', referenceId: reservation.guestRecord, status: 'active' });
  }
  if (creditAccount) {
    creditAvailability = Math.max(0, Number(creditAccount.creditLimit || 0) - Number(creditAccount.currentExposure || 0));
  }

  return {
    folio,
    totals: { totalCharges, totalPayments, depositTotal, balance, balanceOnArrival },
    stage,
    estimatedTotal,
    credit: {
      account: creditAccount,
      available: creditAvailability,
    },
  };
}

// @route   GET /api/reservations
// @desc    Get user's reservations or all reservations (admin)
// @access  Private
router.get('/', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      status,
      type,
      search,
      dateFrom,
      dateTo,
      source,
      page = 1,
      limit = 10,
      sort = '-createdAt'
    } = req.query;

    // Build filter object
    const filter: any = {};

    // Determine if user has privilege to view all reservations
    let canViewAll = false;
    if (req.user) {
      const roleName = String(req.user.role).toLowerCase();
      if (['admin', 'staff', 'maintenance'].includes(roleName)) {
        canViewAll = true;
      } else {
        try {
          const roleDoc = await Role.findOne({ name: roleName });
          const perms = roleDoc?.permissions || [];
          // Roles with any of these permissions can view all reservations
          canViewAll = perms.includes('admin.reservations') || perms.includes('admin.access') || perms.includes('admin.dashboard');
        } catch (permErr) {
          console.error('Permission check failed:', permErr);
        }
      }
    }

    // If not privileged, show only the user's own reservations
    if (req.user && !canViewAll) {
      filter.$or = [
        { user: req.user.id }, // Reservations made while logged in
        { 'contactInfo.email': req.user.email } // Reservations made with same email (guest bookings)
      ];
    }

    if (status) filter.status = status;
    if (type) filter.type = type;

    // Where the reservation came from: direct (front desk), booking engine, any channel, or one OTA
    if (typeof source === 'string' && source) {
      const sourceCondition =
        source === 'direct' ? { channelSource: { $exists: false }, confirmationToken: { $not: BOOKING_ENGINE_TOKEN_RE } }
        : source === 'booking_engine' ? { channelSource: { $exists: false }, confirmationToken: BOOKING_ENGINE_TOKEN_RE }
        : source === 'channel' ? { 'channelSource.provider': { $exists: true } }
        : source.startsWith('ota:') ? { 'channelSource.otaName': source.slice(4) }
        : null;
      if (sourceCondition) filter.$and = [...(filter.$and ?? []), sourceCondition];
    }

    // Date filtering
    if (dateFrom || dateTo) {
      const toStartOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const toEndOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
      const parseLocalDate = (s: string) => {
        const parts = s.split('-');
        if (parts.length === 3) {
          const y = Number(parts[0]);
          const m = Number(parts[1]);
          const d = Number(parts[2]);
          return new Date(Date.UTC(y, m - 1, d));
        }
        // Fallback to native parsing
        return new Date(s);
      };

      let occupancyCondition: any = null;
      const rawFrom = (dateFrom && typeof dateFrom === 'string') ? parseLocalDate(dateFrom) : null;
      const rawTo = (dateTo && typeof dateTo === 'string') ? parseLocalDate(dateTo) : null;

      if (rawFrom && rawTo) {
        // Both From + To: include stays overlapping range, and daypass only if check-in within range
        const fromStart = toStartOfDay(rawFrom);
        const toEnd = toEndOfDay(rawTo);
        occupancyCondition = {
          $or: [
            { $and: [ { checkInDate: { $lte: toEnd } }, { checkOutDate: { $gte: fromStart } } ] },
            { $and: [ { $or: [ { checkOutDate: { $exists: false } }, { checkOutDate: null } ] }, { checkInDate: { $gte: fromStart, $lte: toEnd } } ] }
          ]
        };
      } else if (rawFrom) {
        // Only From selected
        const fromStart = toStartOfDay(rawFrom);
        const fromEnd = toEndOfDay(rawFrom);
        occupancyCondition = {
          $or: [
            // Starts on the date
            { checkInDate: { $gte: fromStart, $lte: fromEnd } },
            // Ends on the date (rooms/events with checkOutDate)
            { checkOutDate: { $gte: fromStart, $lte: fromEnd } },
            // Started before and ends after the date
            { $and: [ { checkInDate: { $lt: fromStart } }, { checkOutDate: { $gt: fromEnd } } ] },
            // Starts after the selected date
            { checkInDate: { $gt: fromEnd } }
          ]
        };
      } else if (rawTo) {
        // Only To selected
        const toStart = toStartOfDay(rawTo);
        const toEnd = toEndOfDay(rawTo);
        occupancyCondition = {
          $or: [
            { checkInDate: { $gte: toStart, $lte: toEnd } },
            { checkOutDate: { $gte: toStart, $lte: toEnd } },
            { $and: [ { checkInDate: { $lt: toStart } }, { checkOutDate: { $gte: toStart } } ] }
          ]
        };
      }

      if (occupancyCondition) {
        if (filter.$and) filter.$and.push(occupancyCondition);
        else filter.$and = [occupancyCondition];
      }
    }

    // Basic text search across guest name, contact email, event description, event type, reservation code.
    // ANDed with the rest: a user who may only see their own reservations searches within them.
    if (search && typeof search === 'string' && search.trim()) {
      const s = search.trim();
      filter.$and = [...(filter.$and ?? []), { $or: [
        { 'guestName.firstName': { $regex: s, $options: 'i' } },
        { 'guestName.lastName': { $regex: s, $options: 'i' } },
        { 'contactInfo.email': { $regex: s, $options: 'i' } },
        { eventDescription: { $regex: s, $options: 'i' } },
        { eventType: { $regex: s, $options: 'i' } },
        { reservationCode: { $regex: s, $options: 'i' } },
        { 'channelSource.otaReservationCode': { $regex: s, $options: 'i' } }
      ] }];
    }

    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const sortObject = getSortObject(sort as string);

    const reservations = await Reservation.find(filter)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('rooms', 'name status')
      .populate('guestRecord', 'firstName lastName email phone')
      .sort(sortObject)
      .limit(limitNumber * 1)
      .skip((pageNumber - 1) * limitNumber)
      .exec();

    const total = await Reservation.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: reservations.length,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber)
      },
      data: reservations
    });
  } catch (error: any) {
    console.error('Get reservations error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving reservations'
    });
  }
});

// @route   GET /api/reservations/:id
// @desc    Get single reservation
// @access  Private
// @route   GET /api/reservations/channel-sources
// @desc    OTA names that reservations came from (options for the source filter)
// @access  Private
router.get('/channel-sources', authenticate, authorizeAppAccess('pms'), async (_req: AuthRequest, res: Response) => {
  try {
    const names = (await Reservation.distinct('channelSource.otaName')).filter((n): n is string => typeof n === 'string' && !!n).sort();
    res.json({ success: true, data: names });
  } catch (error) {
    console.error('Channel sources error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/reservations/:id/channel-history
// @desc    Changes the channel sent for this reservation (new / modified / cancelled), oldest first
// @access  Private
router.get('/:id/channel-history', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id).select('channelSource.channexBookingId').lean();
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
    const bookingId = reservation.channelSource?.channexBookingId;
    res.json({ success: true, data: bookingId ? await loadChannelHistory(bookingId) : [] });
  } catch (error) {
    console.error('Channel history error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/reservations/:id/history
// @desc    Who did what and when on this reservation (milestones, folio activity), newest first
// @access  Private (roles with admin.reservations)
router.get('/:id/history', authenticate, authorizePermission('pms', 'admin.reservations'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id)
      .select('user assignedBy assignedAt actualCheckInAt actualCheckOutAt channelSource.provider channelSource.otaName confirmationToken createdAt')
      .lean();
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
    res.json({ success: true, data: await loadReservationHistory(reservation) });
  } catch (error) {
    console.error('Reservation history error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/:id', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status amenities')
      .populate('rooms', 'name status amenities')
      .populate('company', 'name email phone')
      .populate('guestRecord', 'firstName lastName email phone');

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    // If not admin, only allow access to own reservations
    if (req.user && req.user.role !== 'admin') {
      // For guest reservations (no user), check email match
      if (!reservation.user) {
        if (reservation.contactInfo.email !== req.user.email) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      } else if (reservation.user._id.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    res.status(200).json({
      success: true,
      data: reservation
    });
  } catch (error: any) {
    console.error('Get reservation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving reservation'
    });
  }
});

// @route   POST /api/reservations
// @desc    Create new reservation (room, daypass, or event) - No login required
// @access  Public
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      type,
      roomType,
      eventType,
      eventDescription,
      expectedAttendees,
      checkInDate,
      checkOutDate,
      guestDetails,
      guestName, // firstName, lastName for guest bookings
      contactInfo,
      specialRequests,
      isCorporate,
      company,
      requestCorporatePrice,
      requestedCompany,
      rooms: assignedRoomIds, // array of room IDs (new: required for room reservations)
      roomCount,              // legacy: kept for backward compatibility
      items, // optional: ReservationItem[] from service pricing
      discountAmount: rawDiscountAmount,
      discountPercent: rawDiscountPercent,
      discountReason,
      roomRatePlans,          // optional: { [roomId]: ratePlanId } chosen for each assigned room
      promoCode,              // optional: promo code that unlocks private rate plans
    } = req.body;

    // Normalize and basic validation
    const normalizedType = typeof type === 'string' ? String(type).trim() : '';
    const allowedTypes = ['room', 'daypass', 'PasaTarde', 'event'];
    if (!normalizedType || !allowedTypes.includes(normalizedType)) {
      return res.status(400).json({ success: false, message: 'Invalid or missing reservation type' });
    }

    // Authentication is optional for all reservation types; a failed one is a guest booking
    const authenticatedUser: any = await optionalUser(req);

    // Validate required guest information for non-authenticated bookings
    if (!authenticatedUser) {
      if (!guestName || !guestName.firstName || !guestName.lastName) {
        return res.status(400).json({
          success: false,
          message: 'First name and last name are required for guest bookings'
        });
      }
      if (!contactInfo || !contactInfo.email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required for all reservations'
        });
      }
    }

    // Parse dates safely. Store as noon UTC so that local-timezone getters
    // (on both server and client) always return the correct calendar date.
    const parseLocalDate = (s: string | Date | null | undefined) => {
      if (!s) return null;
      if (s instanceof Date) return s;
      const str = String(s);
      const strictMatch = /^\d{4}-\d{2}-\d{2}$/.test(str);
      if (strictMatch) {
        const [yStr, mStr, dStr] = str.split('-');
        const y = Number(yStr);
        const m = Number(mStr);
        const d = Number(dStr);
        return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      }
      const d2 = new Date(str);
      return isNaN(d2.getTime()) ? null : d2;
    };

    const checkIn = parseLocalDate(checkInDate);
    const checkOut = parseLocalDate(checkOutDate);

    if (!checkIn || isNaN(checkIn.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid or missing check-in date' });
    }

    // Validation based on reservation type
    if (normalizedType === 'room') {
      if (!checkOut || isNaN(checkOut.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Check-out date is required for room reservations'
        });
      }

      if (checkIn >= checkOut) {
        return res.status(400).json({
          success: false,
          message: 'Check-out date must be after check-in date'
        });
      }

      // Rooms picked by staff must be free (other stays and room blocks) for every night
      if (Array.isArray(assignedRoomIds) && assignedRoomIds.length > 0) {
        const invalid = await validateRoomAssignment({ roomIds: assignedRoomIds, checkIn, checkOut });
        if (invalid) return res.status(invalid.status).json({ success: false, message: invalid.message });
      }
    }

    if (normalizedType === 'event') {
      if (!eventType || !eventDescription || !expectedAttendees) {
        return res.status(400).json({
          success: false,
          message: 'Event type, description, and expected attendees are required for event reservations'
        });
      }

      // Validate against EventType configuration
      const eventTypeKey = String(eventType).toLowerCase().trim();
      const eventConfig = await EventType.findOne({ type: eventTypeKey });
      if (!eventConfig) {
        return res.status(400).json({ success: false, message: 'Selected event type is not available' });
      }
      if (eventConfig.isActive === false) {
        return res.status(400).json({ success: false, message: 'Selected event type is inactive' });
      }

      const attendeesNum = Number(expectedAttendees);
      if (!Number.isFinite(attendeesNum) || attendeesNum <= 0) {
        return res.status(400).json({ success: false, message: 'Expected attendees must be a positive number' });
      }
      if (attendeesNum > eventConfig.maxGuests) {
        return res.status(400).json({ success: false, message: `Expected attendees exceed maximum allowed (${eventConfig.maxGuests})` });
      }
      // Enforce children limit only if configured on the event type
      if (guestDetails) {
        const childrenNum = Number(guestDetails.children ?? 0);
        if (
          Number.isFinite(childrenNum) &&
          eventConfig.maxChildren !== undefined &&
          eventConfig.maxChildren !== null &&
          childrenNum > eventConfig.maxChildren
        ) {
          return res.status(400).json({ success: false, message: `Children exceed maximum allowed (${eventConfig.maxChildren}) for this event type` });
        }
      }

      // Enforce adults limit only if configured on the event type
      if (guestDetails) {
        const adultsNum = Number(guestDetails.adults ?? 0);
        if (
          Number.isFinite(adultsNum) &&
          eventConfig.maxAdults !== undefined &&
          eventConfig.maxAdults !== null &&
          adultsNum > (eventConfig as any).maxAdults
        ) {
          return res.status(400).json({ success: false, message: `Adults exceed maximum allowed (${(eventConfig as any).maxAdults}) for this event type` });
        }
      }
      // Optional: ensure breakdown does not exceed total
      if (guestDetails) {
        const totalBreakdown = Number(guestDetails.adults || 0) + Number(guestDetails.children || 0) + Number(guestDetails.infants || 0);
        if (totalBreakdown > attendeesNum) {
          return res.status(400).json({ success: false, message: 'Attendee breakdown exceeds expected attendees' });
        }
      }
    }

    // Check if check-in date is not before today (allow same-day)
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (checkIn < startOfToday) {
      return res.status(400).json({
        success: false,
        message: 'Event/check-in date cannot be in the past'
      });
    }

    // Calculate pricing based on reservation type
    let estimatedTotal = 0;
    let nights = 0;
    let days = 1;
    let pricingSnapshotData: any = undefined;
    // Rate plans the stay is priced on — checked against booking rules (warnings only)
    const usedRatePlanIds: string[] = [];
    // Room reservations with assigned rooms: one room item per room, priced on its plan
    let roomItems: ReturnType<typeof roomItemsFromQuote> = [];
    let appliedPromoCode: string | undefined;

    if (normalizedType === 'room') {
      // Room reservation pricing via tiered rate plan
      nights = Math.ceil((checkOut!.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

      if (Array.isArray(assignedRoomIds) && assignedRoomIds.length > 0) {
        // ── Each assigned room on its own rate plan ──
        // The plan chosen for the room (roomRatePlans), or the pre-selection: contract →
        // promo code → the room type's default plan → cheapest open plan, priced night by
        // night (services/ratePlanSelection.ts). Without a session only the plans the booking
        // engine offers can be booked, without negotiated prices.
        const selections: Record<string, string> = {};
        if (roomRatePlans && typeof roomRatePlans === 'object' && !Array.isArray(roomRatePlans)) {
          for (const [roomId, planId] of Object.entries(roomRatePlans)) {
            if (mongoose.Types.ObjectId.isValid(roomId) && mongoose.Types.ObjectId.isValid(String(planId))) selections[roomId] = String(planId);
          }
        }
        let roomQuote: RoomRatesResult;
        try {
          roomQuote = await quoteRooms({
            roomIds: assignedRoomIds.map(String),
            checkIn,
            checkOut: checkOut!,
            adults: Number(guestDetails?.adults ?? 0),
            children: Number(guestDetails?.children ?? 0),
            companyId: isCorporate && company ? String(company) : undefined,
            guestEmail: contactInfo?.email,
            promoCode: typeof promoCode === 'string' ? promoCode : undefined,
            selections,
            audience: authenticatedUser ? 'staff' : 'public',
            strict: true,
          });
        } catch (err) {
          if (err instanceof RateSelectionError) return res.status(400).json({ success: false, message: err.message });
          throw err;
        }
        roomItems = roomItemsFromQuote(roomQuote, checkIn, checkOut!);
        const quotes = roomQuote.lines.map((l) => l.quote).filter((q): q is NonNullable<typeof q> => !!q);
        pricingSnapshotData = pricingSnapshotFrom(quotes);
        estimatedTotal = roomQuote.totals.finalTotal;
        usedRatePlanIds.push(...roomItems.map((i) => String(i.ratePlanId)));
        const promoUsed = roomQuote.lines.some((l) => l.options.some((o) => o.ratePlanId === l.selected?.ratePlanId && o.promoMatch));
        if (promoUsed && roomQuote.promo) appliedPromoCode = roomQuote.promo.code;
      } else {
        // ── Legacy path: single explicit rate plan ──
        const inboundRatePlanId = req.body.ratePlanId;
        const inboundRoomCount = Math.max(1, Number(roomCount) || 1);
        if (inboundRatePlanId) {
          usedRatePlanIds.push(String(inboundRatePlanId));
          // Snapshot all prices at booking time so future rate plan changes
          // cannot retroactively affect this reservation.
          const priceResult = await calculateTieredPrice({
            ratePlanId: inboundRatePlanId,
            adults: guestDetails.adults,
            children: guestDetails.children,
            date: checkIn,
            nights,
            rooms: inboundRoomCount,
            companyId: (isCorporate && company) ? company : undefined,
            guestEmail: contactInfo?.email,
            channel: authenticatedUser ? 'admin' : 'public',
          });
          if (priceResult.ratePlan) {
            pricingSnapshotData = {
              ratePlanId: inboundRatePlanId,
              ratePlanName: priceResult.ratePlan.name,
              roomTypeName: priceResult.ratePlan.roomTypeName,
              basePrice: priceResult.basePrice,
              occupancyCost: priceResult.occupancyCost,
              subtotal: priceResult.subtotal,
              adjustedSubtotal: priceResult.adjustedSubtotal,
              taxes: priceResult.taxes,
              totalTaxes: priceResult.totalTaxes,
              finalTotal: priceResult.finalTotal,
              nights: priceResult.nights,
            };
            estimatedTotal = priceResult.finalTotal;
          }
        }
      }
    } else if (normalizedType === 'event') {
      // Event pricing based on type
      const eventTypePrices = {
        wedding: 2500,
        conference: 1200,
        birthday: 800,
        corporate: 1000,
        other: 600
      };
      estimatedTotal = eventTypePrices[eventType as keyof typeof eventTypePrices] || 600;

      // Calculate days for multi-day events
      if (checkOut) {
        days = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        estimatedTotal *= days;
      }
    }

    // Calculate total guests
    const totalGuests = (guestDetails?.adults || 0) + (guestDetails?.children || 0) + (guestDetails?.infants || 0);

    // If a validated items array was provided (service pricing), use summed total. Room
    // reservations with assigned rooms are priced above; client-sent items never override them.
    if (roomItems.length === 0 && Array.isArray(items) && items.length > 0) {
      const itemsTotal = items.reduce((sum: number, item: any) => sum + (Number(item.total) || 0), 0);
      if (itemsTotal > 0) estimatedTotal = itemsTotal;
    }

    // ── Discount validation and application ─────────────────────────────────
    const requestedDiscount = Number(rawDiscountAmount) || 0;
    const requestedPercent  = Number(rawDiscountPercent) || 0;
    let appliedDiscount = 0;

    if (requestedDiscount > 0) {
      const authReq = req as AuthRequest;
      const isPrivilegedRole = authReq.user &&
        ['admin', 'superadmin'].includes(String(authReq.user.role).toLowerCase());

      if (!isPrivilegedRole) {
        // Must have the discount permission
        const tenantFilter = authReq.tenantId ? { tenantId: authReq.tenantId } : {};
        const roleDef = authReq.user
          ? await Role.findOne({ name: String(authReq.user.role).toLowerCase(), ...tenantFilter })
          : null;

        if (!roleDef?.permissions.includes('admin.reservations.discount')) {
          return res.status(403).json({ success: false, message: 'Insufficient permissions to apply a discount' });
        }

        const limit = roleDef.discountLimit ?? 0;
        const maxAllowed = Math.round((limit / 100) * estimatedTotal * 100) / 100;
        if (requestedDiscount > maxAllowed + 0.01) {
          return res.status(400).json({
            success: false,
            message: `Discount of ${requestedDiscount} exceeds your allowed maximum of ${limit}% (${maxAllowed})`
          });
        }
      }

      appliedDiscount = Math.min(requestedDiscount, estimatedTotal);
      estimatedTotal  = Math.max(0, estimatedTotal - appliedDiscount);
    }

    // Ensure a Guest record exists and link by guestRecord id
    let guestRecordId: any = undefined;
    if (contactInfo?.email) {
      try {
        const emailKey = String(contactInfo.email).toLowerCase().trim();
        const nameParts = (guestName && guestName.firstName && guestName.lastName)
          ? guestName
          : (contactInfo && (contactInfo as any).firstName && (contactInfo as any).lastName)
            ? { firstName: (contactInfo as any).firstName, lastName: (contactInfo as any).lastName }
            : { firstName: '', lastName: '' };

        const guestDoc = await Guest.findOneAndUpdate(
          { email: emailKey },
          {
            $setOnInsert: {
              email: emailKey,
              firstName: nameParts.firstName || '',
              lastName: nameParts.lastName || '',
              phone: contactInfo.phone || '',
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        guestRecordId = guestDoc._id;
      } catch (guestErr) {
        console.warn('Failed to upsert guest record:', guestErr);
      }
    }

    // Create reservation data
    const reservationData: any = {
      type: normalizedType,
      checkInDate: checkIn,
      guests: (typeof expectedAttendees !== 'undefined' ? Number(expectedAttendees) : totalGuests) || totalGuests,
      guestDetails,
      contactInfo,
      estimatedTotal,
      totalPayments: 0,
      specialRequests: specialRequests || '',
      isCorporate: !!isCorporate,
      // Default to pending for all types; confirmation occurs upon full payment
      status: 'pending'
    };

    if (pricingSnapshotData) reservationData.pricingSnapshot = pricingSnapshotData;
    if (appliedDiscount > 0) {
      reservationData.discountAmount  = appliedDiscount;
      reservationData.discountPercent = requestedPercent || undefined;
      reservationData.discountReason  = discountReason   || undefined;
    }
    if (normalizedType === 'room') {
      if (Array.isArray(assignedRoomIds) && assignedRoomIds.length > 0) {
        reservationData.rooms = assignedRoomIds;
        reservationData.roomCount = assignedRoomIds.length;
      } else if (roomCount && Number(roomCount) > 1) {
        reservationData.roomCount = Math.max(1, Number(roomCount));
      }
    }
    if (guestRecordId) reservationData.guestRecord = guestRecordId;
    if (roomItems.length > 0) {
      reservationData.items = roomItems;
    } else if (Array.isArray(items) && items.length > 0) {
      reservationData.items = items;
    }
    if (appliedPromoCode) reservationData.promoCode = appliedPromoCode;

    // Link company for corporate bookings (direct assignment by privileged users)
    if (isCorporate && company) {
      reservationData.company = company;
      reservationData.corporatePriceStatus = 'approved';
    }

    // Handle corporate price REQUEST from non-privileged users
    if (requestCorporatePrice && !reservationData.company) {
      reservationData.isCorporate = true;
      if (requestedCompany) {
        reservationData.requestedCompany = requestedCompany;
      }
      // Check if guest has auto-approval for the requested company
      if (guestRecordId && requestedCompany) {
        const guestDoc = await Guest.findById(guestRecordId).lean();
        const companyLinks: any[] = (guestDoc as any)?.companyLinks ?? [];
        const matchingLink = companyLinks.find(
          (l: any) => l.companyId?.toString() === String(requestedCompany) && l.autoApproveCorporateRate === true
        );
        if (matchingLink) {
          // Guest has auto-approval — approve immediately without sending request email
          reservationData.company = requestedCompany;
          reservationData.corporatePriceStatus = 'approved';
        } else {
          reservationData.corporatePriceStatus = 'pending';
        }
      } else {
        reservationData.corporatePriceStatus = 'pending';
      }
    }

    // Persist the guest name from the form regardless of auth status
    const nameFromRequest = (guestName && guestName.firstName && guestName.lastName)
      ? guestName
      : (contactInfo && (contactInfo as any).firstName && (contactInfo as any).lastName)
        ? { firstName: (contactInfo as any).firstName, lastName: (contactInfo as any).lastName }
        : null;

    if (nameFromRequest) {
      reservationData.guestName = nameFromRequest;
    }

    // Set user if authenticated (always attribute to the authenticated user)
    if (authenticatedUser) {
      reservationData.user = authenticatedUser.id;
    }

    // Always generate a confirmation token for deep-link viewing (guest or authenticated)
    if (!reservationData.confirmationToken) {
      reservationData.confirmationToken = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Generate human-friendly reservation code
    reservationData.reservationCode = generateReservationCode();

    // Add type-specific fields
    if (normalizedType === 'room') {
      reservationData.checkOutDate = checkOut;
      reservationData.totalNights = nights;
    } else if (normalizedType === 'event') {
      reservationData.eventType = String(eventType).toLowerCase().trim();
      reservationData.eventDescription = eventDescription;
      reservationData.expectedAttendees = expectedAttendees;
      reservationData.totalDays = days;
      if (checkOut) reservationData.checkOutDate = checkOut;
    } else if (normalizedType === 'daypass' || normalizedType === 'PasaTarde') {
      reservationData.totalDays = 1;
    }

    // Booking rules (stop sell, no arrivals/departures, min/max stay) never block staff: a
    // broken rule comes back as a warning so the front desk can override it knowingly.
    let warnings: StayWarning[] = [];
    if (normalizedType === 'room' && checkOut) {
      if (roomItems.length === 0) {
        for (const item of Array.isArray(items) ? items : []) {
          if (item?.kind === 'room' && item.ratePlanId) usedRatePlanIds.push(String(item.ratePlanId));
        }
      }
      warnings = await stayRestrictionWarnings({ ...toStay(checkIn, checkOut), ratePlanIds: usedRatePlanIds })
        .catch((err) => { console.warn('Booking-rule check failed (reservation still created):', err); return []; });
    }

    // Create reservation
    const reservation = await Reservation.create(reservationData);

    // If corporate rate was approved, ensure the company is linked to the guest record
    // (auto-approve remains false unless the admin explicitly enables it later)
    if (guestRecordId && reservationData.company && reservationData.corporatePriceStatus === 'approved') {
      Guest.updateOne(
        { _id: guestRecordId, 'companyLinks.companyId': { $ne: reservationData.company } },
        { $push: { companyLinks: { companyId: reservationData.company, autoApproveCorporateRate: false } } }
      ).catch((err: any) => console.warn('Failed to auto-link company to guest:', err));
    }

    // Create empty folio at reservation creation
    await ensureFolio(reservation._id);
    await recordReservationEvent(reservation._id as any, 'created', {
      actor: actorFromRequest({ user: authenticatedUser }),
      ...(appliedDiscount > 0 ? { note: `Discount ${appliedDiscount}${discountReason ? `: ${discountReason}` : ''}` } : {}),
    });

    // Populate the reservation before sending response and email
    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status') // room may be null
      .populate('rooms', 'name status')
      .populate('company', 'name')
      .populate('requestedCompany', 'name')
      .populate('guestRecord', 'firstName lastName email');

    // Send confirmation email (don't wait for it to complete)
    sendReservationConfirmationEmail(populatedReservation)
      .catch(err => console.error('Failed to send confirmation email:', err));

    // Send corporate price request notification if pending approval
    if (reservationData.corporatePriceStatus === 'pending') {
      (async () => {
        try {
          // Find roles with the assignCorporatePrice permission
          const rolesWithPerm = await Role.find({
            permissions: 'admin.reservations.assignCorporatePrice',
          }).lean();
          const roleNames = rolesWithPerm.map((r: any) => String(r.name).toLowerCase());

          let recipientUsers: any[];
          if (roleNames.length > 0) {
            // Find users whose role matches any of those role names
            recipientUsers = await User.find({
              role: { $in: roleNames.map(n => new RegExp(`^${n}$`, 'i')) },
            }).select('email').lean();
          } else {
            // Fallback: send to all admins
            recipientUsers = await User.find({
              role: { $in: [/^admin$/i, /^superadmin$/i] },
            }).select('email').lean();
          }

          const emails = recipientUsers
            .map((u: any) => u.email)
            .filter((e: string) => !!e);

          if (emails.length > 0) {
            await sendCorporatePriceRequestEmail(populatedReservation, emails);
          }
        } catch (err) {
          console.error('Failed to send corporate price request emails:', err);
        }
      })();
    }

    res.status(201).json({
      success: true,
      message: 'Reservation created successfully. A confirmation email has been sent.',
      data: populatedReservation,
      warnings,
    });
  } catch (error: any) {
    console.error('Create reservation error:', error);
    // Return actionable 4xx for validation and duplicate errors
    if (error?.name === 'ValidationError') {
      const messages = Object.values(error.errors || {}).map((e: any) => e?.message || 'Validation error');
      return res.status(400).json({ success: false, message: 'Validation failed', errors: messages });
    }
    if (error?.code === 11000) {
      // Handle unique index violations (e.g., reservationCode, confirmationToken)
      return res.status(400).json({ success: false, message: 'Duplicate value detected', details: error.keyValue });
    }
    res.status(500).json({
      success: false,
      message: 'Server error while creating reservation'
    });
  }
});

// @route   PUT /api/reservations/:id
// @desc    Update reservation
// @access  Private
router.put('/:id', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    // Authorization: allow admin or roles with 'admin.reservations' permission to update any.
    // Otherwise, enforce ownership (user can only update their own reservations).
    let privileged = false;
    if (req.user) {
      if (req.user.role === 'admin') {
        privileged = true;
      } else {
        const roleDoc = await Role.findOne({ name: req.user.role.toLowerCase() });
        const perms = roleDoc?.permissions || [];
        privileged = perms.includes('admin.reservations');
      }

      if (!privileged) {
        // For guest reservations (no user), check email match
        if (!reservation.user) {
          if (reservation.contactInfo.email !== req.user.email) {
            return res.status(403).json({
              success: false,
              message: 'Access denied'
            });
          }
        } else if (reservation.user.toString() !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
      }
    }

    // Only allow certain fields to be updated (admins may also edit the total amount)
    const allowedUpdates = ['checkInDate', 'checkOutDate', 'guestDetails', 'specialRequests', 'contactInfo'];

    // Total price updates only for admin or roles with admin.reservations.amountUpdate
    let canUpdateAmount = false;
    if (req.user) {
      if (req.user.role === 'admin') {
        canUpdateAmount = true;
      } else {
        const roleDoc = await Role.findOne({ name: req.user.role.toLowerCase() });
        const perms = roleDoc?.permissions || [];
        canUpdateAmount = perms.includes('admin.reservations.amountUpdate');
      }
    }
    if (canUpdateAmount) {
      allowedUpdates.push('totalPrice');
    }
    const updates = Object.keys(req.body);
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));

    if (!isValidOperation) {
      return res.status(400).json({
        success: false,
        message: 'Invalid updates. Only checkInDate, checkOutDate, guestDetails, specialRequests, and contactInfo can be updated'
      });
    }

    // If reservation is already completed or cancelled, don't allow updates
    if (reservation.status === 'completed' || reservation.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update reservation that is already completed or cancelled'
      });
    }
    const before = snapshotReservation(reservation);

    const { checkInDate, checkOutDate, guestDetails, specialRequests, contactInfo, totalPrice: totalPriceUpdate } = req.body;

    // If dates are being updated, validate them
    if (checkInDate || checkOutDate) {
      // Parse local date strings (YYYY-MM-DD) — store as noon UTC so that
      // local-timezone getters always return the correct calendar date.
      const parseLocalDate = (s: string | Date) => {
        if (s instanceof Date) return s;
        const str = String(s);
        const parts = str.split('-');
        if (parts.length === 3) {
          const y = Number(parts[0]);
          const m = Number(parts[1]);
          const d = Number(parts[2]);
          return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        }
        return new Date(str);
      };

      const checkIn = checkInDate ? parseLocalDate(checkInDate) : new Date(reservation.checkInDate);
      // For room reservations, checkOut is required; for events optional; for daypass/PasaTarde there is no checkOut
      let checkOut: Date | null = null;
      if (reservation.type === 'room') {
        checkOut = checkOutDate
          ? parseLocalDate(checkOutDate)
          : (reservation.checkOutDate ? new Date(reservation.checkOutDate) : null);
        if (!checkOut) {
          return res.status(400).json({ success: false, message: 'Check-out date is required for room reservations' });
        }
        if (checkIn >= checkOut) {
          return res.status(400).json({ success: false, message: 'Check-out date must be after check-in date' });
        }
      } else if (reservation.type === 'event') {
        checkOut = checkOutDate
          ? parseLocalDate(checkOutDate)
          : (reservation.checkOutDate ? new Date(reservation.checkOutDate) : null);
        if (checkOut && checkIn >= checkOut) {
          return res.status(400).json({ success: false, message: 'Check-out date must be after check-in date' });
        }
      } else {
        // daypass or PasaTarde: ensure checkOut is not set/used
        checkOut = null;
      }

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (checkIn < startOfToday) {
        return res.status(400).json({
          success: false,
          message: 'Check-in date cannot be in the past'
        });
      }

      // The assigned rooms must stay free (other stays and room blocks) on the new nights
      if (reservation.type === 'room' && checkOut) {
        const assigned = [reservation.room, ...(reservation.rooms || [])].filter(Boolean).map(String);
        const conflict = await validateRoomAssignment({
          roomIds: assigned,
          checkIn,
          checkOut,
          reservationId: reservation._id,
        });
        if (conflict) {
          return res.status(400).json({ success: false, message: conflict.message });
        }
      }

      // Update dates and recalculate price
      const oldStay = {
        checkIn: new Date(reservation.checkInDate),
        checkOut: reservation.checkOutDate ? new Date(reservation.checkOutDate) : new Date(new Date(reservation.checkInDate).getTime() + 24 * 60 * 60 * 1000),
      };
      reservation.checkInDate = checkIn;
      if (reservation.type === 'room') {
        reservation.checkOutDate = checkOut!;
        // Room items follow the stay (inventory counts an item on its own nights)
        if (reservation.items?.length) {
          reservation.items = realignRoomItems(reservation.items, oldStay, { checkIn, checkOut: checkOut! }, { rescaleAmounts: true }) as any;
        }
      } else if (reservation.type === 'event') {
        // allow null or provided value
        reservation.checkOutDate = checkOut || undefined;
      } else {
        // daypass/PasaTarde: ensure checkOutDate is cleared
        reservation.checkOutDate = undefined;
      }

      if (reservation.type === 'room' && checkOut) {
        const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
        reservation.totalNights = nights;
      } else if (reservation.type === 'event') {
        // handled by schema pre-save, but keep consistent if provided
        if (checkOut) {
          const days = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          reservation.totalDays = days;
        } else {
          reservation.totalDays = 1;
        }
      } else {
        // daypass/PasaTarde
        reservation.totalNights = 0;
        reservation.totalDays = 1;
      }

      // Flag for recalculation based on new nights (handled below via needsRecalc)
    }

    // Track whether a recalculation is needed
    let needsRecalc = false;
    // Recalc if dates changed
    if (checkInDate || checkOutDate) {
      needsRecalc = true;
    }



    // Update totalPrice if permitted and provided
    if (canUpdateAmount) {
      if (totalPriceUpdate !== undefined) {
        reservation.totalPrice = Number(totalPriceUpdate);
      }
    } else {
      if (("totalPrice" in req.body)) {
        return res.status(403).json({ success: false, message: 'Access denied. Missing amount update permission.' });
      }
    }

    // Update guest details if provided
    if (guestDetails !== undefined) {
      const totalGuests = guestDetails.adults + guestDetails.children + guestDetails.infants;
      reservation.guestDetails = guestDetails;
      reservation.guests = totalGuests;
      needsRecalc = true;
    }

    // Update other fields if provided
    if (specialRequests !== undefined) {
      reservation.specialRequests = specialRequests;
    }

    if (contactInfo !== undefined) {
      reservation.contactInfo = { ...reservation.contactInfo, ...contactInfo };

      // Keep reservation->guest link in sync with email changes
      if (reservation.contactInfo?.email) {
        try {
          const emailKey = String(reservation.contactInfo.email).toLowerCase().trim();
          const existingGuestName = reservation.guestName || { firstName: '', lastName: '' };
          const linkedGuest = await Guest.findOneAndUpdate(
            { email: emailKey },
            {
              $setOnInsert: {
                email: emailKey,
                firstName: existingGuestName.firstName || '',
                lastName: existingGuestName.lastName || '',
                phone: reservation.contactInfo.phone || '',
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          reservation.guestRecord = linkedGuest._id as any;
        } catch (guestErr) {
          console.warn('Failed to sync guest record on reservation update:', guestErr);
        }
      }
    }

    // If a manual override for totalPrice was provided and permitted, apply it and skip auto calc
    let manualTotalApplied = false;
    if (canUpdateAmount && totalPriceUpdate !== undefined) {
      reservation.totalPrice = Number(totalPriceUpdate);
      manualTotalApplied = true;
    }

    // Auto-recalculate totalPrice when appropriate
    if (!manualTotalApplied && needsRecalc) {
      try {
        let newTotal = reservation.estimatedTotal ?? reservation.totalPrice ?? 0;
        const totalGuests = (reservation.guestDetails?.adults || 0) + (reservation.guestDetails?.children || 0) + (reservation.guestDetails?.infants || 0);
        if (reservation.type === 'room') {
          const checkIn = new Date(reservation.checkInDate);
          const checkOut = reservation.checkOutDate ? new Date(reservation.checkOutDate) : new Date(checkIn.getTime() + 24 * 60 * 60 * 1000);
          const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
          const snapshot = (reservation as any).pricingSnapshot;
          if (snapshot?.nights > 0 && snapshot?.adjustedSubtotal != null) {
            const perNight = snapshot.adjustedSubtotal / snapshot.nights;
            newTotal = perNight * nights + (snapshot.totalTaxes ?? 0);
          }
          // else keep existing total
        }
        // For daypass/PasaTarde/event: keep existing total
        reservation.estimatedTotal = newTotal;
      } catch (calcErr) {
        console.error('Auto-recalc totalPrice failed:', calcErr);
      }
    }

    // After recalculation or manual update, re-evaluate reservation status
    // For daypass/PasaTarde, toggle reservation status based on payment completion
    if (reservation.type === 'daypass' || reservation.type === 'PasaTarde') {
      reservation.status = (reservation.totalPayments >= (reservation.estimatedTotal ?? reservation.totalPrice ?? 0)) ? 'confirmed' : 'pending';
    }

    await reservation.save();
    await recordReservationEvent(reservation._id as any, 'updated', {
      actor: actorFromRequest(req),
      changes: diffSnapshots(before, snapshotReservation(reservation)),
    });

    // Populate the reservation before sending response
    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('rooms', 'name status')
      .populate('guestRecord', 'firstName lastName email phone');

    res.status(200).json({
      success: true,
      message: 'Reservation updated successfully',
      data: populatedReservation
    });
  } catch (error: any) {
    console.error('Update reservation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating reservation'
    });
  }
});

// @route   DELETE /api/reservations/:id
// @desc    Remove reservation (hard delete)
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }

    await Reservation.findByIdAndDelete(reservation._id);
    // Kept after the reservation is gone: a hard delete is the event an audit most needs
    await recordReservationEvent(reservation._id as any, 'deleted', {
      actor: actorFromRequest(req),
      note: [reservation.reservationCode, reservation.contactInfo?.email].filter(Boolean).join(' · '),
    });

    res.status(200).json({ success: true, message: 'Reservation removed successfully' });
  } catch (error: any) {
    console.error('Delete reservation error:', error);
    res.status(500).json({ success: false, message: 'Server error while removing reservation' });
  }
});

// @route   PATCH /api/reservations/:id/status
// @desc    Update reservation status (Admin only)
// @access  Private (Admin)
router.patch('/:id/status', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Valid statuses are: ${validStatuses.join(', ')}`
      });
    }

    const reservation = await Reservation.findById(req.params.id);

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    // Allow non-admins to cancel only if they have the cancel permission
    if (String(req.user?.role).toLowerCase() !== 'admin') {
      if (status === 'cancelled') {
        try {
          const roleDoc = await Role.findOne({ name: String(req.user?.role).toLowerCase() });
          const perms = roleDoc?.permissions || [];
          if (!perms.includes('admin.reservations.cancel')) {
            return res.status(403).json({ success: false, message: 'Access denied. Missing cancel permission.' });
          }
        } catch (permErr) {
          console.error('Cancel permission check failed:', permErr);
          return res.status(500).json({ success: false, message: 'Authorization failure.' });
        }
      } else {
        return res.status(403).json({ success: false, message: 'Access denied. Admin required for this status change.' });
      }
    }

    const previousStatus = reservation.status;
    reservation.status = status;
    await reservation.save();
    if (reservation.status !== previousStatus) {
      await recordReservationEvent(reservation._id as any, status === 'cancelled' ? 'cancelled' : 'status_changed', {
        actor: actorFromRequest(req),
        changes: [{ field: 'status', from: previousStatus, to: reservation.status }],
      });
    }

    // Populate the reservation before sending response
    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('rooms', 'name status');

    res.status(200).json({
      success: true,
      message: 'Reservation status updated successfully',
      data: populatedReservation
    });
  } catch (error: any) {
    console.error('Update reservation status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating reservation status'
    });
  }
});

// @route   PUT /api/reservations/:id/assign-room
// @desc    Assign room to reservation (Admin only)
// @access  Private/Admin
router.put('/:id/assign-room', authenticate, authorizePermission('pms', 'admin.reservations.assignRoom'), async (req: AuthRequest, res: Response) => {
  try {
    const { roomId } = req.body;
    const reservationId = req.params.id;

    // Find the reservation
    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    const before = snapshotReservation(reservation);
    const recordRooms = () => recordReservationEvent(reservation._id as any, 'rooms_changed', {
      actor: actorFromRequest(req),
      changes: diffSnapshots(before, snapshotReservation(reservation)),
    });

    // If roomId is null/empty, clear existing assignment
    if (!roomId) {
      const previousRoomId = reservation.room as any;
      reservation.room = undefined as any;
      // Also remove from rooms array if present
      if (Array.isArray(reservation.rooms)) {
        reservation.rooms = reservation.rooms.filter((rid: any) => String(rid) !== String(previousRoomId));
      }
      reservation.assignedBy = undefined as any;
      reservation.assignedAt = undefined as any;
      // Do not change totalPrice or status here; admin may update separately
      await reservation.save();
      await recordRooms();

      // If there was a previously assigned room, no status changes are needed (availability is derived)
      if (previousRoomId) {
        const prevRoom = await Room.findById(previousRoomId);
        if (prevRoom) {
          await prevRoom.save();
        }
      }

      const populatedReservation = await Reservation.findById(reservation._id)
        .populate('user', 'firstName lastName email')
        .populate('room', 'name status')
        .populate('assignedBy', 'firstName lastName email');

      return res.status(200).json({
        success: true,
        message: 'Room assignment cleared successfully',
        data: populatedReservation
      });
    }

    // At this point, roomId is provided and we are assigning/reassigning

    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Track previous room to free if reassigning. Front-desk reservations keep their rooms in
    // `rooms` without a primary `room`: with a single room, that room is the one replaced.
    const currentRooms = Array.isArray(reservation.rooms) ? reservation.rooms : [];
    const previousRoomId = (reservation.room ?? (currentRooms.length === 1 ? currentRooms[0] : undefined)) as any;

    // Resulting assignment: the new room replaces the previous primary room
    const nextRoomIds = (Array.isArray(reservation.rooms) ? reservation.rooms.map(r => String(r)) : [])
      .filter(id => !previousRoomId || id !== String(previousRoomId));
    if (!nextRoomIds.includes(String(roomId))) nextRoomIds.push(String(roomId));

    // Room active, free for every night (other stays and room blocks), and matching the booked room types
    const invalid = await validateRoomAssignment({
      roomIds: nextRoomIds,
      checkIn: reservation.checkInDate,
      checkOut: reservation.checkOutDate,
      items: reservation.items,
      reservationId: reservation._id,
    });
    if (invalid) {
      return res.status(invalid.status).json({ success: false, message: invalid.message });
    }

    // Update reservation with room assignment
    reservation.room = roomId as any;
    reservation.rooms = nextRoomIds as any;
    reservation.assignedBy = req.user!.id as any;
    reservation.assignedAt = new Date();

    // Update total price using pricingSnapshot if available
    const snapshot = (reservation as any).pricingSnapshot;
    if (snapshot?.nights > 0 && snapshot?.adjustedSubtotal != null) {
      const nights = reservation.totalNights || snapshot.nights || 1;
      const perNight = snapshot.adjustedSubtotal / snapshot.nights;
      reservation.totalPrice = perNight * nights + (snapshot.totalTaxes ?? 0);
    }
    reservation.status = 'confirmed'; // Automatically confirm when room is assigned

    await reservation.save();
    await recordRooms();

    // Do not change room status; status only reflects active/inactive
    await room.save();

    // If there was a previously assigned room different from selected, save it (availability is derived)
    if (previousRoomId && previousRoomId.toString() !== roomId.toString()) {
      const prevRoom = await Room.findById(previousRoomId);
      if (prevRoom) {
        await prevRoom.save();
      }
    }

    // Populate the updated reservation
    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('rooms', 'name status')
      .populate('assignedBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      message: 'Room assigned successfully',
      data: populatedReservation
    });
  } catch (error: any) {
    console.error('Assign room error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while assigning room'
    });
  }
});

// @route   PUT /api/reservations/:id/assign-rooms
// @desc    Assign multiple rooms to reservation (Admin only)
// @access  Private/Admin
router.put('/:id/assign-rooms', authenticate, authorizePermission('pms', 'admin.reservations.assignRoom'), async (req: AuthRequest, res: Response) => {
  try {
    const { roomIds } = req.body as { roomIds?: string[] };
    const reservationId = req.params.id;

    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }

    const before = snapshotReservation(reservation);
    const recordRooms = () => recordReservationEvent(reservation._id as any, 'rooms_changed', {
      actor: actorFromRequest(req),
      changes: diffSnapshots(before, snapshotReservation(reservation)),
    });

    const ids = Array.isArray(roomIds) ? roomIds.filter(Boolean) : [];
    if (ids.length === 0) {
      reservation.rooms = [] as any;
      reservation.room = undefined as any;
      reservation.assignedBy = undefined as any;
      reservation.assignedAt = undefined as any;
      await reservation.save();
      await recordRooms();
      const populatedReservation = await Reservation.findById(reservation._id)
        .populate('user', 'firstName lastName email')
        .populate('room', 'name status')
        .populate('rooms', 'name status')
        .populate('assignedBy', 'firstName lastName email');
      return res.status(200).json({ success: true, message: 'Rooms assignment cleared', data: populatedReservation });
    }

    // Each room active, free for every night (other stays and room blocks), and — for
    // reservations with room items — one room per booked room of a matching type or capacity
    const uniqueIds = Array.from(new Set(ids.map(String)));
    const invalid = await validateRoomAssignment({
      roomIds: uniqueIds,
      checkIn: reservation.checkInDate,
      checkOut: reservation.checkOutDate,
      items: reservation.items,
      reservationId: reservation._id,
    });
    if (invalid) return res.status(invalid.status).json({ success: false, message: invalid.message });

    reservation.rooms = uniqueIds as any;
    reservation.room = uniqueIds[0] as any; // Backward compatibility
    reservation.assignedBy = req.user!.id as any;
    reservation.assignedAt = new Date();
    reservation.status = 'confirmed';
    await reservation.save();
    await recordRooms();

    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('rooms', 'name status')
      .populate('assignedBy', 'firstName lastName email');

    res.status(200).json({ success: true, message: 'Rooms assigned successfully', data: populatedReservation });
  } catch (error: any) {
    console.error('Assign rooms error:', error);
    res.status(500).json({ success: false, message: 'Server error while assigning rooms' });
  }
});

// @route   PUT /api/reservations/:id/move
// @desc    Booking calendar drag and drop: shift a stay to a new check-in (same number of nights)
//          and/or swap one of its rooms (`fromRoomId`, null for an unassigned booked room) for
//          `toRoomId`. Validated as one change: the resulting rooms must be active, match the
//          booked room types and be free on the resulting nights.
// @access  Private — date changes need admin.reservations, room changes admin.reservations.assignRoom
router.put('/:id/move', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { checkInDate, fromRoomId, toRoomId } = req.body as { checkInDate?: string; fromRoomId?: string | null; toRoomId?: string | null };
    if (checkInDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(checkInDate))) {
      return res.status(400).json({ success: false, message: 'checkInDate must be YYYY-MM-DD' });
    }

    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    if (reservation.type !== 'room' || !reservation.checkOutDate) {
      return res.status(400).json({ success: false, message: 'Only room reservations can be moved' });
    }
    if (!['pending', 'confirmed', 'checked-in'].includes(reservation.status)) {
      return res.status(400).json({ success: false, message: 'Only pending, confirmed or checked-in reservations can be moved' });
    }

    const from = fromRoomId ? String(fromRoomId) : null;
    const to = toRoomId ? String(toRoomId) : null;
    const currentIds = [...new Set([reservation.room, ...(reservation.rooms || [])].filter(Boolean).map(String))];
    if (from && !currentIds.includes(from)) {
      return res.status(400).json({ success: false, message: 'That room is not assigned to this reservation' });
    }
    if (from && !to) {
      return res.status(400).json({ success: false, message: 'Choose a room to move the reservation to' });
    }
    const roomChange = !!to && to !== from;
    if (roomChange && currentIds.includes(to!)) {
      return res.status(400).json({ success: false, message: 'That room is already assigned to this reservation' });
    }

    // Same number of nights; dates stored at noon UTC
    const oldCheckIn = new Date(reservation.checkInDate);
    const nightMs = 24 * 60 * 60 * 1000;
    const nights = Math.max(1, Math.round((new Date(reservation.checkOutDate).getTime() - oldCheckIn.getTime()) / nightMs));
    const checkIn = checkInDate
      ? (() => { const [y, m, d] = checkInDate.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); })()
      : oldCheckIn;
    const checkOut = new Date(checkIn.getTime() + nights * nightMs);
    const dateChange = checkIn.toISOString().slice(0, 10) !== oldCheckIn.toISOString().slice(0, 10);

    if (!dateChange && !roomChange) {
      return res.status(400).json({ success: false, message: 'Nothing to move' });
    }

    const tenantProducts = (req.tenant as any)?.products;
    if (dateChange && !(await userHasPermission(req.user, 'pms', ['admin.reservations'], req.tenantId, tenantProducts))) {
      return res.status(403).json({ success: false, message: 'Access denied. Missing permission to change reservation dates.' });
    }
    if (roomChange && !(await userHasPermission(req.user, 'pms', ['admin.reservations.assignRoom'], req.tenantId, tenantProducts))) {
      return res.status(403).json({ success: false, message: 'Access denied. Missing permission to assign rooms.' });
    }

    if (dateChange) {
      if (reservation.status === 'checked-in') {
        return res.status(400).json({ success: false, message: 'The guest is already checked in; only the room can be changed' });
      }
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (checkIn < startOfToday) {
        return res.status(400).json({ success: false, message: 'Check-in date cannot be in the past' });
      }
    }

    const nextIds = roomChange
      ? (from ? currentIds.map(id => (id === from ? to! : id)) : [...currentIds, to!])
      : currentIds;
    const invalid = await validateRoomAssignment({
      roomIds: nextIds,
      checkIn,
      checkOut,
      items: reservation.items,
      reservationId: reservation._id,
    });
    if (invalid) return res.status(invalid.status).json({ success: false, message: invalid.message });

    const before = snapshotReservation(reservation);
    if (dateChange) {
      if (reservation.items?.length) {
        reservation.items = realignRoomItems(
          reservation.items, { checkIn: oldCheckIn, checkOut: new Date(reservation.checkOutDate) }, { checkIn, checkOut },
        ) as any;
      }
      reservation.checkInDate = checkIn;
      reservation.checkOutDate = checkOut;
    }
    if (roomChange) {
      const primary = reservation.room ? String(reservation.room) : null;
      reservation.rooms = nextIds as any;
      reservation.room = (!primary || primary === from ? to : primary) as any;
      reservation.assignedBy = req.user!.id as any;
      reservation.assignedAt = new Date();
      // Assigning a waiting booked room confirms the reservation, as assign-room does
      if (!from && reservation.status === 'pending') reservation.status = 'confirmed';
    }
    await reservation.save();
    await recordReservationEvent(reservation._id as any, 'moved', {
      actor: actorFromRequest(req),
      changes: diffSnapshots(before, snapshotReservation(reservation)),
    });

    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('rooms', 'name status')
      .populate('guestRecord', 'firstName lastName email phone');

    res.status(200).json({ success: true, message: 'Reservation moved', data: populatedReservation });
  } catch (error: any) {
    console.error('Move reservation error:', error);
    res.status(500).json({ success: false, message: 'Server error while moving reservation' });
  }
});

// @route   GET /api/reservations/public/:confirmationToken
// @desc    Get reservation by confirmation token (public access for guests)
// @access  Public
router.get('/public/:confirmationToken', async (req: Request, res: Response) => {
  try {
    const { confirmationToken } = req.params;

    const reservation = await Reservation.findOne({ confirmationToken })
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status amenities');

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    res.status(200).json({
      success: true,
      data: reservation
    });
  } catch (error: any) {
    console.error('Get public reservation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving reservation'
    });
  }
});

// @route   GET /api/reservations/public/code/:reservationCode
// @desc    Get reservation by reservation code (public access for guests)
// @access  Public
router.get('/public/code/:reservationCode', async (req: Request, res: Response) => {
  try {
    const { reservationCode } = req.params;

    const reservation = await Reservation.findOne({ reservationCode })
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status amenities');

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    res.status(200).json({
      success: true,
      data: reservation
    });
  } catch (error: any) {
    console.error('Get public reservation by code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving reservation'
    });
  }
});

// @route   PUT /api/reservations/public/:confirmationToken/cancel
// @desc    Cancel reservation by confirmation token (public access for guests)
// @access  Public
router.put('/public/:confirmationToken/cancel', async (req: Request, res: Response) => {
  try {
    const { confirmationToken } = req.params;
    const { cancellationReason } = req.body;

    const reservation = await Reservation.findOne({ confirmationToken });

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    // Check if already cancelled
    if (reservation.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Reservation is already cancelled'
      });
    }

    // Check if reservation can be cancelled (24 hours before check-in)
    const now = new Date();
    const checkInDate = new Date(reservation.checkInDate);
    const hoursDifference = (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursDifference < 24) {
      return res.status(400).json({
        success: false,
        message: 'Reservations must be cancelled at least 24 hours in advance'
      });
    }

    // Update reservation status
    const previousStatus = reservation.status;
    reservation.status = 'cancelled';
    reservation.cancellationReason = cancellationReason || 'Cancelled by guest';
    await reservation.save();
    await recordReservationEvent(reservation._id as any, 'cancelled', {
      actor: GUEST_ACTOR,
      changes: [{ field: 'status', from: previousStatus, to: 'cancelled' }],
      note: reservation.cancellationReason,
    });

    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name');

    res.status(200).json({
      success: true,
      message: 'Reservation cancelled successfully',
      data: populatedReservation
    });
  } catch (error: any) {
    console.error('Cancel public reservation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while cancelling reservation'
    });
  }
});

// @route   PUT /api/reservations/public/code/:reservationCode/cancel
// @desc    Cancel reservation by reservation code (public access for guests)
// @access  Public
router.put('/public/code/:reservationCode/cancel', async (req: Request, res: Response) => {
  try {
    const { reservationCode } = req.params;
    const { cancellationReason } = req.body;

    const reservation = await Reservation.findOne({ reservationCode });

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    // Check if already cancelled
    if (reservation.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Reservation is already cancelled'
      });
    }

    // Check if reservation can be cancelled (24 hours before check-in)
    const now = new Date();
    const checkInDate = new Date(reservation.checkInDate);
    const hoursDifference = (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursDifference < 24) {
      return res.status(400).json({
        success: false,
        message: 'Reservations must be cancelled at least 24 hours in advance'
      });
    }

    // Update reservation status
    const previousStatus = reservation.status;
    reservation.status = 'cancelled';
    reservation.cancellationReason = cancellationReason || 'Cancelled by guest';
    await reservation.save();
    await recordReservationEvent(reservation._id as any, 'cancelled', {
      actor: GUEST_ACTOR,
      changes: [{ field: 'status', from: previousStatus, to: 'cancelled' }],
      note: reservation.cancellationReason,
    });

    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name');

    res.status(200).json({
      success: true,
      message: 'Reservation cancelled successfully',
      data: populatedReservation
    });
  } catch (error: any) {
    console.error('Cancel public reservation by code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while cancelling reservation'
    });
  }
});

// Operational actions: Check-In / Check-Out
// @route   PATCH /api/reservations/:id/check-in
// @desc    Perform check-in for any reservation type and post base charge to folio
// @access  Private (Permission-based)
router.patch('/:id/check-in', authenticate, authorizePermission('pms', 'admin.reservations.checkin'), async (req: AuthRequest, res: Response) => {
  try {
    const { identificationDocument, identificationType, checkInAt } = req.body as { identificationDocument?: string; identificationType?: string; checkInAt?: string | Date };

    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }

    if (reservation.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot check-in a cancelled reservation' });
    }

    if (reservation.type === 'room') {
      if (!identificationDocument || !String(identificationDocument).trim()) {
        return res.status(400).json({ success: false, message: 'Identification document is required for check-in' });
      }
      if (!reservation.room && (!reservation.rooms || reservation.rooms.length === 0)) {
        return res.status(400).json({ success: false, message: 'Reservation has no room assigned' });
      }
      const primaryRoomId = reservation.room || (reservation.rooms && reservation.rooms[0]);
      const room = primaryRoomId ? await Room.findById(primaryRoomId) : null;
      if (!room) return res.status(404).json({ success: false, message: 'Assigned room not found' });
      reservation.identificationDocument = String(identificationDocument).trim();
      if (identificationType) {
        reservation.identificationType = identificationType as 'cedula' | 'pasaporte' | 'rnc';
      }
    }

    const now = new Date();
    const when = checkInAt ? new Date(checkInAt) : now;
    reservation.actualCheckInAt = when;
    reservation.status = 'checked-in';

    const folio = await ensureFolio(reservation._id);
    const existingBaseCharge = await Charge.findOne({ folioId: folio._id, description: { $regex: '^Reservation base charge:', $options: 'i' } });
    if (!existingBaseCharge) {
      const amount = Number((reservation as any).estimatedTotal ?? (reservation as any).totalPrice ?? 0);
      const summary = `${reservation.type} ${reservation.reservationCode || String(reservation._id).slice(-6)}`;
      const baseCharge = await Charge.create({
        folioId: folio._id,
        description: `Reservation base charge: ${summary}`,
        amount,
        createdBy: req.user?.id as any,
      });
      await postChargeAddedEntry(req.tenant, baseCharge, req.user?.id as any);
    }

    const previousStatus = reservation.status;
    await reservation.save();
    // The ID type only — the document number itself stays on the reservation, not in the log
    await recordReservationEvent(reservation._id as any, 'checked_in', {
      actor: actorFromRequest(req),
      changes: [{ field: 'status', from: previousStatus, to: reservation.status }],
      ...(reservation.identificationType ? { note: reservation.identificationType } : {}),
    });

    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('rooms', 'name status')
      .populate('guestRecord', 'firstName lastName email phone');

    res.status(200).json({ success: true, message: 'Check-in completed', data: populatedReservation });
  } catch (error: any) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, message: 'Server error during check-in' });
  }
});

// @route   GET /api/reservations/:id/financial
// @desc    Get folio, charges, payments and checkout-related summary for reservation
// @access  Private
router.get('/:id/financial', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id)
      .populate('company', 'name')
      .populate('guestRecord', 'firstName lastName email');
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });

    const financial = await getReservationFinancialSnapshot(reservation);
    const charges = await Charge.find({ folioId: financial.folio._id }).sort({ createdAt: 1 });
    const payments = await Payment.find({ folioId: financial.folio._id })
      .sort({ createdAt: -1 })
      .populate('createdBy', 'firstName lastName');

    res.status(200).json({
      success: true,
      data: {
        folio: financial.folio,
        charges,
        payments,
        summary: {
          stage: financial.stage,
          estimatedTotal: financial.estimatedTotal,
          totalCharges: financial.totals.totalCharges,
          totalPayments: financial.totals.totalPayments,
          depositTotal: financial.totals.depositTotal,
          balance: financial.totals.balance,
          balanceOnArrival: financial.totals.balanceOnArrival,
          creditAvailability: financial.credit.available,
        },
      },
    });
  } catch (error: any) {
    console.error('Get reservation financial error:', error);
    res.status(500).json({ success: false, message: 'Server error while retrieving reservation financials' });
  }
});

// @route   PATCH /api/reservations/:id/check-out
// @desc    Perform check-out when folio has no pending balance
// @access  Private (Admin, Staff, Maintenance, or roles with check-in permission)
router.patch('/:id/check-out', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { checkOutAt } = req.body as { checkOutAt?: string | Date };

    let allowed = false;
    const roleName = String(req.user?.role || '').toLowerCase();
    if (['admin', 'staff', 'maintenance'].includes(roleName)) {
      allowed = true;
    } else {
      try {
        const roleDoc = await Role.findOne({ name: roleName });
        const perms = roleDoc?.permissions || [];
        allowed = perms.includes('admin.reservations.checkin');
      } catch (permErr) {
        console.error('Checkout permission check failed:', permErr);
      }
    }
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied. Missing permission to check-out.' });
    }

    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    if (reservation.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot check-out a cancelled reservation' });
    }
    if (!reservation.actualCheckInAt) {
      return res.status(400).json({ success: false, message: 'Cannot check-out before check-in has been completed' });
    }

    const financial = await getReservationFinancialSnapshot(reservation);
    let cityLedgerOutcome: { transferred: boolean; preApproved: boolean; invoiceNumber: string; authorizationStatus: string } | null = null;

    // Resolved and validated before any City Ledger / AR side effect below, so a missing
    // room fails fast — same fail-before-mutating order the original blocking checkout had.
    let checkedOutRoom: any = null;
    if (reservation.type === 'room') {
      const primaryRoomId = reservation.room || (reservation.rooms && reservation.rooms[0]);
      checkedOutRoom = primaryRoomId ? await Room.findById(primaryRoomId) : null;
      if (!checkedOutRoom) return res.status(404).json({ success: false, message: 'Assigned room not found' });
    }

    if (financial.totals.balance > 0) {
      // A PMS-only tenant has no AR subledger to move the balance into — keep today's
      // behavior (block checkout until settled or credit is used). An accounting-enabled
      // tenant never blocks here: the balance is transferred to City Ledger automatically
      // (architecture §11.5 — never a discretionary front-desk action).
      if (!tenantHasAccounting(req.tenant)) {
        return res.status(400).json({
          success: false,
          message: 'Pending balance must be settled before checkout',
          data: {
            totalCharges: financial.totals.totalCharges,
            totalPayments: financial.totals.totalPayments,
            balance: financial.totals.balance,
            creditAvailability: financial.credit.available,
          },
        });
      }

      const balance = financial.totals.balance;
      const transfer = await transferFolioBalanceToCityLedger(reservation, financial.folio, balance, req.user?.id as any);

      await Payment.create({
        folioId: financial.folio._id,
        amount: balance,
        method: 'credit',
        status: 'pending',
        note: transfer.preApproved
          ? 'Credit used for checkout remaining balance (City Ledger — pre-approved direct bill)'
          : 'Transferred to City Ledger pending manager authorization',
        createdBy: req.user?.id as any,
      });

      financial.folio.status = 'in_ar';
      await financial.folio.save();

      cityLedgerOutcome = {
        transferred: true,
        preApproved: transfer.preApproved,
        invoiceNumber: transfer.invoice.invoiceNumber,
        authorizationStatus: transfer.invoice.cityLedger!.authorizationStatus,
      };
    }

    const previousStatus = reservation.status;
    reservation.actualCheckOutAt = checkOutAt ? new Date(checkOutAt) : new Date();
    reservation.status = 'completed';

    if (checkedOutRoom) {
      checkedOutRoom.condition = 'pending_cleanup';
      await checkedOutRoom.save();
    }

    if (financial.folio.status === 'open') {
      financial.folio.status = 'closed';
      await financial.folio.save();
      // Fire-and-forget invoice email — errors must not block checkout response
      sendInvoiceEmail(financial.folio._id as string).catch(err =>
        console.error(JSON.stringify({ emailEvent: 'failed', emailType: 'invoice', errorCode: String(err.message) }))
      );
    }

    await reservation.save();
    await recordReservationEvent(reservation._id as any, 'checked_out', {
      actor: actorFromRequest(req),
      changes: [{ field: 'status', from: previousStatus, to: 'completed' }],
      ...(cityLedgerOutcome ? { amount: financial.totals.balance, note: `City Ledger ${cityLedgerOutcome.invoiceNumber}` } : {}),
    });

    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status condition')
      .populate('rooms', 'name status condition')
      .populate('guestRecord', 'firstName lastName email phone');

    res.status(200).json({
      success: true,
      message: 'Check-out completed',
      data: populatedReservation,
      ...(cityLedgerOutcome ? { cityLedger: cityLedgerOutcome } : {}),
    });
  } catch (error: any) {
    console.error('Check-out error:', error);
    res.status(500).json({ success: false, message: 'Server error during check-out' });
  }
});

// @route   POST /api/reservations/:id/charges
// @desc    Manually add a charge to a reservation folio
// @access  Private (roles with managePayments permission)
router.post('/:id/charges', authenticate, authorizePermission('pms', 'admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
  try {
    const { description, amount, category } = req.body as {
      description?: string;
      amount?: number;
      category?: string;
    };

    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
    if (reservation.status === 'cancelled') return res.status(400).json({ success: false, message: 'Cannot add charges to a cancelled reservation' });

    const descStr = String(description || '').trim();
    if (!descStr) return res.status(400).json({ success: false, message: 'Charge description is required' });

    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ success: false, message: 'Charge amount must be a positive number' });

    const allowedCategories = ['room', 'late_fee', 'service', 'damage', 'adjustment'];
    if (category && !allowedCategories.includes(String(category))) {
      return res.status(400).json({ success: false, message: 'Invalid charge category' });
    }

    const financial = await getReservationFinancialSnapshot(reservation);
    if (financial.folio.status !== 'open') {
      return res.status(400).json({ success: false, message: 'Charges can only be added while folio is open' });
    }

    const charge = await Charge.create({
      folioId: financial.folio._id,
      description: descStr,
      amount: amt,
      type: 'manual',
      category: category || undefined,
      createdBy: req.user?.id as any,
    });
    await postChargeAddedEntry(req.tenant, charge, req.user?.id as any);

    res.status(201).json({ success: true, message: 'Charge recorded', data: charge });
  } catch (error: any) {
    console.error('Add charge error:', error);
    res.status(500).json({ success: false, message: 'Server error while adding charge' });
  }
});

// @route   DELETE /api/reservations/:id/charges/:chargeId
// @desc    Delete a manual charge from a reservation folio
// @access  Private (roles with managePayments permission)
router.delete('/:id/charges/:chargeId', authenticate, authorizePermission('pms', 'admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });

    const financial = await getReservationFinancialSnapshot(reservation);
    const charge = await Charge.findOne({ _id: req.params.chargeId, folioId: financial.folio._id });
    if (!charge) return res.status(404).json({ success: false, message: 'Charge not found' });
    if (charge.type === 'base') {
      return res.status(400).json({ success: false, message: 'Base reservation charges cannot be deleted' });
    }

    await charge.deleteOne();
    await recordReservationEvent(reservation._id as any, 'charge_deleted', {
      actor: actorFromRequest(req),
      ref: { kind: 'charge', id: charge._id as any },
      amount: charge.amount,
      note: charge.description,
    });
    res.json({ success: true, message: 'Charge deleted' });
  } catch (error: any) {
    console.error('Delete charge error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting charge' });
  }
});

// @route   POST /api/reservations/:id/payments
// @desc    Record a payment against reservation folio
// @access  Private
router.post('/:id/payments', authenticate, authorizePermission('pms', 'admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
  try {
    const { amount, method, note, reference, paymentStage: rawStage } = req.body as {
      amount?: number;
      method?: 'cash' | 'card' | 'transfer' | 'credit' | 'check';
      note?: string;
      reference?: string;
      paymentStage?: string;
    };

    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
    if (reservation.status === 'cancelled') return res.status(400).json({ success: false, message: 'Cannot add payment to a cancelled reservation' });

    const amt = Number(amount);
    if (!amt || isNaN(amt) || amt <= 0) return res.status(400).json({ success: false, message: 'Payment amount must be a positive number' });

    const allowedMethods = ['cash', 'card', 'transfer', 'credit', 'check'];
    if (!method || !allowedMethods.includes(String(method))) {
      return res.status(400).json({ success: false, message: 'Payment method is required and must be one of cash, card, transfer, credit, check' });
    }

    const paymentStage: 'deposit' | 'in_house' = rawStage === 'deposit' ? 'deposit' : 'in_house';
    const isDeposit = paymentStage === 'deposit';
    const isPreArrival = !(reservation as any).actualCheckInAt;

    // Deposits are only valid for pre-arrival reservations
    if (isDeposit && !isPreArrival) {
      return res.status(400).json({ success: false, message: 'Deposit payments can only be recorded for pre-arrival reservations' });
    }
    // Credit method not allowed for deposits (deposits must be settled funds)
    if (isDeposit && method === 'credit') {
      return res.status(400).json({ success: false, message: 'Credit payment method cannot be used for pre-arrival deposits' });
    }

    const financial = await getReservationFinancialSnapshot(reservation);
    if (financial.folio.status !== 'open') {
      return res.status(400).json({ success: false, message: 'Payments can only be registered while folio is open' });
    }

    if (isDeposit) {
      // Validate deposit does not exceed remaining balance on arrival
      const remainingOnArrival = financial.totals.balanceOnArrival;
      if (amt > remainingOnArrival) {
        return res.status(400).json({
          success: false,
          message: `Deposit amount exceeds balance on arrival (${remainingOnArrival.toFixed(2)})`,
        });
      }
    } else {
      // Regular in-house payment: require existing folio charges and a pending balance
      if (financial.totals.totalCharges <= 0 || financial.totals.balance <= 0) {
        return res.status(400).json({ success: false, message: 'Folio has no pending balance to pay' });
      }
      if (amt > financial.totals.balance) {
        return res.status(400).json({ success: false, message: `Amount exceeds pending balance (${financial.totals.balance})` });
      }
    }

    const paymentStatus = method === 'credit' ? 'pending' : 'completed';

    if (method === 'credit') {
      let creditAccount: any = null;
      if (reservation.company) {
        creditAccount = await CreditAccount.findOne({ scope: 'company', referenceId: reservation.company, status: 'active' });
      }
      if (!creditAccount && reservation.guestRecord) {
        creditAccount = await CreditAccount.findOne({ scope: 'guest', referenceId: reservation.guestRecord, status: 'active' });
      }
      if (!creditAccount) {
        return res.status(400).json({ success: false, message: 'No active credit account found for this reservation' });
      }
      const available = Number(creditAccount.creditLimit || 0) - Number(creditAccount.currentExposure || 0);
      if (available < amt) {
        return res.status(400).json({ success: false, message: 'Insufficient credit availability for this payment' });
      }
      creditAccount.currentExposure = Number(creditAccount.currentExposure || 0) + amt;
      await creditAccount.save();
      financial.folio.status = 'in_ar';
      await financial.folio.save();
    }

    const payment = await Payment.create({
      folioId: financial.folio._id,
      amount: amt,
      method,
      status: paymentStatus,
      paymentStage,
      reference,
      note,
      createdBy: req.user?.id as any,
    });
    if (paymentStatus === 'completed') {
      await postPaymentCompletedEntry(req.tenant, payment, req.user?.id as any);
    }

    const updatedFinancial = await getReservationFinancialSnapshot(reservation);
    reservation.totalPayments = updatedFinancial.totals.totalPayments;
    if (reservation.type === 'daypass' || reservation.type === 'PasaTarde') {
      reservation.status = updatedFinancial.totals.balance <= 0 ? 'confirmed' : 'pending';
    }
    await reservation.save();

    const populated = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('guestRecord', 'firstName lastName email phone');

    res.status(200).json({ success: true, message: 'Payment recorded successfully', data: populated });
  } catch (error: any) {
    console.error('Add payment error:', error);
    res.status(500).json({ success: false, message: 'Server error while recording payment' });
  }
});

// @route   PATCH /api/reservations/:id/payments/:paymentId
// @desc    Edit a payment record and update folio summary
// @access  Private
router.patch('/:id/payments/:paymentId', authenticate, authorizePermission('pms', 'admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
  try {
    const { amount, method, note, reference, status } = req.body as {
      amount?: number;
      method?: 'cash' | 'card' | 'transfer' | 'credit' | 'check';
      note?: string;
      reference?: string;
      status?: 'completed' | 'pending' | 'reversed';
    };

    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });

    const financial = await getReservationFinancialSnapshot(reservation);
    const payment = await Payment.findOne({ _id: req.params.paymentId, folioId: financial.folio._id });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    const previousStatus = payment.status;
    const paymentFields = (p: any) => ({ amount: p.amount, method: p.method, status: p.status, reference: p.reference || undefined });
    const paymentBefore = paymentFields(payment);

    if (amount !== undefined) {
      const amt = Number(amount);
      if (!amt || isNaN(amt) || amt <= 0) return res.status(400).json({ success: false, message: 'Payment amount must be a positive number' });
      payment.amount = amt;
    }
    if (method) payment.method = method;
    if (note !== undefined) payment.note = note || undefined;
    if (reference !== undefined) payment.reference = reference || undefined;
    if (status) payment.status = status;

    await payment.save();
    await recordReservationEvent(reservation._id as any, 'payment_updated', {
      actor: actorFromRequest(req),
      ref: { kind: 'payment', id: payment._id as any },
      changes: diffSnapshots(paymentBefore, paymentFields(payment)),
    });

    // Phase 7.2: mirror the status transition onto the GL — a completed payment gaining
    // a GL entry, a completed→reversed one flipping it. A same-status edit (e.g. just the
    // amount/method changing) intentionally does not adjust any already-posted entry here;
    // reverse and re-record if a completed payment's amount needs correcting.
    if (status && status !== previousStatus) {
      if (status === 'reversed' && previousStatus === 'completed') {
        await reversePaymentEntry(req.tenant, payment, req.user?.id as any);
      } else if (status === 'completed' && previousStatus !== 'completed') {
        await postPaymentCompletedEntry(req.tenant, payment, req.user?.id as any);
      }
    }

    const updatedFinancial = await getReservationFinancialSnapshot(reservation);
    reservation.totalPayments = updatedFinancial.totals.totalPayments;
    if (reservation.type === 'daypass' || reservation.type === 'PasaTarde') {
      reservation.status = updatedFinancial.totals.balance <= 0 ? 'confirmed' : 'pending';
    }
    await reservation.save();

    const populated = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('guestRecord', 'firstName lastName email phone');
    res.status(200).json({ success: true, message: 'Payment updated successfully', data: populated });
  } catch (error: any) {
    console.error('Edit payment error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating payment' });
  }
});

// @route   DELETE /api/reservations/:id/payments/:paymentId
// @desc    Delete a payment record and update folio summary
// @access  Private
router.delete('/:id/payments/:paymentId', authenticate, authorizePermission('pms', 'admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });

    const financial = await getReservationFinancialSnapshot(reservation);
    const deleted = await Payment.findOneAndDelete({ _id: req.params.paymentId, folioId: financial.folio._id });
    if (!deleted) return res.status(404).json({ success: false, message: 'Payment not found' });
    await recordReservationEvent(reservation._id as any, 'payment_deleted', {
      actor: actorFromRequest(req),
      ref: { kind: 'payment', id: deleted._id as any },
      amount: deleted.amount,
      note: deleted.method,
    });

    const updatedFinancial = await getReservationFinancialSnapshot(reservation);
    reservation.totalPayments = updatedFinancial.totals.totalPayments;
    if (reservation.type === 'daypass' || reservation.type === 'PasaTarde') {
      reservation.status = updatedFinancial.totals.balance <= 0 ? 'confirmed' : 'pending';
    }
    await reservation.save();

    const populated = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status')
      .populate('guestRecord', 'firstName lastName email phone');
    res.status(200).json({ success: true, message: 'Payment deleted successfully', data: populated });
  } catch (error: any) {
    console.error('Delete payment error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting payment' });
  }
});

// @route   POST /api/reservations/:id/use-credit
// @desc    Use credit for remaining folio balance and complete checkout
// @access  Private
router.post('/:id/use-credit', authenticate, authorizePermission('pms', 'admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
    if (!reservation.actualCheckInAt) return res.status(400).json({ success: false, message: 'Cannot use credit before check-in' });

    const financial = await getReservationFinancialSnapshot(reservation);
    if (financial.folio.status !== 'open') return res.status(400).json({ success: false, message: 'Folio must be open to use credit' });
    if (financial.totals.totalCharges <= 0 || financial.totals.balance <= 0) {
      return res.status(400).json({ success: false, message: 'No pending balance to move to credit' });
    }

    let creditAccount: any = null;
    if (reservation.company) creditAccount = await CreditAccount.findOne({ scope: 'company', referenceId: reservation.company, status: 'active' });
    if (!creditAccount && reservation.guestRecord) creditAccount = await CreditAccount.findOne({ scope: 'guest', referenceId: reservation.guestRecord, status: 'active' });
    if (!creditAccount) return res.status(400).json({ success: false, message: 'No active credit account found for this reservation' });

    const available = Number(creditAccount.creditLimit || 0) - Number(creditAccount.currentExposure || 0);
    if (available < financial.totals.balance) {
      return res.status(400).json({ success: false, message: 'Insufficient credit availability for folio balance' });
    }

    await Payment.create({
      folioId: financial.folio._id,
      amount: financial.totals.balance,
      method: 'credit',
      status: 'pending',
      note: 'Credit used for checkout remaining balance',
      createdBy: req.user?.id as any,
    });

    creditAccount.currentExposure = Number(creditAccount.currentExposure || 0) + financial.totals.balance;
    await creditAccount.save();

    financial.folio.status = 'in_ar';
    await financial.folio.save();

    const previousStatus = reservation.status;
    reservation.actualCheckOutAt = new Date();
    reservation.status = 'completed';
    const refreshed = await getReservationFinancialSnapshot(reservation);
    reservation.totalPayments = refreshed.totals.totalPayments;
    await reservation.save();
    await recordReservationEvent(reservation._id as any, 'checked_out', {
      actor: actorFromRequest(req),
      changes: [{ field: 'status', from: previousStatus, to: 'completed' }],
      amount: financial.totals.balance,
      note: 'credit',
    });

    const populated = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status condition')
      .populate('rooms', 'name status condition')
      .populate('guestRecord', 'firstName lastName email phone')
      .populate('company', 'name email phone');

    res.status(200).json({ success: true, message: 'Credit applied and checkout completed', data: populated });
  } catch (error: any) {
    console.error('Use credit error:', error);
    res.status(500).json({ success: false, message: 'Server error while using credit' });
  }
});

// @route   POST /api/reservations/:id/send-email
// @desc    Send a transactional email for this reservation on demand
// @access  Private (admin)
router.post('/:id/send-email', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { type } = req.body as { type?: string };
    if (!type || !['confirmation', 'invoice'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid email type. Must be "confirmation" or "invoice".' });
    }

    const reservation = await Reservation.findById(req.params.id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name')
      .populate('rooms', 'name')
      .populate('guestRecord', 'firstName lastName email phone');
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });

    const contactEmail = (reservation as any).contactInfo?.email;
    if (!contactEmail) {
      return res.status(422).json({ success: false, message: 'Reservation has no contact email address' });
    }

    if (type === 'confirmation') {
      await sendReservationConfirmationEmail(reservation);
    } else if (type === 'invoice') {
      const financial = await getReservationFinancialSnapshot(reservation);
      await sendInvoiceEmail(financial.folio._id as string);
    }
    await recordReservationEvent(reservation._id as any, 'email_sent', { actor: actorFromRequest(req), note: type });

    res.status(200).json({ success: true, message: `${type} email sent` });
  } catch (error: any) {
    console.error('Send email error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to send email' });
  }
});

// ─── Corporate Price Approval ────────────────────────────────────────────────

/**
 * Recalculate estimatedTotal and pricingSnapshot for a room reservation using
 * company pricing rules. Called immediately after a corporate price request is
 * approved so the stored total reflects the negotiated corporate rate.
 *
 * Reservations with room items keep their rate plans, re-priced night by night with the
 * company's (and guest's) rules; a room moves to the plan carrying the company's contract when
 * its type has one (services/ratePlanSelection.ts). Older reservations without room items are
 * re-priced on their snapshot's plan. Non-room reservation types are skipped.
 */
async function recalculateCorporatePrice(reservation: any, companyId: string): Promise<void> {
  if (reservation.type !== 'room') return;
  const guestEmail = reservation.contactInfo?.email;

  let newTotal = 0;
  let newSnapshot: any;
  const roomItems = (reservation.items ?? []).filter((i: any) => i.kind === 'room');

  if (roomItems.length > 0) {
    const { items, quotes } = await requoteRoomItems(reservation.items, { companyId, guestEmail });
    if (quotes.length === 0) return;
    reservation.items = items;
    const repriced = items.filter((i: any) => i.kind === 'room');
    newTotal = Math.round(repriced.reduce((s: number, i: any) => s + Number(i.total || 0), 0) * 100) / 100
      + (reservation.items as any[]).filter((i: any) => i.kind !== 'room').reduce((s: number, i: any) => s + Number(i.total || 0), 0);
    newSnapshot = quotes.length === repriced.length ? pricingSnapshotFrom(quotes) : undefined;
  } else {
    const rooms: string[] = (Array.isArray(reservation.rooms) ? reservation.rooms : []).map(String);
    if (rooms.length > 0 && reservation.checkInDate && reservation.checkOutDate) {
      const result = await quoteRooms({
        roomIds: rooms,
        checkIn: new Date(reservation.checkInDate),
        checkOut: new Date(reservation.checkOutDate),
        adults: reservation.guestDetails?.adults ?? 1,
        children: reservation.guestDetails?.children ?? 0,
        companyId,
        guestEmail,
        audience: 'staff',
      });
      const quotes = result.lines.map((l) => l.quote).filter((q): q is NonNullable<typeof q> => !!q);
      if (quotes.length === 0) return;
      newTotal = result.totals.finalTotal;
      newSnapshot = pricingSnapshotFrom(quotes);
    } else if (reservation.pricingSnapshot?.ratePlanId) {
      const snap = reservation.pricingSnapshot;
      const nights = snap.nights || 1;
      const result = await calculateTieredPrice({
        ratePlanId: snap.ratePlanId,
        adults: reservation.guestDetails?.adults ?? 1,
        children: reservation.guestDetails?.children ?? 0,
        date: new Date(reservation.checkInDate),
        nights,
        rooms: 1,
        companyId,
        channel: 'admin',
      });
      newTotal = result.finalTotal;
      newSnapshot = {
        ...(snap.toObject ? snap.toObject() : snap),
        basePrice: result.basePrice,
        occupancyCost: result.occupancyCost,
        subtotal: result.subtotal,
        adjustedSubtotal: result.adjustedSubtotal,
        taxes: result.taxes,
        totalTaxes: result.totalTaxes,
        finalTotal: result.finalTotal,
      };
    } else {
      // No pricing data to recalculate from — leave price unchanged
      return;
    }
  }

  // Re-apply any existing manual discount on top of the new corporate total
  const existingDiscount = reservation.discountAmount ?? 0;
  reservation.estimatedTotal = Math.max(0, newTotal - existingDiscount);
  if (newSnapshot) reservation.pricingSnapshot = newSnapshot;
}

/**
 * These routes are also reached from the buttons in the request email, without a session:
 * those decisions are recorded as staff without a name, marked `email_link`.
 */
async function recordCorporateDecision(
  req: Request, reservation: any,
  action: 'corporate_rate_approved' | 'corporate_rate_declined', before: ReturnType<typeof snapshotReservation>,
) {
  const user = await optionalUser(req);
  await recordReservationEvent(reservation._id, action, {
    actor: user ? actorFromRequest({ user }) : { kind: 'user' },
    changes: diffSnapshots(before, snapshotReservation(reservation)),
    ...(user ? {} : { note: 'email_link' }),
  });
}

// @route   POST /api/reservations/:id/corporate-price/approve
// @desc    Approve a pending corporate price request (via email link or admin UI)
// @access  Public (stateless action link) — token-based in production
router.post('/:id/corporate-price/approve', async (req: Request, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    if (reservation.corporatePriceStatus !== 'pending') {
      return res.status(400).json({ success: false, message: `Corporate price is already ${reservation.corporatePriceStatus || 'not requested'}` });
    }

    // The company to assign can come from req.body or we look up the guest's company
    let companyId = req.body.companyId || null;

    // If no company provided, try to find via guest record
    if (!companyId && reservation.guestRecord) {
      const guest = await Guest.findById(reservation.guestRecord).lean();
      if (guest && (guest as any).companyId) {
        companyId = (guest as any).companyId;
      }
    }

    const before = snapshotReservation(reservation);
    reservation.corporatePriceStatus = 'approved';
    if (companyId) {
      reservation.company = companyId;

      // Also associate the guest with the company for future auto-approval
      if (reservation.guestRecord) {
        await Guest.findByIdAndUpdate(reservation.guestRecord, { companyId });
      }

      // Recalculate price using company pricing rules
      await recalculateCorporatePrice(reservation, String(companyId));
    }
    await reservation.save();
    await recordCorporateDecision(req, reservation, 'corporate_rate_approved', before);

    // If accessed from an email link (GET-like), redirect to a friendly page
    const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
    if (req.headers.accept?.includes('text/html')) {
      return res.redirect(`${frontendUrl}/admin/reservations?corporateApproved=${reservation.reservationCode}`);
    }

    res.json({ success: true, message: 'Corporate price approved', data: reservation });
  } catch (error: any) {
    console.error('Corporate price approve error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve corporate price' });
  }
});

// Also support GET for email button clicks
router.get('/:id/corporate-price/approve', async (req: Request, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) {
      const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
      return res.redirect(`${frontendUrl}/admin/reservations?error=not_found`);
    }
    if (reservation.corporatePriceStatus !== 'pending') {
      const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
      return res.redirect(`${frontendUrl}/admin/reservations?info=already_${reservation.corporatePriceStatus || 'processed'}`);
    }

    const before = snapshotReservation(reservation);
    reservation.corporatePriceStatus = 'approved';

    // Try to auto-link guest's company
    let resolvedCompanyId: string | null = null;
    if (reservation.guestRecord) {
      const guest = await Guest.findById(reservation.guestRecord).lean();
      if (guest && (guest as any).companyId) {
        reservation.company = (guest as any).companyId;
        resolvedCompanyId = String((guest as any).companyId);
      }
    }

    // Recalculate price using company pricing rules
    if (resolvedCompanyId) {
      await recalculateCorporatePrice(reservation, resolvedCompanyId);
    }

    await reservation.save();
    await recordCorporateDecision(req, reservation, 'corporate_rate_approved', before);

    const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
    res.redirect(`${frontendUrl}/admin/reservations?corporateApproved=${reservation.reservationCode}`);
  } catch (error: any) {
    console.error('Corporate price approve error:', error);
    const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
    res.redirect(`${frontendUrl}/admin/reservations?error=approve_failed`);
  }
});

// @route   POST /api/reservations/:id/corporate-price/decline
// @desc    Decline a pending corporate price request
// @access  Public (stateless action link)
router.post('/:id/corporate-price/decline', async (req: Request, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    if (reservation.corporatePriceStatus !== 'pending') {
      return res.status(400).json({ success: false, message: `Corporate price is already ${reservation.corporatePriceStatus || 'not requested'}` });
    }

    const before = snapshotReservation(reservation);
    reservation.corporatePriceStatus = 'declined';
    await reservation.save();
    await recordCorporateDecision(req, reservation, 'corporate_rate_declined', before);

    if (req.headers.accept?.includes('text/html')) {
      const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
      return res.redirect(`${frontendUrl}/admin/reservations?corporateDeclined=${reservation.reservationCode}`);
    }

    res.json({ success: true, message: 'Corporate price declined', data: reservation });
  } catch (error: any) {
    console.error('Corporate price decline error:', error);
    res.status(500).json({ success: false, message: 'Failed to decline corporate price' });
  }
});

// Also support GET for email button clicks
router.get('/:id/corporate-price/decline', async (req: Request, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) {
      const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
      return res.redirect(`${frontendUrl}/admin/reservations?error=not_found`);
    }
    if (reservation.corporatePriceStatus !== 'pending') {
      const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
      return res.redirect(`${frontendUrl}/admin/reservations?info=already_${reservation.corporatePriceStatus || 'processed'}`);
    }

    const before = snapshotReservation(reservation);
    reservation.corporatePriceStatus = 'declined';
    await reservation.save();
    await recordCorporateDecision(req, reservation, 'corporate_rate_declined', before);

    const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
    res.redirect(`${frontendUrl}/admin/reservations?corporateDeclined=${reservation.reservationCode}`);
  } catch (error: any) {
    console.error('Corporate price decline error:', error);
    const frontendUrl = tenantBaseUrl((req as any).tenant?.slug);
    res.redirect(`${frontendUrl}/admin/reservations?error=decline_failed`);
  }
});

export default router;
