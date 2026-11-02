/**
 * Booking calendar helpers: which rooms a reservation holds, which of its booked rooms
 * still need a room (the Unassigned lane), lane packing for overlapping bars, nightly
 * occupancy, and the conflict preview for drag and drop moves.
 */
import { Reservation, Room, RoomBlock } from '../types';

/** Assigned room ids of a reservation (`room` ∪ `rooms`, populated or not). */
export const getRoomIds = (res: Reservation): string[] => {
  const ids = new Set<string>();
  if (res.room) ids.add(typeof res.room === 'object' ? (res.room as Room)._id : String(res.room));
  for (const r of res.rooms ?? []) ids.add(typeof r === 'object' ? r._id : String(r));
  return [...ids];
};

export const roomTypeIdOf = (room?: Room): string | null => {
  const rt = room?.roomTypeId as any;
  if (!rt) return null;
  return typeof rt === 'object' ? String(rt._id) : String(rt);
};

export interface UnassignedEntry {
  res: Reservation;
  /** Booked rooms still without a room */
  missing: number;
  /** Room types of those booked rooms (null = unknown, e.g. an unmapped OTA room) */
  typeIds: (string | null)[];
}

/**
 * Booked rooms of a reservation that have no room yet. Assigned rooms cover booked rooms of
 * their own type first, then any other (upgrade) — the same matching the backend uses.
 * Reservations without room items count as one room when nothing is assigned.
 */
export function unassignedEntry(res: Reservation, roomsById: Record<string, Room>): UnassignedEntry | null {
  const assigned = getRoomIds(res);
  const units: (string | null)[] = (res.items ?? [])
    .filter(i => i.kind === 'room')
    .flatMap(i => Array.from({ length: Math.max(1, i.quantity || 1) }, () => (i.roomTypeId ? String(i.roomTypeId) : null)));
  if (units.length === 0) return assigned.length === 0 ? { res, missing: 1, typeIds: [] } : null;
  const left = [...units];
  let upgrades = 0;
  for (const id of assigned) {
    const t = roomTypeIdOf(roomsById[id]);
    const i = t ? left.indexOf(t) : -1;
    if (i >= 0) left.splice(i, 1);
    else upgrades++;
  }
  const remaining = left.slice(Math.min(upgrades, left.length));
  return remaining.length ? { res, missing: remaining.length, typeIds: remaining } : null;
}

/** Place items on the first lane where they don't overlap (end exclusive), in start order. */
export function packLanes<T>(items: T[], span: (item: T) => { start: number; end: number }): { placed: { item: T; lane: number }[]; lanes: number } {
  const sorted = [...items].sort((a, b) => span(a).start - span(b).start);
  const laneEnds: number[] = [];
  const placed = sorted.map(item => {
    const { start, end } = span(item);
    let lane = laneEnds.findIndex(e => e <= start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(end); } else laneEnds[lane] = end;
    return { item, lane };
  });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}

/** `YYYY-MM-DD` of a stored (noon UTC) reservation date or a block date */
export const isoDay = (value?: string) => (value ? value.slice(0, 10) : '');

/** Rooms a reservation holds each night: its assigned rooms plus booked rooms still waiting for one. */
export const roomsHeld = (res: Reservation, roomsById: Record<string, Room>): number =>
  getRoomIds(res).length + (unassignedEntry(res, roomsById)?.missing ?? 0);

/**
 * Occupancy per night (`YYYY-MM-DD`): rooms held by the given (non-cancelled) stays over rooms
 * available — active rooms minus those out of service that night, as the occupancy reports count.
 */
export function occupancyByDay(
  days: string[],
  reservations: Reservation[],
  roomsById: Record<string, Room>,
  activeRoomIds: string[],
  blocks: RoomBlock[] = [],
): { sold: number; available: number; pct: number }[] {
  const active = new Set(activeRoomIds);
  const sold = days.map(() => 0);
  for (const res of reservations) {
    if (res.type !== 'room' || res.status === 'cancelled') continue;
    const ci = isoDay(res.checkInDate);
    const co = isoDay(res.checkOutDate);
    const held = roomsHeld(res, roomsById);
    days.forEach((d, i) => { if (ci <= d && d < co) sold[i] += held; });
  }
  return sold.map((n, i) => {
    const blocked = new Set(blocks
      .filter(b => isoDay(b.startDate) <= days[i] && days[i] < isoDay(b.endDate))
      .map(b => (typeof b.roomId === 'object' ? b.roomId._id : b.roomId))
      .filter(id => active.has(id)));
    const available = active.size - blocked.size;
    return { sold: n, available, pct: available > 0 ? Math.round((n / available) * 100) : 0 };
  });
}

/** Stays that hold their rooms (the backend's inventory rule) */
const HOLDS_ROOM = ['pending', 'confirmed', 'checked-in'];

/**
 * Client-side preview of a calendar move onto a room: the first stay or room block already
 * on that room for any of the new nights (`checkIn` inclusive, `checkOut` exclusive).
 * Only what is loaded is checked — the server validates the move in full.
 */
export function moveConflict(
  res: Reservation,
  roomId: string,
  checkIn: string,
  checkOut: string,
  roomReservations: Reservation[],
  roomBlocks: RoomBlock[],
): { kind: 'reservation'; other: Reservation } | { kind: 'block'; block: RoomBlock } | null {
  for (const other of roomReservations) {
    if (other._id === res._id || !HOLDS_ROOM.includes(other.status)) continue;
    const oCi = isoDay(other.checkInDate);
    const oCo = isoDay(other.checkOutDate) || oCi;
    if (oCi < checkOut && checkIn < oCo) return { kind: 'reservation', other };
  }
  for (const block of roomBlocks) {
    const id = typeof block.roomId === 'object' ? block.roomId._id : block.roomId;
    if (id !== roomId) continue;
    if (isoDay(block.startDate) < checkOut && checkIn < isoDay(block.endDate)) return { kind: 'block', block };
  }
  return null;
}
