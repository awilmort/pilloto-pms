/**
 * Booking revision → Reservation (CHANNEX_ARCHITECTURE.md §7.4–7.5; plan Phase 7.3).
 *
 * `applyBookingRevision` is the booking inbox's apply step (bookingInbox.ts) and runs inside
 * the tenant scope. One Channex booking is one Pilloto reservation, found again by
 * `channelSource.channexBookingId`, with one room item per booked room.
 *
 *   new / modified, unknown booking → create (OTA bookings are never rejected):
 *       rooms auto-assigned when `channelManager.autoAssignRooms` and a room of the booked type
 *       is free for every night; an unmapped room or rate leaves the item without a type (no
 *       typed inventory) + `unmapped_booking` alert; demand above free rooms → still created,
 *       `overbooking` alert with the nights and competing reservations.
 *   modified, pending/confirmed → replace guest, occupancy, items, dates, totals and notes;
 *       assigned rooms still free on every new night and still of a booked type are kept, the
 *       rest are released and auto-assignment runs again.
 *   modified, checked-in/completed → non-stay fields only (guest, notes, commission, payment);
 *       stay differences raise `modification_needs_review` for staff.
 *   cancelled → status cancelled with the OTA in the reason; after check-in it is not
 *       cancelled but raises `modification_needs_review`; for an unknown booking nothing is
 *       created. Folio charges and payments are left to staff.
 *
 * Every write goes through Reservation documents, so the change-capture plugin queues the
 * availability push for old and new nights. No MongoDB transaction: the outbox rows are
 * written by that plugin outside any session. Re-applying is safe instead — a reservation
 * whose `channelSource.lastRevisionId` is this revision was already updated by it, and
 * folio, guest, company and alert writes are upserts.
 *
 * Guest emails: a real `customer.mail` links/creates the Guest record; otherwise a
 * placeholder `ota-<unique id>@noreply.pilloto.com` is stored and no Guest record is made.
 * Pilloto's confirmation email is sent only when `channelManager.sendGuestConfirmationEmail`.
 *
 * Alerts go through alerts.service.ts; the stored English titles never
 * name Channex (architecture §18).
 */

import mongoose from 'mongoose';
import AppSettings from '../../models/AppSettings';
import { ChannelAlertSeverity, ChannelAlertType } from '../../models/ChannelAlert';
import { raiseAlert as raise } from './alerts.service';
import ChannexEntityMap from '../../models/ChannexEntityMap';
import Guest from '../../models/Guest';
import RatePlan from '../../models/RatePlan';
import Reservation, { IReservation, IReservationItem } from '../../models/Reservation';
import Room from '../../models/Room';
import RoomType from '../../models/RoomType';
import Tenant from '../../models/Tenant';
import { getTenantId } from '../../middleware/tenantContext';
import { sendReservationConfirmationEmail } from '../../utils/email';
import { ensureFolio, generateReservationCode, RESERVATION_EMAIL_RE } from '../reservationRecords';
import { IChannexBookingRevision } from '../../models/ChannexBookingRevision';
import { getChannexConfig } from './config';
import { ChannexDate, diffDays, eachNight, fromChannexDate, isChannexDate, toChannexDate } from './dates';
import { explainNight, findFreeRooms, getInventory, loadInventoryWindow } from './inventory.service';
import { ensureOtaCompany, otaDisplayName } from './otaSettlement';
import type { ApplyResult } from './bookingInbox';
import { channelActor, diffSnapshots, recordReservationEvent, snapshotReservation } from '../reservationHistory';

type Id = mongoose.Types.ObjectId;

// ─── Pure mapping ────────────────────────────────────────────────────────────

