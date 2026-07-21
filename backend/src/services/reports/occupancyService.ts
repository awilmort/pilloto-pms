import Reservation from '../../models/Reservation';
import Room from '../../models/Room';
import Folio from '../../models/Folio';
import Charge from '../../models/Charge';
import {
  toDateStr,
  parseUTCDate,
  addDays,
  daysBetween,
  buildDateRange,
  isoWeek,
  round2,
} from '../../utils/dateUtils';
import {
  GroupBy,
  OccupancyRow,
  OccupancySummary,
  OccupancyComparison,
} from '../../types/reports';

// ─── Grouping ─────────────────────────────────────────────────────────────────

function bucketKey(dateStr: string, groupBy: GroupBy): string {
  if (groupBy === 'day') return dateStr;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (groupBy === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return `${d.getUTCFullYear()}-W${String(isoWeek(d)).padStart(2, '0')}`;
}

export function groupRows(rows: OccupancyRow[], groupBy: GroupBy): OccupancyRow[] {
  if (groupBy === 'day') return rows;
  const buckets = new Map<string, OccupancyRow[]>();
  for (const row of rows) {
    const key = bucketKey(row.date, groupBy);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }
  const result: OccupancyRow[] = [];
  for (const [key, group] of buckets) {
    const roomsAvailable = group.reduce((s, r) => s + r.roomsAvailable, 0);
    const roomsSold = group.reduce((s, r) => s + r.roomsSold, 0);
    const roomRevenue = round2(group.reduce((s, r) => s + r.roomRevenue, 0));
    const occupancyPct = roomsAvailable > 0 ? round2((roomsSold / roomsAvailable) * 100) : 0;
    const adr = roomsSold > 0 ? round2(roomRevenue / roomsSold) : 0;
    const revpar = roomsAvailable > 0 ? round2(roomRevenue / roomsAvailable) : 0;
    result.push({ date: key, roomsAvailable, roomsSold, occupancyPct, roomRevenue, adr, revpar });
  }
  return result;
}

export function summarise(rows: OccupancyRow[]): OccupancySummary {
  if (rows.length === 0) {
    return { occupancyPct: 0, adr: 0, revpar: 0, roomRevenue: 0, roomsSold: 0, roomsAvailable: 0 };
  }
  const totalAvailable = rows.reduce((s, r) => s + r.roomsAvailable, 0);
  const totalSold = rows.reduce((s, r) => s + r.roomsSold, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.roomRevenue, 0);
  return {
    occupancyPct: totalAvailable > 0 ? round2((totalSold / totalAvailable) * 100) : 0,
    adr: totalSold > 0 ? round2(totalRevenue / totalSold) : 0,
    revpar: totalAvailable > 0 ? round2(totalRevenue / totalAvailable) : 0,
    roomRevenue: round2(totalRevenue),
    roomsSold: totalSold,
    roomsAvailable: totalAvailable,
  };
}

export function rowsToCsv(rows: OccupancyRow[]): string {
  const header = 'Date,Rooms Available,Rooms Sold,Occupancy %,Room Revenue,ADR,RevPAR';
  const lines = rows.map(
    (r) =>
      `${r.date},${r.roomsAvailable},${r.roomsSold},${r.occupancyPct.toFixed(2)},${r.roomRevenue.toFixed(2)},${r.adr.toFixed(2)},${r.revpar.toFixed(2)}`,
  );
  return [header, ...lines].join('\n');
}

// ─── Core computation ─────────────────────────────────────────────────────────

export async function computeOccupancy(from: Date, to: Date): Promise<OccupancyRow[]> {
  const totalRooms = await Room.countDocuments({ status: 'active' });
  const days = buildDateRange(from, to);

  if (totalRooms === 0) {
    return days.map((date) => ({
      date,
      roomsAvailable: 0,
      roomsSold: 0,
      occupancyPct: 0,
      roomRevenue: 0,
      adr: 0,
      revpar: 0,
    }));
  }

  const reservations = await Reservation.find({
    type: 'room',
    status: { $in: ['checked-in', 'completed'] },
    checkInDate: { $lte: addDays(to, 1) },
    checkOutDate: { $gt: from },
  })
    .select('_id checkInDate checkOutDate')
    .lean();

  const resIds = (reservations as any[]).map((r) => r._id);
  const folios = await Folio.find({ reservationId: { $in: resIds } })
    .select('_id reservationId')
    .lean();

  const folioToRes = new Map<string, string>();
  for (const f of folios as any[]) folioToRes.set(String(f._id), String(f.reservationId));

  const folioIds = (folios as any[]).map((f) => f._id);
  const charges = await Charge.find({ folioId: { $in: folioIds }, category: 'room' })
    .select('folioId amount')
    .lean();

  const revenueByRes = new Map<string, number>();
  for (const c of charges as any[]) {
    const rid = folioToRes.get(String(c.folioId));
    if (rid) revenueByRes.set(rid, (revenueByRes.get(rid) || 0) + Number(c.amount));
  }

  const soldByDay = new Map<string, number>(days.map((d) => [d, 0]));
  const revByDay = new Map<string, number>(days.map((d) => [d, 0]));

  for (const res of reservations as any[]) {
    const checkIn = parseUTCDate(toDateStr(new Date(res.checkInDate)));
    const checkOut = parseUTCDate(toDateStr(new Date(res.checkOutDate)));
    const totalNights = Math.max(1, daysBetween(checkIn, checkOut));
    const totalRev = revenueByRes.get(String(res._id)) || 0;
    const revPerNight = totalRev / totalNights;

    let cur = new Date(checkIn);
    while (cur < checkOut) {
      const ds = toDateStr(cur);
      if (soldByDay.has(ds)) {
        soldByDay.set(ds, (soldByDay.get(ds) || 0) + 1);
        revByDay.set(ds, (revByDay.get(ds) || 0) + revPerNight);
      }
      cur = addDays(cur, 1);
    }
  }

  return days.map((date) => {
    const roomsSold = soldByDay.get(date) || 0;
    const roomRevenue = round2(revByDay.get(date) || 0);
    const occupancyPct = totalRooms > 0 ? round2((roomsSold / totalRooms) * 100) : 0;
    const adr = roomsSold > 0 ? round2(roomRevenue / roomsSold) : 0;
    const revpar = totalRooms > 0 ? round2(roomRevenue / totalRooms) : 0;
    return { date, roomsAvailable: totalRooms, roomsSold, occupancyPct, roomRevenue, adr, revpar };
  });
}

// ─── Comparison builder ───────────────────────────────────────────────────────

export async function buildComparison(
  fromDate: Date,
  toDate: Date,
  compareTo: 'prev_period' | 'prev_year',
  groupBy: GroupBy,
): Promise<OccupancyComparison> {
  const rangeLen = daysBetween(fromDate, toDate) + 1;
  let compFrom: Date;
  let compTo: Date;

  if (compareTo === 'prev_period') {
    compTo = addDays(fromDate, -1);
    compFrom = addDays(compTo, -(rangeLen - 1));
  } else {
    compFrom = new Date(fromDate);
    compFrom.setUTCFullYear(compFrom.getUTCFullYear() - 1);
    compTo = new Date(toDate);
    compTo.setUTCFullYear(compTo.getUTCFullYear() - 1);
  }

  let compRows = await computeOccupancy(compFrom, compTo);
  compRows = groupRows(compRows, groupBy);
  return { summary: summarise(compRows), rows: compRows };
}
