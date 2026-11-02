/**
 * Management reports on the stay-night engine (stayEngine.ts):
 *
 *   - Manager's flash: day / month-to-date / year-to-date KPIs against the same dates last year,
 *     the day's operations, and the 30-day outlook.
 *   - Forecast & pace: on-the-books occupancy and revenue per future night, 7-day pickup, and
 *     pace against the same time last year (STLY: the night 52 weeks earlier, as it stood
 *     52 weeks before today).
 *   - Segmentation: room nights, revenue, ADR, share, commission, lead time, length of stay and
 *     cancellations by source, room type or rate plan, with the revenue trend per segment.
 *   - Booking insights: lead time, length of stay, day-of-week demand, cancellations, no-shows,
 *     party size and repeat guests for stays arriving in a range.
 *
 * All functions take the property's local `today`; pure builders are exported for tests.
 */
import mongoose from 'mongoose';
import Reservation from '../../models/Reservation';
import RoomType from '../../models/RoomType';
import { toDateStr, parseUTCDate, addDays, isoWeek, round2 } from '../../utils/dateUtils';
import {
  Stay, Capacity, NightRow,
  loadStays, loadCapacity, nightlyRows, totals, dateRange, stayNights, nightSold, revenuePerNight,
  soldInRange, sameDateLastYear, sameWeekdayLastYear,
} from './stayEngine';

type Totals = ReturnType<typeof totals>;
const pct = (part: number, whole: number) => (whole > 0 ? round2((part / whole) * 100) : 0);

// ─── Manager's flash ──────────────────────────────────────────────────────────

export interface FlashPeriod { from: string; to: string; current: Totals; lastYear: Totals }

export interface ManagerFlash {
  date: string;
  periods: { day: FlashPeriod; mtd: FlashPeriod; ytd: FlashPeriod };
  operations: {
    arrivals: number;
    departures: number;
    inHouse: number;
    outOfOrder: number;
    noShows: number;
    newBookings: number;
    newRoomNights: number;
    newRevenue: number;
    cancellations: number;
    cancelledRoomNights: number;
  };
  outlook: { summary: Totals; rows: NightRow[] };
}

export async function computeManagerFlash(date: string, today: string): Promise<ManagerFlash> {
  const monthStart = `${date.slice(0, 8)}01`;
  const yearStart = `${date.slice(0, 4)}-01-01`;
  const lyDate = sameDateLastYear(date);
  const lyMonthStart = `${lyDate.slice(0, 8)}01`;
  const lyYearStart = `${lyDate.slice(0, 4)}-01-01`;
  const outlookTo = toDateStr(addDays(parseUTCDate(date), 29));

  const [stays, capacity, lyStays, lyCapacity, created] = await Promise.all([
    loadStays(yearStart, outlookTo, { includeCancelled: true }),
    loadCapacity(yearStart, outlookTo),
    loadStays(lyYearStart, lyDate),
    loadCapacity(lyYearStart, lyDate),
    Reservation.find({
      type: 'room',
      $or: [
        { createdAt: { $gte: parseUTCDate(date), $lt: addDays(parseUTCDate(date), 1) } },
        { status: 'cancelled', updatedAt: { $gte: parseUTCDate(date), $lt: addDays(parseUTCDate(date), 1) } },
      ],
    }).select('_id').lean(),
  ]);

  const live = stays.filter((s) => !s.cancelled);
  const rows = new Map(nightlyRows(dateRange(yearStart, outlookTo), live, capacity, today).map((r) => [r.date, r]));
  const lyRows = new Map(nightlyRows(dateRange(lyYearStart, lyDate), lyStays, lyCapacity, today).map((r) => [r.date, r]));
  const period = (from: string, lyFrom: string, lyTo: string): FlashPeriod => ({
    from,
    to: date,
    current: totals(dateRange(from, date).map((d) => rows.get(d)!)),
    lastYear: totals(dateRange(lyFrom, lyTo).map((d) => lyRows.get(d)!).filter(Boolean)),
  });

  // Operations of the day (bookings / cancellations made that day may be for any date)
  const createdIds = new Set((created as any[]).map((r) => String(r._id)));
  const madeToday = createdIds.size
    ? await loadStaysByIds([...createdIds])
    : [];
  const newBookings = madeToday.filter((s) => s.bookedOn === date);
  const cancellations = madeToday.filter((s) => s.cancelled && s.cancelledOn === date);
  const dayRow = rows.get(date)!;

  return {
    date,
    periods: {
      day: period(date, lyDate, lyDate),
      mtd: period(monthStart, lyMonthStart, lyDate),
      ytd: period(yearStart, lyYearStart, lyDate),
    },
    operations: {
      arrivals: live.filter((s) => s.checkIn === date).reduce((n, s) => n + s.rooms, 0),
      departures: live.filter((s) => s.checkOut === date && (s.status === 'checked-in' || s.status === 'completed' || date >= today)).reduce((n, s) => n + s.rooms, 0),
      inHouse: dayRow.roomsSold,
      outOfOrder: dayRow.roomsOutOfOrder,
      noShows: date < today ? live.filter((s) => s.checkIn === date && (s.status === 'pending' || s.status === 'confirmed')).reduce((n, s) => n + s.rooms, 0) : 0,
      newBookings: newBookings.length,
      newRoomNights: newBookings.reduce((n, s) => n + s.nights * s.rooms, 0),
      newRevenue: round2(newBookings.reduce((n, s) => n + s.roomRevenue, 0)),
      cancellations: cancellations.length,
      cancelledRoomNights: cancellations.reduce((n, s) => n + s.nights * s.rooms, 0),
    },
    outlook: (() => {
      const out = dateRange(date, outlookTo).map((d) => rows.get(d)!);
      return { summary: totals(out), rows: out };
    })(),
  };
}

