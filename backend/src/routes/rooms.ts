import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Room from '../models/Room';
import { authenticate, authorize, optionalAuth, authorizePermission } from '../middleware/auth';
import Reservation from '../models/Reservation';
import { validateRoom } from '../middleware/validation';
import { findFreeRooms, loadInventoryWindow, computeInventory } from '../services/channex/inventory.service';
import { addDays, eachDate, fromChannexDate, isChannexDate } from '../services/channex/dates';

const router = express.Router();

/** `YYYY-MM-DD` (a full ISO string is cut to its date part) or null. */
const parseDay = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  return isChannexDate(day) ? day : null;
};

// @route   GET /api/rooms
// @desc    Get all rooms with optional filtering
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      available,
      date, // optional: compute availability state for this local date (YYYY-MM-DD)
      features,
      page = 1,
      limit = 10,
      sort = 'name'
    } = req.query;

    // Build filter object
    const filter: any = {};

    // Status now only reflects active/inactive; filter when available flag is set
    if (available !== undefined) filter.status = (available === 'true') ? 'active' : 'inactive';

    // Handle features filter
    if (features) {
      const featuresList = (features as string).split(',');
      featuresList.forEach(feature => {
        filter[`features.${feature}`] = true;
      });
    }

    // Build sort object
    const sortObj: any = {};
    if (sort === 'name') sortObj.name = 1;
    else sortObj.name = 1; // default

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const rooms = await Room.find(filter)
      .populate('roomTypeId', 'name capacity')
      .sort(sortObj)
      .limit(limitNum)
      .skip(skip)
      .lean();

    // If a date is provided, compute availability state for that date per room
    let roomsWithAvailability = rooms;
    if (date && typeof date === 'string') {
      const parseLocalDate = (s: string) => {
        const [y,m,d] = s.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      };
      const dayStart = parseLocalDate(date);
      // Occupancy condition: checkInDate <= dayStart AND checkOutDate > dayStart
      const reservations = await Reservation.find({
        type: 'room',
        $or: [
          { room: { $ne: null } },
          { rooms: { $exists: true, $ne: [] } }
        ],
        status: { $in: ['pending', 'confirmed', 'completed'] },
        checkInDate: { $lte: dayStart },
        checkOutDate: { $gt: dayStart },
      }).select('room rooms actualCheckInAt').lean();
      const byRoom = new Map<string, any>();
      for (const r of reservations as any[]) {
        if (r.room) {
          byRoom.set(String(r.room), r);
        }
        if (Array.isArray(r.rooms)) {
          for (const rr of r.rooms) {
            byRoom.set(String(rr), r);
          }
        }
      }
      roomsWithAvailability = rooms.map(r => {
        const inactive = r.status === 'inactive';
        let availability: 'not_available' | 'available' | 'booked' | 'occupied' = 'available';
        if (inactive) availability = 'not_available';
        else if (byRoom.has(String(r._id))) {
          const rr = byRoom.get(String(r._id));
          availability = rr.actualCheckInAt ? 'occupied' : 'booked';
        }
        return { ...r, availability } as any;
      });
    }

    const total = await Room.countDocuments(filter);
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      data: roomsWithAvailability,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRooms: total,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error: any) {
    console.error('Get rooms error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching rooms'
    });
  }
});

// @route   GET /api/rooms/available-dates
// @desc    Dates in a range (inclusive) on which at least one room can be sold — room-type
//          availability from InventoryService (unassigned bookings and room blocks included)
// @access  Public
router.get('/available-dates', async (req, res) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required (format: YYYY-MM-DD)'
      });
    }

    const start = parseDay(startDate);
    const end = parseDay(endDate);
    if (!start || !end) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    if (start > end) {
      return res.status(400).json({ success: false, message: 'Start date must be before end date' });
    }

    const data = await loadInventoryWindow({ dateFrom: start, dateTo: end });
    const totalActiveRooms = data.rooms.filter(r => r.status === 'active').length;
    if (totalActiveRooms === 0) {
      return res.status(200).json({ success: true, data: { availableDates: [], unavailableDates: [] } });
    }

    // Rooms without a room type are counted as a type of their own
    const grid = computeInventory({
      ...data,
      rooms: data.rooms.map(r => ({ ...r, roomTypeId: r.roomTypeId ?? '__untyped' })),
      dateFrom: start,
      dateTo: end,
    });

    const availableDates: string[] = [];
    const unavailableDates: string[] = [];
    for (const day of eachDate(start, end)) {
      const anyLeft = Object.values(grid).some(byDate => (byDate[day]?.available ?? 0) > 0);
      (anyLeft ? availableDates : unavailableDates).push(day);
    }

    res.status(200).json({
      success: true,
      data: {
        availableDates,
        unavailableDates,
        totalActiveRooms
      }
    });
  } catch (error: any) {
    console.error('Get available dates error:', error);
    res.status(500).json({ success: false, message: 'Server error while checking available dates' });
  }
});

