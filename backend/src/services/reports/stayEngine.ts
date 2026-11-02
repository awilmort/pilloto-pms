/**
 * Stay-night engine shared by the management reports (occupancy, manager's flash, forecast &
 * pace, segmentation, booking insights), so every report counts the same way:
 *
 *   - A room reservation holds `rooms` rooms on each night from check-in (inclusive) to
 *     check-out (exclusive): the larger of its assigned rooms and its booked rooms (room items ×
 *     quantity, else `roomCount`), at least one.
 *   - A night is sold when the stay is checked-in / completed, or pending / confirmed and the
 *     night is today or later (on the books). Earlier nights of a stay never checked in are
 *     no-shows, not sold.
 *   - Room revenue is the posted folio room charges when the stay has any (actuals), otherwise
 *     the booked room value (room items' subtotal, else the pricing snapshot, else the
 *     estimated total). It is spread evenly over the stay's nights.
 *   - Rooms available on a night = active rooms − active rooms out of service (RoomBlock) that
 *     night, as USALI defines it.
 *   - Source: an OTA (channel source), the booking engine, corporate, or the front desk.
 *
 * Dates are `YYYY-MM-DD` strings; stored reservation dates are noon UTC.
 */
import Reservation from '../../models/Reservation';
import Room from '../../models/Room';
import RoomBlock from '../../models/RoomBlock';
import Folio from '../../models/Folio';
import Charge from '../../models/Charge';
import { BOOKING_ENGINE_TOKEN_RE } from '../reservationRecords';
import { toDateStr, parseUTCDate, addDays, daysBetween, round2 } from '../../utils/dateUtils';

export interface Stay {
  id: string;
  code: string;
  status: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  /** Whole-stay room revenue (all rooms, all nights) */
  roomRevenue: number;
  revenueBasis: 'posted' | 'booked';
  source: string;
  sourceLabel: string;
  /** Room type per booked room (assigned rooms' types for stays without room items) */
  roomTypeIds: string[];
  ratePlanName: string | null;
  bookedOn: string;
  leadDays: number;
  guests: number;
  guestKey: string | null;
  /** OTA commission for the whole stay */
  commission: number;
  cancelled: boolean;
  /** Last update of a cancelled stay — the closest record of when it was cancelled */
  cancelledOn: string | null;
}

export interface Capacity {
  activeRooms: number;
  /** Rooms out of service per night */
  outOfOrder: Map<string, number>;
}

export interface NightRow {
  date: string;
  roomsAvailable: number;
  roomsOutOfOrder: number;
  roomsSold: number;
  occupancyPct: number;
  roomRevenue: number;
  adr: number;
  revpar: number;
}

const HOLDS_ROOM = ['pending', 'confirmed', 'checked-in', 'completed'];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function sourceOf(r: { channelSource?: any; isCorporate?: boolean; confirmationToken?: string }): { key: string; label: string } {
  if (r.channelSource) {
    const label = String(r.channelSource.otaName || r.channelSource.otaCode || 'OTA').trim();
    return { key: `ota:${label.toLowerCase()}`, label };
  }
  if (r.isCorporate) return { key: 'corporate', label: 'Corporate' };
  if (r.confirmationToken && BOOKING_ENGINE_TOKEN_RE.test(r.confirmationToken)) return { key: 'booking_engine', label: 'Booking engine' };
  return { key: 'front_desk', label: 'Front desk' };
}

/** Nights of a stay, `YYYY-MM-DD` */
export function stayNights(stay: Pick<Stay, 'checkIn' | 'nights'>): string[] {
  const start = parseUTCDate(stay.checkIn);
  return Array.from({ length: stay.nights }, (_, i) => toDateStr(addDays(start, i)));
}

/** Whether a night of a (non-cancelled) stay counts as sold */
export function nightSold(stay: Pick<Stay, 'status' | 'cancelled'>, night: string, today: string): boolean {
  if (stay.cancelled) return false;
  if (stay.status === 'checked-in' || stay.status === 'completed') return true;
  return (stay.status === 'pending' || stay.status === 'confirmed') && night >= today;
}

export const revenuePerNight = (stay: Pick<Stay, 'roomRevenue' | 'nights'>) => (stay.nights > 0 ? stay.roomRevenue / stay.nights : 0);

/** Sold rooms and room revenue of one stay inside [from, to] */
export function soldInRange(stay: Stay, from: string, to: string, today: string): { nights: number; roomNights: number; revenue: number } {
  let nights = 0;
  for (const night of stayNights(stay)) {
    if (night >= from && night <= to && nightSold(stay, night, today)) nights++;
  }
  return { nights, roomNights: nights * stay.rooms, revenue: nights * revenuePerNight(stay) };
}