/** Stays by id, whatever their dates */
async function loadStaysByIds(ids: string[]): Promise<Stay[]> {
  const docs: any[] = await Reservation.find({ _id: { $in: ids } }).select('checkInDate checkOutDate').lean();
  if (!docs.length) return [];
  const from = toDateStr(new Date(Math.min(...docs.map((d) => new Date(d.checkInDate).getTime()))));
  const to = toDateStr(new Date(Math.max(...docs.map((d) => new Date(d.checkOutDate ?? d.checkInDate).getTime()))));
  const wanted = new Set(ids);
  return (await loadStays(from, to, { includeCancelled: true })).filter((s) => wanted.has(s.id));
}

// ─── Forecast & pace ──────────────────────────────────────────────────────────

export interface ForecastRow extends NightRow {
  arrivals: number;
  departures: number;
  /** Rooms on the night from bookings made in the last 7 days (incl. today) */
  pickup7: number;
  stlyDate: string;
  stlyRoomsSold: number;
  stlyRevenue: number;
  stlyOccupancyPct: number;
}

export interface Forecast {
  asOf: string;
  rows: ForecastRow[];
  summary: Totals & { pickup7: number; stly: Totals };
}

/** On-the-books rows plus pickup and STLY, from loaded data (pure) */
export function buildForecast(
  days: string[],
  stays: Stay[],
  capacity: Capacity,
  lyStays: Stay[],
  lyCapacity: Capacity,
  asOf: string,
): Forecast {
  const live = stays.filter((s) => !s.cancelled);
  const otb = nightlyRows(days, live, capacity, asOf);
  const pickupFrom = toDateStr(addDays(parseUTCDate(asOf), -6));
  const pickupRows = nightlyRows(days, live.filter((s) => s.bookedOn >= pickupFrom), capacity, asOf);

  // STLY: what was on the books 52 weeks ago for the night 52 weeks earlier
  const lyAsOf = sameWeekdayLastYear(asOf);
  const onBooksThen = (s: Stay) => s.bookedOn <= lyAsOf && !(s.cancelled && s.cancelledOn && s.cancelledOn <= lyAsOf);
  const lyDays = days.map(sameWeekdayLastYear);
  const stly = nightlyRows(lyDays, lyStays, lyCapacity, asOf, (s) => onBooksThen(s));

  const rows: ForecastRow[] = otb.map((r, i) => ({
    ...r,
    arrivals: live.filter((s) => s.checkIn === r.date).reduce((n, s) => n + s.rooms, 0),
    departures: live.filter((s) => s.checkOut === r.date).reduce((n, s) => n + s.rooms, 0),
    pickup7: pickupRows[i].roomsSold,
    stlyDate: lyDays[i],
    stlyRoomsSold: stly[i].roomsSold,
    stlyRevenue: stly[i].roomRevenue,
    stlyOccupancyPct: stly[i].occupancyPct,
  }));
  return {
    asOf,
    rows,
    summary: { ...totals(otb), pickup7: rows.reduce((n, r) => n + r.pickup7, 0), stly: totals(stly) },
  };
}

