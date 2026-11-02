/**
 * Home panel — the property's day at a glance, built the way enterprise PMS home dashboards are
 * (Opera Cloud, Mews, Cloudbeds): tonight's KPIs against last year, today's movement (arrivals,
 * departures, in house), room and housekeeping status, the front-desk worklists, what needs
 * attention, the next 14 nights and today's booking activity.
 *
 * Occupancy, ADR and RevPAR come from the stay-night engine, so the panel agrees with the
 * reports. Money (rates, revenue, balances) is only included when the caller may see revenue.
 */
import Reservation from '../../models/Reservation';
import Room from '../../models/Room';
import RoomBlock from '../../models/RoomBlock';
import Folio from '../../models/Folio';
import Charge from '../../models/Charge';
import Payment from '../../models/Payment';
import ChannelAlert from '../../models/ChannelAlert';
import { TENANT_ALERT_TYPES } from '../channex/alerts.service';
import { todayInTz } from '../channex/dates';
import { toDateStr, parseUTCDate, addDays, daysBetween, round2 } from '../../utils/dateUtils';
import {
  NightRow, dateRange, loadCapacity, loadStays, nightlyRows, roomsHeld, sameDateLastYear, sourceOf, totals,
} from './stayEngine';

export const OUTLOOK_NIGHTS = 14;
/** Arrivals this close still without a room are flagged */
export const ASSIGN_WITHIN_DAYS = 3;
/** Pending (unconfirmed) arrivals this close are flagged */
export const CONFIRM_WITHIN_DAYS = 7;
const ATTENTION_ITEMS = 5;
const RECENT_BOOKINGS = 8;

type Totals = ReturnType<typeof totals>;

export interface PanelStay {
  id: string;
  code: string;
  guest: string;
  status: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  roomNames: string[];
  /** Fewer rooms assigned than held */
  unassigned: boolean;
  adults: number;
  children: number;
  source: string;
  sourceLabel: string;
  corporate: boolean;
  specialRequests: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  /** Before arrival: booked total less payments; from check-in on: folio charges less payments */
  balance?: number;
}

export type AttentionKey =
  | 'overdueArrivals' | 'overdueDepartures' | 'unassigned' | 'unconfirmed'
  | 'balanceDue' | 'dirtyRooms' | 'corporateRates' | 'channelAlerts';

export interface AttentionItem {
  key: AttentionKey;
  severity: 'critical' | 'warning' | 'info';
  count: number;
  amount?: number;
  /** Extra numbers the message needs (e.g. arrivals still to come) */
  meta?: Record<string, number>;
  items: { id: string; label: string; detail: string; date?: string }[];
}

export interface DashboardOptions {
  timezone: string;
  showMoney: boolean;
  channelAlerts: boolean;
  dayVisits: boolean;
  now?: Date;
}