export function rowFor(date: string, capacity: Capacity, roomsSold: number, revenue: number): NightRow {
  const roomsOutOfOrder = capacity.outOfOrder.get(date) ?? 0;
  const roomsAvailable = Math.max(0, capacity.activeRooms - roomsOutOfOrder);
  return {
    date,
    roomsAvailable,
    roomsOutOfOrder,
    roomsSold,
    occupancyPct: roomsAvailable > 0 ? round2((roomsSold / roomsAvailable) * 100) : 0,
    roomRevenue: round2(revenue),
    adr: roomsSold > 0 ? round2(revenue / roomsSold) : 0,
    revpar: roomsAvailable > 0 ? round2(revenue / roomsAvailable) : 0,
  };
}

/** Per-night occupancy / ADR / RevPAR for `days` */
export function nightlyRows(days: string[], stays: Stay[], capacity: Capacity, today: string, include: (stay: Stay, night: string) => boolean = (s, n) => nightSold(s, n, today)): NightRow[] {
  const sold = new Map<string, number>();
  const rev = new Map<string, number>();
  const wanted = new Set(days);
  for (const stay of stays) {
    const perNight = revenuePerNight(stay);
    for (const night of stayNights(stay)) {
      if (!wanted.has(night) || !include(stay, night)) continue;
      sold.set(night, (sold.get(night) ?? 0) + stay.rooms);
      rev.set(night, (rev.get(night) ?? 0) + perNight);
    }
  }
  return days.map((d) => rowFor(d, capacity, sold.get(d) ?? 0, rev.get(d) ?? 0));
}

export function totals(rows: NightRow[]) {
  const roomsAvailable = rows.reduce((s, r) => s + r.roomsAvailable, 0);
  const roomsSold = rows.reduce((s, r) => s + r.roomsSold, 0);
  const roomRevenue = rows.reduce((s, r) => s + r.roomRevenue, 0);
  return {
    roomsAvailable,
    roomsSold,
    roomRevenue: round2(roomRevenue),
    occupancyPct: roomsAvailable > 0 ? round2((roomsSold / roomsAvailable) * 100) : 0,
    adr: roomsSold > 0 ? round2(roomRevenue / roomsSold) : 0,
    revpar: roomsAvailable > 0 ? round2(roomRevenue / roomsAvailable) : 0,
  };
}

export function dateRange(from: string, to: string): string[] {
  const start = parseUTCDate(from);
  const n = daysBetween(start, parseUTCDate(to));
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => toDateStr(addDays(start, i)));
}

