// ─── Shared ───────────────────────────────────────────────────────────────────

export type GroupBy = 'day' | 'week' | 'month';

// ─── Occupancy ────────────────────────────────────────────────────────────────

export interface OccupancyRow {
  date: string;
  roomsAvailable: number;
  roomsSold: number;
  occupancyPct: number;
  roomRevenue: number;
  adr: number;
  revpar: number;
}

export interface OccupancySummary {
  occupancyPct: number;
  adr: number;
  revpar: number;
  roomRevenue: number;
  roomsSold: number;
  roomsAvailable: number;
}

export interface OccupancyComparison {
  summary: OccupancySummary;
  rows: OccupancyRow[];
}

// ─── Night Audit ──────────────────────────────────────────────────────────────

export interface NightAuditRoomStats {
  totalRooms: number;
  occupied: number;
  arrivals: number;
  arrivalsDone: number;
  departures: number;
  departuresDone: number;
  noShows: number;
  stayOvers: number;
}

export interface NightAuditRevenue {
  room: number;
  service: number;
  lateFee: number;
  damage: number;
  adjustment: number;
  other: number;
  total: number;
}

export interface NightAuditPayments {
  cash: number;
  card: number;
  transfer: number;
  check: number;
  credit: number;
  total: number;
}

export interface NightAuditOutstanding {
  openFoliosCount: number;
  totalOutstanding: number;
}

export interface CashierClosureSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalCash: number;
  totalCard: number;
  totalTransfer: number;
  totalCheck: number;
  total: number;
}

export interface NightAuditData {
  date: string;
  roomStats: NightAuditRoomStats;
  revenue: NightAuditRevenue;
  payments: NightAuditPayments;
  outstanding: NightAuditOutstanding;
  cashierClosures: CashierClosureSummary[];
}

export interface NightAuditRangeRow {
  date: string;
  totalRooms: number;
  occupied: number;
  arrivals: number;
  departures: number;
  noShows: number;
  totalRevenue: number;
  totalPayments: number;
}

// ─── Arrivals & Departures ────────────────────────────────────────────────────

export interface ArrivalRow {
  reservationId: string;
  reservationCode: string;
  guestName: string;
  guestEmail: string;
  roomName: string | null;
  type: 'room' | 'daypass' | 'PasaTarde' | 'event';
  checkInDate: string;
  checkOutDate: string | null;
  totalGuests: number;
  balanceDue: number;
  folioStatus: 'open' | 'in_ar' | 'closed' | 'none';
  specialRequests: string | null;
  status: string;
  isCorporate: boolean;
}

export interface DepartureRow {
  reservationId: string;
  reservationCode: string;
  guestName: string;
  guestEmail: string;
  roomName: string | null;
  type: 'room' | 'daypass' | 'PasaTarde' | 'event';
  checkInDate: string;
  checkOutDate: string | null;
  totalGuests: number;
  balanceRemaining: number;
  folioStatus: 'open' | 'in_ar' | 'closed' | 'none';
  paymentStatus: 'paid' | 'partial' | 'unpaid';
  isFolioClosed: boolean;
  specialRequests: string | null;
  status: string;
  isCorporate: boolean;
}