export interface Dashboard {
  date: string;
  timezone: string;
  generatedAt: string;
  showMoney: boolean;
  tonight: { current: Totals; lastYear: Totals };
  tomorrow: Totals;
  mtd: { from: string; current: Totals; lastYear: Totals };
  movement: {
    arrivals: { rooms: number; done: number; reservations: number; guests: number };
    departures: { rooms: number; done: number; reservations: number };
    inHouse: { rooms: number; guests: number; stayovers: number };
  };
  roomStatus: { total: number; occupied: number; vacantClean: number; vacantDirty: number; outOfService: number; occupiedDirty: number };
  worklists: { arrivals: PanelStay[]; departures: PanelStay[]; inHouse: PanelStay[] };
  attention: AttentionItem[];
  outlook: (NightRow & { arrivals: number; departures: number })[];
  activity: {
    newBookings: number;
    newRoomNights: number;
    newRevenue: number;
    cancellations: number;
    cancelledRoomNights: number;
    recent: {
      id: string; code: string; guest: string; status: string; sourceLabel: string; source: string;
      checkIn: string; nights: number; rooms: number; createdAt: string; value?: number;
    }[];
  };
  dayVisits: { reservations: number; guests: number; byType: Record<string, number> } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function guestNameOf(d: any): string {
  const g = d.guestName;
  if (g?.firstName || g?.lastName) return `${g.firstName ?? ''} ${g.lastName ?? ''}`.trim();
  if (d.user && typeof d.user === 'object' && (d.user.firstName || d.user.lastName)) {
    return `${d.user.firstName ?? ''} ${d.user.lastName ?? ''}`.trim();
  }
  return d.contactInfo?.email ?? '';
}

/** Booked value of a reservation (room items' subtotal, else the snapshot, else the estimate) */
function bookedValue(d: any): number {
  const items = (d.items ?? []).filter((i: any) => i.kind === 'room').reduce((s: number, i: any) => s + Number(i.subtotal || 0), 0);
  return round2(items || Number(d.pricingSnapshot?.adjustedSubtotal ?? 0) || Number(d.estimatedTotal ?? 0));
}

/** Folio charges and non-reversed payments per reservation */
async function folioTotals(reservationIds: string[]): Promise<Map<string, { charges: number; paid: number }>> {
  const out = new Map<string, { charges: number; paid: number }>();
  if (!reservationIds.length) return out;
  const folios: any[] = await Folio.find({ reservationId: { $in: reservationIds } }).select('_id reservationId').lean();
  if (!folios.length) return out;
  const folioIds = folios.map((f) => f._id);
  const [charges, payments] = await Promise.all([
    Charge.aggregate([{ $match: { folioId: { $in: folioIds } } }, { $group: { _id: '$folioId', total: { $sum: '$amount' } } }]),
    Payment.aggregate([{ $match: { folioId: { $in: folioIds }, status: { $ne: 'reversed' } } }, { $group: { _id: '$folioId', total: { $sum: '$amount' } } }]),
  ]);
  const byFolio = new Map(folios.map((f) => [String(f._id), String(f.reservationId)]));
  const add = (folioId: unknown, field: 'charges' | 'paid', amount: number) => {
    const rid = byFolio.get(String(folioId));
    if (!rid) return;
    const cur = out.get(rid) ?? { charges: 0, paid: 0 };
    cur[field] += Number(amount || 0);
    out.set(rid, cur);
  };
  for (const c of charges) add(c._id, 'charges', c.total);
  for (const p of payments) add(p._id, 'paid', p.total);
  return out;
}

const MONEY_FIELDS = ['roomRevenue', 'adr', 'revpar'] as const;
function stripMoney<T extends Record<string, any>>(row: T): T {
  const copy: any = { ...row };
  for (const f of MONEY_FIELDS) if (f in copy) copy[f] = 0;
  return copy;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export async function computeDashboard(opts: DashboardOptions): Promise<Dashboard> {
  const now = opts.now ?? new Date();
  let tz = opts.timezone || 'UTC';
  let today: string;
  try { today = todayInTz(tz, now); } catch { tz = 'UTC'; today = todayInTz(tz, now); }
  const localDate = (d: Date) => todayInTz(tz, d);

  const day = (offset: number) => toDateStr(addDays(parseUTCDate(today), offset));
  const tomorrow = day(1);
  const outlookTo = day(OUTLOOK_NIGHTS - 1);
  const monthStart = `${today.slice(0, 8)}01`;
  const lyDate = sameDateLastYear(today);
  const lyMonthStart = `${lyDate.slice(0, 8)}01`;
  const todayStart = parseUTCDate(today);
  const tomorrowStart = parseUTCDate(tomorrow);

  const operationalSelect =
    'reservationCode status checkInDate checkOutDate room rooms roomCount items pricingSnapshot estimatedTotal ' +
    'channelSource isCorporate confirmationToken guestName user contactInfo guestDetails guests specialRequests ' +
    'actualCheckInAt actualCheckOutAt createdAt corporatePriceStatus';

  const [stays, capacity, lyStays, lyCapacity, operational, activeRooms, blocks, madeRecently, latestDocs, corporate, alerts, visits] = await Promise.all([
    loadStays(monthStart < today ? monthStart : today, outlookTo),
    loadCapacity(monthStart < today ? monthStart : today, outlookTo),
    loadStays(lyMonthStart, lyDate),
    loadCapacity(lyMonthStart, lyDate),
    // Everything the front desk works today: arrivals and departures, in house, and pending /
    // confirmed stays arriving before the confirm window ends (includes overdue arrivals)
    Reservation.find({
      type: 'room',
      checkOutDate: { $exists: true },
      status: { $ne: 'cancelled' },
      $or: [
        { status: { $in: ['pending', 'confirmed'] }, checkInDate: { $lt: addDays(todayStart, CONFIRM_WITHIN_DAYS) } },
        { status: 'checked-in' },
        { checkInDate: { $gte: todayStart, $lt: tomorrowStart } },
        { checkOutDate: { $gte: todayStart, $lt: tomorrowStart } },
      ],
    }).select(operationalSelect).populate('user', 'firstName lastName').lean(),
    Room.find({ status: 'active' }).select('_id name condition').lean(),
    RoomBlock.find({ startDate: { $lt: addDays(tomorrowStart, 1) }, endDate: { $gt: addDays(todayStart, -1) } }).select('roomId startDate endDate').lean(),
    // Bookings and cancellations of the last two days; filtered to the local day below
    Reservation.find({
      type: 'room',
      $or: [{ createdAt: { $gte: addDays(now, -2) } }, { status: 'cancelled', updatedAt: { $gte: addDays(now, -2) } }],
    }).select('status checkInDate checkOutDate room rooms roomCount items pricingSnapshot estimatedTotal createdAt updatedAt').lean(),
    Reservation.find({ type: 'room' }).select(operationalSelect).populate('user', 'firstName lastName').sort('-createdAt').limit(RECENT_BOOKINGS).lean(),
    Reservation.find({ corporatePriceStatus: 'pending', status: { $ne: 'cancelled' } })
      .select('reservationCode guestName user contactInfo checkInDate').populate('user', 'firstName lastName').sort('checkInDate').lean(),
    opts.channelAlerts
      ? ChannelAlert.find({ status: 'open', type: { $in: TENANT_ALERT_TYPES } }).select('title severity createdAt dueAt reservationId').sort('-createdAt').lean()
      : Promise.resolve([]),
    opts.dayVisits
      ? Reservation.find({ type: { $in: ['daypass', 'PasaTarde', 'event'] }, status: { $ne: 'cancelled' }, checkInDate: { $gte: todayStart, $lt: tomorrowStart } })
        .select('type guests guestDetails expectedAttendees').lean()
      : Promise.resolve(null),
  ]);

  // ── KPIs ──
  const rows = new Map(nightlyRows(dateRange(monthStart < today ? monthStart : today, outlookTo), stays, capacity, today).map((r) => [r.date, r]));
  const lyRows = nightlyRows(dateRange(lyMonthStart, lyDate), lyStays, lyCapacity, today);
  const money = <T extends Record<string, any>>(r: T) => (opts.showMoney ? r : stripMoney(r));
  const tonight = { current: money(totals([rows.get(today)!])), lastYear: money(totals(lyRows.filter((r) => r.date === lyDate))) };
  const mtd = {
    from: monthStart,
    current: money(totals(dateRange(monthStart, today).map((d) => rows.get(d)!))),
    lastYear: money(totals(lyRows)),
  };

  // ── Operational stays ──
  const ops: any[] = operational as any[];
  const assignedIds = new Set(ops.flatMap((d) => roomsHeld(d).assigned));
  const roomNames = new Map<string, string>((activeRooms as any[]).map((r) => [String(r._id), r.name]));
  const missingNames = [...assignedIds].filter((id) => !roomNames.has(id));
  if (missingNames.length) {
    for (const r of await Room.find({ _id: { $in: missingNames } }).select('name').lean() as any[]) roomNames.set(String(r._id), r.name);
  }
  const balances = opts.showMoney ? await folioTotals(ops.map((d) => String(d._id))) : new Map();

  const toPanel = (d: any): PanelStay => {
    const held = roomsHeld(d);
    const checkIn = toDateStr(new Date(d.checkInDate));
    const checkOut = toDateStr(new Date(d.checkOutDate));
    const source = sourceOf(d);
    const row: PanelStay = {
      id: String(d._id),
      code: d.reservationCode ?? '',
      guest: guestNameOf(d),
      status: d.status,
      checkIn,
      checkOut,
      nights: Math.max(1, daysBetween(parseUTCDate(checkIn), parseUTCDate(checkOut))),
      rooms: held.rooms,
      roomNames: held.assigned.map((id) => roomNames.get(id) ?? '?'),
      unassigned: held.assigned.length < held.rooms,
      adults: Number(d.guestDetails?.adults ?? d.guests ?? 0),
      children: Number(d.guestDetails?.children ?? 0),
      source: source.key,
      sourceLabel: source.label,
      corporate: !!d.isCorporate,
      specialRequests: (d.specialRequests ?? '').trim(),
      checkedInAt: d.actualCheckInAt ? new Date(d.actualCheckInAt).toISOString() : null,
      checkedOutAt: d.actualCheckOutAt ? new Date(d.actualCheckOutAt).toISOString() : null,
    };
    if (opts.showMoney) {
      const f = balances.get(row.id) ?? { charges: 0, paid: 0 };
      const preArrival = d.status === 'pending' || d.status === 'confirmed';
      const owed = preArrival ? Math.max(Number(d.estimatedTotal ?? 0), f.charges) : f.charges;
      row.balance = round2(Math.max(0, owed - f.paid));
    }
    return row;
  };
  const panel = ops.map(toPanel);
  const notYetIn = (s: PanelStay) => s.status === 'pending' || s.status === 'confirmed';
  const byDate = (a: PanelStay, b: PanelStay) => a.checkIn.localeCompare(b.checkIn) || a.guest.localeCompare(b.guest);

  const arrivals = panel.filter((s) => s.checkIn === today).sort((a, b) => Number(!notYetIn(a)) - Number(!notYetIn(b)) || a.guest.localeCompare(b.guest));
  const departures = panel
    .filter((s) => s.checkOut === today && (s.status === 'checked-in' || s.status === 'completed'))
    .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || a.guest.localeCompare(b.guest));
  const inHouse = panel.filter((s) => s.status === 'checked-in').sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.guest.localeCompare(b.guest));
  const sumRooms = (list: PanelStay[]) => list.reduce((n, s) => n + s.rooms, 0);
  const sumGuests = (list: PanelStay[]) => list.reduce((n, s) => n + s.adults + s.children, 0);