// Additional endpoint: list all active rooms available for a given date range
// @route   GET /api/rooms/available?checkIn&checkOut[&roomTypeId][&excludeReservationId]
// @desc    Active rooms free for every night of [checkIn, checkOut): not blocked, not assigned to a
//          pending/confirmed/checked-in reservation, and whose room type still has a room left once
//          unassigned room-type bookings are counted. `excludeReservationId` leaves the reservation
//          being edited out of the calculation.
// @access  Public
router.get('/available', async (req, res) => {
  try {
    const { checkIn, checkOut, roomTypeId, excludeReservationId } = req.query as Record<string, string | undefined>;
    if (!checkIn || !checkOut) {
      return res.status(400).json({ success: false, message: 'Check-in and check-out dates are required' });
    }
    const ci = parseDay(checkIn);
    const co = parseDay(checkOut);
    if (!ci || !co || co <= ci) {
      return res.status(400).json({ success: false, message: 'Check-in and check-out must be YYYY-MM-DD dates, check-out after check-in' });
    }
    const isId = (v?: string) => !v || mongoose.Types.ObjectId.isValid(v);
    if (!isId(roomTypeId) || !isId(excludeReservationId)) {
      return res.status(400).json({ success: false, message: 'Invalid roomTypeId or excludeReservationId' });
    }

    const { freeRoomIds, typeAvailability } = await findFreeRooms({
      checkIn: fromChannexDate(ci),
      checkOut: fromChannexDate(co),
      roomTypeId,
      excludeReservationId,
    });
    // Populate roomTypeId so the client can use capacity
    const rooms = await Room.find({ _id: { $in: freeRoomIds } }).populate('roomTypeId', 'name capacity').sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data: rooms, typeAvailability });
  } catch (error: any) {
    console.error('List available rooms error:', error);
    res.status(500).json({ success: false, message: 'Server error while listing available rooms' });
  }
});

// @route   GET /api/rooms/:id
// @desc    Get single room by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    res.status(200).json({
      success: true,
      data: room
    });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid room ID'
      });
    }

    console.error('Get room error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching room'
    });
  }
});

// @route   POST /api/rooms
// @desc    Create a new room
// @access  Private (Admin only)
router.post('/', authenticate, authorizePermission('pms', 'admin.rooms'), validateRoom, async (req: Request, res: Response) => {
  try {
    const room = new Room(req.body);
    await room.save();

    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: room
    });
  } catch (error: any) {
    console.error('Create room error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating room'
    });
  }
});

// @route   PUT /api/rooms/:id
// @desc    Update a room
// @access  Private (Admin only)
router.put('/:id', authenticate, authorizePermission('pms', 'admin.rooms'), validateRoom, async (req: Request, res: Response) => {
  try {
    const room = await Room.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Room updated successfully',
      data: room
    });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid room ID'
      });
    }

    console.error('Update room error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating room'
    });
  }
});

// Lightweight operational update for housekeeping fields
// @route   PATCH /api/rooms/:id/ops
// @desc    Update status, condition, and comment only
// @access  Private (Admin or Maintenance)
router.patch('/:id/ops', authenticate, authorizePermission('pms', 'admin.accommodations', 'accommodations.manage', 'admin.rooms'), async (req: Request, res: Response) => {
  try {
    const { status, condition, comment } = req.body as {
      status?: 'active' | 'inactive';
      condition?: 'pending_cleanup' | 'clean';
      comment?: string;
    };

    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    if (status !== undefined) {
      room.status = status;
    }
    if (condition !== undefined) {
      room.condition = condition;
    }
    if (comment !== undefined) {
      room.comment = String(comment).slice(0, 500);
    }

    await room.save();
    res.status(200).json({ success: true, message: 'Room updated', data: room });
  } catch (error: any) {
    console.error('Ops update error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating room' });
  }
});

// @route   DELETE /api/rooms/:id
// @desc    Delete a room
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const room = await Room.findByIdAndDelete(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Room deleted successfully'
    });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid room ID'
      });
    }

    console.error('Delete room error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting room'
    });
  }
});

// @route   GET /api/rooms/:id/availability?checkIn&checkOut | ?date[&excludeReservationId]
// @desc    Whether this room can take the stay (same rules as /api/rooms/available)
// @access  Public
router.get('/:id/availability', async (req, res) => {
  try {
    const { checkIn, checkOut, date, excludeReservationId } = req.query as Record<string, string | undefined>;

    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }
    // Inactive rooms are not available
    if (room.status === 'inactive') {
      return res.status(200).json({ success: true, available: false, reason: 'Room inactive' });
    }

    let ci: string | null;
    let co: string | null;
    if (date) {
      ci = parseDay(date);
      co = ci ? addDays(ci, 1) : null;
    } else {
      if (!checkIn || !checkOut) {
        return res.status(400).json({ success: false, message: 'Check-in and check-out dates are required' });
      }
      ci = parseDay(checkIn);
      co = parseDay(checkOut);
    }
    if (!ci || !co || co <= ci) {
      return res.status(400).json({ success: false, message: 'Dates must be YYYY-MM-DD, check-out after check-in' });
    }
    if (excludeReservationId && !mongoose.Types.ObjectId.isValid(excludeReservationId)) {
      return res.status(400).json({ success: false, message: 'Invalid excludeReservationId' });
    }

    const { freeRoomIds } = await findFreeRooms({
      checkIn: fromChannexDate(ci),
      checkOut: fromChannexDate(co),
      roomTypeId: room.roomTypeId ?? undefined,
      excludeReservationId,
    });
    const available = freeRoomIds.includes(String(room._id));
    return res.status(200).json({ success: true, available });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid room ID'
      });
    }

    console.error('Check availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking availability'
    });
  }
});

export default router;