/** "200.00" | 200 → 200 (2 decimals); anything else → 0. */
export function money(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

/** `ota-<unique id>@noreply.pilloto.com`, valid for the reservation email format. */
export function placeholderEmail(uniqueId: string | undefined, bookingId: string): string {
  const local = (uniqueId || bookingId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'booking';
  return `ota-${local}@noreply.pilloto.com`;
}

export interface EntityLookup {
  /** Channex room type id → Pilloto RoomType id */
  roomTypes: Map<string, string>;
  /** Channex rate plan id → Pilloto RatePlan id */
  ratePlans: Map<string, string>;
  roomTypeNames: Map<string, string>;
  ratePlanNames: Map<string, string>;
}

export interface MappedRoom {
  channexRoomTypeId?: string;
  channexRatePlanId?: string;
  roomTypeMapped: boolean;
  ratePlanMapped: boolean;
  item: IReservationItem;
}

export interface MappedBooking {
  status: 'new' | 'modified' | 'cancelled';
  guestName: { firstName: string; lastName: string };
  email: string;
  emailIsReal: boolean;
  phone?: string;
  country?: string;
  guestDetails: { adults: number; children: number; infants: number };
  guests: number;
  rooms: MappedRoom[];
  checkInDate: Date;
  checkOutDate: Date;
  estimatedTotal: number;
  pricingSnapshot: NonNullable<IReservation['pricingSnapshot']>;
  specialRequests: string;
  currency?: string;
  channelSource: NonNullable<IReservation['channelSource']>;
}

function guaranteeSummary(g: any): NonNullable<IReservation['channelSource']>['guaranteeSummary'] | undefined {
  if (!g || typeof g !== 'object') return undefined;
  const meta = g.meta && typeof g.meta === 'object' ? g.meta : {};
  const places = Number(meta.virtual_card_decimal_places);
  const rawBalance = Number(meta.virtual_card_current_balance);
  const out = {
    cardType: str(g.card_type, 40),
    last4: typeof g.last4 === 'string' && /^\d{4}$/.test(g.last4) ? g.last4 : undefined,
    expirationDate: str(g.expiration_date, 10),
    isVirtual: typeof g.is_virtual === 'boolean' ? g.is_virtual : undefined,
    virtualCardCurrency: str(meta.virtual_card_currency_code, 3),
    virtualCardBalance: Number.isFinite(rawBalance)
      ? (Number.isFinite(places) && places > 0 ? rawBalance / 10 ** places : rawBalance)
      : undefined,
    virtualCardActivationDate: str(meta.virtual_card_effective_date, 10),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

/** Map a (card-scrubbed) revision payload. Throws when it has no usable stay. */
export function mapRevisionPayload(
  p: any,
  lookup: EntityLookup,
  revision: { revisionId: string; bookingId: string; insertedAt?: Date; propertyId?: string },
): MappedBooking {
  const status = (['new', 'modified', 'cancelled'] as const).find((s) => s === p?.status) ?? 'new';
  const rawRooms: any[] = Array.isArray(p?.rooms) ? p.rooms : [];
  const uniqueId = str(p?.unique_id, 120);
  const otaName = otaDisplayName(str(p?.ota_name, 80));

  const rooms: MappedRoom[] = [];
  for (const r of rawRooms) {
    const checkIn = isChannexDate(r?.checkin_date) ? r.checkin_date : p?.arrival_date;
    const checkOut = isChannexDate(r?.checkout_date) ? r.checkout_date : p?.departure_date;
    if (!isChannexDate(checkIn) || !isChannexDate(checkOut) || checkOut <= checkIn) continue;
    const nights = diffDays(checkIn, checkOut);
    const channexRoomTypeId = str(r?.room_type_id, 64);
    const channexRatePlanId = str(r?.rate_plan_id, 64);
    const roomTypeId = channexRoomTypeId ? lookup.roomTypes.get(channexRoomTypeId) : undefined;
    const ratePlanId = channexRatePlanId ? lookup.ratePlans.get(channexRatePlanId) : undefined;
    const dayPrices = r?.days && typeof r.days === 'object' ? Object.values(r.days).map(money) : [];
    const amount = money(r?.amount) || dayPrices.reduce((a, b) => a + b, 0);
    const taxes = (Array.isArray(r?.taxes) ? r.taxes : []).map((t: any) => ({
      name: str(t?.name, 100) ?? 'Tax',
      type: str(t?.type, 20) ?? 'tax',
      amount: money(t?.total_price),
      isInclusive: t?.is_inclusive === true,
    }));
    // `total` is what the OTA charged for the room; inclusive taxes are part of it
    const inclusiveTaxes = Math.round(taxes.filter((t: any) => t.isInclusive).reduce((a: number, t: any) => a + t.amount, 0) * 100) / 100;
    const occ = r?.occupancy ?? {};
    rooms.push({
      channexRoomTypeId,
      channexRatePlanId,
      roomTypeMapped: Boolean(roomTypeId),
      ratePlanMapped: Boolean(ratePlanId),
      item: {
        kind: 'room',
        roomTypeId: roomTypeId ? new mongoose.Types.ObjectId(roomTypeId) : undefined,
        ratePlanId: ratePlanId ? new mongoose.Types.ObjectId(ratePlanId) : undefined,
        checkIn: fromChannexDate(checkIn),
        checkOut: fromChannexDate(checkOut),
        adults: int(occ.adults),
        children: int(occ.children),
        quantity: 1,
        unitPrice: Math.round((amount / nights) * 100) / 100,
        subtotal: Math.max(0, Math.round((amount - inclusiveTaxes) * 100) / 100),
        taxes,
        totalTaxes: inclusiveTaxes,
        total: amount,
      },
    });
  }
  if (rooms.length === 0) throw new Error('The booking revision has no room with valid dates.');

  const checkIns = rooms.map((r) => toChannexDate(r.item.checkIn!)).sort();
  const checkOuts = rooms.map((r) => toChannexDate(r.item.checkOut!)).sort();
  const checkIn = checkIns[0];
  const checkOut = checkOuts[checkOuts.length - 1];

  const occ = rawRooms.reduce((a, r) => ({
    adults: a.adults + int(r?.occupancy?.adults),
    children: a.children + int(r?.occupancy?.children),
    infants: a.infants + int(r?.occupancy?.infants),
  }), { adults: 0, children: 0, infants: 0 });
  const guestDetails = { adults: Math.max(1, occ.adults), children: occ.children, infants: occ.infants };

  const customer = p?.customer ?? {};
  const firstGuest = rawRooms.flatMap((r) => (Array.isArray(r?.guests) ? r.guests : []))[0] ?? {};
  let firstName = str(customer.name, 80) ?? str(firstGuest.name, 80);
  let lastName = str(customer.surname, 80) ?? str(firstGuest.surname, 80);
  if (!firstName && !lastName) { firstName = otaName; lastName = 'Guest'; }

  const mail = str(customer.mail, 200)?.toLowerCase();
  const emailIsReal = Boolean(mail && RESERVATION_EMAIL_RE.test(mail));

  const roomsTotal = rooms.reduce((a, r) => a + r.item.total, 0);
  const estimatedTotal = money(p?.amount) || Math.round(roomsTotal * 100) / 100;
  const nights = diffDays(checkIn, checkOut);
  const ratePlanNames = [...new Set(rooms.map((r) => (r.item.ratePlanId ? lookup.ratePlanNames.get(String(r.item.ratePlanId)) : undefined) ?? `${otaName} rate`))];
  const roomTypeNames = [...new Set(rooms.map((r) => (r.item.roomTypeId ? lookup.roomTypeNames.get(String(r.item.roomTypeId)) : undefined) ?? 'Unmapped room'))];
  const subtotal = Math.round(rooms.reduce((a, r) => a + r.item.subtotal, 0) * 100) / 100;
  const totalTaxes = Math.round(rooms.reduce((a, r) => a + r.item.totalTaxes, 0) * 100) / 100;

  const notes: string[] = [];
  if (str(p?.notes, 1000)) notes.push(str(p.notes, 1000)!);
  if (str(p?.arrival_hour, 10)) notes.push(`Hora de llegada: ${str(p.arrival_hour, 10)}`);
  const services = (Array.isArray(p?.services) ? p.services : [])
    .map((s: any) => [str(s?.name, 80) ?? str(s?.type, 80), money(s?.total_price) ? money(s.total_price).toFixed(2) : undefined].filter(Boolean).join(' '))
    .filter(Boolean);
  if (services.length) notes.push(`Extras: ${services.join(', ')}`);

  const commission = p?.ota_commission === null || p?.ota_commission === undefined ? undefined : money(p.ota_commission);
  const insertedAt = revision.insertedAt ?? (p?.inserted_at ? new Date(p.inserted_at) : undefined);

  return {
    status,
    guestName: { firstName: firstName ?? '', lastName: lastName ?? '' },
    email: emailIsReal ? mail! : placeholderEmail(uniqueId, revision.bookingId),
    emailIsReal,
    phone: str(customer.phone, 40),
    country: str(customer.country, 60),
    guestDetails,
    guests: Math.max(1, guestDetails.adults + guestDetails.children),
    rooms,
    checkInDate: fromChannexDate(checkIn),
    checkOutDate: fromChannexDate(checkOut),
    estimatedTotal,
    pricingSnapshot: {
      ratePlanId: rooms.find((r) => r.item.ratePlanId)?.item.ratePlanId?.toString() ?? '',
      ratePlanName: ratePlanNames.join(' + ').slice(0, 200),
      roomTypeName: roomTypeNames.join(' + ').slice(0, 200),
      basePrice: rooms[0].item.unitPrice,
      occupancyCost: 0,
      subtotal,
      adjustedSubtotal: subtotal,
      taxes: [],
      totalTaxes,
      finalTotal: estimatedTotal,
      nights,
    },
    specialRequests: notes.join('\n').slice(0, 1000),
    currency: str(p?.currency, 3)?.toUpperCase(),
    channelSource: {
      provider: 'channex',
      otaName,
      otaCode: uniqueId?.includes('-') ? uniqueId.split('-')[0].slice(0, 20) : undefined,
      otaReservationCode: str(p?.ota_reservation_code, 120),
      uniqueId,
      channexBookingId: revision.bookingId,
      channexPropertyId: revision.propertyId ?? str(p?.property_id, 64),
      channelId: str(p?.channel_id, 64),
      lastRevisionId: revision.revisionId,
      lastRevisionInsertedAt: insertedAt && !Number.isNaN(insertedAt.getTime()) ? insertedAt : undefined,
      paymentCollect: p?.payment_collect === 'ota' || p?.payment_collect === 'property' ? p.payment_collect : undefined,
      paymentType: str(p?.payment_type, 40),
      otaCommission: commission,
      currency: str(p?.currency, 3)?.toUpperCase(),
      guaranteeSummary: guaranteeSummary(p?.guarantee),
      importedAt: new Date(),
    },
  };
}

export interface StayDiff { field: string; from: unknown; to: unknown }

/** Stay differences staff must apply by hand (checked-in / completed reservations). */
export function stayDiff(current: Pick<IReservation, 'checkInDate' | 'checkOutDate' | 'items' | 'estimatedTotal' | 'guestDetails'>, next: MappedBooking): StayDiff[] {
  const d: StayDiff[] = [];
  const day = (x?: Date | null) => (x ? toChannexDate(x) : undefined);
  if (day(current.checkInDate) !== day(next.checkInDate)) d.push({ field: 'checkIn', from: day(current.checkInDate), to: day(next.checkInDate) });
  if (day(current.checkOutDate) !== day(next.checkOutDate)) d.push({ field: 'checkOut', from: day(current.checkOutDate), to: day(next.checkOutDate) });
  const roomsNow = (current.items ?? []).filter((i) => i.kind === 'room').length;
  if (roomsNow !== next.rooms.length) d.push({ field: 'rooms', from: roomsNow, to: next.rooms.length });
  const types = (items: { roomTypeId?: unknown }[]) => items.map((i) => String(i.roomTypeId ?? '')).sort().join(',');
  if (types((current.items ?? []).filter((i) => i.kind === 'room')) !== types(next.rooms.map((r) => r.item))) {
    d.push({ field: 'roomTypes', from: types((current.items ?? []).filter((i) => i.kind === 'room')), to: types(next.rooms.map((r) => r.item)) });
  }
  if (Math.abs(Number(current.estimatedTotal ?? 0) - next.estimatedTotal) >= 0.01) d.push({ field: 'total', from: current.estimatedTotal, to: next.estimatedTotal });
  const g = current.guestDetails;
  if (g && (g.adults !== next.guestDetails.adults || (g.children ?? 0) !== next.guestDetails.children)) {
    d.push({ field: 'guests', from: `${g.adults}+${g.children ?? 0}`, to: `${next.guestDetails.adults}+${next.guestDetails.children}` });
  }
  return d;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

const raiseAlert = (type: ChannelAlertType, severity: ChannelAlertSeverity, dedupeKey: string, title: string, details: Record<string, unknown>, extra: { reservationId?: unknown; channexBookingId?: string } = {}) =>
  raise({ type, severity, dedupeKey, title, details, ...extra });

// ─── Room assignment ─────────────────────────────────────────────────────────

/**
 * Rooms for the booked items over the reservation's nights: rooms in `keep` that are still
 * free and of a booked type first, then (when `autoAssign`) other free rooms of that type.
 * Never takes more rooms of a type than the type has available, so unassigned bookings of
 * other reservations keep the rooms they need.
 */
async function chooseRooms(
  items: IReservationItem[],
  stay: { checkIn: Date; checkOut: Date },
  opts: { keep: string[]; autoAssign: boolean; excludeReservationId?: Id },
): Promise<string[]> {
  const need = new Map<string, number>();
  for (const i of items) if (i.kind === 'room' && i.roomTypeId) need.set(String(i.roomTypeId), (need.get(String(i.roomTypeId)) ?? 0) + 1);
  if (need.size === 0) return [];

  const free = await findFreeRooms({ checkIn: stay.checkIn, checkOut: stay.checkOut, excludeReservationId: opts.excludeReservationId });
  const rooms = await Room.find({ _id: { $in: free.freeRoomIds } }).select('_id name roomTypeId').sort({ name: 1 }).lean();
  const chosen: string[] = [];
  for (const [typeId, count] of need) {
    const quota = Math.min(count, free.typeAvailability[typeId] ?? 0);
    const ofType = rooms.filter((r) => String(r.roomTypeId) === typeId).map((r) => String(r._id));
    const kept = ofType.filter((id) => opts.keep.includes(id)).slice(0, quota);
    const extra = opts.autoAssign ? ofType.filter((id) => !kept.includes(id)).slice(0, quota - kept.length) : [];
    chosen.push(...kept, ...extra);
  }
  return chosen;
}

function setRooms(reservation: IReservation, roomIds: string[], previous: string[]) {
  const ids = roomIds.map((id) => new mongoose.Types.ObjectId(id));
  reservation.rooms = ids;
  reservation.room = ids[0];
  const changed = roomIds.length !== previous.length || roomIds.some((id) => !previous.includes(id));
  if (changed) {
    reservation.assignedBy = undefined;
    reservation.assignedAt = ids.length ? new Date() : undefined;
  }
}

const assigned = (r: Pick<IReservation, 'room' | 'rooms'>) =>
  [...new Set([r.room, ...(r.rooms ?? [])].filter(Boolean).map(String))];

// ─── Overbooking ─────────────────────────────────────────────────────────────

/** Nights where the saved reservation's room types have more bookings than rooms, and who competes for them. */
async function findOverbooking(reservation: IReservation) {
  const typeIds = [...new Set((reservation.items ?? []).filter((i) => i.kind === 'room' && i.roomTypeId).map((i) => String(i.roomTypeId)))];
  if (!typeIds.length || !reservation.checkOutDate) return null;
  const nights = eachNight(reservation.checkInDate, reservation.checkOutDate);
  if (!nights.length) return null;
  const range = { dateFrom: nights[0], dateTo: nights[nights.length - 1] };
  const grid = await getInventory({ ...range, roomTypeIds: typeIds });
  const conflicts: { roomTypeId: string; date: ChannexDate; overbooked: number }[] = [];
  for (const t of typeIds) for (const d of nights) {
    const cell = grid[t]?.[d];
    if (cell && cell.overbooked > 0) conflicts.push({ roomTypeId: t, date: d, overbooked: cell.overbooked });
  }
  if (!conflicts.length) return null;

  const data = await loadInventoryWindow(range);
  const competing = new Set<string>();
  for (const c of conflicts.slice(0, 10)) {
    const why = explainNight(data, c.roomTypeId, c.date);
    why.rooms.forEach((r) => r.reservationId && competing.add(r.reservationId));
    why.unassigned.forEach((u) => competing.add(u.reservationId));
  }
  competing.delete(String(reservation._id));
  const others = await Reservation.find({ _id: { $in: [...competing] } }).select('reservationCode').lean();
  return {
    nights: [...new Set(conflicts.map((c) => c.date))],
    conflicts,
    competingReservations: others.map((o: any) => ({ reservationId: String(o._id), reservationCode: o.reservationCode })),
  };
}

// ─── Apply ───────────────────────────────────────────────────────────────────

async function loadLookup(p: any): Promise<EntityLookup> {
  const rooms: any[] = Array.isArray(p?.rooms) ? p.rooms : [];
  const channexIds = [...new Set(rooms.flatMap((r) => [r?.room_type_id, r?.rate_plan_id]).filter((x): x is string => typeof x === 'string'))];
  const maps = channexIds.length
    ? await ChannexEntityMap.find({ environment: getChannexConfig().environment, channexId: { $in: channexIds } }).select('kind localId channexId').lean()
    : [];
  const roomTypes = new Map(maps.filter((m) => m.kind === 'room_type').map((m) => [m.channexId, String(m.localId)]));
  const ratePlans = new Map(maps.filter((m) => m.kind === 'rate_plan').map((m) => [m.channexId, String(m.localId)]));
  const [types, plans] = await Promise.all([
    RoomType.find({ _id: { $in: [...roomTypes.values()] } }).select('name').lean(),
    RatePlan.find({ _id: { $in: [...ratePlans.values()] } }).select('name').lean(),
  ]);
  return {
    roomTypes,
    ratePlans,
    roomTypeNames: new Map(types.map((t: any) => [String(t._id), t.name as string])),
    ratePlanNames: new Map(plans.map((t: any) => [String(t._id), t.name as string])),
  };
}

async function upsertGuest(m: MappedBooking): Promise<Id | undefined> {
  if (!m.emailIsReal) return undefined;
  try {
    const guest = await Guest.findOneAndUpdate(
      { email: m.email },
      { $setOnInsert: { email: m.email, firstName: m.guestName.firstName, lastName: m.guestName.lastName, phone: m.phone ?? '' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return guest._id as Id;
  } catch (err) {
    console.warn('[Channex] guest record upsert failed:', (err as Error).message);
    return undefined;
  }
}

async function saveNewReservation(data: Record<string, unknown>): Promise<IReservation> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await Reservation.create({ ...data, reservationCode: generateReservationCode() });
    } catch (err: any) {
      if (err?.code === 11000 && err?.keyPattern?.reservationCode && attempt < 5) continue;
      throw err;
    }
  }
}

const otaLabel = (m: MappedBooking) => `${m.channelSource.otaName}${m.channelSource.otaReservationCode ? ` ${m.channelSource.otaReservationCode}` : ''}`;

async function afterWrite(reservation: IReservation, m: MappedBooking, bookingId: string) {
  const unmapped = m.rooms
    .map((r, index) => ({ index, roomType: r.channexRoomTypeId ?? null, ratePlan: r.channexRatePlanId ?? null, roomTypeMapped: r.roomTypeMapped, ratePlanMapped: r.ratePlanMapped }))
    .filter((r) => !r.roomTypeMapped || !r.ratePlanMapped);
  if (unmapped.length) {
    await raiseAlert('unmapped_booking', 'critical', bookingId,
      `${otaLabel(m)}: booked a room or rate that is not linked in your channel; assign a room by hand`,
      { rooms: unmapped }, { reservationId: reservation._id, channexBookingId: bookingId });
  }
  const over = await findOverbooking(reservation);
  if (over) {
    await raiseAlert('overbooking', 'critical', bookingId,
      `${otaLabel(m)}: more bookings than rooms on ${over.nights.length} night${over.nights.length === 1 ? '' : 's'}`,
      over, { reservationId: reservation._id, channexBookingId: bookingId });
  }
  const tenant = await Tenant.findById(getTenantId()).select('settings.currency').lean<{ settings?: { currency?: string } }>();
  const propertyCurrency = (tenant?.settings?.currency || 'DOP').toUpperCase();
  if (m.currency && m.currency !== propertyCurrency) {
    await raiseAlert('currency_mismatch', 'warning', bookingId,
      `${otaLabel(m)}: booked in ${m.currency}, but the property works in ${propertyCurrency}; amounts were kept as sent`,
      { bookingCurrency: m.currency, propertyCurrency, amount: m.estimatedTotal }, { reservationId: reservation._id, channexBookingId: bookingId });
  }
}

/** The inbox's apply step for one revision (tenant scope). */
export async function applyBookingRevision(row: IChannexBookingRevision): Promise<ApplyResult> {
  const p: any = row.payload ?? {};
  const bookingId = row.channexBookingId;
  const existing = await Reservation.findOne({ 'channelSource.channexBookingId': bookingId });
  if (existing && existing.channelSource?.lastRevisionId === row.channexRevisionId) {
    return { reservationId: existing._id as Id }; // already applied (crash between save and inbox update)
  }

  const lookup = await loadLookup(p);
  const m = mapRevisionPayload({ ...p, status: p.status ?? row.status }, lookup, {
    revisionId: row.channexRevisionId, bookingId, insertedAt: row.insertedAt, propertyId: row.channexPropertyId,
  });
  const settings = (await AppSettings.findOne({}).select('channelManager').lean())?.channelManager;
  const autoAssign = settings?.autoAssignRooms !== false;
  const items = m.rooms.map((r) => r.item);

  // ── Cancellation ──
  if (m.status === 'cancelled') {
    if (!existing) return {}; // nothing to cancel; recorded in the inbox only
    if (existing.status === 'checked-in' || existing.status === 'completed') {
      await raiseAlert('modification_needs_review', 'warning', bookingId,
        `${otaLabel(m)} was cancelled by the channel, but the guest is already ${existing.status === 'checked-in' ? 'checked in' : 'checked out'}`,
        { change: 'cancelled', reservationStatus: existing.status }, { reservationId: existing._id, channexBookingId: bookingId });
    }
    const previousStatus = existing.status;
    if (previousStatus !== 'cancelled' && previousStatus !== 'checked-in' && previousStatus !== 'completed') {
      existing.status = 'cancelled';
      existing.cancellationReason = `Cancelled via ${m.channelSource.otaName}${m.channelSource.otaReservationCode ? ` (${m.channelSource.otaReservationCode})` : ''}`;
    }
    existing.set('channelSource.lastRevisionId', m.channelSource.lastRevisionId);
    existing.set('channelSource.lastRevisionInsertedAt', m.channelSource.lastRevisionInsertedAt);
    await existing.save();
    if (existing.status !== previousStatus) {
      await recordReservationEvent(existing._id as Id, 'cancelled', {
        actor: channelActor(m.channelSource.otaName),
        changes: [{ field: 'status', from: previousStatus, to: 'cancelled' }],
      });
    }
    return { reservationId: existing._id as Id };
  }

  const company = m.channelSource.paymentCollect === 'ota' ? await ensureOtaCompany(p.ota_name) : undefined;

  // ── New (or a modification of a booking Pilloto never saw) ──
  if (!existing) {
    const guestRecord = await upsertGuest(m);
    const draft = {
      type: 'room',
      status: 'confirmed',
      guestName: m.guestName,
      contactInfo: { email: m.email, phone: m.phone, country: m.country },
      guests: m.guests,
      guestDetails: m.guestDetails,
      items,
      checkInDate: m.checkInDate,
      checkOutDate: m.checkOutDate,
      roomCount: items.length,
      estimatedTotal: m.estimatedTotal,
      totalPayments: 0,
      pricingSnapshot: m.pricingSnapshot,
      specialRequests: m.specialRequests,
      channelSource: m.channelSource,
      ...(guestRecord ? { guestRecord } : {}),
      ...(company ? { company } : {}),
    };
    const roomIds = await chooseRooms(items, { checkIn: m.checkInDate, checkOut: m.checkOutDate }, { keep: [], autoAssign });
    const reservation = await saveNewReservation({
      ...draft,
      ...(roomIds.length ? { rooms: roomIds, room: roomIds[0], assignedAt: new Date() } : {}),
    });
    await ensureFolio(reservation._id);
    await recordReservationEvent(reservation._id as Id, 'created', { actor: channelActor(m.channelSource.otaName) });
    await afterWrite(reservation, m, bookingId);
    if (settings?.sendGuestConfirmationEmail && m.emailIsReal) {
      sendReservationConfirmationEmail(reservation).catch((err) => console.warn('[Channex] confirmation email failed:', err?.message));
    }
    return { reservationId: reservation._id as Id };
  }

  // ── Modification after arrival: non-stay fields only ──
  const before = snapshotReservation(existing);
  const recordModified = () => recordReservationEvent(existing._id as Id, 'channel_modified', {
    actor: channelActor(m.channelSource.otaName),
    changes: diffSnapshots(before, snapshotReservation(existing)),
  });
  if (existing.status === 'checked-in' || existing.status === 'completed') {
    const diff = stayDiff(existing, m);
    existing.guestName = m.guestName;
    if (m.emailIsReal) existing.contactInfo.email = m.email;
    if (m.phone) existing.contactInfo.phone = m.phone;
    existing.specialRequests = m.specialRequests;
    existing.channelSource = { ...m.channelSource, importedAt: existing.channelSource?.importedAt ?? m.channelSource.importedAt };
    if (company && !existing.company) existing.company = company;
    await existing.save();
    await recordModified();
    if (diff.length) {
      await raiseAlert('modification_needs_review', 'warning', bookingId,
        `${otaLabel(m)} was changed by the channel after arrival; review the stay`,
        { diff, reservationStatus: existing.status }, { reservationId: existing._id, channexBookingId: bookingId });
    }
    return { reservationId: existing._id as Id };
  }

  // ── Modification before arrival (also re-confirms a cancelled one the channel sends again) ──
  const reopened = existing.status === 'cancelled';
  const previous = assigned(existing);
  const roomIds = await chooseRooms(items, { checkIn: m.checkInDate, checkOut: m.checkOutDate }, { keep: previous, autoAssign, excludeReservationId: existing._id as Id });
  existing.status = 'confirmed';
  if (reopened) existing.cancellationReason = undefined;
  existing.guestName = m.guestName;
  if (m.emailIsReal) existing.contactInfo.email = m.email;
  if (m.phone) existing.contactInfo.phone = m.phone;
  existing.guests = m.guests;
  existing.guestDetails = m.guestDetails;
  existing.items = items;
  existing.checkInDate = m.checkInDate;
  existing.checkOutDate = m.checkOutDate;
  existing.roomCount = items.length;
  existing.estimatedTotal = m.estimatedTotal;
  existing.pricingSnapshot = m.pricingSnapshot;
  existing.specialRequests = m.specialRequests;
  existing.channelSource = { ...m.channelSource, importedAt: existing.channelSource?.importedAt ?? m.channelSource.importedAt };
  if (company && !existing.company) existing.company = company;
  if (!existing.guestRecord) {
    const guestRecord = await upsertGuest(m);
    if (guestRecord) existing.guestRecord = guestRecord;
  }
  setRooms(existing, roomIds, previous);
  await existing.save();
  await recordModified();
  await afterWrite(existing, m, bookingId);
  if (reopened) {
    await raiseAlert('modification_needs_review', 'warning', bookingId,
      `${otaLabel(m)} was cancelled earlier and is active again; check its rooms and folio`,
      { change: 'reinstated' }, { reservationId: existing._id, channexBookingId: bookingId });
  }
  return { reservationId: existing._id as Id };
}
