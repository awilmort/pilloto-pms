import express, { Request, Response } from 'express';
import Reservation from '../models/Reservation';
import Room from '../models/Room';
import RatePlan from '../models/RatePlan';
import Role from '../models/Role';
import { authenticate, authorize, authorizePermission, AuthRequest } from '../middleware/auth';
import { validateReservation } from '../middleware/validation';
import { getSortObject } from '../utils/helpers';
import { sendReservationConfirmationEmail } from '../utils/email';
import EventType from '../models/EventType';
import { calculateTieredPrice } from '../utils/pricing';
import AppSettings from '../models/AppSettings';
import Company from '../models/Company';
import Guest from '../models/Guest';
import Folio from '../models/Folio';
import Charge from '../models/Charge';
import Payment from '../models/Payment';
import CreditAccount from '../models/CreditAccount';

const router = express.Router();

async function ensureFolio(reservationId: string | any) {
  return Folio.findOneAndUpdate(
    { reservationId },
    { $setOnInsert: { reservationId, status: 'open' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
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
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const {
      status,
      type,
      search,
      dateFrom,
      dateTo,
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

    // Date filtering
    if (dateFrom || dateTo) {
      const toStartOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const toEndOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const parseLocalDate = (s: string) => {
        const parts = s.split('-');
        if (parts.length === 3) {
          const y = Number(parts[0]);
          const m = Number(parts[1]);
          const d = Number(parts[2]);
          return new Date(y, (m - 1), d, 0, 0, 0, 0);
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

    // Basic text search across guest name, contact email, event description, event type, reservation code
    if (search && typeof search === 'string' && search.trim()) {
      const s = search.trim();
      filter.$or = (filter.$or || []).concat([
        { 'guestName.firstName': { $regex: s, $options: 'i' } },
        { 'guestName.lastName': { $regex: s, $options: 'i' } },
        { 'contactInfo.email': { $regex: s, $options: 'i' } },
        { eventDescription: { $regex: s, $options: 'i' } },
        { eventType: { $regex: s, $options: 'i' } },
        { reservationCode: { $regex: s, $options: 'i' } }
      ]);
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
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
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
      rooms: assignedRoomIds, // array of room IDs (new: required for room reservations)
      roomCount,              // legacy: kept for backward compatibility
      items, // optional: ReservationItem[] from service pricing
    } = req.body;

    // Normalize and basic validation
    const normalizedType = typeof type === 'string' ? String(type).trim() : '';
    const allowedTypes = ['room', 'daypass', 'PasaTarde', 'event'];
    if (!normalizedType || !allowedTypes.includes(normalizedType)) {
      return res.status(400).json({ success: false, message: 'Invalid or missing reservation type' });
    }

    let authenticatedUser: any = null;

    // Check if user is authenticated (optional for all reservation types)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        // Apply authentication middleware
        await new Promise<void>((resolve, reject) => {
          authenticate(req as AuthRequest, res, (err: any) => {
            if (err || !(req as AuthRequest).user) {
              reject(new Error('Authentication failed'));
            } else {
              authenticatedUser = (req as AuthRequest).user;
              resolve();
            }
          });
        });
      } catch (authError) {
        // Authentication failed - treat as guest booking
        authenticatedUser = null;
      }
    }

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

    // Parse dates safely. Prefer strict YYYY-MM-DD; otherwise fallback to native parsing.
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
        return new Date(y, m - 1, d, 0, 0, 0, 0);
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
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

    if (normalizedType === 'room') {
      // Room reservation pricing via tiered rate plan
      nights = Math.ceil((checkOut!.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

      if (Array.isArray(assignedRoomIds) && assignedRoomIds.length > 0) {
        // ── New path: derive pricing from the assigned rooms' rate plans ──
        const roomDocs: any[] = await Room.find({ _id: { $in: assignedRoomIds } })
          .populate('roomTypeId', 'name capacity')
          .lean();

        // Sort by room type capacity ascending so we fill smallest rooms first
        roomDocs.sort((a, b) => {
          const capA = (a.roomTypeId as any)?.capacity ?? 1;
          const capB = (b.roomTypeId as any)?.capacity ?? 1;
          return capA - capB;
        });

        let remainingAdults = Number(guestDetails?.adults ?? 0);
        let remainingChildren = Number(guestDetails?.children ?? 0);
        let grandTotal = 0;
        let grandBase = 0;
        let grandOccupancy = 0;
        let grandSubtotal = 0;
        let grandTaxes: any[] = [];
        let grandTaxesTotal = 0;

        for (const room of roomDocs) {
          const roomTypeDoc = room.roomTypeId as any;
          const roomTypeId = roomTypeDoc?._id ?? room.roomTypeId;
          if (!roomTypeId) continue;

          const ratePlan = await RatePlan.findOne({ roomTypeId, isActive: true }).lean();
          if (!ratePlan) continue;

          const capacity = roomTypeDoc?.capacity ?? 1;
          const roomAdults = Math.min(remainingAdults, capacity);
          const roomChildren = Math.min(remainingChildren, Math.max(0, capacity - roomAdults));
          remainingAdults = Math.max(0, remainingAdults - roomAdults);
          remainingChildren = Math.max(0, remainingChildren - roomChildren);

          const priceResult = await calculateTieredPrice({
            ratePlanId: String(ratePlan._id),
            adults: roomAdults,
            children: roomChildren,
            date: checkIn,
            nights,
            rooms: 1,
            companyId: (isCorporate && company) ? company : undefined,
            guestEmail: contactInfo?.email,
          });

          grandTotal += priceResult.finalTotal;
          grandBase += priceResult.basePrice;
          grandOccupancy += priceResult.occupancyCost;
          grandSubtotal += priceResult.subtotal;
          grandTaxesTotal += priceResult.totalTaxes;
          // Merge taxes by name
          for (const tx of (priceResult.taxes ?? [])) {
            const existing = grandTaxes.find(t => t.name === tx.name);
            if (existing) existing.amount += tx.amount;
            else grandTaxes.push({ ...tx });
          }
        }

        estimatedTotal = grandTotal;
        if (grandTotal > 0) {
          pricingSnapshotData = {
            ratePlanId: '',
            ratePlanName: roomDocs.map((r: any) => r.roomTypeId?.name ?? r.name).join(', '),
            roomTypeName: roomDocs.map((r: any) => r.roomTypeId?.name ?? '').join(', '),
            basePrice: grandBase,
            occupancyCost: grandOccupancy,
            subtotal: grandSubtotal,
            adjustedSubtotal: grandSubtotal,
            taxes: grandTaxes,
            totalTaxes: grandTaxesTotal,
            finalTotal: grandTotal,
            nights,
          };
        }
      } else {
        // ── Legacy path: single explicit rate plan ──
        const inboundRatePlanId = req.body.ratePlanId;
        const inboundRoomCount = Math.max(1, Number(roomCount) || 1);
        if (inboundRatePlanId) {
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

    // If a validated items array was provided (service pricing), use summed total
    if (Array.isArray(items) && items.length > 0) {
      const itemsTotal = items.reduce((sum: number, item: any) => sum + (Number(item.total) || 0), 0);
      if (itemsTotal > 0) estimatedTotal = itemsTotal;
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
    if (normalizedType === 'room') {
      if (Array.isArray(assignedRoomIds) && assignedRoomIds.length > 0) {
        reservationData.rooms = assignedRoomIds;
        reservationData.roomCount = assignedRoomIds.length;
      } else if (roomCount && Number(roomCount) > 1) {
        reservationData.roomCount = Math.max(1, Number(roomCount));
      }
    }
    if (guestRecordId) reservationData.guestRecord = guestRecordId;
    if (Array.isArray(items) && items.length > 0) {
      reservationData.items = items;
    }

    // Link company for corporate bookings
    if (isCorporate && company) {
      reservationData.company = company;
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

    // Create reservation
    const reservation = await Reservation.create(reservationData);

    // Create empty folio at reservation creation
    await ensureFolio(reservation._id);

    // Populate the reservation before sending response and email
    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status') // room may be null
      .populate('rooms', 'name status')
      .populate('company', 'name')
      .populate('guestRecord', 'firstName lastName email');

    // Send confirmation email (don't wait for it to complete)
    sendReservationConfirmationEmail(populatedReservation)
      .catch(err => console.error('Failed to send confirmation email:', err));

    res.status(201).json({
      success: true,
      message: 'Reservation created successfully. A confirmation email has been sent.',
      data: populatedReservation
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
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
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

    const { checkInDate, checkOutDate, guestDetails, specialRequests, contactInfo, totalPrice: totalPriceUpdate } = req.body;

    // If dates are being updated, validate them
    if (checkInDate || checkOutDate) {
      // Parse local date strings (YYYY-MM-DD) to avoid timezone drift
      const parseLocalDate = (s: string | Date) => {
        if (s instanceof Date) return s;
        const str = String(s);
        const parts = str.split('-');
        if (parts.length === 3) {
          const y = Number(parts[0]);
          const m = Number(parts[1]);
          const d = Number(parts[2]);
          return new Date(y, m - 1, d, 0, 0, 0, 0);
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

      // Check for overlapping reservations only for room type (excluding current reservation)
      if (reservation.type === 'room' && checkOut) {
        const overlappingReservation = await Reservation.findOne({
          _id: { $ne: reservation._id },
          room: reservation.room,
          status: { $in: ['confirmed'] },
          $or: [
            { checkInDate: { $lte: checkIn }, checkOutDate: { $gt: checkIn } },
            { checkInDate: { $lt: checkOut }, checkOutDate: { $gte: checkOut } },
            { checkInDate: { $gte: checkIn }, checkOutDate: { $lte: checkOut } }
          ]
        });
        if (overlappingReservation) {
          return res.status(400).json({ success: false, message: 'Room is not available for the selected dates' });
        }
      }

      // Update dates and recalculate price
      reservation.checkInDate = checkIn;
      if (reservation.type === 'room') {
        reservation.checkOutDate = checkOut!;
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

    res.status(200).json({ success: true, message: 'Reservation removed successfully' });
  } catch (error: any) {
    console.error('Delete reservation error:', error);
    res.status(500).json({ success: false, message: 'Server error while removing reservation' });
  }
});

// @route   PATCH /api/reservations/:id/status
// @desc    Update reservation status (Admin only)
// @access  Private (Admin)
router.patch('/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
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

    reservation.status = status;
    await reservation.save();

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
router.put('/:id/assign-room', authenticate, authorizePermission('admin.reservations.assignRoom'), async (req: AuthRequest, res: Response) => {
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

    // Check if room exists and is available
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    if (room.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Room is inactive'
      });
    }

    // Check room capacity
    // Capacity logic removed

    // Check for overlapping reservations on this specific room
    const overlappingReservation = await Reservation.findOne({
      _id: { $ne: reservationId },
      status: { $in: ['confirmed'] },
      $and: [
        { $or: [ { room: roomId }, { rooms: roomId } ] },
        { $or: [
          { checkInDate: { $lte: reservation.checkInDate }, checkOutDate: { $gt: reservation.checkInDate } },
          { checkInDate: { $lt: reservation.checkOutDate }, checkOutDate: { $gte: reservation.checkOutDate } },
          { checkInDate: { $gte: reservation.checkInDate }, checkOutDate: { $lte: reservation.checkOutDate } }
        ] }
      ]
    });

    if (overlappingReservation) {
      return res.status(400).json({
        success: false,
        message: 'Room is not available for the selected dates'
      });
    }

    // Track previous room to free if reassigning
    const previousRoomId = reservation.room as any;

    // Update reservation with room assignment
    reservation.room = roomId as any;
    // Ensure rooms array contains this room
    const currentRooms = Array.isArray(reservation.rooms) ? reservation.rooms.map(r => String(r)) : [];
    if (!currentRooms.includes(String(roomId))) {
      reservation.rooms = (reservation.rooms || []).concat([roomId as any]);
    }
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
router.put('/:id/assign-rooms', authenticate, authorizePermission('admin.reservations.assignRoom'), async (req: AuthRequest, res: Response) => {
  try {
    const { roomIds } = req.body as { roomIds?: string[] };
    const reservationId = req.params.id;

    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }

    const ids = Array.isArray(roomIds) ? roomIds.filter(Boolean) : [];
    if (ids.length === 0) {
      reservation.rooms = [] as any;
      reservation.room = undefined as any;
      reservation.assignedBy = undefined as any;
      reservation.assignedAt = undefined as any;
      await reservation.save();
      const populatedReservation = await Reservation.findById(reservation._id)
        .populate('user', 'firstName lastName email')
        .populate('room', 'name status')
        .populate('rooms', 'name status')
        .populate('assignedBy', 'firstName lastName email');
      return res.status(200).json({ success: true, message: 'Rooms assignment cleared', data: populatedReservation });
    }

    // Validate each room and overlapping reservations
    const uniqueIds = Array.from(new Set(ids));
    for (const rid of uniqueIds) {
      const room = await Room.findById(rid);
      if (!room) return res.status(404).json({ success: false, message: `Room not found: ${rid}` });
      if (room.status !== 'active') return res.status(400).json({ success: false, message: `Room is inactive: ${room.name}` });
      const overlapping = await Reservation.findOne({
        _id: { $ne: reservationId },
        status: { $in: ['confirmed'] },
        $and: [
          { $or: [ { room: rid }, { rooms: rid } ] },
          { $or: [
            { checkInDate: { $lte: reservation.checkInDate }, checkOutDate: { $gt: reservation.checkInDate } },
            { checkInDate: { $lt: reservation.checkOutDate }, checkOutDate: { $gte: reservation.checkOutDate } },
            { checkInDate: { $gte: reservation.checkInDate }, checkOutDate: { $lte: reservation.checkOutDate } }
          ] }
        ]
      });
      if (overlapping) return res.status(400).json({ success: false, message: `Room not available for selected dates: ${room.name}` });
    }

    reservation.rooms = uniqueIds as any;
    reservation.room = uniqueIds[0] as any; // Backward compatibility
    reservation.assignedBy = req.user!.id as any;
    reservation.assignedAt = new Date();
    reservation.status = 'confirmed';
    await reservation.save();

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
    reservation.status = 'cancelled';
    reservation.cancellationReason = cancellationReason || 'Cancelled by guest';
    await reservation.save();

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
    reservation.status = 'cancelled';
    reservation.cancellationReason = cancellationReason || 'Cancelled by guest';
    await reservation.save();

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

// Utility: Generate reservation code (B + YY + 4 alphanumeric uppercase)
const generateReservationCode = (): string => {
  const prefix = 'B';
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2); // Last two digits of current year
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}${year}${rand}`;
};

// Operational actions: Check-In / Check-Out
// @route   PATCH /api/reservations/:id/check-in
// @desc    Perform check-in for any reservation type and post base charge to folio
// @access  Private (Permission-based)
router.patch('/:id/check-in', authenticate, authorizePermission('admin.reservations.checkin'), async (req: AuthRequest, res: Response) => {
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

    const folio = await ensureFolio(reservation._id);
    const existingBaseCharge = await Charge.findOne({ folioId: folio._id, description: { $regex: '^Reservation base charge:', $options: 'i' } });
    if (!existingBaseCharge) {
      const amount = Number((reservation as any).estimatedTotal ?? (reservation as any).totalPrice ?? 0);
      const summary = `${reservation.type} ${reservation.reservationCode || String(reservation._id).slice(-6)}`;
      await Charge.create({
        folioId: folio._id,
        description: `Reservation base charge: ${summary}`,
        amount,
      });
    }

    await reservation.save();

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
router.get('/:id/financial', authenticate, async (req: AuthRequest, res: Response) => {
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
router.patch('/:id/check-out', authenticate, async (req: AuthRequest, res: Response) => {
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
    if (financial.totals.balance > 0) {
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

    reservation.actualCheckOutAt = checkOutAt ? new Date(checkOutAt) : new Date();
    reservation.status = 'completed';

    if (reservation.type === 'room') {
      const primaryRoomId = reservation.room || (reservation.rooms && reservation.rooms[0]);
      const room = primaryRoomId ? await Room.findById(primaryRoomId) : null;
      if (!room) return res.status(404).json({ success: false, message: 'Assigned room not found' });
      room.condition = 'pending_cleanup';
      await room.save();
    }

    if (financial.folio.status === 'open') {
      financial.folio.status = 'closed';
      await financial.folio.save();
    }

    await reservation.save();

    const populatedReservation = await Reservation.findById(reservation._id)
      .populate('user', 'firstName lastName email')
      .populate('room', 'name status condition')
      .populate('rooms', 'name status condition')
      .populate('guestRecord', 'firstName lastName email phone');

    res.status(200).json({ success: true, message: 'Check-out completed', data: populatedReservation });
  } catch (error: any) {
    console.error('Check-out error:', error);
    res.status(500).json({ success: false, message: 'Server error during check-out' });
  }
});

// @route   POST /api/reservations/:id/charges
// @desc    Manually add a charge to a reservation folio
// @access  Private (roles with managePayments permission)
router.post('/:id/charges', authenticate, authorizePermission('admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
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
    });

    res.status(201).json({ success: true, message: 'Charge recorded', data: charge });
  } catch (error: any) {
    console.error('Add charge error:', error);
    res.status(500).json({ success: false, message: 'Server error while adding charge' });
  }
});

// @route   DELETE /api/reservations/:id/charges/:chargeId
// @desc    Delete a manual charge from a reservation folio
// @access  Private (roles with managePayments permission)
router.delete('/:id/charges/:chargeId', authenticate, authorizePermission('admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
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
    res.json({ success: true, message: 'Charge deleted' });
  } catch (error: any) {
    console.error('Delete charge error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting charge' });
  }
});

// @route   POST /api/reservations/:id/payments
// @desc    Record a payment against reservation folio
// @access  Private
router.post('/:id/payments', authenticate, authorizePermission('admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
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

    await Payment.create({
      folioId: financial.folio._id,
      amount: amt,
      method,
      status: paymentStatus,
      paymentStage,
      reference,
      note,
      createdBy: req.user?.id as any,
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

    res.status(200).json({ success: true, message: 'Payment recorded successfully', data: populated });
  } catch (error: any) {
    console.error('Add payment error:', error);
    res.status(500).json({ success: false, message: 'Server error while recording payment' });
  }
});

// @route   PATCH /api/reservations/:id/payments/:paymentId
// @desc    Edit a payment record and update folio summary
// @access  Private
router.patch('/:id/payments/:paymentId', authenticate, authorizePermission('admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
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
router.delete('/:id/payments/:paymentId', authenticate, authorizePermission('admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });

    const financial = await getReservationFinancialSnapshot(reservation);
    const deleted = await Payment.findOneAndDelete({ _id: req.params.paymentId, folioId: financial.folio._id });
    if (!deleted) return res.status(404).json({ success: false, message: 'Payment not found' });

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
router.post('/:id/use-credit', authenticate, authorizePermission('admin.reservations.managePayments'), async (req: AuthRequest, res: Response) => {
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

    reservation.actualCheckOutAt = new Date();
    reservation.status = 'completed';
    const refreshed = await getReservationFinancialSnapshot(reservation);
    reservation.totalPayments = refreshed.totals.totalPayments;
    await reservation.save();

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

export default router;
