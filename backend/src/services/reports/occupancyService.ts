import {
  toDateStr,
  addDays,
  daysBetween,
  buildDateRange,
  isoWeek,
  round2,
} from '../../utils/dateUtils';
import { loadStays, loadCapacity, nightlyRows } from './stayEngine';
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
    const roomsOutOfOrder = group.reduce((s, r) => s + r.roomsOutOfOrder, 0);
    const roomsSold = group.reduce((s, r) => s + r.roomsSold, 0);
    const roomRevenue = round2(group.reduce((s, r) => s + r.roomRevenue, 0));
    const occupancyPct = roomsAvailable > 0 ? round2((roomsSold / roomsAvailable) * 100) : 0;
    const adr = roomsSold > 0 ? round2(roomRevenue / roomsSold) : 0;
    const revpar = roomsAvailable > 0 ? round2(roomRevenue / roomsAvailable) : 0;
    result.push({ date: key, roomsAvailable, roomsOutOfOrder, roomsSold, occupancyPct, roomRevenue, adr, revpar });
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
  const header = 'Date,Rooms Available,Out of Service,Rooms Sold,Occupancy %,Room Revenue,ADR,RevPAR';
  const lines = rows.map(
    (r) =>
      `${r.date},${r.roomsAvailable},${r.roomsOutOfOrder},${r.roomsSold},${r.occupancyPct.toFixed(2)},${r.roomRevenue.toFixed(2)},${r.adr.toFixed(2)},${r.revpar.toFixed(2)}`,
  );
  return [header, ...lines].join('\n');
}

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * Nightly occupancy / ADR / RevPAR over [from, to] on the shared stay-night engine: past
 * nights are actuals, today onwards what is on the books; out-of-service rooms are not
 * available. `today` is the property's local date.
 */
export async function computeOccupancy(from: Date, to: Date, today: string = toDateStr(new Date())): Promise<OccupancyRow[]> {
  const fromStr = toDateStr(from);
  const toStr = toDateStr(to);
  const [stays, capacity] = await Promise.all([loadStays(fromStr, toStr), loadCapacity(fromStr, toStr)]);
  return nightlyRows(buildDateRange(from, to), stays, capacity, today);
}

// ─── Comparison builder ───────────────────────────────────────────────────────

export async function buildComparison(
  fromDate: Date,
  toDate: Date,
  compareTo: 'prev_period' | 'prev_year',
  groupBy: GroupBy,
  today: string = toDateStr(new Date()),
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

  let compRows = await computeOccupancy(compFrom, compTo, today);
  compRows = groupRows(compRows, groupBy);
  return { summary: summarise(compRows), rows: compRows };
}