/** Same calendar date one year earlier (29 Feb → 28 Feb) */
export function sameDateLastYear(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Same weekday 52 weeks earlier — the industry's "same time last year" for stay dates */
export const sameWeekdayLastYear = (date: string) => toDateStr(addDays(parseUTCDate(date), -364));

/** Rooms a reservation document holds: its assigned rooms, the room type of each booked room
 *  unit, and the count held (the larger of assigned and booked, at least one) */
export function roomsHeld(d: { room?: unknown; rooms?: unknown[]; items?: any[]; roomCount?: number }): { assigned: string[]; unitTypes: string[]; rooms: number } {
  const assigned = [...new Set([d.room, ...(d.rooms ?? [])].filter(Boolean).map(String))];
  const unitTypes: string[] = (d.items ?? [])
    .filter((i: any) => i.kind === 'room')
    .flatMap((i: any) => Array.from({ length: Math.max(1, i.quantity || 1) }, () => (i.roomTypeId ? String(i.roomTypeId) : 'unknown')));
  return { assigned, unitTypes, rooms: Math.max(1, assigned.length, unitTypes.length, Number(d.roomCount) || 0) };
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/** Stays with a night inside [from, to] (or, with `checkInOnly`, checking in inside it) */
export async function loadStays(
  from: string,
  to: string,
  opts: { includeCancelled?: boolean; checkInOnly?: boolean } = {},
): Promise<Stay[]> {
  const fromStart = parseUTCDate(from);
  const toEnd = addDays(parseUTCDate(to), 1);
  const dateFilter = opts.checkInOnly
    ? { checkInDate: { $gte: fromStart, $lt: toEnd } }
    : { checkInDate: { $lt: toEnd }, checkOutDate: { $gt: fromStart } };
  const statuses = opts.includeCancelled ? [...HOLDS_ROOM, 'cancelled'] : HOLDS_ROOM;

  const docs: any[] = await Reservation.find({ type: 'room', status: { $in: statuses }, checkOutDate: { $exists: true }, ...dateFilter })
    .select('reservationCode status checkInDate checkOutDate room rooms roomCount items pricingSnapshot estimatedTotal channelSource isCorporate confirmationToken guests guestDetails guestRecord contactInfo createdAt updatedAt')
    .lean();
  if (docs.length === 0) return [];

  // Posted room charges (actuals)
  const folios: any[] = await Folio.find({ reservationId: { $in: docs.map((d) => d._id) } }).select('_id reservationId').lean();
  const folioRes = new Map(folios.map((f) => [String(f._id), String(f.reservationId)]));
  const posted = new Map<string, number>();
  if (folios.length) {
    const charges: any[] = await Charge.find({ folioId: { $in: folios.map((f) => f._id) }, category: 'room' }).select('folioId amount').lean();
    for (const c of charges) {
      const rid = folioRes.get(String(c.folioId));
      if (rid) posted.set(rid, (posted.get(rid) ?? 0) + Number(c.amount || 0));
    }
  }

  // Room types of assigned rooms, for stays without room items
  const assignedIds = [...new Set(docs.flatMap((d) => [d.room, ...(d.rooms ?? [])].filter(Boolean).map(String)))];
  const roomTypes = new Map<string, string>();
  if (assignedIds.length) {
    const rooms: any[] = await Room.find({ _id: { $in: assignedIds } }).select('roomTypeId').lean();
    for (const r of rooms) if (r.roomTypeId) roomTypes.set(String(r._id), String(r.roomTypeId));
  }

  return docs.map((d) => {
    const checkIn = toDateStr(new Date(d.checkInDate));
    const checkOut = toDateStr(new Date(d.checkOutDate));
    const nights = Math.max(1, daysBetween(parseUTCDate(checkIn), parseUTCDate(checkOut)));
    const { assigned, unitTypes, rooms } = roomsHeld(d);
    const roomItems = (d.items ?? []).filter((i: any) => i.kind === 'room');
    const roomTypeIds = unitTypes.length ? unitTypes : assigned.map((id) => roomTypes.get(id) ?? 'unknown');

    const postedRevenue = posted.get(String(d._id)) ?? 0;
    const itemsValue = roomItems.reduce((s: number, i: any) => s + Number(i.subtotal || 0), 0);
    const bookedValue = itemsValue || Number(d.pricingSnapshot?.adjustedSubtotal ?? 0) || Number(d.estimatedTotal ?? 0);
    const bookedOn = toDateStr(new Date(d.createdAt ?? d.checkInDate));
    const source = sourceOf(d);
    const guests = (d.guestDetails?.adults ?? 0) + (d.guestDetails?.children ?? 0) || Number(d.guests) || 0;

    return {
      id: String(d._id),
      code: d.reservationCode ?? '',
      status: d.status,
      checkIn,
      checkOut,
      nights,
      rooms,
      roomRevenue: round2(postedRevenue > 0 ? postedRevenue : bookedValue),
      revenueBasis: postedRevenue > 0 ? 'posted' : 'booked',
      source: source.key,
      sourceLabel: source.label,
      roomTypeIds: roomTypeIds.length ? roomTypeIds : ['unknown'],
      ratePlanName: d.pricingSnapshot?.ratePlanName || null,
      bookedOn,
      leadDays: Math.max(0, daysBetween(parseUTCDate(bookedOn), parseUTCDate(checkIn))),
      guests,
      guestKey: d.guestRecord ? String(d.guestRecord) : (d.contactInfo?.email ? String(d.contactInfo.email).toLowerCase().trim() : null),
      commission: Number(d.channelSource?.otaCommission ?? 0) || 0,
      cancelled: d.status === 'cancelled',
      cancelledOn: d.status === 'cancelled' ? toDateStr(new Date(d.updatedAt ?? d.createdAt)) : null,
    } as Stay;
  });
}

/** Active rooms and rooms out of service per night for [from, to] */
export async function loadCapacity(from: string, to: string): Promise<Capacity> {
  const active: any[] = await Room.find({ status: 'active' }).select('_id').lean();
  const activeIds = new Set(active.map((r) => String(r._id)));
  const blocks: any[] = await RoomBlock.find({
    startDate: { $lt: addDays(parseUTCDate(to), 1) },
    endDate: { $gt: parseUTCDate(from) },
  }).select('roomId startDate endDate').lean();

  const perNight = new Map<string, Set<string>>();
  for (const b of blocks) {
    const roomId = String(b.roomId);
    if (!activeIds.has(roomId)) continue;
    const start = toDateStr(new Date(b.startDate));
    const end = toDateStr(new Date(b.endDate));
    for (const night of dateRange(start > from ? start : from, toDateStr(addDays(parseUTCDate(end), -1)))) {
      if (night > to) break;
      if (!perNight.has(night)) perNight.set(night, new Set());
      perNight.get(night)!.add(roomId);
    }
  }
  return { activeRooms: activeIds.size, outOfOrder: new Map([...perNight].map(([d, s]) => [d, s.size])) };
}
