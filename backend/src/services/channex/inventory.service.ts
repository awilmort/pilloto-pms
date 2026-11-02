/**
 * InventoryService — rooms left per room type per night (CHANNEX_ARCHITECTURE.md §6.1).
 *
 * Pilloto-native: no Channex imports beyond the shared date helpers. Used by the booking
 * engine, the admin room pickers and (later) the ARI worker, so every channel sees the
 * same numbers.
 *
 * For room type T and night d:
 *   1. rooms(T)   = active rooms of type T
 *   2. free(T,d)  = rooms(T) − rooms blocked on d − rooms assigned to a blocking reservation occupying d
 *   3. demand(T,d)= unassigned room-type demand: a reservation's room items covering d, after
 *                   matching its assigned rooms to items of the SAME type first, then remaining
 *                   rooms to remaining items of any type (upgrades)
 *   4. available  = max(0, |free(T,d)| − demand(T,d))     (overbooked = the shortfall, never negative availability)
 *
 * Blocking reservations: type 'room', status pending | confirmed | checked-in. Completed and
 * cancelled never block, so an early checkout frees the remaining nights. Assigned rooms
 * occupy their room on the reservation's nights; room items use their own dates when set.
 * Reservations with neither assigned rooms nor room items cannot be attributed to a room type
 * (see scripts/audit-room-reservations.ts).
 *
 * The DB entry points run three set-based queries (rooms, blocks, reservations) per window
 * and compute in memory; `computeInventory` is the pure core.
 */

import mongoose from 'mongoose';
import Room from '../../models/Room';
import RoomType from '../../models/RoomType';
import RoomBlock from '../../models/RoomBlock';
import Reservation from '../../models/Reservation';
import { ChannexDate, DateRange, addDays, eachDate, eachNight, fromChannexDate } from './dates';

export const BLOCKING_RESERVATION_STATUSES = ['pending', 'confirmed', 'checked-in'] as const;

type Id = mongoose.Types.ObjectId | string;

export interface InventoryRoom {
  _id: Id;
  roomTypeId?: Id | null;
  status: 'active' | 'inactive' | string;
}

export interface InventoryBlock {
  _id?: Id;
  roomId: Id;
  startDate: Date;
  endDate: Date;
}

export interface InventoryReservationItem {
  kind: 'room' | 'service' | string;
  roomTypeId?: Id | null;
  checkIn?: Date | null;
  checkOut?: Date | null;
  quantity?: number;
}

export interface InventoryReservation {
  _id: Id;
  status: string;
  checkInDate: Date;
  checkOutDate?: Date | null;
  room?: Id | null;
  rooms?: Id[] | null;
  items?: InventoryReservationItem[] | null;
}

export interface InventoryCell {
  /** Active rooms of the type */
  total: number;
  /** Rooms out of service (RoomBlock) that night */
  blocked: number;
  /** Rooms assigned to a reservation that night (not counting blocked ones) */
  assigned: number;
  /** Room-type bookings without a room of their own */
  unassignedDemand: number;
  available: number;
  /** Demand that exceeds free rooms (0 when not overbooked) */
  overbooked: number;
}

/** roomTypeId → date → cell */
export type InventoryGrid = Record<string, Record<ChannexDate, InventoryCell>>;
/** roomTypeId → date → rooms left */
export type AvailabilityGrid = Record<string, Record<ChannexDate, number>>;

const str = (id: Id | null | undefined): string | null => (id === null || id === undefined ? null : String(id));

/** Unique assigned room ids of a reservation (`room` ∪ `rooms`). */
export function assignedRoomIds(r: Pick<InventoryReservation, 'room' | 'rooms'>): string[] {
  const ids = new Set<string>();
  if (r.room) ids.add(String(r.room));
  for (const id of r.rooms ?? []) if (id) ids.add(String(id));
  return [...ids];
}