export async function computeForecast(from: string, to: string, today: string): Promise<Forecast> {
  const lyFrom = sameWeekdayLastYear(from);
  const lyTo = sameWeekdayLastYear(to);
  const [stays, capacity, lyStays, lyCapacity] = await Promise.all([
    loadStays(from, to),
    loadCapacity(from, to),
    loadStays(lyFrom, lyTo, { includeCancelled: true }),
    loadCapacity(lyFrom, lyTo),
  ]);
  return buildForecast(dateRange(from, to), stays, capacity, lyStays, lyCapacity, today);
}

// ─── Segmentation ─────────────────────────────────────────────────────────────

export type SegmentBy = 'source' | 'roomType' | 'ratePlan';

export interface SegmentRow {
  key: string;
  label: string;
  reservations: number;
  roomNights: number;
  revenue: number;
  adr: number;
  revenueSharePct: number;
  commission: number;
  netRevenue: number;
  avgLos: number;
  avgLeadDays: number;
  cancellations: number;
  cancellationRatePct: number;
}

export interface Segmentation {
  by: SegmentBy;
  bucket: 'day' | 'week' | 'month';
  segments: SegmentRow[];
  /** Revenue per bucket per segment key (top segments; the rest under "other") */
  trend: { bucket: string; values: Record<string, number> }[];
  totals: { reservations: number; roomNights: number; revenue: number; adr: number; commission: number; netRevenue: number };
}

const TOP_SEGMENTS = 7;

function bucketOf(date: string, bucket: 'day' | 'week' | 'month'): string {
  if (bucket === 'day') return date;
  if (bucket === 'month') return date.slice(0, 7);
  const d = parseUTCDate(date);
  const thursday = addDays(d, 4 - (d.getUTCDay() || 7));
  return `${thursday.getUTCFullYear()}-W${String(isoWeek(d)).padStart(2, '0')}`;
}

/** Segment keys of a stay with the share of the stay each one carries */
function segmentsOf(stay: Stay, by: SegmentBy): { key: string; share: number }[] {
  if (by === 'source') return [{ key: stay.source, share: 1 }];
  if (by === 'ratePlan') return [{ key: stay.ratePlanName ? `rp:${stay.ratePlanName}` : 'none', share: 1 }];
  const counts = new Map<string, number>();
  for (const t of stay.roomTypeIds) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([key, n]) => ({ key, share: n / stay.roomTypeIds.length }));
}

export function buildSegmentation(
  stays: Stay[],
  from: string,
  to: string,
  by: SegmentBy,
  today: string,
  labels: Record<string, string> = {},
): Segmentation {
  const days = dateRange(from, to);
  const bucket = days.length > 92 ? 'month' : days.length > 31 ? 'week' : 'day';

  interface Acc { label: string; res: number; roomNights: number; revenue: number; commission: number; nights: number; lead: number; arrivals: number; cancelled: number }
  const acc = new Map<string, Acc>();
  const get = (key: string, label: string) => {
    if (!acc.has(key)) acc.set(key, { label, res: 0, roomNights: 0, revenue: 0, commission: 0, nights: 0, lead: 0, arrivals: 0, cancelled: 0 });
    return acc.get(key)!;
  };
  const labelOf = (stay: Stay, key: string) =>
    by === 'source' ? stay.sourceLabel : by === 'ratePlan' ? (stay.ratePlanName ?? labels.none ?? 'No rate plan') : (labels[key] ?? labels.unknown ?? 'Unknown');
  const trendAcc = new Map<string, Map<string, number>>();

  for (const stay of stays) {
    const arrivesInRange = stay.checkIn >= from && stay.checkIn <= to;
    for (const { key, share } of segmentsOf(stay, by)) {
      const a = get(key, labelOf(stay, key));
      if (stay.cancelled) {
        if (arrivesInRange) { a.cancelled += share; a.arrivals += share; }
        continue;
      }
      const sold = soldInRange(stay, from, to, today);
      if (sold.nights === 0) continue;
      a.res += share;
      a.roomNights += sold.roomNights * share;
      a.revenue += sold.revenue * share;
      a.commission += (stay.roomRevenue > 0 ? stay.commission * (sold.revenue / stay.roomRevenue) : 0) * share;
      a.nights += stay.nights * share;
      a.lead += stay.leadDays * share;
      if (arrivesInRange) a.arrivals += share;

      const perNight = revenuePerNight(stay) * share;
      for (const night of stayNights(stay)) {
        if (night < from || night > to || !nightSold(stay, night, today)) continue;
        const b = bucketOf(night, bucket);
        if (!trendAcc.has(b)) trendAcc.set(b, new Map());
        const m = trendAcc.get(b)!;
        m.set(key, (m.get(key) ?? 0) + perNight);
      }
    }
  }

  const totalRevenue = [...acc.values()].reduce((s, a) => s + a.revenue, 0);
  const segments: SegmentRow[] = [...acc]
    .filter(([, a]) => a.res > 0 || a.cancelled > 0)
    .map(([key, a]) => ({
      key,
      label: a.label,
      reservations: round2(a.res),
      roomNights: round2(a.roomNights),
      revenue: round2(a.revenue),
      adr: a.roomNights > 0 ? round2(a.revenue / a.roomNights) : 0,
      revenueSharePct: pct(a.revenue, totalRevenue),
      commission: round2(a.commission),
      netRevenue: round2(a.revenue - a.commission),
      avgLos: a.res > 0 ? round2(a.nights / a.res) : 0,
      avgLeadDays: a.res > 0 ? round2(a.lead / a.res) : 0,
      cancellations: round2(a.cancelled),
      cancellationRatePct: pct(a.cancelled, a.arrivals),
    }))
    .sort((x, y) => y.revenue - x.revenue);

  const top = new Set(segments.slice(0, TOP_SEGMENTS).map((s) => s.key));
  const buckets = [...new Set(days.map((d) => bucketOf(d, bucket)))];
  const trend = buckets.map((b) => {
    const values: Record<string, number> = {};
    for (const [key, v] of trendAcc.get(b) ?? []) {
      const k = top.has(key) ? key : 'other';
      values[k] = round2((values[k] ?? 0) + v);
    }
    return { bucket: b, values };
  });

  const roomNights = segments.reduce((s, r) => s + r.roomNights, 0);
  const commission = segments.reduce((s, r) => s + r.commission, 0);
  return {
    by,
    bucket,
    segments,
    trend,
    totals: {
      reservations: stays.filter((s) => !s.cancelled && soldInRange(s, from, to, today).nights > 0).length,
      roomNights: round2(roomNights),
      revenue: round2(totalRevenue),
      adr: roomNights > 0 ? round2(totalRevenue / roomNights) : 0,
      commission: round2(commission),
      netRevenue: round2(totalRevenue - commission),
    },
  };
}

