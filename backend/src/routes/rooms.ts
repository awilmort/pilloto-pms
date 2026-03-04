import express, { Request, Response } from 'express';
import Room from '../models/Room';
import { authenticate, authorize, optionalAuth, authorizePermission } from '../middleware/auth';
import Reservation from '../models/Reservation';
import { validateRoom } from '../middleware/validation';

const router = express.Router();

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
      .sort(sortObj)
      .limit(limitNum)
      .skip(skip)
      .lean();

    // If a date is provided, compute availability state for that date per room
    let roomsWithAvailability = rooms;
    if (date && typeof date === 'string') {
      const parseLocalDate = (s: string) => {
        const [y,m,d] = s.split('-').map(Number);
        return new Date(y, (m - 1), d, 0, 0, 0, 0);
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
// @desc    Get available dates in a range where at least one room is available
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

    const parseLocalDate = (s: string) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    };

    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    if (start > end) {
      return res.status(400).json({ success: false, message: 'Start date must be before end date' });
    }

    // Get all active rooms
    const activeRooms = await Room.find({ status: 'active' }).select('_id').lean();
    const totalActiveRooms = activeRooms.length;

    if (totalActiveRooms === 0) {
      return res.status(200).json({ success: true, data: { availableDates: [], unavailableDates: [] } });
    }

    const activeRoomIds = activeRooms.map(r => r._id);

    // Get all reservations that overlap with the date range
    const reservations = await Reservation.find({
      type: 'room',
      status: { $in: ['pending', 'confirmed', 'completed'] },
      checkInDate: { $lt: end },
      checkOutDate: { $gt: start },
      $or: [
        { room: { $in: activeRoomIds } },
        { rooms: { $elemMatch: { $in: activeRoomIds } } }
      ]
    }).select('checkInDate checkOutDate room rooms').lean();

    // Build a map of date -> number of rooms occupied
    const dateOccupancyMap = new Map<string, Set<string>>();

    // Helper to format date as YYYY-MM-DD
    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Iterate through each reservation and mark occupied dates
    for (const reservation of reservations as any[]) {
      const resStart = new Date(reservation.checkInDate);
      const resEnd = new Date(reservation.checkOutDate);
      
      // Get room IDs for this reservation
      const roomIds: string[] = [];
      if (reservation.room) {
        roomIds.push(String(reservation.room));
      }
      if (Array.isArray(reservation.rooms)) {
        roomIds.push(...reservation.rooms.map((r: any) => String(r)));
      }

      // Mark each date in the reservation period as occupied for these rooms
      const currentDate = new Date(resStart);
      while (currentDate < resEnd) {
        const dateKey = formatDate(currentDate);
        
        if (!dateOccupancyMap.has(dateKey)) {
          dateOccupancyMap.set(dateKey, new Set());
        }
        
        const occupiedRooms = dateOccupancyMap.get(dateKey)!;
        roomIds.forEach(roomId => occupiedRooms.add(roomId));
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    // Check each date in the requested range
    const availableDates: string[] = [];
    const unavailableDates: string[] = [];
    
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const dateKey = formatDate(currentDate);
      const occupiedRooms = dateOccupancyMap.get(dateKey);
      const occupiedCount = occupiedRooms ? occupiedRooms.size : 0;
      const availableCount = totalActiveRooms - occupiedCount;

      if (availableCount > 0) {
        availableDates.push(dateKey);
      } else {
        unavailableDates.push(dateKey);
      }

      currentDate.setDate(currentDate.getDate() + 1);
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
// @route   GET /api/rooms/available
// @desc    Get active rooms with no overlapping reservations in [checkIn, checkOut)
// @access  Public
router.get('/available', async (req, res) => {
  try {
    const { checkIn, checkOut } = req.query as { checkIn?: string; checkOut?: string };
    if (!checkIn || !checkOut) {
      return res.status(400).json({ success: false, message: 'Check-in and check-out dates are required' });
    }
    const parseLocalDate = (s: string) => {
      const [y,m,d] = s.split('-').map(Number);
      return new Date(y, (m - 1), d, 0, 0, 0, 0);
    };
    const start = parseLocalDate(checkIn);
    const end = parseLocalDate(checkOut);
    // Get active rooms only
    const rooms = await Room.find({ status: 'active' }).lean();
    const roomIds = rooms.map(r => r._id);
    // Find overlapping reservations for these rooms
    const overlaps = await Reservation.find({
      type: 'room',
      $or: [
        { room: { $in: roomIds } },
        { rooms: { $in: roomIds } }
      ],
      status: { $in: ['pending', 'confirmed', 'completed'] },
      checkInDate: { $lt: end },
      checkOutDate: { $gt: start },
    }).select('room rooms').lean();
    const busySet = new Set<string>();
    for (const r of overlaps as any[]) {
      if (r.room) busySet.add(String(r.room));
      if (Array.isArray(r.rooms)) {
        for (const rr of r.rooms) busySet.add(String(rr));
      }
    }
    const availableRooms = rooms.filter(r => !busySet.has(String(r._id)));
    res.status(200).json({ success: true, data: availableRooms });
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
router.post('/', authenticate, authorizePermission('admin.rooms'), validateRoom, async (req: Request, res: Response) => {
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
router.put('/:id', authenticate, authorizePermission('admin.rooms'), validateRoom, async (req: Request, res: Response) => {
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
router.patch('/:id/ops', authenticate, authorizePermission('admin.accommodations', 'accommodations.manage', 'admin.rooms'), async (req: Request, res: Response) => {
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

// @route   GET /api/rooms/:id/availability
// @desc    Check room availability for specific dates
// @access  Public
router.get('/:id/availability', async (req, res) => {
  try {
    const { checkIn, checkOut, date } = req.query as { checkIn?: string; checkOut?: string; date?: string };

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

    const parseLocalDate = (s: string) => {
      const [y,m,d] = s.split('-').map(Number);
      return new Date(y, (m - 1), d, 0, 0, 0, 0);
    };

    if (date && typeof date === 'string') {
      const dayStart = parseLocalDate(date);
      const overlapping = await Reservation.findOne({
        type: 'room',
        $or: [
          { room: room._id },
          { rooms: room._id }
        ],
        status: { $in: ['pending', 'confirmed', 'completed'] },
        checkInDate: { $lte: dayStart },
        checkOutDate: { $gt: dayStart },
      }).select('actualCheckInAt').lean();
      const available = !overlapping;
      return res.status(200).json({ success: true, available });
    }

    if (!checkIn || !checkOut) {
      return res.status(400).json({ success: false, message: 'Check-in and check-out dates are required' });
    }

    const start = parseLocalDate(checkIn as string);
    const end = parseLocalDate(checkOut as string);
    // Find any overlapping reservation in [start, end) range
    const overlapping = await Reservation.findOne({
      type: 'room',
      $or: [
        { room: room._id },
        { rooms: room._id }
      ],
      status: { $in: ['pending', 'confirmed', 'completed'] },
      checkInDate: { $lt: end },
      checkOutDate: { $gt: start },
    }).lean();
    const available = !overlapping;
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