/** Nights of a reservation (a missing check-out counts as one night). */
function reservationNights(r: InventoryReservation): ChannexDate[] {
  const checkOut = r.checkOutDate ?? new Date(r.checkInDate.getTime() + 24 * 60 * 60 * 1000);
  return eachNight(r.checkInDate, checkOut);
}

/** One entry per booked room unit: `{ typeId, nights }`. */
function roomUnits(r: InventoryReservation): { typeId: string | null; nights: Set<ChannexDate> }[] {
  const units: { typeId: string | null; nights: Set<ChannexDate> }[] = [];
  const resNights = reservationNights(r);
  for (const item of r.items ?? []) {
    if (item.kind !== 'room') continue;
    const nights = item.checkIn && item.checkOut ? eachNight(item.checkIn, item.checkOut) : resNights;
    const qty = Math.max(1, Math.floor(item.quantity ?? 1));
    for (let i = 0; i < qty; i++) units.push({ typeId: str(item.roomTypeId), nights: new Set(nights) });
  }
  return units;
}

/**
 * Match assigned rooms to the room units covering one night: same type first, then any type.
 * Returns the type ids of units left without a room. Leftover rooms cover unmapped (untyped)
 * units before typed ones, so typed demand stays counted: when ambiguous, under-sell rather
 * than overbook.
 */
export function unmatchedUnitTypes(unitTypes: (string | null)[], assignedRoomTypes: (string | null)[]): (string | null)[] {
  const rooms = [...assignedRoomTypes];
  const pending: (string | null)[] = [];
  for (const t of unitTypes) {
    const i = t === null ? -1 : rooms.indexOf(t);
    if (i >= 0) rooms.splice(i, 1);
    else pending.push(t);
  }
  pending.sort((a, b) => (a === null ? 0 : 1) - (b === null ? 0 : 1));
  return pending.slice(Math.min(rooms.length, pending.length));
}

export interface ComputeInventoryInput {
  /** Every room of the tenant (inactive ones too: they still match items they are assigned to) */
  rooms: InventoryRoom[];
  blocks: InventoryBlock[];
  /** Blocking reservations overlapping the window */
  reservations: InventoryReservation[];
  dateFrom: ChannexDate;
  dateTo: ChannexDate;
  /** Room types to report (default: every type that has rooms or demand) */
  roomTypeIds?: Id[];
}

/** Pure core of InventoryService. */
export function computeInventory(input: ComputeInventoryInput): InventoryGrid {
  const { rooms, blocks, reservations, dateFrom, dateTo } = input;
  const dates = eachDate(dateFrom, dateTo);
  const inWindow = (d: ChannexDate) => d >= dateFrom && d <= dateTo;

  const roomType = new Map<string, string | null>();
  const activeByType = new Map<string, Set<string>>();
  for (const room of rooms) {
    const id = String(room._id);
    const typeId = str(room.roomTypeId);
    roomType.set(id, typeId);
    if (room.status === 'active' && typeId) {
      if (!activeByType.has(typeId)) activeByType.set(typeId, new Set());
      activeByType.get(typeId)!.add(id);
    }
  }

  // date → set of occupied room ids, split by cause
  const blockedOn = new Map<ChannexDate, Set<string>>();
  const assignedOn = new Map<ChannexDate, Set<string>>();
  const demand = new Map<string, Map<ChannexDate, number>>();
  const add = (m: Map<ChannexDate, Set<string>>, d: ChannexDate, id: string) => {
    if (!m.has(d)) m.set(d, new Set());
    m.get(d)!.add(id);
  };

  for (const b of blocks) {
    for (const d of eachNight(b.startDate, b.endDate)) if (inWindow(d)) add(blockedOn, d, String(b.roomId));
  }

  for (const r of reservations) {
    if (!(BLOCKING_RESERVATION_STATUSES as readonly string[]).includes(r.status)) continue;
    const assigned = assignedRoomIds(r);
    const resNights = new Set(reservationNights(r));
    for (const d of resNights) if (inWindow(d)) for (const id of assigned) add(assignedOn, d, id);

    const units = roomUnits(r);
    if (units.length === 0) continue;
    const nights = new Set<ChannexDate>(resNights);
    for (const u of units) for (const d of u.nights) nights.add(d);
    for (const d of nights) {
      if (!inWindow(d)) continue;
      const unitTypes = units.filter((u) => u.nights.has(d)).map((u) => u.typeId);
      const roomsThatNight = resNights.has(d) ? assigned.map((id) => roomType.get(id) ?? null) : [];
      for (const t of unmatchedUnitTypes(unitTypes, roomsThatNight)) {
        if (!t) continue; // unmapped item: consumes no typed inventory
        if (!demand.has(t)) demand.set(t, new Map());
        demand.get(t)!.set(d, (demand.get(t)!.get(d) ?? 0) + 1);
      }
    }
  }

  const typeIds = input.roomTypeIds
    ? input.roomTypeIds.map(String)
    : [...new Set([...activeByType.keys(), ...demand.keys()])];

  const grid: InventoryGrid = {};
  for (const t of typeIds) {
    const active = activeByType.get(t) ?? new Set<string>();
    grid[t] = {};
    for (const d of dates) {
      let blocked = 0;
      let assigned = 0;
      for (const id of active) {
        if (blockedOn.get(d)?.has(id)) blocked++;
        else if (assignedOn.get(d)?.has(id)) assigned++;
      }
      const free = active.size - blocked - assigned;
      const need = demand.get(t)?.get(d) ?? 0;
      grid[t][d] = {
        total: active.size,
        blocked,
        assigned,
        unassignedDemand: need,
        available: Math.max(0, free - need),
        overbooked: Math.max(0, need - free),
      };
    }
  }
  return grid;
}