export async function computeSegmentation(from: string, to: string, by: SegmentBy, today: string): Promise<Segmentation> {
  const stays = await loadStays(from, to, { includeCancelled: true });
  const labels: Record<string, string> = {};
  if (by === 'roomType') {
    const ids = [...new Set(stays.flatMap((s) => s.roomTypeIds).filter((id) => id !== 'unknown'))];
    const types: any[] = ids.length ? await RoomType.find({ _id: { $in: ids } }).select('name').lean() : [];
    for (const t of types) labels[String(t._id)] = t.name;
  }
  return buildSegmentation(stays, from, to, by, today, labels);
}

// ─── Booking insights ─────────────────────────────────────────────────────────

export const LEAD_BUCKETS = [
  { key: '0', min: 0, max: 0 },
  { key: '1-3', min: 1, max: 3 },
  { key: '4-7', min: 4, max: 7 },
  { key: '8-14', min: 8, max: 14 },
  { key: '15-30', min: 15, max: 30 },
  { key: '31-60', min: 31, max: 60 },
  { key: '61-90', min: 61, max: 90 },
  { key: '91+', min: 91, max: Infinity },
];
export const LOS_BUCKETS = [
  { key: '1', min: 1, max: 1 }, { key: '2', min: 2, max: 2 }, { key: '3', min: 3, max: 3 },
  { key: '4', min: 4, max: 4 }, { key: '5', min: 5, max: 5 }, { key: '6', min: 6, max: 6 },
  { key: '7', min: 7, max: 7 }, { key: '8-14', min: 8, max: 14 }, { key: '15+', min: 15, max: Infinity },
];

export interface BookingInsights {
  arrivals: number;
  avgLeadDays: number;
  avgLos: number;
  avgPartySize: number;
  repeatGuestPct: number;
  cancellationRatePct: number;
  noShows: number;
  noShowRatePct: number;
  leadTime: { key: string; reservations: number; cancellations: number; cancellationRatePct: number; adr: number }[];
  lengthOfStay: { key: string; reservations: number; roomNights: number }[];
  /** Monday = 0; nightly occupancy / ADR averaged by weekday over the range */
  dayOfWeek: { dow: number; arrivals: number; occupancyPct: number; adr: number }[];
  cancellationsBySource: { key: string; label: string; reservations: number; cancellations: number; cancellationRatePct: number }[];
}

const inBucket = (v: number, b: { min: number; max: number }) => v >= b.min && v <= b.max;

