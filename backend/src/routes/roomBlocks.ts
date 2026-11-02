/**
 * Room blocks — /api/room-blocks (CHANNEX_IMPLEMENTATION_PLAN.md Phase 3.2)
 *
 * A block takes one room out of service for a range of nights. Dates are `YYYY-MM-DD`
 * calendar dates; `endDate` is the first night the room is back (exclusive).
 *
 *   GET    /api/room-blocks?from&to&roomId  — blocks touching the nights from..to (inclusive)
 *   POST   /api/room-blocks                 — create  { roomId, startDate, endDate, reason?, notes?, force? }
 *   PUT    /api/room-blocks/:id             — update  (same body)
 *   DELETE /api/room-blocks/:id
 *
 * A block may not overlap another block of the same room, nor (unless `force: true`) a
 * pending / confirmed / checked-in reservation assigned to that room; both come back as
 * 409 with the conflicting stays listed.
 */

import express, { Response } from 'express';
import mongoose from 'mongoose';
import RoomBlock, { ROOM_BLOCK_REASONS } from '../models/RoomBlock';
import Room from '../models/Room';
import Reservation from '../models/Reservation';
import { authenticate, authorizeAppAccess, authorizePermission, AuthRequest } from '../middleware/auth';
import { addDays, diffDays, fromChannexDate, isChannexDate, toChannexDate } from '../services/channex/dates';
import { findRoomConflicts } from '../services/channex/inventory.service';

const router = express.Router();

const MAX_BLOCK_NIGHTS = 730;

const serialize = (b: any) => ({
  ...b,
  startDate: toChannexDate(new Date(b.startDate)),
  endDate: toChannexDate(new Date(b.endDate)),
});

const isId = (v: unknown): v is string => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);

interface BlockInput {
  roomId: string;
  startDate: string;
  endDate: string;
  reason?: string;
  notes?: string;
  force?: boolean;
}

/** Validates the body; returns an error message or the normalized values. */
function parseBody(body: any): { error: string } | { value: BlockInput } {
  const { roomId, startDate, endDate, reason, notes, force } = body ?? {};
  if (!isId(roomId)) return { error: 'roomId is required' };
  if (!isChannexDate(startDate) || !isChannexDate(endDate)) {
    return { error: 'startDate and endDate must be dates in YYYY-MM-DD format' };
  }
  if (endDate <= startDate) return { error: 'The block must end after it starts (endDate is the day the room is back in service)' };
  if (diffDays(startDate, endDate) > MAX_BLOCK_NIGHTS) return { error: `A block can cover at most ${MAX_BLOCK_NIGHTS} nights` };
  if (reason !== undefined && !(ROOM_BLOCK_REASONS as readonly string[]).includes(reason)) {
    return { error: `reason must be one of: ${ROOM_BLOCK_REASONS.join(', ')}` };
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 500)) return { error: 'notes must be text of at most 500 characters' };
  return { value: { roomId, startDate, endDate, reason, notes, force: force === true } };
}

/** 409 payload when the block overlaps another block or (without force) a reservation. */
async function checkConflicts(input: BlockInput, selfId?: string) {
  const conflicts = (await findRoomConflicts({
    roomIds: [input.roomId],
    checkIn: fromChannexDate(input.startDate),
    checkOut: fromChannexDate(input.endDate),
  })).filter((c) => !(c.kind === 'block' && c.id === selfId));

  const blockConflict = conflicts.find((c) => c.kind === 'block');
  if (blockConflict) {
    return {
      code: 'block_overlap',
      message: `This room is already blocked from ${blockConflict.dateFrom} to ${addDays(blockConflict.dateTo, 1)}. Edit that block instead.`,
      conflicts: [blockConflict],
    };
  }

  const reservationConflicts = conflicts.filter((c) => c.kind === 'reservation');
  if (reservationConflicts.length && !input.force) {
    const reservations = await Reservation.find({ _id: { $in: reservationConflicts.map((c) => c.id) } })
      .select('reservationCode guestName checkInDate checkOutDate status').lean();
    const details = reservations.map((r: any) => ({
      reservationId: String(r._id),
      reservationCode: r.reservationCode,
      guestName: [r.guestName?.firstName, r.guestName?.lastName].filter(Boolean).join(' '),
      checkIn: toChannexDate(new Date(r.checkInDate)),
      checkOut: r.checkOutDate ? toChannexDate(new Date(r.checkOutDate)) : undefined,
      status: r.status,
    }));
    const first = details[0];
    return {
      code: 'reservation_overlap',
      message: details.length === 1
        ? `This room has a reservation${first?.reservationCode ? ` (${first.reservationCode})` : ''} from ${first?.checkIn} to ${first?.checkOut} on these dates. Move the reservation to another room first, or block the room anyway.`
        : `This room has ${details.length} reservations on these dates. Move them to other rooms first, or block the room anyway.`,
      conflicts: details,
    };
  }
  return null;
}