  // ── Room status (tonight) ──
  const outOfService = new Set<string>();
  for (const b of blocks as any[]) {
    if (toDateStr(new Date(b.startDate)) <= today && toDateStr(new Date(b.endDate)) > today) outOfService.add(String(b.roomId));
  }
  const occupiedIds = new Set(ops.filter((d) => d.status === 'checked-in').flatMap((d) => roomsHeld(d).assigned));
  const roomStatus = { total: 0, occupied: 0, vacantClean: 0, vacantDirty: 0, outOfService: 0, occupiedDirty: 0 };
  for (const r of activeRooms as any[]) {
    const id = String(r._id);
    const dirty = r.condition === 'pending_cleanup';
    roomStatus.total++;
    if (occupiedIds.has(id)) {
      roomStatus.occupied++;
      if (dirty) roomStatus.occupiedDirty++;
    } else if (outOfService.has(id)) roomStatus.outOfService++;
    else if (dirty) roomStatus.vacantDirty++;
    else roomStatus.vacantClean++;
  }

  // ── Needs attention ──
  const label = (s: PanelStay) => `${s.guest || s.code}${s.code && s.guest ? ` · ${s.code}` : ''}`;
  const roomsText = (s: PanelStay) => (s.roomNames.length ? s.roomNames.join(', ') : '');
  const attention: AttentionItem[] = [];
  const push = (item: AttentionItem) => { if (item.count > 0) attention.push(item); };