export function toAvailabilityGrid(grid: InventoryGrid): AvailabilityGrid {
  const out: AvailabilityGrid = {};
  for (const [t, byDate] of Object.entries(grid)) {
    out[t] = {};
    for (const [d, cell] of Object.entries(byDate)) out[t][d] = cell.available;
  }
  return out;
}

/** Fewest rooms left for a type over the given nights (0 when the type is unknown). */
export function minAvailable(grid: InventoryGrid, roomTypeId: Id, nights: ChannexDate[]): number {
  const byDate = grid[String(roomTypeId)];
  if (!byDate || nights.length === 0) return 0;
  return Math.min(...nights.map((d) => byDate[d]?.available ?? 0));
}

// ─── DB access ───────────────────────────────────────────────────────────────

const utcMidnight = (d: ChannexDate) => {
  const noon = fromChannexDate(d);
  return new Date(noon.getTime() - 12 * 60 * 60 * 1000);
};

export interface WindowData {
  rooms: InventoryRoom[];
  blocks: InventoryBlock[];
  reservations: InventoryReservation[];
}

/**
 * Rooms, blocks and blocking reservations touching [dateFrom, dateTo] (inclusive nights),
 * in the current tenant context. `excludeReservationIds` leaves reservations out
 * (e.g. the one being edited).
 */
export async function loadInventoryWindow(range: DateRange, excludeReservationIds: Id[] = []): Promise<WindowData> {
  const windowStart = utcMidnight(range.dateFrom);
  const windowEnd = utcMidnight(addDays(range.dateTo, 1));
  const firstCheckout = utcMidnight(addDays(range.dateFrom, 1));
  const exclude = excludeReservationIds.map((id) => new mongoose.Types.ObjectId(String(id)));

  const [rooms, blocks, reservations] = await Promise.all([
    Room.find({}).select('_id roomTypeId status').lean(),
    RoomBlock.find({ startDate: { $lt: windowEnd }, endDate: { $gte: firstCheckout } })
      .select('_id roomId startDate endDate').lean(),
    Reservation.find({
      type: 'room',
      status: { $in: [...BLOCKING_RESERVATION_STATUSES] },
      checkInDate: { $lt: windowEnd },
      $or: [
        { checkOutDate: { $gte: firstCheckout } },
        { checkOutDate: null, checkInDate: { $gte: windowStart } },
      ],
      ...(exclude.length ? { _id: { $nin: exclude } } : {}),
    }).select('_id status checkInDate checkOutDate room rooms items.kind items.roomTypeId items.checkIn items.checkOut items.quantity').lean(),
  ]);

  return {
    rooms: rooms as unknown as InventoryRoom[],
    blocks: blocks as unknown as InventoryBlock[],
    reservations: reservations as unknown as InventoryReservation[],
  };
}

