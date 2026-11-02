/** Home panel — mirrors backend/src/services/reports/dashboardService.ts */
import type { NightRow, Totals } from './reports';

export interface PanelStay {
  id: string;
  code: string;
  guest: string;
  status: 'pending' | 'confirmed' | 'checked-in' | 'completed' | 'cancelled';
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  roomNames: string[];
  unassigned: boolean;
  adults: number;
  children: number;
  source: string;
  sourceLabel: string;
  corporate: boolean;
  specialRequests: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
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
  meta?: Record<string, number>;
  items: { id: string; label: string; detail: string; date?: string }[];
}

export interface DashboardData {
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
      id: string; code: string; guest: string; status: PanelStay['status']; sourceLabel: string; source: string;
      checkIn: string; nights: number; rooms: number; createdAt: string; value?: number;
    }[];
  };
  dayVisits: { reservations: number; guests: number; byType: Record<string, number> } | null;
}