  const overdueArrivals = panel.filter((s) => notYetIn(s) && s.checkIn < today).sort((a, b) => b.checkIn.localeCompare(a.checkIn));
  push({ key: 'overdueArrivals', severity: 'critical', count: overdueArrivals.length, items: overdueArrivals.slice(0, ATTENTION_ITEMS).map((s) => ({ id: s.id, label: label(s), detail: roomsText(s), date: s.checkIn })) });

  const overdueDepartures = inHouse.filter((s) => s.checkOut < today);
  push({ key: 'overdueDepartures', severity: 'critical', count: overdueDepartures.length, items: overdueDepartures.slice(0, ATTENTION_ITEMS).map((s) => ({ id: s.id, label: label(s), detail: roomsText(s), date: s.checkOut })) });

  const assignBy = day(ASSIGN_WITHIN_DAYS - 1);
  const unassigned = panel.filter((s) => notYetIn(s) && s.checkIn >= today && s.checkIn <= assignBy && s.unassigned).sort(byDate);
  push({ key: 'unassigned', severity: unassigned.some((s) => s.checkIn === today) ? 'critical' : 'warning', count: unassigned.length, meta: { days: ASSIGN_WITHIN_DAYS }, items: unassigned.slice(0, ATTENTION_ITEMS).map((s) => ({ id: s.id, label: label(s), detail: '', date: s.checkIn })) });