export function buildBookingInsights(
  stays: Stay[],
  nightRows: NightRow[],
  firstStayByGuest: Map<string, string>,
  today: string,
): BookingInsights {
  const live = stays.filter((s) => !s.cancelled);
  const noShowStays = live.filter((s) => s.checkIn < today && (s.status === 'pending' || s.status === 'confirmed'));
  const adrOf = (list: Stay[]) => {
    const rn = list.reduce((n, s) => n + s.nights * s.rooms, 0);
    return rn > 0 ? round2(list.reduce((n, s) => n + s.roomRevenue, 0) / rn) : 0;
  };
  const avg = (list: Stay[], f: (s: Stay) => number) => (list.length ? round2(list.reduce((n, s) => n + f(s), 0) / list.length) : 0);

  const leadTime = LEAD_BUCKETS.map((b) => {
    const all = stays.filter((s) => inBucket(s.leadDays, b));
    const ok = all.filter((s) => !s.cancelled);
    return { key: b.key, reservations: ok.length, cancellations: all.length - ok.length, cancellationRatePct: pct(all.length - ok.length, all.length), adr: adrOf(ok) };
  });
  const lengthOfStay = LOS_BUCKETS.map((b) => {
    const list = live.filter((s) => inBucket(s.nights, b));
    return { key: b.key, reservations: list.length, roomNights: list.reduce((n, s) => n + s.nights * s.rooms, 0) };
  });
  const dowOf = (date: string) => (parseUTCDate(date).getUTCDay() + 6) % 7;
  const dayOfWeek = Array.from({ length: 7 }, (_, dow) => {
    const rows = nightRows.filter((r) => dowOf(r.date) === dow);
    const t = totals(rows);
    return { dow, arrivals: live.filter((s) => dowOf(s.checkIn) === dow).length, occupancyPct: t.occupancyPct, adr: t.adr };
  });
  const bySource = new Map<string, { label: string; all: number; cancelled: number }>();
  for (const s of stays) {
    if (!bySource.has(s.source)) bySource.set(s.source, { label: s.sourceLabel, all: 0, cancelled: 0 });
    const e = bySource.get(s.source)!;
    e.all++;
    if (s.cancelled) e.cancelled++;
  }
  const repeat = live.filter((s) => s.guestKey && (firstStayByGuest.get(s.guestKey) ?? s.checkIn) < s.checkIn);

  return {
    arrivals: live.length,
    avgLeadDays: avg(live, (s) => s.leadDays),
    avgLos: avg(live, (s) => s.nights),
    avgPartySize: avg(live, (s) => s.guests / s.rooms),
    repeatGuestPct: pct(repeat.length, live.filter((s) => s.guestKey).length),
    cancellationRatePct: pct(stays.length - live.length, stays.length),
    noShows: noShowStays.length,
    noShowRatePct: pct(noShowStays.length, live.filter((s) => s.checkIn < today).length),
    leadTime,
    lengthOfStay,
    dayOfWeek,
    cancellationsBySource: [...bySource]
      .map(([key, e]) => ({ key, label: e.label, reservations: e.all - e.cancelled, cancellations: e.cancelled, cancellationRatePct: pct(e.cancelled, e.all) }))
      .sort((a, b) => b.reservations + b.cancellations - (a.reservations + a.cancellations)),
  };
}

export async function computeBookingInsights(from: string, to: string, today: string): Promise<BookingInsights> {
  const [arriving, staying, capacity] = await Promise.all([
    loadStays(from, to, { includeCancelled: true, checkInOnly: true }),
    loadStays(from, to),
    loadCapacity(from, to),
  ]);
  const guestKeys = [...new Set(arriving.map((s) => s.guestKey).filter((k): k is string => !!k))];
  const firstStay = new Map<string, string>();
  if (guestKeys.length) {
    const ids = guestKeys.filter((k) => /^[0-9a-f]{24}$/.test(k));
    const emails = guestKeys.filter((k) => !/^[0-9a-f]{24}$/.test(k));
    const firsts: any[] = await Reservation.aggregate([
      { $match: { type: 'room', status: { $ne: 'cancelled' }, $or: [{ guestRecord: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, { 'contactInfo.email': { $in: emails } }] } },
      { $group: { _id: { $ifNull: [{ $toString: '$guestRecord' }, { $toLower: '$contactInfo.email' }] }, first: { $min: '$checkInDate' } } },
    ]);
    for (const f of firsts) firstStay.set(String(f._id), toDateStr(new Date(f.first)));
  }
  return buildBookingInsights(arriving, nightlyRows(dateRange(from, to), staying, capacity, today), firstStay, today);
}