export interface InventoryQuery extends DateRange {
  roomTypeIds?: Id[];
  excludeReservationIds?: Id[];
}

/** Full breakdown per room type and night (for "why?" explanations and overbooking checks). */
export async function getInventory(q: InventoryQuery): Promise<InventoryGrid> {
  const data = await loadInventoryWindow(q, q.excludeReservationIds);
  let roomTypeIds = q.roomTypeIds;
  if (!roomTypeIds) {
    const types = await RoomType.find({}).select('_id').lean();
    roomTypeIds = [...new Set([
      ...types.map((t) => String(t._id)),
      ...data.rooms.map((r) => str(r.roomTypeId)).filter((t): t is string => !!t),
    ])];
  }
  return computeInventory({ ...data, dateFrom: q.dateFrom, dateTo: q.dateTo, roomTypeIds });
}

/** `availability(tenant, roomTypeIds?, dateFrom, dateTo)` of architecture §6.1. */
export async function getAvailability(q: InventoryQuery): Promise<AvailabilityGrid> {
  return toAvailabilityGrid(await getInventory(q));
}

// ─── Physical rooms: free-room lookup and conflicts ──────────────────────────

export interface RoomConflict {
  roomId: string;
  kind: 'reservation' | 'block';
  /** Reservation or RoomBlock id */
  id: string;
  /** First and last conflicting night */
  dateFrom: ChannexDate;
  dateTo: ChannexDate;
}

/** Nights each room is taken (by a block or an assigned blocking reservation) within `nights`. */
function conflictsFor(data: WindowData, nights: Set<ChannexDate>, roomIds?: Set<string>): RoomConflict[] {
  const out: RoomConflict[] = [];
  const collect = (roomId: string, kind: RoomConflict['kind'], id: string, taken: ChannexDate[]) => {
    const hit = taken.filter((d) => nights.has(d));
    if (hit.length && (!roomIds || roomIds.has(roomId))) {
      out.push({ roomId, kind, id, dateFrom: hit[0], dateTo: hit[hit.length - 1] });
    }
  };
  for (const b of data.blocks) collect(String(b.roomId), 'block', String(b._id), eachNight(b.startDate, b.endDate));
  for (const r of data.reservations) {
    const taken = reservationNights(r);
    for (const roomId of assignedRoomIds(r)) collect(roomId, 'reservation', String(r._id), taken);
  }
  return out;
}

export interface StayQuery {
  checkIn: Date;
  checkOut: Date;
  excludeReservationId?: Id;
}

/** Why each of `roomIds` cannot be used for the stay (empty when all are free). */
export async function findRoomConflicts(q: StayQuery & { roomIds: Id[] }): Promise<RoomConflict[]> {
  const nights = eachNight(q.checkIn, q.checkOut);
  if (nights.length === 0 || q.roomIds.length === 0) return [];
  const data = await loadInventoryWindow(
    { dateFrom: nights[0], dateTo: nights[nights.length - 1] },
    q.excludeReservationId ? [q.excludeReservationId] : [],
  );
  return conflictsFor(data, new Set(nights), new Set(q.roomIds.map(String)));
}

export interface FreeRoomsResult {
  /** Active rooms not blocked and not assigned to another blocking reservation for every night */
  freeRoomIds: string[];
  /** Fewest rooms left per room type over the stay, after unassigned demand */
  typeAvailability: Record<string, number>;
  nights: ChannexDate[];
}