  const unconfirmed = panel.filter((s) => s.status === 'pending' && s.checkIn >= today).sort(byDate);
  push({ key: 'unconfirmed', severity: 'warning', count: unconfirmed.length, meta: { days: CONFIRM_WITHIN_DAYS }, items: unconfirmed.slice(0, ATTENTION_ITEMS).map((s) => ({ id: s.id, label: label(s), detail: s.sourceLabel, date: s.checkIn })) });

  if (opts.showMoney) {
    const owing = inHouse.filter((s) => s.checkOut <= today && (s.balance ?? 0) > 0).sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
    push({ key: 'balanceDue', severity: 'warning', count: owing.length, amount: round2(owing.reduce((n, s) => n + (s.balance ?? 0), 0)), items: owing.slice(0, ATTENTION_ITEMS).map((s) => ({ id: s.id, label: label(s), detail: roomsText(s), date: s.checkOut })) });
  }

  const arrivalsToCome = sumRooms(arrivals.filter(notYetIn));
  if (roomStatus.vacantDirty > 0 && arrivalsToCome > 0) {
    push({
      key: 'dirtyRooms',
      severity: arrivalsToCome > roomStatus.vacantClean ? 'warning' : 'info',
      count: roomStatus.vacantDirty,
      meta: { arrivals: arrivalsToCome, clean: roomStatus.vacantClean },
      items: [],
    });
  }

  push({
    key: 'corporateRates',
    severity: 'info',
    count: (corporate as any[]).length,
    items: (corporate as any[]).slice(0, ATTENTION_ITEMS).map((d) => ({ id: String(d._id), label: `${guestNameOf(d) || d.reservationCode}${d.reservationCode ? ` · ${d.reservationCode}` : ''}`, detail: '', date: toDateStr(new Date(d.checkInDate)) })),
  });

