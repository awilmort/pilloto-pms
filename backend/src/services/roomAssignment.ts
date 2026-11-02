/**
 * Room assignment rules shared by every path that puts rooms on a reservation
 * (assign-room, assign-rooms, date changes, admin create) — plan Phase 3.3.
 *
 *   - Each room exists and is active.
 *   - No room is blocked (RoomBlock) or assigned to another pending / confirmed /
 *     checked-in reservation on any night of the stay (InventoryService rules).
 *   - Reservations with room items (booking engine, OTA bookings): the rooms map one-to-one
 *     onto the booked rooms — same room type first, otherwise a room whose capacity holds
 *     that booked room's guests (an upgrade). No more rooms than booked.
 */

import mongoose from 'mongoose';
import Room from '../models/Room';
import RoomType from '../models/RoomType';
import Reservation from '../models/Reservation';
import RoomBlock from '../models/RoomBlock';
import { findRoomConflicts, RoomConflict } from './channex/inventory.service';
import { addDays } from './channex/dates';

export interface AssignableRoom {
  _id: string;
  name: string;
  roomTypeId: string | null;
  roomTypeName?: string;
  capacity?: number;
}

export interface BookedRoomUnit {
  roomTypeId: string | null;
  roomTypeName?: string;
  guests: number;
}

type ItemLike = { kind: string; roomTypeId?: unknown; adults?: number; children?: number; quantity?: number };

/** One unit per booked room (items expanded by quantity). */
export function bookedRoomUnits(items: ItemLike[] | undefined | null, typeNames: Map<string, string> = new Map()): BookedRoomUnit[] {
  const units: BookedRoomUnit[] = [];
  for (const item of items ?? []) {
    if (item.kind !== 'room') continue;
    const typeId = item.roomTypeId ? String(item.roomTypeId) : null;
    const qty = Math.max(1, Math.floor(item.quantity ?? 1));
    // Item adults/children describe one room of the item
    const guests = (item.adults ?? 0) + (item.children ?? 0);
    for (let i = 0; i < qty; i++) {
      units.push({ roomTypeId: typeId, roomTypeName: typeId ? typeNames.get(typeId) : undefined, guests });
    }
  }
  return units;
}

/**
 * Match rooms to booked units: same type first, then upgrades by capacity (largest
 * parties to largest rooms). Returns an error message, or null when every room fits.
 */
export function matchRoomsToUnits(rooms: AssignableRoom[], units: BookedRoomUnit[]): string | null {
  if (units.length === 0) return null; // legacy reservation without room items: no type rule
  if (rooms.length > units.length) {
    return `This reservation booked ${units.length} room${units.length === 1 ? '' : 's'}; ${rooms.length} were selected.`;
  }
  const leftUnits = [...units];
  const leftRooms: AssignableRoom[] = [];
  for (const room of rooms) {
    const i = leftUnits.findIndex((u) => u.roomTypeId !== null && u.roomTypeId === room.roomTypeId);
    if (i >= 0) leftUnits.splice(i, 1);
    else leftRooms.push(room);
  }
  leftUnits.sort((a, b) => b.guests - a.guests);
  leftRooms.sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0));
  for (const room of leftRooms) {
    const unit = leftUnits.shift()!;
    if ((room.capacity ?? 0) < unit.guests) {
      const booked = unit.roomTypeName ? `the booked ${unit.roomTypeName}` : 'the booked room';
      return `${room.name}${room.roomTypeName ? ` (${room.roomTypeName})` : ''} holds ${room.capacity ?? 0} guests; ${booked} is for ${unit.guests}.`;
    }
  }
  return null;
}

/** Human-readable explanation of the first conflict. */
async function describeConflict(conflict: RoomConflict, roomName: string): Promise<string> {
  const until = addDays(conflict.dateTo, 1);
  if (conflict.kind === 'block') {
    const block = await RoomBlock.findById(conflict.id).select('reason').lean();
    return `${roomName} is out of service (${block?.reason?.replace('_', ' ') ?? 'blocked'}) from ${conflict.dateFrom} to ${until}.`;
  }
  const other = await Reservation.findById(conflict.id).select('reservationCode').lean();
  return `${roomName} is not available for the selected dates: it is assigned to reservation ${other?.reservationCode ?? conflict.id} from ${conflict.dateFrom} to ${until}.`;
}

export interface AssignmentCheck {
  roomIds: string[];
  checkIn: Date;
  checkOut?: Date | null;
  items?: ItemLike[] | null;
  /** The reservation being changed (its own stay is not a conflict) */
  reservationId?: unknown;
}

/** Validate an assignment; returns `{ status, message }` for the caller to send, or null when valid. */
export async function validateRoomAssignment(check: AssignmentCheck): Promise<{ status: number; message: string } | null> {
  const ids = [...new Set(check.roomIds.map(String))];
  if (ids.length === 0) return null;
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) return { status: 400, message: 'Invalid room id' };

  const docs: any[] = await Room.find({ _id: { $in: ids } }).populate('roomTypeId', 'name capacity').lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  for (const id of ids) {
    const doc = byId.get(id);
    if (!doc) return { status: 404, message: `Room not found: ${id}` };
    if (doc.status !== 'active') return { status: 400, message: `Room is inactive: ${doc.name}` };
  }
  const rooms: AssignableRoom[] = ids.map((id) => {
    const d = byId.get(id);
    return {
      _id: id,
      name: d.name,
      roomTypeId: d.roomTypeId?._id ? String(d.roomTypeId._id) : null,
      roomTypeName: d.roomTypeId?.name,
      capacity: d.roomTypeId?.capacity,
    };
  });

  const units = bookedRoomUnits(check.items);
  if (units.length) {
    const typeIds = [...new Set(units.map((u) => u.roomTypeId).filter((t): t is string => !!t))];
    const types: any[] = await RoomType.find({ _id: { $in: typeIds } }).select('name').lean();
    const names = new Map(types.map((t) => [String(t._id), t.name as string]));
    const mismatch = matchRoomsToUnits(rooms, bookedRoomUnits(check.items, names));
    if (mismatch) return { status: 400, message: mismatch };
  }

  const checkOut = check.checkOut ?? new Date(check.checkIn.getTime() + 24 * 60 * 60 * 1000);
  const conflicts = await findRoomConflicts({
    roomIds: ids,
    checkIn: check.checkIn,
    checkOut,
    excludeReservationId: check.reservationId ? String(check.reservationId) : undefined,
  });
  if (conflicts.length) {
    const first = conflicts[0];
    return { status: 400, message: await describeConflict(first, byId.get(first.roomId)?.name ?? first.roomId) };
  }
  return null;
}