/**
 * Rooms that can take the stay. A room is offered only if it is physically free AND its
 * room type still has availability once unassigned room-type bookings are counted
 * (otherwise assigning it would take a room another booking is counting on).
 */
export async function findFreeRooms(q: StayQuery & { roomTypeId?: Id }): Promise<FreeRoomsResult> {
  const nights = eachNight(q.checkIn, q.checkOut);
  if (nights.length === 0) return { freeRoomIds: [], typeAvailability: {}, nights };
  const range = { dateFrom: nights[0], dateTo: nights[nights.length - 1] };
  const data = await loadInventoryWindow(range, q.excludeReservationId ? [q.excludeReservationId] : []);
  const grid = computeInventory({ ...data, ...range });

  const typeAvailability: Record<string, number> = {};
  for (const t of Object.keys(grid)) typeAvailability[t] = minAvailable(grid, t, nights);

  const taken = new Set(conflictsFor(data, new Set(nights)).map((c) => c.roomId));
  const freeRoomIds = data.rooms
    .filter((r) => r.status === 'active' && !taken.has(String(r._id)))
    .filter((r) => !q.roomTypeId || str(r.roomTypeId) === String(q.roomTypeId))
    .filter((r) => {
      const t = str(r.roomTypeId);
      return !t || (typeAvailability[t] ?? 0) > 0;
    })
    .map((r) => String(r._id));

  return { freeRoomIds, typeAvailability, nights };
}

/** Calendar dates `YYYY-MM-DD` → the night range used by the queries above. */
export function stayFromDates(checkIn: ChannexDate, checkOut: ChannexDate): StayQuery {
  return { checkIn: fromChannexDate(checkIn), checkOut: fromChannexDate(checkOut) };
}

// ─── "Why?" — one room type on one night ─────────────────────────────────────

export interface NightExplanation {
  /** Active rooms of the type and what holds each one that night */
  rooms: { roomId: string; state: 'free' | 'blocked' | 'assigned'; blockId?: string; reservationId?: string }[];
  /** Bookings of the type without a room of their own that night (count = booked rooms) */
  unassigned: { reservationId: string; count: number }[];
}

/**
 * The parts behind one InventoryService cell, with the same rules as computeInventory: a
 * block wins over an assignment, and assigned rooms cover booked rooms of their own type
 * first. `data` must cover the night.
 */
export function explainNight(data: WindowData, roomTypeId: Id, date: ChannexDate): NightExplanation {
  const typeId = String(roomTypeId);
  const roomType = new Map(data.rooms.map((r) => [String(r._id), str(r.roomTypeId)]));
  const blocking = data.reservations.filter((r) => (BLOCKING_RESERVATION_STATUSES as readonly string[]).includes(r.status));

  const rooms = data.rooms
    .filter((r) => r.status === 'active' && str(r.roomTypeId) === typeId)
    .map((r) => {
      const roomId = String(r._id);
      const block = data.blocks.find((b) => String(b.roomId) === roomId && eachNight(b.startDate, b.endDate).includes(date));
      if (block) return { roomId, state: 'blocked' as const, blockId: str(block._id) ?? undefined };
      const res = blocking.find((x) => assignedRoomIds(x).includes(roomId) && reservationNights(x).includes(date));
      if (res) return { roomId, state: 'assigned' as const, reservationId: String(res._id) };
      return { roomId, state: 'free' as const };
    });

  const unassigned: NightExplanation['unassigned'] = [];
  for (const r of blocking) {
    const unitTypes = roomUnits(r).filter((u) => u.nights.has(date)).map((u) => u.typeId);
    if (unitTypes.length === 0) continue;
    const roomsThatNight = reservationNights(r).includes(date) ? assignedRoomIds(r).map((id) => roomType.get(id) ?? null) : [];
    const count = unmatchedUnitTypes(unitTypes, roomsThatNight).filter((t) => t === typeId).length;
    if (count) unassigned.push({ reservationId: String(r._id), count });
  }
  return { rooms, unassigned };
}