// @route   GET /api/room-blocks
// @access  Any PMS user (the booking calendar shows blocks)
router.get('/', authenticate, authorizeAppAccess('pms'), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, roomId } = req.query;
    const filter: any = {};
    if (from !== undefined || to !== undefined) {
      if (!isChannexDate(from) || !isChannexDate(to) || to < from) {
        return res.status(400).json({ success: false, message: 'from and to must be YYYY-MM-DD dates, with to on or after from' });
      }
      // Touches a night in [from, to]: starts before the night after `to`, ends after `from`
      filter.startDate = { $lt: fromChannexDate(addDays(to, 1)) };
      filter.endDate = { $gt: fromChannexDate(from) };
    }
    if (roomId !== undefined) {
      if (!isId(roomId)) return res.status(400).json({ success: false, message: 'Invalid roomId' });
      filter.roomId = roomId;
    }
    const blocks = await RoomBlock.find(filter)
      .populate('roomId', 'name roomTypeId')
      .populate('createdBy', 'firstName lastName')
      .sort({ startDate: 1 })
      .lean();
    res.json({ success: true, data: blocks.map(serialize) });
  } catch (err) {
    console.error('Get room-blocks error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/room-blocks
// @access  admin.rooms
router.post('/', authenticate, authorizePermission('pms', 'admin.rooms'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseBody(req.body);
    if ('error' in parsed) return res.status(400).json({ success: false, message: parsed.error });
    const input = parsed.value;

    const room = await Room.findById(input.roomId).select('_id').lean();
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    const conflict = await checkConflicts(input);
    if (conflict) return res.status(409).json({ success: false, ...conflict });

    const block = await RoomBlock.create({
      roomId: input.roomId,
      startDate: fromChannexDate(input.startDate),
      endDate: fromChannexDate(input.endDate),
      reason: input.reason,
      notes: input.notes,
      createdBy: req.user?.id,
    });
    res.status(201).json({ success: true, data: serialize(block.toObject()) });
  } catch (err: any) {
    console.error('Create room-block error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/room-blocks/:id
// @access  admin.rooms
router.put('/:id', authenticate, authorizePermission('pms', 'admin.rooms'), async (req: AuthRequest, res: Response) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid block id' });
    const block = await RoomBlock.findById(req.params.id);
    if (!block) return res.status(404).json({ success: false, message: 'Room block not found' });

    const parsed = parseBody({ roomId: String(block.roomId), ...req.body });
    if ('error' in parsed) return res.status(400).json({ success: false, message: parsed.error });
    const input = parsed.value;

    if (input.roomId !== String(block.roomId)) {
      const room = await Room.findById(input.roomId).select('_id').lean();
      if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const conflict = await checkConflicts(input, String(block._id));
    if (conflict) return res.status(409).json({ success: false, ...conflict });

    block.roomId = new mongoose.Types.ObjectId(input.roomId);
    block.startDate = fromChannexDate(input.startDate);
    block.endDate = fromChannexDate(input.endDate);
    if (input.reason !== undefined) block.reason = input.reason as any;
    if (input.notes !== undefined) block.notes = input.notes;
    await block.save();
    res.json({ success: true, data: serialize(block.toObject()) });
  } catch (err: any) {
    console.error('Update room-block error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/room-blocks/:id
// @access  admin.rooms
router.delete('/:id', authenticate, authorizePermission('pms', 'admin.rooms'), async (req: AuthRequest, res: Response) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid block id' });
    const block = await RoomBlock.findById(req.params.id);
    if (!block) return res.status(404).json({ success: false, message: 'Room block not found' });
    await block.deleteOne();
    res.json({ success: true, message: 'Room block deleted' });
  } catch (err) {
    console.error('Delete room-block error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
