/** Response shapes of the PMS management reports (/api/admin/reports/*). */

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

export interface Totals {
  roomsAvailable: number;
  roomsSold: number;
  roomRevenue: number;
  occupancyPct: number;
  adr: number;
  revpar: number;
}

export interface OccupancyReportData {
  filters: { from: string; to: string; groupBy: string; compareTo: string | null };
  summary: Totals;
  rows: NightRow[];
  comparison: { summary: Totals; rows: NightRow[] } | null;
}

export interface FlashPeriod { from: string; to: string; current: Totals; lastYear: Totals }

export interface ManagerFlashData {
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

export interface ForecastRow extends NightRow {
  arrivals: number;
  departures: number;
  pickup7: number;
  stlyDate: string;
  stlyRoomsSold: number;
  stlyRevenue: number;
  stlyOccupancyPct: number;
}

export interface ForecastData {
  filters: { from: string; to: string };
  asOf: string;
  rows: ForecastRow[];
  summary: Totals & { pickup7: number; stly: Totals };
}

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

export interface SegmentationData {
  filters: { from: string; to: string; by: SegmentBy };
  by: SegmentBy;
  bucket: 'day' | 'week' | 'month';
  segments: SegmentRow[];
  trend: { bucket: string; values: Record<string, number> }[];
  totals: { reservations: number; roomNights: number; revenue: number; adr: number; commission: number; netRevenue: number };
}

export interface BookingInsightsData {
  filters: { from: string; to: string };
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
  dayOfWeek: { dow: number; arrivals: number; occupancyPct: number; adr: number }[];
  cancellationsBySource: { key: string; label: string; reservations: number; cancellations: number; cancellationRatePct: number }[];
}