  if (opts.channelAlerts) {
    const list = alerts as any[];
    const critical = list.filter((a) => a.severity === 'critical').length;
    push({
      key: 'channelAlerts',
      severity: critical > 0 ? 'critical' : 'warning',
      count: list.length,
      meta: { critical },
      items: [...list].sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical')).slice(0, ATTENTION_ITEMS)
        .map((a) => ({ id: String(a._id), label: a.title, detail: a.severity })),
    });
  }
  const severityRank = { critical: 0, warning: 1, info: 2 } as const;
  attention.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  // ── Outlook ──
  const movementOn = (night: string) => {
    let arr = 0, dep = 0;
    for (const s of stays) {
      if (s.checkIn === night) arr += s.rooms;
      if (s.checkOut === night) dep += s.rooms;
    }
    return { arrivals: arr, departures: dep };
  };
  const outlook = dateRange(today, outlookTo).map((d) => ({ ...money(rows.get(d)!), ...movementOn(d) }));

  // ── Booking activity (property-local day) ──
  const recent = madeRecently as any[];
  // A booking made today counts even if it was cancelled later the same day (it shows in both)
  const newBookings = recent.filter((d) => localDate(new Date(d.createdAt)) === today);
  const cancelledToday = recent.filter((d) => d.status === 'cancelled' && localDate(new Date(d.updatedAt ?? d.createdAt)) === today);
  const roomNightsOf = (d: any) => roomsHeld(d).rooms * Math.max(1, daysBetween(parseUTCDate(toDateStr(new Date(d.checkInDate))), parseUTCDate(toDateStr(new Date(d.checkOutDate ?? d.checkInDate)))));

  const latest = (latestDocs as any[]).map((d) => {
    const source = sourceOf(d);
    const checkIn = toDateStr(new Date(d.checkInDate));
    const item: Dashboard['activity']['recent'][number] = {
      id: String(d._id),
      code: d.reservationCode ?? '',
      guest: guestNameOf(d),
      status: d.status,
      source: source.key,
      sourceLabel: source.label,
      checkIn,
      nights: Math.max(1, daysBetween(parseUTCDate(checkIn), parseUTCDate(toDateStr(new Date(d.checkOutDate ?? d.checkInDate))))),
      rooms: roomsHeld(d).rooms,
      createdAt: new Date(d.createdAt).toISOString(),
    };
    if (opts.showMoney) item.value = bookedValue(d);
    return item;
  });

  // ── Day visitors (day passes, pasadías, events) ──
  let dayVisits: Dashboard['dayVisits'] = null;
  if (visits) {
    const byType: Record<string, number> = {};
    let guests = 0;
    for (const v of visits as any[]) {
      byType[v.type] = (byType[v.type] ?? 0) + 1;
      guests += v.type === 'event'
        ? Number(v.expectedAttendees ?? v.guests ?? 0)
        : ((v.guestDetails?.adults ?? 0) + (v.guestDetails?.children ?? 0)) || Number(v.guests ?? 0);
    }
    dayVisits = { reservations: (visits as any[]).length, guests, byType };
  }

  return {
    date: today,
    timezone: tz,
    generatedAt: now.toISOString(),
    showMoney: opts.showMoney,
    tonight,
    tomorrow: money(totals([rows.get(tomorrow)!])),
    mtd,
    movement: {
      arrivals: { rooms: sumRooms(arrivals), done: sumRooms(arrivals.filter((s) => !notYetIn(s))), reservations: arrivals.length, guests: sumGuests(arrivals) },
      departures: { rooms: sumRooms(departures), done: sumRooms(departures.filter((s) => s.status === 'completed')), reservations: departures.length },
      inHouse: { rooms: sumRooms(inHouse), guests: sumGuests(inHouse), stayovers: sumRooms(inHouse.filter((s) => s.checkOut > today)) },
    },
    roomStatus,
    worklists: { arrivals, departures, inHouse },
    attention,
    outlook,
    activity: {
      newBookings: newBookings.length,
      newRoomNights: newBookings.reduce((n, d) => n + roomNightsOf(d), 0),
      newRevenue: opts.showMoney ? round2(newBookings.reduce((n, d) => n + bookedValue(d), 0)) : 0,
      cancellations: cancelledToday.length,
      cancelledRoomNights: cancelledToday.reduce((n, d) => n + roomNightsOf(d), 0),
      recent: latest,
    },
    dayVisits,
  };
}
