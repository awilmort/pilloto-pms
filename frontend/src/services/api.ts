import axios, { AxiosInstance, AxiosResponse } from 'axios';
import i18n from '../i18n';
import { User, Room, Reservation, MediaItem, Amenity, EventType, Company, Guest, CreditAccount, AppCode } from '../types';
import type { OccupancyReportData, ManagerFlashData, ForecastData, SegmentationData, SegmentBy, BookingInsightsData } from '../types/reports';
import type { DashboardData } from '../types/dashboard';
import type { Customer, RoomBlock, RoomBlockReason } from '../types';
import type { ChargeTemplate, ChargeRule, ChargeRuleExecution, AuditRun } from '../types';
import type {
  ElectronicInvoice, EcfMonthlyTaxRow, FiscalActivation, FiscalAlert, FiscalPlanId, FiscalPlans, FiscalReadiness, FiscalSequence,
  FiscalStatement, FiscalStatus, FiscalUsage, ReceivedDecision, ReceivedDocument, ReceivedDocumentDetail,
} from '../types';
import type { Warehouse, Product, InventoryTransaction, InventoryAdjustmentReason } from '../types';
import type { Invoice, InvoicePaymentMethod, Quote, InvoiceFormMeta } from '../types';
import type { Account, Supplier, Bill, BillPaymentMethod } from '../types';
import type { CreditNote, CreditNoteReason, CreditNoteFiscalModificationCode, CreditNoteRefundMethod } from '../types';
import type { DebitNote, DebitNoteReason, DebitNoteFiscalModificationCode, DebitNotePaymentMethod } from '../types';
import type { JournalEntry, JournalEntrySource } from '../types';
import type {
  TrialBalanceReport, ProfitAndLossReport, BalanceSheetReport,
  ApAgingReport, ArAgingReport, GeneralLedgerReport,
  SupplierStatementReport, CustomerStatementReport, AccountingDashboardData, DashboardPeriod,
} from '../types';
import type {
  BillingCharge, BillingIssuer, BillingIssuerReadiness, BillingOverview, BillingPayment, BillingPlanEntry, BillingProduct, BillingSequence, BillingSettings, BillingTenant, BillingTenantDetail, Paged, RecordPaymentBody,
} from '../types/billing';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
// Prefer the explicit public backend URL env var; fall back to deriving from API_BASE_URL.
// REACT_APP_BACKEND_PUBLIC_URL must match BACKEND_PUBLIC_URL in the backend .env.
export const API_ORIGIN = (() => {
  if (process.env.REACT_APP_BACKEND_PUBLIC_URL) {
    return process.env.REACT_APP_BACKEND_PUBLIC_URL.replace(/\/$/, '');
  }
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return API_BASE_URL.replace(/\/api$/, '');
  }
})();

// Resolve relative media URLs (e.g., /uploads/xyz) against backend origin
export const resolveMediaUrl = (url: string): string =>
  url?.startsWith('http') ? url : `${API_ORIGIN}${url || ''}`;

// Create axios instance with default configuration
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Include cookies for authentication
});

// Request interceptor to add auth token and tenant slug
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Inject X-Tenant-Slug so the backend can resolve the tenant
    // regardless of whether the request comes from a subdomain or localhost.
    const subdomain = (() => {
      const parts = window.location.hostname.split('.');
      if (parts.length >= 3) return parts[0].toLowerCase();
      // local: slug.localhost
      if (parts.length === 2 && parts[1] === 'localhost') return parts[0].toLowerCase();
      return undefined;
    })();

    if (subdomain === 'admin') {
      config.headers['X-Tenant-Slug'] = '__superadmin__';
    } else {
      const slug = subdomain || process.env.REACT_APP_TENANT_SLUG;
      if (slug) config.headers['X-Tenant-Slug'] = slug;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for handling common responses
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error) => {
    // Gracefully handle rate limiting without forcing logout
    if (error.response?.status === 429) {
      const msg = error.response?.data?.message || i18n.t('common.tooManyRequests');
      // Surface to UI if available; avoid clearing auth token
      if (typeof window !== 'undefined' && (window as any).toast?.error) {
        (window as any).toast.error(msg);
      }
      return Promise.reject(error);
    }
    if (error.response?.status === 401) {
      // List of public endpoints that don't require authentication
      const publicEndpoints = [
        '/amenities',
        '/rooms',
        '/media',
        '/pricing',
        '/booking',
        '/auth/login',
        '/auth/register',
        '/auth/forgot-password',
        '/auth/reset-password',
        // Do not force logout on auth check endpoint while on public pages
        '/auth/me'
      ];

      const requestUrl = error.config?.url || '';
      const isPublicEndpoint = publicEndpoints.some(endpoint => requestUrl.includes(endpoint));

      // Only redirect to login if it's not a public endpoint
      if (!isPublicEndpoint) {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// API Response wrapper interface
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  count?: number;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

// Auth Service
export const authService = {
  register: (userData: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    phone?: string;
  }): Promise<AxiosResponse<{ success: boolean; message: string; user: User; token: string }>> =>
    apiClient.post('/auth/register', userData),

  login: (credentials: {
    email: string;
    password: string;
  }): Promise<AxiosResponse<{ success: boolean; message: string; user: User; token: string }>> =>
    apiClient.post('/auth/login', credentials),

  logout: (): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.post('/auth/logout'),

  getCurrentUser: (): Promise<AxiosResponse<{ success: boolean; user: User }>> =>
    apiClient.get('/auth/me'),

  updateProfile: (data: Partial<{ firstName: string; lastName: string; phone?: string; email?: string }>): Promise<AxiosResponse<{ success: boolean; message: string; user: User }>> =>
    apiClient.put('/auth/profile', data),

  changePassword: (data: { currentPassword: string; newPassword: string }): Promise<AxiosResponse<{ success: boolean; message: string }>> =>
    apiClient.put('/auth/change-password', data),

  forgotPassword: (email: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.post('/auth/forgot-password', { email }),

  /** Who an invitation link is for (400 invalid/used, 410 expired) */
  getInvitation: (token: string): Promise<AxiosResponse<ApiResponse<{ firstName: string; email: string; tenantName: string }>>> =>
    apiClient.get('/auth/invitation', { params: { token } }),

  /** Choose the first password; the response logs the user in (token) */
  acceptInvitation: (token: string, password: string): Promise<AxiosResponse<ApiResponse & { token?: string }>> =>
    apiClient.post('/auth/accept-invitation', { token, password }),

  resetPassword: (token: string, password: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.post('/auth/reset-password', { token, password }),

  verifyEmail: (token: string): Promise<AxiosResponse<{ success: boolean; message: string; user?: User; token?: string }>> =>
    apiClient.post('/auth/verify-email', { token }),

  resendVerification: (email: string): Promise<AxiosResponse<{ success: boolean; message: string }>> =>
    apiClient.post('/auth/resend-verification', { email }),
};

// Rooms Service
export const roomsService = {
  getRooms: (params?: {
    page?: number;
    limit?: number;
    type?: string;
    minPrice?: number;
    maxPrice?: number;
    available?: boolean;
  }): Promise<AxiosResponse<ApiResponse<{ rooms: Room[]; totalPages: number; currentPage: number }>>> =>
    apiClient.get('/rooms', { params }),

  getRoom: (id: string): Promise<AxiosResponse<ApiResponse<Room>>> =>
    apiClient.get(`/rooms/${id}`),

  checkAvailability: (roomId: string, checkIn: string, checkOut: string): Promise<AxiosResponse<ApiResponse<{ available: boolean }>>> =>
    apiClient.get(`/rooms/${roomId}/availability`, { params: { checkIn, checkOut } }),

  /** Rooms free for every night; `excludeReservationId` leaves the reservation being edited out. */
  getAvailableRooms: (
    checkIn: string,
    checkOut: string,
    opts?: { excludeReservationId?: string; roomTypeId?: string },
  ): Promise<AxiosResponse<ApiResponse<Room[]> & { typeAvailability?: Record<string, number> }>> =>
    apiClient.get('/rooms/available', { params: { checkIn, checkOut, ...opts } }),

  getAvailableDates: (startDate: string, endDate: string): Promise<AxiosResponse<ApiResponse<{ availableDates: string[]; unavailableDates: string[]; totalActiveRooms: number }>>> =>
    apiClient.get('/rooms/available-dates', { params: { startDate, endDate } }),

};

// Room blocks (rooms out of service over a date range)
export interface RoomBlockInput {
  roomId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD, the day the room is back
  reason?: RoomBlockReason;
  notes?: string;
  /** Block even though a reservation is assigned to the room on those nights */
  force?: boolean;
}

/** Body of a 409 from create/update: another block, or (without force) assigned reservations. */
export interface RoomBlockConflict {
  code: 'block_overlap' | 'reservation_overlap';
  message: string;
  conflicts: Array<{ reservationId?: string; reservationCode?: string; guestName?: string; checkIn?: string; checkOut?: string }>;
}

export const roomBlocksService = {
  list: (params?: { from?: string; to?: string; roomId?: string }): Promise<AxiosResponse<ApiResponse<RoomBlock[]>>> =>
    apiClient.get('/room-blocks', { params }),

  create: (data: RoomBlockInput): Promise<AxiosResponse<ApiResponse<RoomBlock>>> =>
    apiClient.post('/room-blocks', data),

  update: (id: string, data: Partial<RoomBlockInput>): Promise<AxiosResponse<ApiResponse<RoomBlock>>> =>
    apiClient.put(`/room-blocks/${id}`, data),

  remove: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/room-blocks/${id}`),
};

// ── Rate calendar and booking rules (Pricing → Calendar / Booking rules) ─────
export type WeekdayCode = 'mo' | 'tu' | 'we' | 'th' | 'fr' | 'sa' | 'su';
export type RestrictionField = 'minStayArrival' | 'maxStay' | 'closedToArrival' | 'closedToDeparture' | 'stopSell';
export type CalendarField = 'price' | RestrictionField;

/** Where a Calendar value comes from */
export type ValueSource =
  | { kind: 'plan' }
  | { kind: 'default' }
  | { kind: 'rule'; ruleId: string; name?: string; origin: 'manual' | 'calendar' }
  | { kind: 'booking_rule'; ruleId: string; name?: string; origin: 'manual' | 'calendar' };

export interface CalendarRatePlanDay {
  /** Currency units: `base` is the editable nightly price; `rates` per occupancy is what OTAs receive */
  price: { base: number; single: number; full: number; rates: Record<string, number>; source: ValueSource };
  restrictions: Record<RestrictionField, { value: number | boolean; source: ValueSource }>;
  forcedStopSell?: 'rate_plan_inactive' | 'room_type_inactive' | 'no_price';
}

export interface CalendarAvailability {
  available: number; total: number; blocked: number; assigned: number; unassignedDemand: number; overbooked: number;
}

export interface RateCalendarView {
  from: string;
  to: string;
  dates: string[];
  ratesIncludeTaxes: boolean;
  roomTypes: Array<{
    _id: string;
    name: string;
    capacity: number;
    isActive: boolean;
    sellOnChannels: boolean;
    availability: Record<string, CalendarAvailability>;
    ratePlans: Array<{ _id: string; name: string; isActive: boolean; sellOnChannels: boolean; days: Record<string, CalendarRatePlanDay> }>;
  }>;
}

export interface CalendarSet {
  price?: number;
  minStayArrival?: number;
  maxStay?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
}

/** One row of a Calendar save (PUT /rate-calendar/bulk) */
export interface CalendarChange {
  ratePlanIds: string[];
  dateFrom: string;
  dateTo: string;
  /** Weekdays; omitted or empty = every day */
  days?: WeekdayCode[];
  set?: CalendarSet;
  reset?: CalendarField[];
}

export interface NightReservationRef { _id: string; code?: string; guestName: string; checkIn: string; checkOut: string; status: string }

export interface NightDetails {
  date: string;
  roomTypeId: string;
  counts: CalendarAvailability;
  rooms: Array<{
    _id: string;
    name: string;
    state: 'free' | 'blocked' | 'assigned';
    block?: { _id: string; reason: string; notes?: string; until: string };
    reservation?: NightReservationRef;
  }>;
  unassigned: Array<NightReservationRef & { count: number }>;
}

export const rateCalendarService = {
  get: (params: { from: string; to: string; roomTypeIds?: string }): Promise<AxiosResponse<ApiResponse<RateCalendarView>>> =>
    apiClient.get('/rate-calendar', { params }),

  availability: (roomTypeId: string, date: string): Promise<AxiosResponse<ApiResponse<NightDetails>>> =>
    apiClient.get('/rate-calendar/availability', { params: { roomTypeId, date } }),

  /** One Calendar save: every staged edit and bulk row in a single request */
  bulk: (changes: CalendarChange[]): Promise<AxiosResponse<ApiResponse<{ pricingRulesCreated: number; restrictionRulesCreated: number; rulesTrimmed: number; rulesDeleted: number }>>> =>
    apiClient.put('/rate-calendar/bulk', { changes }),
};

export interface RestrictionRuleRecord {
  _id: string;
  name: string;
  origin: 'manual' | 'calendar';
  scope: 'property' | 'room_types' | 'rate_plans';
  roomTypeIds: string[];
  ratePlanIds: string[];
  dateStart: string;
  dateEnd: string;
  days: WeekdayCode[];
  minStayArrival?: number;
  maxStay?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  stopSell?: boolean;
  isActive: boolean;
  updatedAt?: string;
  summary: { es: string; en: string };
}

/** Create/update body; on update `null` clears a restriction value */
export interface RestrictionRuleInput {
  name?: string;
  scope?: RestrictionRuleRecord['scope'];
  roomTypeIds?: string[];
  ratePlanIds?: string[];
  dateStart?: string;
  dateEnd?: string;
  days?: WeekdayCode[];
  minStayArrival?: number | null;
  maxStay?: number | null;
  closedToArrival?: boolean | null;
  closedToDeparture?: boolean | null;
  stopSell?: boolean | null;
  isActive?: boolean;
}

// ── Rate plan choice (services/ratePlanSelection.ts) ─────────────────────────
export type RateSelectionReason = 'manual' | 'contract' | 'promo' | 'default' | 'cheapest' | 'restricted';

export interface RatePricing {
  basePrice: number;
  occupancyCost: number;
  subtotal: number;
  adjustedSubtotal: number;
  taxes: Array<{ name: string; type: string; amount: number; isInclusive: boolean }>;
  totalTaxes: number;
  finalTotal: number;
  nights: number;
  perNight: number;
  nightly?: Array<{ date: string; price: number }>;
}

export interface RateOption {
  ratePlanId: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  isDefault: boolean;
  /** Unlocked by the promo code given */
  promoMatch: boolean;
  /** A guest or company negotiated rule prices the stay */
  contract: 'guest' | 'company' | null;
  /** The stay breaks none of the plan's booking rules */
  bookable: boolean;
  restrictionMessages: Array<{ es: string; en: string }>;
  restrictionMessage: string | null;
  pricing: RatePricing;
}

export interface RoomRateOptions {
  roomId: string;
  roomName: string;
  roomTypeId: string | null;
  roomTypeName: string;
  capacity: number;
  assignedAdults: number;
  assignedChildren: number;
  options: RateOption[];
  recommended: { ratePlanId: string; reason: Exclude<RateSelectionReason, 'manual'> } | null;
  selected: { ratePlanId: string; reason: RateSelectionReason } | null;
  error: 'no_room_type' | 'no_rate_plan' | null;
}

export interface RateOptionsResult {
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: RoomRateOptions[];
  totals: {
    basePrice: number;
    occupancyCost: number;
    subtotal: number;
    adjustedSubtotal: number;
    taxes: Array<{ name: string; type: string; amount: number; isInclusive: boolean }>;
    totalTaxes: number;
    finalTotal: number;
  };
  unassignedAdults: number;
  unassignedChildren: number;
  promo: { code: string; matched: boolean } | null;
}

/** A rate plan the booking engine offers for a room type */
export interface PublicRateOffer {
  _id: string;
  name: string;
  description: string;
  isDefault: boolean;
  /** Unlocked by the guest's promo code */
  promo: boolean;
  pricing: Omit<RatePricing, 'nightly'>;
}

export interface StayWarning {
  ratePlanId: string;
  ratePlanName: string;
  roomTypeName: string;
  code: 'stop_sell' | 'closed_to_arrival' | 'closed_to_departure' | 'min_stay' | 'max_stay';
  message: { es: string; en: string };
}

export const restrictionRulesService = {
  list: (params?: { origin?: 'manual' | 'calendar'; active?: boolean; from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<RestrictionRuleRecord[]>>> =>
    apiClient.get('/restriction-rules', { params }),

  create: (data: RestrictionRuleInput): Promise<AxiosResponse<ApiResponse<RestrictionRuleRecord>>> =>
    apiClient.post('/restriction-rules', data),

  update: (id: string, data: RestrictionRuleInput): Promise<AxiosResponse<ApiResponse<RestrictionRuleRecord>>> =>
    apiClient.put(`/restriction-rules/${id}`, data),

  remove: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/restriction-rules/${id}`),

  /** Plain-language summary and problems for an unsaved rule */
  preview: (data: RestrictionRuleInput): Promise<AxiosResponse<ApiResponse<{ summary: { es: string; en: string } | null; problems: string[] }>>> =>
    apiClient.post('/restriction-rules/preview', data),

  /** Booking rules a stay breaks (admin dialogs: warnings staff may override) */
  check: (data: { checkIn: string; checkOut: string; ratePlanIds?: string[]; roomIds?: string[] }): Promise<AxiosResponse<ApiResponse<{ warnings: StayWarning[] }>>> =>
    apiClient.post('/restriction-rules/check', data),
};

// ── Channel manager (Settings → Channel Manager) ─────────────────────────────
export type ReadinessId =
  | 'currency' | 'timezone' | 'contact' | 'roomTypes' | 'rooms' | 'ratePlans' | 'limits'
  | 'roomTypesWithoutRooms' | 'unattributableReservations' | 'noPriceNights';

export interface ReadinessCheck {
  id: ReadinessId;
  status: 'ok' | 'warning' | 'error';
  message: string;
  fixRoute: string;
  count?: number;
}

export interface ChannelManagerSettings {
  /** Property name shown on the channels (the property profile's name) */
  name: string;
  autoAssignRooms: boolean;
  sendGuestConfirmationEmail: boolean;
  ratesIncludeTaxes: boolean;
}

export type ChannelPropertyState = 'provisioning' | 'active' | 'disabled' | 'error';

/** Tenant view of the channel manager (white-label: no Channex ids or raw errors) */
export interface ChannelManagerStatus {
  configured: boolean;
  enabled: boolean;
  property: null | {
    status: ChannelPropertyState;
    lastFullSyncAt?: string;
    /** Something went wrong that support must look at */
    hasProblem: boolean;
  };
  /** Room types / rate plans that need attention */
  issues: { kind: 'room_type' | 'rate_plan'; name: string; parentName?: string; status: ChannelMappingRow['status'] }[];
  prerequisites: { id: ReadinessId; ok: boolean; message: string; fixRoute: string }[];
  settings: ChannelManagerSettings;
}

export interface EntitySyncResult {
  kind: 'room_type' | 'rate_plan';
  localId: string;
  name: string;
  action: 'created' | 'updated' | 'unchanged' | 'deleted' | 'skipped_no_rooms' | 'skipped_no_room_type' | 'remap_required' | 'kept_mapped' | 'failed';
  error?: string;
}

export interface EnableResponse {
  status: string;
  sync: { results: EntitySyncResult[]; ok: boolean };
}

export interface ChannelMappingRow {
  kind: 'room_type' | 'rate_plan';
  localId: string;
  name: string;
  parentName?: string;
  channexId: string | null;
  status: 'active' | 'orphaned' | 'remap_required' | 'not_synced';
  lastSyncedAt?: string;
  error?: string;
}

export interface SetupProgress { step: number; answers: Record<string, any>; status: 'in_progress' | 'waiting_ota' | 'completed' | 'abandoned' }

export interface SyncLogRow {
  _id: string;
  createdAt: string;
  trigger: 'delta' | 'full_sync' | 'manual';
  kind: 'availability' | 'restrictions' | 'structure';
  dateFrom?: string;
  dateTo?: string;
  status: 'ok' | 'warning' | 'error';
}

/** Platform console only: the technical details of each Channex call */
export interface SyncLogDetailRow extends SyncLogRow {
  valuesCount: number;
  taskIds: string[];
  warnings: unknown[];
  httpStatus?: number;
  error?: string;
  durationMs?: number;
}

export interface SyncActivity<Row = SyncLogRow> {
  logs: Row[];
  total: number;
  page: number;
  limit: number;
  /** Changes waiting to be sent */
  pending: number;
  lastFullSyncAt?: string;
  lastPushAt?: string;
  pausedUntil?: string;
}

export type BookingInboxState = 'waiting' | 'imported' | 'outdated' | 'failed';

/** One change the OTA sent for a reservation */
export interface ChannelHistoryRow {
  _id: string;
  receivedAt: string;
  sentAt?: string;
  status?: 'new' | 'modified' | 'cancelled';
  state: BookingInboxState;
  acknowledged: boolean;
}

export interface ReservationHistoryEntry {
  id: string;
  at: string;
  action: string;
  actor: { kind: 'user' | 'guest' | 'channel' | 'system'; name?: string };
  changes?: { field: string; from?: unknown; to?: unknown }[];
  note?: string;
  amount?: number;
  method?: string;
  /** Reconstructed from data stored before history tracking existed */
  inferred?: boolean;
}

export interface BookingInboxRow {
  _id: string;
  receivedAt: string;
  /** As the channel manager reports it, e.g. "BookingCom", "Airbnb" */
  otaName?: string;
  otaReservationCode?: string;
  status?: 'new' | 'modified' | 'cancelled';
  state: BookingInboxState;
  guestName?: string;
  arrivalDate?: string;
  departureDate?: string;
  reservationId?: string;
  reservationCode?: string;
  acknowledged: boolean;
}

/** Platform console only */
export interface BookingInboxDetailRow extends BookingInboxRow {
  channexRevisionId: string;
  channexBookingId: string;
  source: 'webhook' | 'feed';
  insertedAt?: string;
  attempts: number;
  error?: string;
  ackedAt?: string;
}

export interface BookingInbox<Row = BookingInboxRow> {
  rows: Row[];
  total: number;
  page: number;
  limit: number;
}

// ── Channels (plan 8.1–8.2) ──
export type ChannelState =
  | 'active' | 'attention' | 'waiting_ota' | 'needs_mapping' | 'ready_to_activate' | 'inactive' | 'removal_scheduled' | 'removed';

export interface ChannelCard {
  /** Pilloto's id for the channel */
  id: string;
  title: string;
  otaCode?: string;
  otaName: string;
  active: boolean;
  state: ChannelState;
  alerts: { critical: number; warning: number };
  connectedAt?: string;
  activatedAt?: string;
  lastEventAt?: string;
  /** Its connect wizard, while unfinished */
  onboarding?: { otaCode: string; step: number; status: string };
}

export interface ChannelStatusView extends ChannelCard {
  /** What blocks activation (empty = ready); absent when it could not be checked */
  problems?: { kind: 'mapping' | 'settings' | 'other'; count: number }[];
  fullSync?: { sentAt: string; status: 'ok' | 'warning' | 'error' };
  stale: boolean;
}

export interface ChannelList {
  channels: ChannelCard[];
  /** Wizards started for an OTA whose channel does not exist yet */
  onboardings: { otaCode: string; step: number; status: string }[];
  stale: boolean;
  /** 'platform_only': Pilloto connects channels for the tenant */
  connection: 'tenant' | 'platform_only';
  /** OTA codes offered, e.g. ['BDC', 'EXP'] */
  offered: string[];
}

export type ChannelWizardStatus = 'in_progress' | 'waiting_ota' | 'completed' | 'abandoned';

export interface ChannelWizardProgress {
  otaCode: string;
  step: number;
  answers: Record<string, any>;
  status: ChannelWizardStatus;
  started: boolean;
  channel: ChannelStatusView | ChannelCard | null;
}

export interface IframeSession { url: string; expiresAt: string }

export const channelManagerService = {
  status: (): Promise<AxiosResponse<ApiResponse<ChannelManagerStatus>>> => apiClient.get('/channel-manager/status'),
  saveSettings: (data: Partial<Omit<ChannelManagerSettings, 'name'>>): Promise<AxiosResponse<ApiResponse<ChannelManagerSettings>>> =>
    apiClient.put('/channel-manager/settings', data),
  readiness: (): Promise<AxiosResponse<ApiResponse<ReadinessCheck[]>>> => apiClient.get('/channel-manager/readiness'),
  preview: (days = 30): Promise<AxiosResponse<ApiResponse<RateCalendarView>>> => apiClient.get('/channel-manager/preview', { params: { days } }),
  getOnboarding: (): Promise<AxiosResponse<ApiResponse<SetupProgress>>> => apiClient.get('/channel-manager/onboarding'),
  saveOnboarding: (data: { step?: number; answers?: Record<string, any> }): Promise<AxiosResponse<ApiResponse<SetupProgress>>> => apiClient.put('/channel-manager/onboarding', data),
  enable: (): Promise<AxiosResponse<ApiResponse<EnableResponse>>> => apiClient.post('/channel-manager/enable'),
  disable: (): Promise<AxiosResponse<ApiResponse<{ status: string }>>> => apiClient.post('/channel-manager/disable'),
  fullSync: (): Promise<AxiosResponse<ApiResponse<{ queued: number }>>> => apiClient.post('/channel-manager/full-sync'),
  syncActivity: (page = 1, limit = 20): Promise<AxiosResponse<ApiResponse<SyncActivity>>> => apiClient.get('/channel-manager/sync-activity', { params: { page, limit } }),
  bookingInbox: (page = 1, limit = 20): Promise<AxiosResponse<ApiResponse<BookingInbox>>> => apiClient.get('/channel-manager/booking-inbox', { params: { page, limit } }),
  channels: (): Promise<AxiosResponse<ApiResponse<ChannelList>>> => apiClient.get('/channel-manager/channels'),
  channelStatus: (id: string): Promise<AxiosResponse<ApiResponse<ChannelStatusView>>> => apiClient.get(`/channel-manager/channels/${id}/status`),
  iframeSession: (data: { otaCode?: string; language: string }): Promise<AxiosResponse<ApiResponse<IframeSession>>> => apiClient.post('/channel-manager/iframe-session', data),
  getChannelOnboarding: (otaCode: string, live = false): Promise<AxiosResponse<ApiResponse<ChannelWizardProgress>>> =>
    apiClient.get(`/channel-manager/channel-onboarding/${otaCode}`, { params: live ? { live: 1 } : {} }),
  saveChannelOnboarding: (otaCode: string, data: { step?: number; answers?: Record<string, any>; status?: ChannelWizardStatus }): Promise<AxiosResponse<ApiResponse<ChannelWizardProgress>>> =>
    apiClient.put(`/channel-manager/channel-onboarding/${otaCode}`, data),
};

// ── Channel alerts (plan 9.1–9.2) ──
export type ChannelAlertType =
  | 'overbooking' | 'unmapped_booking' | 'non_acked_booking' | 'modification_needs_review' | 'currency_mismatch'
  | 'sync_error' | 'sync_warning' | 'rate_error' | 'ari_warning' | 'push_failing'
  | 'channel_disconnected' | 'listing_disconnected' | 'channel_removal_warning' | 'property_removal_warning'
  | 'remap_required' | 'unmap_before_delete'
  | 'airbnb_reservation_request' | 'airbnb_alteration_request' | 'airbnb_inquiry';
export type ChannelAlertSeverity = 'info' | 'warning' | 'critical';
export type ChannelAlertStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';
export type ChannelAlertActionKind = 'reservation' | 'channels' | 'calendar' | 'airbnb_request' | 'none';

export interface ChannelAlert {
  _id: string;
  type: ChannelAlertType;
  severity: ChannelAlertSeverity;
  status: ChannelAlertStatus;
  createdAt: string;
  lastSeenAt?: string;
  occurrences: number;
  dueAt?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  autoResolved?: boolean;
  notes?: string;
  reservationId?: string;
  channelId?: string;
  /** Type-specific values for the text (guestName, otaName, nights, messages, …) */
  params: Record<string, any>;
  action: { kind: ChannelAlertActionKind; path?: string };
}

export interface RequestAvailability {
  nights: string[];
  requestedRoomType: boolean;
  roomTypes: { roomTypeId: string; name: string; bookable: boolean; nights: { date: string; available: number }[] }[];
}

export interface ChannelAlertDetail extends ChannelAlert {
  resolvedByName?: string;
  acknowledgedByName?: string;
  /** Airbnb requests: availability of the requested nights */
  availability?: RequestAvailability | null;
}

export interface ChannelAlertList { alerts: ChannelAlert[]; total: number; page: number; limit: number }
export interface ChannelAlertSummary { openCritical: number; open: number; acknowledged: number; activeCritical: number }
export type ChannelAlertQuery = { status?: string; type?: string; severity?: string; page?: number; limit?: number };
export const AIRBNB_DECLINE_REASONS = ['dates_not_available', 'not_a_good_fit', 'waiting_for_better_reservation', 'not_comfortable'] as const;
export type AirbnbDeclineReason = typeof AIRBNB_DECLINE_REASONS[number];

export const channelAlertsService = {
  list: (q: ChannelAlertQuery = {}): Promise<AxiosResponse<ApiResponse<ChannelAlertList>>> => apiClient.get('/channel-manager/alerts', { params: q }),
  summary: (): Promise<AxiosResponse<ApiResponse<ChannelAlertSummary>>> => apiClient.get('/channel-manager/alerts/summary'),
  get: (id: string): Promise<AxiosResponse<ApiResponse<ChannelAlertDetail>>> => apiClient.get(`/channel-manager/alerts/${id}`),
  act: (id: string, action: 'acknowledge' | 'resolve' | 'dismiss', notes?: string): Promise<AxiosResponse<ApiResponse<ChannelAlertDetail>>> =>
    apiClient.post(`/channel-manager/alerts/${id}/${action}`, { notes }),
  airbnbAnswer: (id: string, data: { decision: 'accept' | 'decline'; reason?: AirbnbDeclineReason; messageToGuest?: string; messageToAirbnb?: string }):
    Promise<AxiosResponse<ApiResponse<{ alreadyResolved: boolean; resolution?: string; alert: ChannelAlertDetail }>>> =>
    apiClient.post(`/channel-manager/alerts/${id}/airbnb-answer`, data),
};

// ─── Property profile ────────────────────────────────────────────────────────

export const PROFILE_CURRENCIES = ['DOP', 'USD', 'EUR'] as const;

export interface PropertyProfile {
  /** Commercial name */
  name: string;
  legalName: string;
  rnc: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  /** Empty until set (shown as DOP) */
  currency: string;
  timezone: string;
  /** The currency cannot change any more (it was saved and there is data in it) */
  currencyLocked: boolean;
  currencyLockReason?: 'channel_manager' | 'reservations';
  /** The currency is unset but the property already has data: saving one makes it permanent */
  currencyLocksOnSave?: 'channel_manager' | 'reservations';
}

export const propertyProfileService = {
  get: (): Promise<AxiosResponse<ApiResponse<PropertyProfile>>> => apiClient.get('/property-profile'),
  update: (data: Partial<Omit<PropertyProfile, 'currencyLocked' | 'currencyLockReason' | 'currencyLocksOnSave'>>): Promise<AxiosResponse<ApiResponse<PropertyProfile>>> =>
    apiClient.put('/property-profile', data),
};

// Reservations Service
export const reservationsService = {
  createReservation: (reservationData: {
    type: 'room' | 'daypass' | 'PasaTarde' | 'event';
    // Room-specific fields
    roomType?: string;
    checkOutDate?: string | Date;
    // Event-specific fields
    eventType?: string;
    eventDescription?: string;
    expectedAttendees?: number;
    // Guest information (required for non-authenticated bookings)
    guestName?: {
      firstName: string;
      lastName: string;
    };
    // Common fields
    checkInDate: string | Date;
    guests: number;
    guestDetails: {
      adults: number;
      children: number;
      infants: number;
    };
    contactInfo: {
      phone: string;
      email: string;
      emergencyContact?: string;
      country?: string;
    };
    specialRequests?: string;
    estimatedTotal?: number;
  }): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.post('/reservations', reservationData),

  getUserReservations: (): Promise<AxiosResponse<ApiResponse<Reservation[]>>> =>
    apiClient.get('/reservations'),

  getReservations: (params?: {
    page?: number;
    limit?: number;
    status?: string;
    type?: 'room' | 'daypass' | 'PasaTarde' | 'event';
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    sort?: string;
    /** 'direct' | 'booking_engine' | 'channel' | 'ota:<OTA name>' */
    source?: string;
  }): Promise<AxiosResponse<{ success: boolean; count: number; data: Reservation[]; pagination?: any }>> =>
    apiClient.get('/reservations', { params }),

  /** OTA names reservations came from (source filter options) */
  getChannelSources: (): Promise<AxiosResponse<ApiResponse<string[]>>> => apiClient.get('/reservations/channel-sources'),

  getChannelHistory: (id: string): Promise<AxiosResponse<ApiResponse<ChannelHistoryRow[]>>> =>
    apiClient.get(`/reservations/${id}/channel-history`),

  getHistory: (id: string): Promise<AxiosResponse<ApiResponse<ReservationHistoryEntry[]>>> =>
    apiClient.get(`/reservations/${id}/history`),

  getReservation: (id: string): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.get(`/reservations/${id}`),

  corporatePriceAction: (id: string, action: 'approve' | 'decline'): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.post(`/reservations/${id}/corporate-price/${action}`),

  getReservationFinancial: (id: string): Promise<AxiosResponse<ApiResponse<{
    folio: { _id: string; reservationId: string; status: 'open' | 'in_ar' | 'closed' };
    charges: Array<{ _id: string; folioId: string; description: string; amount: number; createdAt: string; updatedAt: string }>;
    payments: Array<{ _id: string; folioId: string; amount: number; method: 'cash' | 'card' | 'transfer' | 'credit' | 'check'; status: 'completed' | 'pending' | 'reversed'; paymentStage: 'deposit' | 'in_house'; reference?: string; note?: string; createdAt: string; createdBy?: any }>;
    summary: {
      stage: 'pre_arrival' | 'in_house' | 'checked_out';
      estimatedTotal: number;
      totalCharges: number;
      totalPayments: number;
      depositTotal: number;
      balance: number;
      balanceOnArrival: number;
      creditAvailability: number;
    };
  }>>> =>
    apiClient.get(`/reservations/${id}/financial`),

  // Public endpoints for guest access
  getPublicReservation: (confirmationToken: string): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.get(`/reservations/public/${confirmationToken}`),

  getPublicReservationByCode: (reservationCode: string): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.get(`/reservations/public/code/${reservationCode}`),

  cancelPublicReservation: (confirmationToken: string, cancellationReason?: string): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.put(`/reservations/public/${confirmationToken}/cancel`, { cancellationReason }),

  cancelPublicReservationByCode: (reservationCode: string, cancellationReason?: string): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.put(`/reservations/public/code/${reservationCode}/cancel`, { cancellationReason }),

  cancelReservation: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.patch(`/reservations/${id}/cancel`),

  assignRoom: (reservationId: string, roomId: string | null): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.put(`/reservations/${reservationId}/assign-room`, { roomId }),

  assignRooms: (reservationId: string, roomIds: string[]): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.put(`/reservations/${reservationId}/assign-rooms`, { roomIds }),

  /** Booking calendar drag and drop: new check-in (same nights) and/or swap one room (`fromRoomId` null = an unassigned booked room) */
  moveReservation: (reservationId: string, data: { checkInDate?: string; fromRoomId?: string | null; toRoomId?: string | null }): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.put(`/reservations/${reservationId}/move`, data),

  updateReservation: (id: string, data: Partial<{
    checkInDate: string | Date;
    checkOutDate: string | Date;
    guestDetails: {
      adults: number;
      children: number;
      infants: number;
    };
    specialRequests: string;
    contactInfo: {
      phone?: string;
      email?: string;
      emergencyContact?: string;
      country?: string;
    };
    adultPrice?: number; // admin only
    childrenPrice?: number; // admin only
  }>): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.put(`/reservations/${id}`, data),

  deleteReservation: (id: string, reason?: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/reservations/${id}`, { data: { reason } }),

  updateReservationStatus: (id: string, status: 'pending' | 'confirmed' | 'cancelled' | 'completed'): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.patch(`/reservations/${id}/status`, { status }),

  // Operational actions
  checkInReservation: (id: string, data: { identificationDocument?: string; checkInAt?: string }): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.patch(`/reservations/${id}/check-in`, data),
  checkOutReservation: (id: string, data?: { checkOutAt?: string }): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.patch(`/reservations/${id}/check-out`, data || {}),
  useCreditAndCheckout: (id: string): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.post(`/reservations/${id}/use-credit`),
  sendReservationEmail: (id: string, type: 'confirmation' | 'invoice'): Promise<AxiosResponse<ApiResponse<null>>> =>
    apiClient.post(`/reservations/${id}/send-email`, { type }),

  // Payments
  addReservationPayment: (id: string, data: { amount: number; method?: 'cash' | 'card' | 'transfer' | 'credit' | 'check'; status?: 'completed' | 'pending' | 'reversed'; reference?: string; note?: string; paymentStage?: 'deposit' | 'in_house' }): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.post(`/reservations/${id}/payments`, data),

  updateReservationPayment: (id: string, paymentId: string, data: { amount?: number; method?: 'cash' | 'card' | 'transfer' | 'credit' | 'check'; status?: 'completed' | 'pending' | 'reversed'; reference?: string; note?: string }): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.patch(`/reservations/${id}/payments/${paymentId}`, data),

  deleteReservationPayment: (id: string, paymentId: string): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.delete(`/reservations/${id}/payments/${paymentId}`),

  // Charges
  addReservationCharge: (id: string, data: { description: string; amount: number; category?: string }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.post(`/reservations/${id}/charges`, data),

  deleteReservationCharge: (id: string, chargeId: string): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.delete(`/reservations/${id}/charges/${chargeId}`),
};

// Amenities Service
export const amenitiesService = {
  getAmenities: (params?: {
    category?: string;
    active?: boolean;
  }): Promise<AxiosResponse<ApiResponse<Amenity[]>>> =>
    apiClient.get('/amenities', { params }),

  getAmenity: (id: string): Promise<AxiosResponse<ApiResponse<Amenity>>> =>
    apiClient.get(`/amenities/${id}`),

  createAmenity: (amenityData: {
    name: string;
    description: string;
    imageUrl: string;
    category: string;
    order: number;
    isActive: boolean;
  }): Promise<AxiosResponse<ApiResponse<Amenity>>> =>
    apiClient.post('/amenities', amenityData),

  updateAmenity: (id: string, amenityData: Partial<{
    name: string;
    description: string;
    imageUrl: string;
    category: string;
    order: number;
    isActive: boolean;
  }>): Promise<AxiosResponse<ApiResponse<Amenity>>> =>
    apiClient.put(`/amenities/${id}`, amenityData),

  deleteAmenity: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/amenities/${id}`),

  getAllAmenitiesAdmin: (params?: {
    category?: string;
    active?: boolean;
    page?: number;
    limit?: number;
    sort?: string;
  }): Promise<AxiosResponse<ApiResponse<{ amenities: Amenity[]; totalPages: number; currentPage: number }>>> =>
    apiClient.get('/amenities', { params }),
};

// Media Service
export const mediaService = {
  getMedia: (params?: {
    category?: string;
    type?: string;
    featured?: boolean;
    tags?: string; // comma-separated
    page?: number;
    limit?: number;
    sort?: string;
  }): Promise<AxiosResponse<ApiResponse<MediaItem[]>>> =>
    apiClient.get('/media', { params }),

  uploadMedia: (formData: FormData): Promise<AxiosResponse<ApiResponse<MediaItem>>> =>
    apiClient.post('/media/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 60000, // allow up to 60s in production to avoid timeouts
    }),

  updateMedia: (id: string, data: Partial<{
    title: string;
    description: string;
    category: string;
    tags: string; // comma-separated
    isFeatured: boolean;
    isPublic: boolean;
  }>): Promise<AxiosResponse<ApiResponse<MediaItem>>> =>
    apiClient.put(`/media/${id}`, data),

  deleteMedia: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/media/${id}`),

  syncUploads: (): Promise<AxiosResponse<ApiResponse<{ created: number; skipped: number }>>> =>
    apiClient.post('/media/sync-uploads'),
};

// Event Types Service
export const eventTypesService = {
  getEventTypes: (params?: { active?: boolean }): Promise<AxiosResponse<ApiResponse<EventType[]>>> =>
    apiClient.get('/event-types', { params }),

  getEventType: (id: string): Promise<AxiosResponse<ApiResponse<EventType>>> =>
    apiClient.get(`/event-types/${id}`),

  createEventType: (data: {
    type: string;
    title: string;
    description?: string;
    features?: string[];
    priceFrom: number;
    maxGuests: number;
    maxChildren?: number;
    maxAdults?: number;
    isActive?: boolean;
  }): Promise<AxiosResponse<ApiResponse<EventType>>> =>
    apiClient.post('/event-types', data),

  updateEventType: (id: string, data: Partial<{
    type: string;
    title: string;
    description?: string;
    features?: string[];
    priceFrom: number;
    maxGuests: number;
    maxChildren: number;
    maxAdults?: number;
    isActive: boolean;
  }>): Promise<AxiosResponse<ApiResponse<EventType>>> =>
    apiClient.put(`/event-types/${id}`, data),

  deleteEventType: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/event-types/${id}`)
};

// Admin Services
export const adminService = {
  // Home panel
  getDashboard: (): Promise<AxiosResponse<ApiResponse<DashboardData>>> =>
    apiClient.get('/admin/dashboard'),
  // Revenue
  getRevenue: (params: { from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.get('/admin/revenue', { params }),
  processAccountReceivablePayment: (
    paymentId: string,
    data: { creditPaymentMethod: 'cash' | 'card' | 'transfer' | 'check' }
  ): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.post(`/admin/revenue/account-receivable/${paymentId}/process`, data),
  // Commissions (salesman stats)
  getCommissions: (params: { from?: string; to?: string; name?: string; email?: string }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.get('/admin/commissions', { params }),

  // Room management - using correct room routes
  createRoom: (roomData: Partial<Room>): Promise<AxiosResponse<ApiResponse<Room>>> =>
    apiClient.post('/rooms', roomData),

  updateRoom: (id: string, roomData: Partial<Room>): Promise<AxiosResponse<ApiResponse<Room>>> =>
    apiClient.put(`/rooms/${id}`, roomData),
  updateRoomOps: (id: string, data: {
    status?: 'not_available' | 'available' | 'booked' | 'occupied';
    condition?: 'pending_cleanup' | 'clean';
    comment?: string;
  }): Promise<AxiosResponse<ApiResponse<Room>>> =>
    apiClient.patch(`/rooms/${id}/ops`, data),

  deleteRoom: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/rooms/${id}`),

  // Reservation management
  getAllReservations: (params?: {
    page?: number;
    limit?: number;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<AxiosResponse<ApiResponse<{ reservations: Reservation[]; totalPages: number; currentPage: number }>>> =>
    apiClient.get('/admin/reservations', { params }),

  updateReservationStatus: (id: string, status: string): Promise<AxiosResponse<ApiResponse<Reservation>>> =>
    apiClient.patch(`/admin/reservations/${id}/status`, { status }),

  // User CRUD
  /** No password: the user is emailed an invitation to choose one */
  createUser: (data: { firstName: string; lastName: string; email: string; phone?: string; role?: string }): Promise<AxiosResponse<ApiResponse<User> & { invitation?: { sent: boolean } }>> =>
    apiClient.post('/admin/users', data),
  resendInvitation: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.post(`/admin/users/${id}/resend-invitation`),
  updateUser: (id: string, data: Partial<{ firstName: string; lastName: string; email: string; phone?: string; role?: string; isActive?: boolean; emailVerified?: boolean }>): Promise<AxiosResponse<ApiResponse<User>>> =>
    apiClient.put(`/admin/users/${id}`, data),
  deleteUser: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/admin/users/${id}`),

  // User management
  getAllUsers: (params?: {
    page?: number;
    limit?: number;
    role?: string;
    app?: AppCode;
  }): Promise<AxiosResponse<ApiResponse<{ users: User[]; totalPages: number; currentPage: number }>>> =>
    apiClient.get('/admin/users', { params }),

  /** Assigns `roleId` for `app` (inferred server-side from the role if `app` omitted), or removes that app's assignment when `roleId` is `null` (requires `app`). */
  updateUserRole: (id: string, roleId: string | null, app?: AppCode): Promise<AxiosResponse<ApiResponse<User>>> =>
    apiClient.patch(`/admin/users/${id}/role`, { roleId, app }),

  // Permission catalog for the given app (canonical, backend-verified list).
  getPermissions: (app: AppCode): Promise<AxiosResponse<ApiResponse<string[]>>> =>
    apiClient.get('/admin/permissions', { params: { app } }),
};

// Wristbands Service
export const wristbandsService = {
  createDelivery: (data: {
    date: string | Date;
    type: 'delivery' | 'collection';
    recipient?: string;
    counts: { daypassAdults: number; daypassChildren: number; accommodations: number; pasatarde: number };
    notes?: string;
  }): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.post('/admin/wristbands/deliveries', data),

  getDeliveries: (params?: { from?: string; to?: string }): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.get('/admin/wristbands/deliveries', { params }),

  getUsage: (params?: { from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<{ accommodations: number; daypassAdults: number; daypassChildren: number; pasatarde: number }>>> =>
    apiClient.get('/admin/wristbands/usage', { params }),

  updateDelivery: (id: string, data: Partial<{
    date: string | Date;
    type: 'delivery' | 'collection';
    recipient: string;
    counts: { daypassAdults: number; daypassChildren: number; accommodations: number; pasatarde: number };
    notes: string;
  }>): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.put(`/admin/wristbands/deliveries/${id}`, data),

  deleteDelivery: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/admin/wristbands/deliveries/${id}`),
};
// Roles Service
export const rolesService = {
  getRoles: (app?: AppCode): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    apiClient.get('/roles', { params: { app } }),
  createRole: (data: { name: string; description?: string; permissions: string[]; discountLimit?: number; app?: AppCode }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.post('/roles', data),
  updateRole: (id: string, data: Partial<{ name: string; description?: string; permissions: string[]; discountLimit?: number }>): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.put(`/roles/${id}`, data),
  deleteRole: (id: string): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.delete(`/roles/${id}`),
};

// ── Booking Engine Service (public, no auth required) ────────────────────────
export const bookingService = {
  /** Fetch public booking page configuration (branding, contact, etc.) */
  getConfig: (): Promise<AxiosResponse<ApiResponse<{
    enabled: boolean;
    tenantName: string;
    tenantSlug: string;
    logoUrl: string;
    currency: string;
    timezone: string;
    language: string;
    contactPhone: string;
    contactEmail: string;
    contactAddress: string;
    minAdvanceHours: number;
    maxAdvanceDays: number;
    termsVersion: string;
    privacyVersion: string;
    checkoutTime: string;
  }>>> =>
    apiClient.get('/booking/config'),

  /** Fetch public room types for the property showcase */
  getRoomTypes: (): Promise<AxiosResponse<ApiResponse<Array<{
    _id: string;
    name: string;
    capacity: number;
    image: string;
  }>>>> =>
    apiClient.get('/booking/room-types'),

  /** Fetch public amenities for the property */
  getAmenities: (): Promise<AxiosResponse<ApiResponse<Array<{
    _id: string;
    name: string;
    description: string;
    image: string;
    category: string;
    order: number;
  }>>>> =>
    apiClient.get('/booking/amenities'),

  /** Search available room types for a date range */
  getAvailability: (params: {
    checkIn: string;
    checkOut: string;
    adults: number;
    children?: number;
    promoCode?: string;
  }): Promise<AxiosResponse<ApiResponse<Array<{
    roomType: { _id: string; name: string; capacity: number; image?: string };
    availableCount: number;
    /** The first offer (the room type's "from" price) */
    ratePlan: { _id: string; name: string };
    /** Every plan the guest can choose: promo plans first, then cheapest first */
    ratePlans: PublicRateOffer[];
    pricing: {
      basePrice: number;
      occupancyCost: number;
      subtotal: number;
      adjustedSubtotal: number;
      taxes: Array<{ name: string; type: string; amount: number; isInclusive: boolean }>;
      totalTaxes: number;
      finalTotal: number;
      nights: number;
      perNight: number;
    };
    images: string[];
    features: Record<string, boolean>;
    amenities: string[];
    bedConfiguration: string;
  }>> & { promo?: { code: string; valid: boolean; applied: boolean } | null }>> =>
    apiClient.get('/booking/availability', { params }),

  /** Fetch active reviews for the trust & credibility bar */
  getReviews: (): Promise<AxiosResponse<ApiResponse<Array<{
    _id: string;
    guestName: string;
    rating: number;
    comment: string;
    source: string;
    createdAt: string;
  }>>>> =>
    apiClient.get('/booking/reviews'),

  /** Get a detailed price quote for a specific room type */
  getQuote: (data: {
    roomTypeId: string;
    ratePlanId?: string;
    promoCode?: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children?: number;
    rooms?: number;
  }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.post('/booking/quote', data),

  /** List online-bookable services (public booking engine) */
  getServices: (): Promise<AxiosResponse<ApiResponse<Array<Pick<ServiceRecord, '_id' | 'code' | 'name' | 'kind' | 'chargeBasis' | 'reservationMode' | 'basePrice'>>>>> =>
    apiClient.get('/booking/services'),

  /** Get price for a specific service */
  getServiceQuote: (data: {
    serviceId: string;
    date: string;
    adults: number;
    children?: number;
  }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.post('/booking/services/quote', data),

  /** Send 4-digit verification code to guest email */
  sendVerification: (data: {
    email: string;
    guestName: string;
  }): Promise<AxiosResponse<ApiResponse<{ expiresAt: string }>>> =>
    apiClient.post('/booking/verify/send', data),

  /** Confirm the 4-digit verification code */
  confirmVerification: (data: {
    email: string;
    code: string;
  }): Promise<AxiosResponse<ApiResponse<{ verificationId: string }>>> =>
    apiClient.post('/booking/verify/confirm', data),

  /** Finalize booking (requires verified email) */
  reserve: (data: {
    verificationId: string;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    specialRequests?: string;
    /** Promo code that unlocked private rate plans in the search */
    promoCode?: string;
    items: Array<{
      kind: 'room' | 'service';
      roomTypeId?: string;
      ratePlanId?: string;
      checkIn?: string;
      checkOut?: string;
      serviceId?: string;
      date?: string;
      adults?: number;
      children?: number;
      quantity?: number;
    }>;
    acceptedTermsVersion: string;
    acceptedPrivacyVersion: string;
  }): Promise<AxiosResponse<ApiResponse<{
    reservationId: string;
    reservationCode: string;
    confirmationToken: string;
    status: string;
    estimatedTotal: number;
    checkIn: string;
    checkOut: string;
  }>>> =>
    apiClient.post('/booking/reserve', data),

  /** Get booking terms of service */
  getTerms: (): Promise<AxiosResponse<ApiResponse<{
    version: string;
    title: string;
    lastUpdated: string;
    content: string;
  }>>> =>
    apiClient.get('/booking/legal/terms'),

  /** Get booking privacy policy */
  getPrivacyPolicy: (): Promise<AxiosResponse<ApiResponse<{
    version: string;
    title: string;
    lastUpdated: string;
    content: string;
  }>>> =>
    apiClient.get('/booking/legal/privacy'),

  getReservation: (code: string, token: string): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.get(`/booking/reservation/${encodeURIComponent(code)}`, { params: { token } }),
};

export default apiClient;

// Room Type Service
export const roomTypeService = {
  getRoomTypes: (params?: { active?: boolean }): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    apiClient.get('/pricing/room-types', { params }),

  createRoomType: (data: { name: string; capacity: number; isActive?: boolean }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.post('/pricing/room-types', data),

  updateRoomType: (id: string, data: Partial<{ name: string; capacity: number; isActive: boolean }>): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.put(`/pricing/room-types/${id}`, data),

  deleteRoomType: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/pricing/room-types/${id}`),
};

// Pricing Service
export const pricingService = {
  // ── Rate Plans ────────────────────────────────────────────
  getRatePlans: (params?: { roomTypeId?: string; active?: boolean }): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    apiClient.get('/pricing/rate-plans', { params }),

  createRatePlan: (data: {
    name: string;
    roomTypeId: string;
    basePrice: number;
    pricingMode?: 'tiered';
    occupancyTiers: Array<{ guestType: 'adult' | 'child'; guestNumber: number; price: number }>;
    isActive?: boolean;
    sellOnChannels?: boolean;
    isDefault?: boolean;
    visibility?: 'public' | 'private';
    accessCodes?: string[];
    description?: string;
  }): Promise<AxiosResponse<ApiResponse<any>>> => apiClient.post('/pricing/rate-plans', data),

  updateRatePlan: (id: string, data: Partial<{
    name: string;
    roomTypeId: string;
    basePrice: number;
    occupancyTiers: Array<{ guestType: 'adult' | 'child'; guestNumber: number; price: number }>;
    isActive: boolean;
    sellOnChannels: boolean;
    isDefault: boolean;
    visibility: 'public' | 'private';
    accessCodes: string[];
    description: string;
  }>): Promise<AxiosResponse<ApiResponse<any>>> => apiClient.put(`/pricing/rate-plans/${id}`, data),

  deleteRatePlan: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/pricing/rate-plans/${id}`),

  // ── Pricing Rules ─────────────────────────────────────────
  getPricingRules: (): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    apiClient.get('/pricing/rules'),

  createPricingRule: (data: {
    name: string;
    ruleTarget: 'guest' | 'company' | 'promotional';
    companyId?: string | null;
    guestEmail?: string | null;
    ratePlanId: string;
    ruleModel: 'percentage' | 'fixed' | 'custom';
    direction?: 'discount' | 'surcharge';
    value?: number;
    scope?: 'base' | 'occupancy' | 'both';
    customBasePrice?: number;
    customOccupancyTiers?: Array<{ guestType: 'adult' | 'child'; guestNumber: number; price: number }>;
    periodPattern?: 'all_days' | 'weekdays' | 'weekends' | 'specific_days';
    specificDays?: number[];
    dateStart?: string | null;
    dateEnd?: string | null;
    minimumNights?: number | null;
    blackoutDates?: Array<{ start: string; end: string }>;
    isActive?: boolean;
  }): Promise<AxiosResponse<ApiResponse<any>>> => apiClient.post('/pricing/rules', data),

  updatePricingRule: (id: string, data: Partial<{
    name: string;
    ruleTarget: 'guest' | 'company' | 'promotional';
    companyId: string | null;
    guestEmail: string | null;
    ratePlanId: string;
    ruleModel: 'percentage' | 'fixed' | 'custom';
    direction: 'discount' | 'surcharge';
    value: number;
    scope: 'base' | 'occupancy' | 'both';
    customBasePrice: number;
    customOccupancyTiers: Array<{ guestType: 'adult' | 'child'; guestNumber: number; price: number }>;
    periodPattern: 'all_days' | 'weekdays' | 'weekends' | 'specific_days';
    specificDays: number[];
    dateStart: string | null;
    dateEnd: string | null;
    minimumNights: number | null;
    blackoutDates: Array<{ start: string; end: string }>;
    isActive: boolean;
  }>): Promise<AxiosResponse<ApiResponse<any>>> => apiClient.put(`/pricing/rules/${id}`, data),

  deletePricingRule: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/pricing/rules/${id}`),

  // ── Taxes ─────────────────────────────────────────────────
  getTaxes: (): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    apiClient.get('/pricing/taxes'),

  createTax: (data: {
    name: string;
    type: 'percentage' | 'fixed';
    value: number;
    appliesTo: 'room' | 'guest' | 'total';
    isInclusive?: boolean;
    priority?: number;
    isActive?: boolean;
  }): Promise<AxiosResponse<ApiResponse<any>>> => apiClient.post('/pricing/taxes', data),

  updateTax: (id: string, data: Partial<{
    name: string;
    type: 'percentage' | 'fixed';
    value: number;
    appliesTo: 'room' | 'guest' | 'total';
    isInclusive: boolean;
    priority: number;
    isActive: boolean;
  }>): Promise<AxiosResponse<ApiResponse<any>>> => apiClient.put(`/pricing/taxes/${id}`, data),

  deleteTax: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/pricing/taxes/${id}`),

  // ── Calculate ─────────────────────────────────────────────
  calculatePrice: (data: {
    ratePlanId?: string;
    roomTypeId?: string;
    adults: number;
    children: number;
    date?: string;
    nights?: number;
    rooms?: number;
    companyId?: string;
    guestEmail?: string;
  }): Promise<AxiosResponse<ApiResponse<{
    ratePlan: { _id: string; name: string; roomTypeId: string; roomTypeName: string } | null;
    basePrice: number;
    occupancyCost: number;
    subtotal: number;
    adjustedSubtotal: number;
    taxes: Array<{ name: string; type: string; amount: number; isInclusive: boolean }>;
    totalTaxes: number;
    finalTotal: number;
    nights: number;
  }>>> => apiClient.post('/pricing/calculate', data),

  /** Every rate plan each room can be booked on for the stay, with the pre-selected one */
  getRateOptions: (data: {
    roomIds: string[];
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    children: number;
    companyId?: string;
    guestEmail?: string;
    promoCode?: string;
    /** roomId → ratePlanId chosen by the user */
    selections?: Record<string, string>;
  }): Promise<AxiosResponse<ApiResponse<RateOptionsResult>>> => apiClient.post('/pricing/rate-options', data),

  calculateRoomsPrice: (data: {
    roomIds: string[];
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    children: number;
    companyId?: string;
    guestEmail?: string;
  }): Promise<AxiosResponse<ApiResponse<{
    perRoom: Array<{
      roomId: string;
      roomName: string;
      roomTypeName: string;
      ratePlanId: string;
      ratePlanName: string;
      assignedAdults: number;
      assignedChildren: number;
      basePrice: number;
      occupancyCost: number;
      subtotal: number;
      taxes: Array<{ name: string; type: string; amount: number; isInclusive: boolean }>;
      totalTaxes: number;
      finalTotal: number;
      nights: number;
      error?: string;
    }>;
    nights: number;
    basePrice: number;
    occupancyCost: number;
    subtotal: number;
    totalTaxes: number;
    finalTotal: number;
    unassignedAdults: number;
    unassignedChildren: number;
  }>>> => apiClient.post('/pricing/calculate-rooms', data),

  // ── Service Price Calculation ──────────────────────────────
  calculateServicePrice: (data: {
    serviceId: string;
    date?: string;
    adults: number;
    children: number;
    rooms?: number;
    companyId?: string;
    guestEmail?: string;
  }): Promise<AxiosResponse<ApiResponse<{
    service: { _id: string; name: string; kind: string; chargeBasis: string } | null;
    servicePrice: { _id: string; category: string; adultPrice: number; childrenPrice: number } | null;
    quantity: number;
    unitPrice: number;
    baseSubtotal: number;
    taxes: Array<{ name: string; type: string; amount: number; isInclusive: boolean }>;
    totalTaxes: number;
    finalTotal: number;
  }>>> => apiClient.post('/pricing/calculate-service', data),
};

// ── Service types ─────────────────────────────────────────────
export type ServiceKind = 'daypass' | 'pasatarde' | 'event' | 'roomAddon' | 'generic';
export type ChargeBasis = 'perPerson' | 'perRoom' | 'perStay' | 'perEvent';
export type ReservationMode = 'dateRange' | 'singleDate';

export interface ServiceRecord {
  _id: string;
  code: string;
  name: string;
  kind: ServiceKind;
  chargeBasis: ChargeBasis;
  reservationMode?: ReservationMode;
  isActive: boolean;
  isOnlineBookable: boolean;
  isVisibleInPOS: boolean;
  /** Standard everyday adult price returned by the booking services endpoint. */
  basePrice?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type ServicePriceCategory = 'standard' | 'special' | 'guest' | 'company';
export type ServicePriceValidity = 'everyday' | 'weekdays' | 'weekend' | 'custom';

export interface ServicePriceRecord {
  _id: string;
  serviceId: string | ServiceRecord;
  category: ServicePriceCategory;
  validity: ServicePriceValidity;
  startDate?: string;
  endDate?: string;
  guestEmail?: string;
  companyId?: string | { _id: string; name: string };
  adultPrice: number;
  childrenPrice: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Services API ──────────────────────────────────────────────
export const servicesService = {
  getServices: (params?: { active?: boolean; kind?: ServiceKind }): Promise<AxiosResponse<ApiResponse<ServiceRecord[]>>> =>
    apiClient.get('/services', { params }),

  getService: (id: string): Promise<AxiosResponse<ApiResponse<ServiceRecord>>> =>
    apiClient.get(`/services/${id}`),

  createService: (data: Partial<ServiceRecord>): Promise<AxiosResponse<ApiResponse<ServiceRecord>>> =>
    apiClient.post('/services', data),

  updateService: (id: string, data: Partial<ServiceRecord>): Promise<AxiosResponse<ApiResponse<ServiceRecord>>> =>
    apiClient.put(`/services/${id}`, data),

  deleteService: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/services/${id}`),
};

// ── Service Prices API ────────────────────────────────────────
export const servicePricesService = {
  getServicePrices: (params?: { serviceId?: string; active?: boolean; category?: ServicePriceCategory }): Promise<AxiosResponse<ApiResponse<ServicePriceRecord[]>>> =>
    apiClient.get('/service-prices', { params }),

  createServicePrice: (data: Partial<ServicePriceRecord>): Promise<AxiosResponse<ApiResponse<ServicePriceRecord>>> =>
    apiClient.post('/service-prices', data),

  updateServicePrice: (id: string, data: Partial<ServicePriceRecord>): Promise<AxiosResponse<ApiResponse<ServicePriceRecord>>> =>
    apiClient.put(`/service-prices/${id}`, data),

  deleteServicePrice: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/service-prices/${id}`),
};

export interface AppSettings {
  sections: Record<string, boolean>;
  nightAuditEnabled?: boolean;
  nightAuditTime?: string;
  checkoutTime?: string;
  emailSettings?: {
    fromDisplayName?: string;
    replyTo?: string;
    footerHtml?: string;
    footerText?: string;
  };
  bookingSettings?: {
    enabled: boolean;
    heroImageUrl?: string;
    heroHeadline?: string;
    heroSubtitle?: string;
    widgetAllowedOrigins?: string[];
    minAdvanceHours?: number;
    maxAdvanceDays?: number;
    termsVersion?: string;
    privacyVersion?: string;
  };
}

export interface CashierClosure {
  _id: string;
  user: { _id: string; firstName: string; lastName: string; email?: string };
  periodStart: string;
  periodEnd: string;
  paymentTotals: { cash: number; card: number; transfer: number; check: number; total: number };
  cashDistribution: Array<{ denomination: number; count: number; subtotal: number }>;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export const settingsService = {
  getSettings: (): Promise<AxiosResponse<ApiResponse<AppSettings>>> =>
    apiClient.get('/settings'),

  updateSettings: (data: Partial<AppSettings>): Promise<AxiosResponse<ApiResponse<AppSettings>>> =>
    apiClient.put('/settings', data),
};

// Reviews Service (admin CRUD)
export interface ReviewData {
  _id?: string;
  guestName: string;
  rating: number;
  comment: string;
  source: string;
  isActive: boolean;
  displayOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export const reviewsService = {
  getReviews: (): Promise<AxiosResponse<ApiResponse<ReviewData[]>>> =>
    apiClient.get('/reviews'),
  createReview: (data: Omit<ReviewData, '_id' | 'createdAt' | 'updatedAt'>): Promise<AxiosResponse<ApiResponse<ReviewData>>> =>
    apiClient.post('/reviews', data),
  updateReview: (id: string, data: Partial<ReviewData>): Promise<AxiosResponse<ApiResponse<ReviewData>>> =>
    apiClient.put(`/reviews/${id}`, data),
  deleteReview: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    apiClient.delete(`/reviews/${id}`),
};

export const cashierClosuresService = {
  getPreview: (params: { shiftStart: string; shiftEnd: string }): Promise<AxiosResponse<ApiResponse<{
    periodStart: string;
    periodEnd: string;
    paymentTotals: { cash: number; card: number; transfer: number; check: number; total: number };
    denominations: number[];
  }>>> =>
    apiClient.get('/cashier-closures/preview', { params }),
  getClosures: (params?: { from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<CashierClosure[]>>> =>
    apiClient.get('/cashier-closures', { params }),
  createClosure: (data: { shiftStart: string; shiftEnd: string; cashDistribution: Record<string, number>; note?: string }): Promise<AxiosResponse<ApiResponse<CashierClosure>>> =>
    apiClient.post('/cashier-closures', data),
};

// Companies Service
export const companiesService = {
  getCompanies: (params?: { search?: string; page?: number; limit?: number; active?: boolean }): Promise<AxiosResponse<ApiResponse<Company[]>>> =>
    apiClient.get('/companies', { params }),
  getCompany: (id: string): Promise<AxiosResponse<ApiResponse<{ company: Company; reservations: Reservation[] }>>> =>
    apiClient.get(`/companies/${id}`),
  createCompany: (data: Partial<Company>): Promise<AxiosResponse<ApiResponse<Company>>> =>
    apiClient.post('/companies', data),
  updateCompany: (id: string, data: Partial<Company>): Promise<AxiosResponse<ApiResponse<Company>>> =>
    apiClient.put(`/companies/${id}`, data),
  deleteCompany: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/companies/${id}`),
};

// Guests Service
export const guestsService = {
  getGuests: (params?: { search?: string; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<Guest[]>>> =>
    apiClient.get('/guests', { params }),
  getGuest: (id: string): Promise<AxiosResponse<ApiResponse<{ guest: Guest; reservations: Reservation[] }>>> =>
    apiClient.get(`/guests/${id}`),
  createGuest: (data: Omit<Partial<Guest>, 'companyLinks'> & { companyLinks?: { companyId: string; autoApproveCorporateRate: boolean }[] }): Promise<AxiosResponse<ApiResponse<Guest>>> =>
    apiClient.post('/guests', data),
  updateGuest: (id: string, data: Omit<Partial<Guest>, 'companyLinks'> & { companyLinks?: { companyId: string; autoApproveCorporateRate: boolean }[] }): Promise<AxiosResponse<ApiResponse<Guest>>> =>
    apiClient.put(`/guests/${id}`, data),
  deleteGuest: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/guests/${id}`),
  addCompanyLink: (guestId: string, data: { companyId: string; autoApproveCorporateRate: boolean }): Promise<AxiosResponse<ApiResponse<Guest>>> =>
    apiClient.post(`/guests/${guestId}/company-links`, data),
  updateCompanyLink: (guestId: string, companyId: string, data: { autoApproveCorporateRate: boolean }): Promise<AxiosResponse<ApiResponse<Guest>>> =>
    apiClient.put(`/guests/${guestId}/company-links/${companyId}`, data),
  removeCompanyLink: (guestId: string, companyId: string): Promise<AxiosResponse<ApiResponse<Guest>>> =>
    apiClient.delete(`/guests/${guestId}/company-links/${companyId}`),
};

// Credit Accounts Service
export const creditAccountsService = {
  getCreditAccounts: (params?: { scope?: 'guest' | 'company'; status?: 'active' | 'suspended'; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<CreditAccount[]>>> =>
    apiClient.get('/credit-accounts', { params }),
  getCreditAccount: (id: string): Promise<AxiosResponse<ApiResponse<CreditAccount>>> =>
    apiClient.get(`/credit-accounts/${id}`),
  createCreditAccount: (data: {
    scope: 'guest' | 'company';
    referenceId: string;
    creditLimit: number;
    currentExposure?: number;
    status?: 'active' | 'suspended';
  }): Promise<AxiosResponse<ApiResponse<CreditAccount>>> =>
    apiClient.post('/credit-accounts', data),
  updateCreditAccount: (id: string, data: Partial<{
    creditLimit: number;
    currentExposure: number;
    status: 'active' | 'suspended';
  }>): Promise<AxiosResponse<ApiResponse<CreditAccount>>> =>
    apiClient.put(`/credit-accounts/${id}`, data),
  deleteCreditAccount: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/credit-accounts/${id}`),
};

// ── Platform Service (superadmin only – admin.pilloto.com) ────────────────────
export type TenantProduct = 'pms' | 'accounting';
export type AccountingPlanSlug = 'starter' | 'pro' | 'plus';

/** Where a new account's "choose your password" invitation stands */
export interface InvitationInfo {
  status: 'none' | 'pending' | 'expired' | 'accepted';
  invitedAt?: string;
  expiresAt?: string;
  acceptedAt?: string;
}

export interface TenantRecord {
  _id: string;
  name: string;
  slug: string;
  plan: string;
  products: TenantProduct[];
  plans: { accounting?: AccountingPlanSlug };
  isActive: boolean;
  ownerEmail: string;
  settings: Record<string, any>;
  /** The owner's invitation (null if the owner account is missing) */
  ownerInvitation?: InvitationInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisionTenantPayload {
  name: string;
  slug: string;
  plan?: 'basic' | 'pro' | 'enterprise';
  ownerEmail: string;
  adminFirstName: string;
  adminLastName: string;
  settings?: Record<string, any>;
  products?: TenantProduct[];
  plans?: { accounting?: AccountingPlanSlug };
}

export const platformService = {
  listTenants: (): Promise<AxiosResponse<ApiResponse<TenantRecord[]>>> =>
    apiClient.get('/platform/tenants'),

  getTenant: (id: string): Promise<AxiosResponse<ApiResponse<TenantRecord>>> =>
    apiClient.get(`/platform/tenants/${id}`),

  createTenant: (data: ProvisionTenantPayload): Promise<AxiosResponse<ApiResponse<{ tenant: TenantRecord; adminUser: any; loginUrl: string; invitation: { sent: boolean; error?: string } }>>> =>
    apiClient.post('/platform/tenants', data),

  /** New invitation email for an owner who has not chosen a password yet */
  resendInvitation: (id: string): Promise<AxiosResponse<ApiResponse<InvitationInfo>>> =>
    apiClient.post(`/platform/tenants/${id}/resend-invitation`),

  updateTenant: (id: string, data: Partial<{ name: string; plan: string; isActive: boolean; ownerEmail: string; settings: any; products: TenantProduct[]; plans: { accounting?: AccountingPlanSlug } }>): Promise<AxiosResponse<ApiResponse<TenantRecord>>> =>
    apiClient.patch(`/platform/tenants/${id}`, data),

  deactivateTenant: (id: string): Promise<AxiosResponse<ApiResponse<TenantRecord>>> =>
    apiClient.delete(`/platform/tenants/${id}`),

  getTenantStats: (id: string): Promise<AxiosResponse<ApiResponse<{ tenant: TenantRecord; stats: { users: number; reservations: number; rooms: number } }>>> =>
    apiClient.get(`/platform/tenants/${id}/stats`),
};

// ─── Platform: channel manager (Channex) technical console ───────────────────

export interface PlatformChannexTenantRow {
  _id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  property: null | {
    status: ChannelPropertyState;
    channexPropertyId?: string;
    lastPushAt?: string;
    lastFullSyncAt?: string;
    pausedUntil?: string;
    lastError?: string;
    pushesPaused?: boolean;
    consecutiveFailures?: number;
  };
  pendingOutbox?: number;
  openCriticalAlerts?: number;
  channels?: { total: number; active: number };
}

export interface PlatformChannexOverview {
  environment: 'staging' | 'production';
  baseUrl: string;
  configured: boolean;
  webhookUrl: string | null;
  webhookSecretConfigured: boolean;
  workersDisabledByEnv: boolean;
  globalEnabled: boolean;
  workers: {
    running: boolean; notRunningReason?: 'disabled_by_env' | 'not_configured'; startedAt?: string;
    lastTickAt?: string; lastTickError?: string; lastFeedPollAt?: string; lastFeedError?: string; lastDigestAt?: string; inboxLeaseUntil?: string;
  };
  webhook: { webhookId: string | null; signingKeyId: string | null; lastWebhookAt: string | null; callbackUrl: string | null; secretConfigured: boolean };
  openPlatformAlerts: number;
}

export interface PlatformWebhookStatus {
  environment: string;
  callbackUrl: string | null;
  secretConfigured: boolean;
  signingKeyId: string | null;
  webhookId: string | null;
  lastWebhookAt: string | null;
  eventMask: string;
  recentEvents: { _id: string; event: string; channexPropertyId?: string; tenantId?: string; signatureKeyLabel?: string; receivedAt: string; processedAt?: string; error?: string }[];
}

/** Raw alert as stored (platform console only) */
export interface PlatformAlertRow {
  _id: string; tenantId?: string; type: string; severity: string; status: string; dedupeKey: string; title: string;
  details?: Record<string, any>; occurrences?: number; createdAt: string; updatedAt: string; lastSeenAt?: string; notes?: string;
  reservationId?: string; channexBookingId?: string; channelId?: string; liveFeedEventId?: string; dueAt?: string;
}

export interface ChannexOptionRow { id: string; title: string; roomTypeId?: string; occupancies?: number[] }
export interface RepairRow {
  kind: 'room_type' | 'rate_plan'; localId: string; name: string; roomTypeId?: string; roomTypeName?: string; capacity?: number;
  channexId: string | null; channexTitle?: string; status: string; error?: string;
  problems: ('not_synced' | 'missing_in_channex' | 'remap_required' | 'error' | 'wrong_room_type')[];
}
export interface RepairView {
  rows: RepairRow[];
  channex: { roomTypes: ChannexOptionRow[]; ratePlans: ChannexOptionRow[] };
  unlinked: { roomTypes: ChannexOptionRow[]; ratePlans: ChannexOptionRow[] };
}

export interface PlatformChannexStatus {
  environment: 'staging' | 'production';
  configured: boolean;
  enabled: boolean;
  property: null | {
    status: ChannelPropertyState;
    channexPropertyId?: string;
    channexGroupId?: string;
    lastFullSyncAt?: string;
    lastError?: string;
  };
  prerequisites: { id: ReadinessId; ok: boolean; message: string; fixRoute: string }[];
  settings: ChannelManagerSettings;
}

export const platformChannexService = {
  health: (): Promise<AxiosResponse<ApiResponse<any>>> => apiClient.get('/platform/channex/health'),
  tenants: (): Promise<AxiosResponse<ApiResponse<{ environment: 'staging' | 'production'; tenants: PlatformChannexTenantRow[] }>>> =>
    apiClient.get('/platform/channex/tenants'),
  status: (tenantId: string): Promise<AxiosResponse<ApiResponse<PlatformChannexStatus>>> => apiClient.get(`/platform/channex/tenants/${tenantId}/status`),
  mappings: (tenantId: string): Promise<AxiosResponse<ApiResponse<ChannelMappingRow[]>>> => apiClient.get(`/platform/channex/tenants/${tenantId}/mappings`),
  syncActivity: (tenantId: string, page = 1, limit = 25): Promise<AxiosResponse<ApiResponse<SyncActivity<SyncLogDetailRow>>>> =>
    apiClient.get(`/platform/channex/tenants/${tenantId}/sync-activity`, { params: { page, limit } }),
  bookingInbox: (tenantId: string, page = 1, limit = 25): Promise<AxiosResponse<ApiResponse<BookingInbox<BookingInboxDetailRow>>>> =>
    apiClient.get(`/platform/channex/tenants/${tenantId}/booking-inbox`, { params: { page, limit } }),
  fullSync: (tenantId: string): Promise<AxiosResponse<ApiResponse<{ queued: number }>>> => apiClient.post(`/platform/channex/tenants/${tenantId}/full-sync`),
  resync: (tenantId: string): Promise<AxiosResponse<ApiResponse<{ sync: { results: EntitySyncResult[]; calls: number; ok: boolean }; mappings: ChannelMappingRow[] }>>> =>
    apiClient.post(`/platform/channex/tenants/${tenantId}/resync`),
  settings: (): Promise<AxiosResponse<ApiResponse<PlatformChannexSettings>>> => apiClient.get('/platform/channex/settings'),
  saveSettings: (data: Partial<PlatformChannexSettings>): Promise<AxiosResponse<ApiResponse<PlatformChannexSettings>>> => apiClient.put('/platform/channex/settings', data),
  channels: (tenantId: string): Promise<AxiosResponse<ApiResponse<PlatformChannelList>>> => apiClient.get(`/platform/channex/tenants/${tenantId}/channels`),
  setChannelConnection: (tenantId: string, setting: ChannelConnectionSetting): Promise<AxiosResponse<ApiResponse<PlatformChannelConnection>>> =>
    apiClient.put(`/platform/channex/tenants/${tenantId}/channel-connection`, { setting }),
  iframeSession: (tenantId: string, data: { otaCode?: string; language?: string } = {}): Promise<AxiosResponse<ApiResponse<IframeSession>>> =>
    apiClient.post(`/platform/channex/tenants/${tenantId}/iframe-session`, data),
  // ── plan 9.3 ──
  overview: (): Promise<AxiosResponse<ApiResponse<PlatformChannexOverview>>> => apiClient.get('/platform/channex/overview'),
  webhook: (): Promise<AxiosResponse<ApiResponse<PlatformWebhookStatus>>> => apiClient.get('/platform/channex/webhook'),
  createSigningKey: (billingAccountId?: string): Promise<AxiosResponse<ApiResponse<{ signingKeyId: string; secret: string; message: string }>>> =>
    apiClient.post('/platform/channex/signing-key', { billingAccountId }),
  upsertWebhook: (): Promise<AxiosResponse<ApiResponse<{ webhookId: string; created: boolean; callbackUrl: string }>>> => apiClient.put('/platform/channex/webhook', {}),
  testWebhook: (): Promise<AxiosResponse<ApiResponse<{ webhookId: string; result: any }>>> => apiClient.post('/platform/channex/webhook/test'),
  platformAlerts: (status = 'active'): Promise<AxiosResponse<ApiResponse<PlatformAlertRow[]>>> => apiClient.get('/platform/channex/alerts', { params: { status } }),
  platformAlertAction: (id: string, action: 'acknowledge' | 'resolve' | 'dismiss', notes?: string): Promise<AxiosResponse<ApiResponse<PlatformAlertRow>>> =>
    apiClient.post(`/platform/channex/alerts/${id}/${action}`, { notes }),
  enable: (tenantId: string): Promise<AxiosResponse<ApiResponse<{ status: string }>>> => apiClient.post(`/platform/channex/tenants/${tenantId}/enable`),
  pause: (tenantId: string): Promise<AxiosResponse<ApiResponse<{ pushesPaused: boolean }>>> => apiClient.post(`/platform/channex/tenants/${tenantId}/pause`),
  resume: (tenantId: string): Promise<AxiosResponse<ApiResponse<{ pushesPaused: boolean; pending: number }>>> => apiClient.post(`/platform/channex/tenants/${tenantId}/resume`),
  tenantAlerts: (tenantId: string, status = 'active'): Promise<AxiosResponse<ApiResponse<PlatformAlertRow[]>>> =>
    apiClient.get(`/platform/channex/tenants/${tenantId}/alerts`, { params: { status } }),
  repair: (tenantId: string): Promise<AxiosResponse<ApiResponse<RepairView>>> => apiClient.get(`/platform/channex/tenants/${tenantId}/repair`),
  relink: (tenantId: string, data: { kind: 'room_type' | 'rate_plan'; localId: string; channexId: string }): Promise<AxiosResponse<ApiResponse<{ queued: number; view: RepairView }>>> =>
    apiClient.post(`/platform/channex/tenants/${tenantId}/repair/relink`, data),
  recreate: (tenantId: string, localId: string): Promise<AxiosResponse<ApiResponse<{ oldDeleted: boolean; view: RepairView }>>> =>
    apiClient.post(`/platform/channex/tenants/${tenantId}/repair/recreate`, { kind: 'rate_plan', localId }),
  recreateRatePlans: (tenantId: string, roomTypeId: string): Promise<AxiosResponse<ApiResponse<{ recreated: number; closed: number; view: RepairView }>>> =>
    apiClient.post(`/platform/channex/tenants/${tenantId}/repair/recreate-rate-plans`, { roomTypeId }),
};

export interface PlatformChannexSettings {
  /** Platform kill switch: off = no pushes, feed polls or nightly syncs anywhere */
  globalEnabled: boolean;
  iframePlatformOnly: boolean;
  /** OTA codes offered to tenants in "Conectar un canal", in card order */
  offeredChannels: string[];
}

export type ChannelConnectionSetting = 'default' | 'tenant' | 'platform_only';
export interface PlatformChannelConnection { mode: 'tenant' | 'platform_only'; setting: ChannelConnectionSetting; platformDefault: 'tenant' | 'platform_only' }
export interface PlatformChannelList {
  connection: PlatformChannelConnection;
  offered: string[];
  stale: boolean;
  onboardings: ChannelList['onboardings'];
  channels: (ChannelCard & { channexChannelId: string; adapter?: string; channexStatus?: string; expectedRemovalDate?: string; lastEvent?: string; lastSeenAt?: string })[];
}

// ─────────────────────────────────────────────────────────────
// Charge Templates Service
// ─────────────────────────────────────────────────────────────

export const chargeTemplatesService = {
  getChargeTemplates: (params?: { active?: boolean }): Promise<AxiosResponse<ApiResponse<ChargeTemplate[]>>> =>
    apiClient.get('/charge-templates', { params }),

  createChargeTemplate: (data: Omit<ChargeTemplate, '_id' | 'createdAt' | 'updatedAt'>): Promise<AxiosResponse<ApiResponse<ChargeTemplate>>> =>
    apiClient.post('/charge-templates', data),

  updateChargeTemplate: (id: string, data: Partial<ChargeTemplate>): Promise<AxiosResponse<ApiResponse<ChargeTemplate>>> =>
    apiClient.put(`/charge-templates/${id}`, data),

  deleteChargeTemplate: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/charge-templates/${id}`),
};

// ─────────────────────────────────────────────────────────────
// Charge Rules Service
// ─────────────────────────────────────────────────────────────
export const chargeRulesService = {
  getChargeRules: (params?: { active?: boolean }): Promise<AxiosResponse<ApiResponse<ChargeRule[]>>> =>
    apiClient.get('/charge-rules', { params }),

  createChargeRule: (data: Omit<ChargeRule, '_id' | 'createdAt' | 'updatedAt'>): Promise<AxiosResponse<ApiResponse<ChargeRule>>> =>
    apiClient.post('/charge-rules', data),

  updateChargeRule: (id: string, data: Partial<ChargeRule>): Promise<AxiosResponse<ApiResponse<ChargeRule>>> =>
    apiClient.put(`/charge-rules/${id}`, data),

  deleteChargeRule: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/charge-rules/${id}`),
};

// ─────────────────────────────────────────────────────────────
// Audit Service
// ─────────────────────────────────────────────────────────────
export interface AuditSummary {
  tenantId: string;
  businessDate: string;
  rulesEvaluated: number;
  reservationsScanned: number;
  chargesPosted: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  auditRunId?: string;
}

export const auditService = {
  runAudit: (options?: { dryRun?: boolean }): Promise<AxiosResponse<ApiResponse<AuditSummary[]> & { dryRun: boolean }>> =>
    apiClient.post('/audit/run', options?.dryRun ? { dryRun: true } : {}),

  getExecutions: (params?: {
    status?: 'success' | 'skipped' | 'error';
    reservationId?: string;
    chargeRuleId?: string;
    page?: number;
    limit?: number;
  }): Promise<AxiosResponse<ApiResponse<ChargeRuleExecution[]> & { pagination: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/audit/executions', { params }),

  getRuns: (params?: {
    status?: 'running' | 'completed' | 'failed' | 'skipped';
    dryRun?: boolean;
    page?: number;
    limit?: number;
  }): Promise<AxiosResponse<ApiResponse<AuditRun[]> & { pagination: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/audit/runs', { params }),
};

// ─── e-CF (electronic fiscal invoicing) ──────────────────────────────────────
// One module for the company, used by PMS and Accounting alike (backend: /api/fiscal).

type FiscalList<T> = ApiResponse<T[]> & { meta?: { total: number; page: number; limit: number; pages: number } };

export interface FiscalDocumentQuery {
  q?: string;
  estadoECF?: string;
  tipo?: string;
  fechaInicio?: string;
  fechaFin?: string;
  folioId?: string;
  paymentId?: string;
  invoiceId?: string;
  page?: number;
  limit?: number;
}

export interface FiscalIssueResult {
  success: boolean;
  /** True when BillingSoft could not be reached: saved, and sent automatically. */
  queued?: boolean;
  data: ElectronicInvoice;
  message?: string;
}

export interface FiscalOtherLine {
  name: string;
  kind: 'good' | 'service';
  quantity: string;
  unitPrice: string;
  tax: 'itbis18' | 'itbis16' | 'itbis0' | 'exempt';
  withholding?: { itbis?: string; isr?: string };
}

export const fiscalService = {
  // ── The company's e-CF ─────────────────────────────────────────────────────
  getStatus: (): Promise<AxiosResponse<ApiResponse<FiscalStatus>>> => apiClient.get('/fiscal/status'),
  sync: (): Promise<AxiosResponse<ApiResponse<FiscalStatus>>> => apiClient.post('/fiscal/sync'),
  activate: (data: FiscalActivation): Promise<AxiosResponse<ApiResponse<FiscalStatus>>> => apiClient.post('/fiscal/activate', data),
  getPlans: (): Promise<AxiosResponse<ApiResponse<FiscalPlans>>> => apiClient.get('/fiscal/plans'),
  changePlan: (plan: FiscalPlanId): Promise<AxiosResponse<ApiResponse<FiscalStatus> & { outcome: 'applied' | 'scheduled' | 'unchanged' | 'cancelled' }>> =>
    apiClient.put('/fiscal/plan', { plan }),
  getReadiness: (): Promise<AxiosResponse<ApiResponse<FiscalReadiness>>> => apiClient.get('/fiscal/readiness'),
  getUsage: (): Promise<AxiosResponse<ApiResponse<FiscalUsage>>> => apiClient.get('/fiscal/usage'),
  getStatements: (): Promise<AxiosResponse<ApiResponse<FiscalStatement[]>>> => apiClient.get('/fiscal/statements'),
  getAlerts: (): Promise<AxiosResponse<ApiResponse<FiscalAlert[]>>> => apiClient.get('/fiscal/alerts'),

  // ── Documents ──────────────────────────────────────────────────────────────
  getDocuments: (params?: FiscalDocumentQuery): Promise<AxiosResponse<FiscalList<ElectronicInvoice>>> =>
    apiClient.get('/fiscal/documents', { params }),
  getDocument: (id: string): Promise<AxiosResponse<ApiResponse<ElectronicInvoice>>> => apiClient.get(`/fiscal/documents/${id}`),
  refreshDocument: (id: string): Promise<AxiosResponse<ApiResponse<ElectronicInvoice>>> => apiClient.post(`/fiscal/documents/${id}/refresh`),
  retryDocument: (id: string): Promise<AxiosResponse<FiscalIssueResult>> => apiClient.post(`/fiscal/documents/${id}/retry`),
  emailDocument: (id: string, email?: string): Promise<AxiosResponse<ApiResponse<null>>> =>
    apiClient.post(`/fiscal/documents/${id}/email`, email ? { email } : {}),
  getDocumentPdfBlob: (id: string): Promise<AxiosResponse<Blob>> => apiClient.get(`/fiscal/documents/${id}/pdf`, { responseType: 'blob' }),
  getDocumentXmlBlob: (id: string): Promise<AxiosResponse<Blob>> => apiClient.get(`/fiscal/documents/${id}/xml`, { responseType: 'blob' }),

  /** PMS: an e-CF for a folio's charges (31 with a buyer RNC, else 32). */
  issueFromFolio: (data: {
    folioId: string;
    paymentId?: string;
    tipoECF?: 'E31' | 'E32';
    buyerRnc?: string;
    buyerName?: string;
    buyerEmail?: string;
    buyerRazonSocial?: string;
  }): Promise<AxiosResponse<FiscalIssueResult>> => apiClient.post('/fiscal/documents/from-folio', data),

  /** A credit note (34) on an accepted invoice. `codigoModificacion`: DGII's code, '1' void · '2' text · '3' amounts. */
  issueCreditNote: (data: {
    originalId: string;
    codigoModificacion: '1' | '2' | '3';
    razonModificacion: string;
    items?: Array<{ description: string; amount: number }>;
    totalAmount?: number;
  }): Promise<AxiosResponse<FiscalIssueResult>> => apiClient.post('/fiscal/documents/credit-note', data),

  issueDebitNote: (data: {
    originalId: string;
    razonModificacion: string;
    items?: Array<{ description: string; amount: number }>;
    totalAmount?: number;
  }): Promise<AxiosResponse<FiscalIssueResult>> => apiClient.post('/fiscal/documents/debit-note', data),

  /** Purchases, minor expenses, special regime, government, export and payments abroad (41–47). */
  issueOther: (data: {
    type: '41' | '43' | '44' | '45' | '46' | '47';
    buyer?: { name: string; rnc?: string; foreignId?: string; email?: string; address?: string };
    incomeType?: string;
    payment?: { type: 'cash' } | { type: 'credit'; dueOn: string } | { type: 'free' };
    lines: FiscalOtherLine[];
    refNumber?: string;
  }): Promise<AxiosResponse<FiscalIssueResult>> => apiClient.post('/fiscal/documents/other', data),

  // ── Reports, sequences, received documents, directory ──────────────────────
  getMonthlyTaxReport: (params?: { year?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<EcfMonthlyTaxRow[]>>> =>
    apiClient.get('/fiscal/reports/monthly-tax', { params }),

  getSequences: (): Promise<AxiosResponse<ApiResponse<FiscalSequence[]>>> => apiClient.get('/fiscal/sequences'),
  recordSequence: (data: { documentType: string; rangeStart: number; rangeEnd: number; expiresOn?: string }): Promise<AxiosResponse<ApiResponse<FiscalSequence>>> =>
    apiClient.post('/fiscal/sequences', data),
  annulSequences: (ranges: Array<{ documentType: string; from: number; to: number }>): Promise<AxiosResponse<ApiResponse<{ count: number; outcome: string; fileName: string }>>> =>
    apiClient.post('/fiscal/sequences/annul', { ranges }),

  getReceived: (params?: { page?: number; filter?: 'undecided' | 'approved' | 'rejected'; q?: string }): Promise<AxiosResponse<FiscalList<ReceivedDocument>>> =>
    apiClient.get('/fiscal/received', { params }),
  getReceivedOne: (id: string): Promise<AxiosResponse<ApiResponse<ReceivedDocumentDetail>>> => apiClient.get(`/fiscal/received/${id}`),
  getReceivedFileBlob: (id: string, file: 'xml' | 'pdf' | 'acknowledgment'): Promise<AxiosResponse<Blob>> =>
    apiClient.get(`/fiscal/received/${id}/${file}`, { responseType: 'blob' }),
  decideReceived: (id: string, decision: ReceivedDecision, reason?: string): Promise<AxiosResponse<ApiResponse<ReceivedDocumentDetail>>> =>
    apiClient.post(`/fiscal/received/${id}/decision`, decision === 'rejected' ? { decision, reason } : { decision }),
  retryReceivedDelivery: (id: string, target: 'dgii' | 'issuer'): Promise<AxiosResponse<ApiResponse<ReceivedDocumentDetail>>> =>
    apiClient.post(`/fiscal/received/${id}/deliveries/${target}/retry`),

  lookupDirectory: (rnc: string): Promise<AxiosResponse<ApiResponse<{ rnc: string; name: string } | null>>> =>
    apiClient.get('/fiscal/directory', { params: { rnc } }),
};

// ─── Reports Service ──────────────────────────────────────────────────────────

export interface OccupancyParams {
  from?: string;
  to?: string;
  groupBy?: 'day' | 'week' | 'month';
  compareTo?: 'prev_period' | 'prev_year';
}

export const reportsService = {
  /** GET /admin/reports/occupancy — ADR, RevPAR, Occupancy % metrics */
  getOccupancy: (params?: OccupancyParams): Promise<AxiosResponse<ApiResponse<OccupancyReportData>>> =>
    apiClient.get('/admin/reports/occupancy', { params }),

  /** GET /admin/reports/manager-flash — day / MTD / YTD vs last year, operations, 30-day outlook */
  getManagerFlash: (params?: { date?: string }): Promise<AxiosResponse<ApiResponse<ManagerFlashData>>> =>
    apiClient.get('/admin/reports/manager-flash', { params }),

  /** GET /admin/reports/forecast — on the books, pickup and pace vs same time last year */
  getForecast: (params?: { from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<ForecastData>>> =>
    apiClient.get('/admin/reports/forecast', { params }),

  /** GET /admin/reports/segmentation — revenue mix by source, room type or rate plan */
  getSegmentation: (params?: { from?: string; to?: string; by?: SegmentBy }): Promise<AxiosResponse<ApiResponse<SegmentationData>>> =>
    apiClient.get('/admin/reports/segmentation', { params }),

  /** GET /admin/reports/booking-insights — lead time, LOS, day of week, cancellations, no-shows */
  getBookingInsights: (params?: { from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<BookingInsightsData>>> =>
    apiClient.get('/admin/reports/booking-insights', { params }),

  /** GET /admin/reports/night-audit — full Night Audit for a single date */
  getNightAudit: (params?: { date?: string }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.get('/admin/reports/night-audit', { params }),

  /** GET /admin/reports/night-audit/range — summary table for a date range */
  getNightAuditRange: (params?: {
    from?: string;
    to?: string;
  }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.get('/admin/reports/night-audit/range', { params }),

  /** GET /admin/reports/arrivals — arrivals list for a given date */
  getArrivals: (params?: { date?: string }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.get('/admin/reports/arrivals', { params }),

  /** GET /admin/reports/departures — departures list for a given date */
  getDepartures: (params?: { date?: string }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.get('/admin/reports/departures', { params }),
};

// ─── Accounting: Warehouses Service ───────────────────────────────────────────

export const warehousesService = {
  getWarehouses: (params?: { active?: boolean | 'all'; search?: string }): Promise<AxiosResponse<ApiResponse<Warehouse[]>>> =>
    apiClient.get('/accounting/warehouses', { params }),

  getWarehouse: (id: string): Promise<AxiosResponse<ApiResponse<Warehouse>>> =>
    apiClient.get(`/accounting/warehouses/${id}`),

  getWarehouseStock: (id: string): Promise<AxiosResponse<ApiResponse<Array<{ product: any; onHandQty: number }>>>> =>
    apiClient.get(`/accounting/warehouses/${id}/stock`),

  createWarehouse: (data: { name: string; code: string; address?: string; notes?: string; isDefault?: boolean }): Promise<AxiosResponse<ApiResponse<Warehouse>>> =>
    apiClient.post('/accounting/warehouses', data),

  updateWarehouse: (id: string, data: Partial<{ name: string; code: string; address: string; notes: string; isActive: boolean; isDefault: boolean }>): Promise<AxiosResponse<ApiResponse<Warehouse>>> =>
    apiClient.put(`/accounting/warehouses/${id}`, data),

  archiveWarehouse: (id: string): Promise<AxiosResponse<ApiResponse<Warehouse>>> =>
    apiClient.delete(`/accounting/warehouses/${id}`),
};

// ─── Accounting: Products (Inventory) Service ─────────────────────────────────

export const productsService = {
  getProducts: (params?: { active?: boolean | 'all'; category?: string; search?: string; lowStock?: boolean; sellable?: boolean; purchasable?: boolean }): Promise<AxiosResponse<ApiResponse<Product[]>>> =>
    apiClient.get('/accounting/products', { params }),

  getProduct: (id: string): Promise<AxiosResponse<ApiResponse<Product>>> =>
    apiClient.get(`/accounting/products/${id}`),

  getProductTransactions: (id: string, params?: { page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<InventoryTransaction[]>>> =>
    apiClient.get(`/accounting/products/${id}/transactions`, { params }),

  getProductStockByWarehouse: (id: string): Promise<AxiosResponse<ApiResponse<Array<{ warehouse: Warehouse; onHandQty: number }>>>> =>
    apiClient.get(`/accounting/products/${id}/stock`),

  createProduct: (data: {
    name: string; sku: string; category?: string; unitOfMeasure: string; defaultUnitPrice?: number;
    reorderPoint?: number; description?: string; isSellable?: boolean; isPurchasable?: boolean; notes?: string;
    initialQuantity?: number; initialUnitCost?: number; warehouseId?: string;
  }): Promise<AxiosResponse<ApiResponse<Product>>> =>
    apiClient.post('/accounting/products', data),

  updateProduct: (id: string, data: Partial<{
    name: string; sku: string; category: string; unitOfMeasure: string; defaultUnitPrice: number;
    reorderPoint: number; description: string; isSellable: boolean; isPurchasable: boolean; notes: string; isActive: boolean;
  }>): Promise<AxiosResponse<ApiResponse<Product>>> =>
    apiClient.put(`/accounting/products/${id}`, data),

  archiveProduct: (id: string): Promise<AxiosResponse<ApiResponse<Product>>> =>
    apiClient.delete(`/accounting/products/${id}`),

  purchaseProduct: (id: string, data: { quantity: number; unitCost: number; notes?: string; warehouseId?: string }): Promise<AxiosResponse<ApiResponse<{ product: Product; transaction: InventoryTransaction }>>> =>
    apiClient.post(`/accounting/products/${id}/purchase`, data),

  adjustProduct: (id: string, data: { quantityDelta?: number; countedQuantity?: number; reason?: InventoryAdjustmentReason; notes?: string; warehouseId?: string }): Promise<AxiosResponse<ApiResponse<{ product: Product; transaction: InventoryTransaction }>>> =>
    apiClient.post(`/accounting/products/${id}/adjust`, data),
};

// Accounting-scoped Customer CRUD (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.2,
// re-pointed at a dedicated `Customer` model by the Phase 10.3 / architecture §11 split —
// no longer the PMS-side `Company` model) through `accounting.customers.manage`-gated
// `/api/accounting/customers` endpoints so an accounting-only user (no PMS admin role) can
// manage AR customers. `linkedCompanyId` optionally bridges a customer to a real PMS
// `Company` (a pre-approved direct-bill account) — validated server-side against `Company`.
export const accountingCustomersService = {
  getCustomers: (params?: { search?: string; active?: boolean | 'all'; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<Customer[]>>> =>
    apiClient.get('/accounting/customers', { params }),

  getCustomer: (id: string): Promise<AxiosResponse<ApiResponse<Customer>>> =>
    apiClient.get(`/accounting/customers/${id}`),

  createCustomer: (data: Omit<Partial<Customer>, 'linkedCompanyId'> & { linkedCompanyId?: string | null }): Promise<AxiosResponse<ApiResponse<Customer>>> =>
    apiClient.post('/accounting/customers', data),

  updateCustomer: (id: string, data: Omit<Partial<Customer>, 'linkedCompanyId'> & { linkedCompanyId?: string | null }): Promise<AxiosResponse<ApiResponse<Customer>>> =>
    apiClient.put(`/accounting/customers/${id}`, data),

  archiveCustomer: (id: string): Promise<AxiosResponse<ApiResponse<Customer>>> =>
    apiClient.delete(`/accounting/customers/${id}`),
};

export interface InvoiceLineItemInput {
  description: string;
  product?: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxRate?: number;
}

export const invoicesService = {
  getInvoices: (params?: { status?: string; customer?: string; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<Invoice[]> & { meta?: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/accounting/invoices', { params }),

  getInvoice: (id: string): Promise<AxiosResponse<ApiResponse<Invoice>>> =>
    apiClient.get(`/accounting/invoices/${id}`),

  getFormMeta: (): Promise<AxiosResponse<ApiResponse<InvoiceFormMeta>>> =>
    apiClient.get('/accounting/invoices/form-meta'),

  /** The printable invoice, generated server-side from the stored document. */
  getPdfBlob: (id: string): Promise<AxiosResponse<Blob>> =>
    apiClient.get(`/accounting/invoices/${id}/pdf`, { responseType: 'blob', timeout: 30000 }),

  createInvoice: (data: {
    customer?: string;
    isIndividual?: boolean;
    individualCustomer?: { name: string; email?: string; phone?: string };
    dueDate?: string;
    notes?: string;
    reference?: string;
    lineItems: InvoiceLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<Invoice>>> =>
    apiClient.post('/accounting/invoices', data),

  updateInvoice: (id: string, data: {
    customer?: string;
    isIndividual?: boolean;
    individualCustomer?: { name: string; email?: string; phone?: string };
    dueDate?: string;
    notes?: string;
    reference?: string;
    lineItems?: InvoiceLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<Invoice>>> =>
    apiClient.put(`/accounting/invoices/${id}`, data),

  sendInvoice: (id: string, data?: { lineItemWarehouses?: Record<string, string> }): Promise<AxiosResponse<ApiResponse<{ invoice: Invoice; electronicInvoice: ElectronicInvoice }>>> =>
    apiClient.post(`/accounting/invoices/${id}/send`, data || {}),

  recordPayment: (id: string, data: { amount: number; method: InvoicePaymentMethod; date?: string; reference?: string }): Promise<AxiosResponse<ApiResponse<Invoice>>> =>
    apiClient.post(`/accounting/invoices/${id}/payments`, data),

  voidInvoice: (id: string): Promise<AxiosResponse<ApiResponse<Invoice>>> =>
    apiClient.post(`/accounting/invoices/${id}/void`),
};

export const cityLedgerService = {
  getPending: (params?: { page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<Invoice[]> & { meta?: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/accounting/city-ledger', { params }),

  getPendingCount: (): Promise<AxiosResponse<ApiResponse<{ count: number }>>> =>
    apiClient.get('/accounting/city-ledger/pending-count'),

  authorize: (id: string): Promise<AxiosResponse<ApiResponse<Invoice>>> =>
    apiClient.post(`/accounting/city-ledger/${id}/authorize`),

  decline: (id: string, reason: string): Promise<AxiosResponse<ApiResponse<Invoice>>> =>
    apiClient.post(`/accounting/city-ledger/${id}/decline`, { reason }),
};

export const quotesService = {
  getQuotes: (params?: { status?: string; customer?: string; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<Quote[]> & { meta?: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/accounting/quotes', { params }),

  getQuote: (id: string): Promise<AxiosResponse<ApiResponse<Quote>>> =>
    apiClient.get(`/accounting/quotes/${id}`),

  createQuote: (data: {
    customer?: string;
    isIndividual?: boolean;
    individualCustomer?: { name: string; email?: string; phone?: string };
    expiryDate?: string;
    notes?: string;
    lineItems: InvoiceLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<Quote>>> =>
    apiClient.post('/accounting/quotes', data),

  updateQuote: (id: string, data: {
    customer?: string;
    isIndividual?: boolean;
    individualCustomer?: { name: string; email?: string; phone?: string };
    expiryDate?: string;
    notes?: string;
    lineItems?: InvoiceLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<Quote>>> =>
    apiClient.put(`/accounting/quotes/${id}`, data),

  sendQuote: (id: string): Promise<AxiosResponse<ApiResponse<Quote>>> =>
    apiClient.post(`/accounting/quotes/${id}/send`),

  acceptQuote: (id: string): Promise<AxiosResponse<ApiResponse<Quote>>> =>
    apiClient.post(`/accounting/quotes/${id}/accept`),

  rejectQuote: (id: string): Promise<AxiosResponse<ApiResponse<Quote>>> =>
    apiClient.post(`/accounting/quotes/${id}/reject`),

  convertQuote: (id: string): Promise<AxiosResponse<ApiResponse<{ quote: Quote; invoice: Invoice }>>> =>
    apiClient.post(`/accounting/quotes/${id}/convert`),
};

// ─── Accounting: Credit Notes (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8) ─────────
// AR mirror of invoicesService's write shape, but 'issue' stands in for 'send' (issues a real
// E34 e-CF against the originating invoice) and there are two post-issue actions instead of one
// payment action: 'apply' (subsidiary-ledger allocation onto a target invoice, no new
// JournalEntry) and 'refund' (real cash-out, does post a JournalEntry) — see creditNotes.controller.ts.

export interface CreditNoteLineItemInput {
  lineType: 'return' | 'allowance';
  description: string;
  taxRate?: number;
  // 'return' lines only:
  product?: string;
  quantity?: number;
  unitPrice?: number;
  // 'allowance' lines only:
  lineTotal?: number;
}

export const creditNotesService = {
  getCreditNotes: (params?: { status?: string; invoice?: string; customer?: string; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<CreditNote[]> & { meta?: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/accounting/credit-notes', { params }),

  getCreditNote: (id: string): Promise<AxiosResponse<ApiResponse<CreditNote>>> =>
    apiClient.get(`/accounting/credit-notes/${id}`),

  createCreditNote: (data: {
    invoice: string;
    warehouse?: string;
    reason: CreditNoteReason;
    fiscalModificationCode: CreditNoteFiscalModificationCode;
    notes?: string;
    lineItems: CreditNoteLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<CreditNote>>> =>
    apiClient.post('/accounting/credit-notes', data),

  updateCreditNote: (id: string, data: {
    warehouse?: string;
    reason?: CreditNoteReason;
    fiscalModificationCode?: CreditNoteFiscalModificationCode;
    notes?: string;
    lineItems?: CreditNoteLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<CreditNote>>> =>
    apiClient.put(`/accounting/credit-notes/${id}`, data),

  issueCreditNote: (id: string): Promise<AxiosResponse<ApiResponse<{ creditNote: CreditNote; electronicInvoice: ElectronicInvoice }>>> =>
    apiClient.post(`/accounting/credit-notes/${id}/issue`),

  applyCreditNote: (id: string, data: { invoice?: string; amount: number; note?: string }): Promise<AxiosResponse<ApiResponse<{ creditNote: CreditNote; invoice: Invoice }>>> =>
    apiClient.post(`/accounting/credit-notes/${id}/apply`, data),

  refundCreditNote: (id: string, data: { amount: number; method: CreditNoteRefundMethod; reference?: string; note?: string }): Promise<AxiosResponse<ApiResponse<CreditNote>>> =>
    apiClient.post(`/accounting/credit-notes/${id}/refund`, data),

  voidCreditNote: (id: string, data?: { reason?: string }): Promise<AxiosResponse<ApiResponse<CreditNote>>> =>
    apiClient.post(`/accounting/credit-notes/${id}/void`, data || {}),
};

// ─── Accounting: Debit Notes (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8.3/8.4) ────
// AR mirror of invoicesService's write shape — 'issue' stands in for 'send' (issues a real
// E33 e-CF against the originating invoice), 'payments' stands in for the same recordPayment
// action Invoice/Bill use. No apply/refund here — a debit note is new AR to collect, not a
// pool of credit to allocate (see creditNotesService for that shape). See debitNotes.controller.ts.

export interface DebitNoteLineItemInput {
  description: string;
  taxRate?: number;
  lineTotal: number;
  product?: string;
}

export const debitNotesService = {
  getDebitNotes: (params?: { status?: string; invoice?: string; customer?: string; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<DebitNote[]> & { meta?: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/accounting/debit-notes', { params }),

  getDebitNote: (id: string): Promise<AxiosResponse<ApiResponse<DebitNote>>> =>
    apiClient.get(`/accounting/debit-notes/${id}`),

  createDebitNote: (data: {
    invoice: string;
    reason: DebitNoteReason;
    fiscalModificationCode: DebitNoteFiscalModificationCode;
    dueDate?: string;
    notes?: string;
    lineItems: DebitNoteLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<DebitNote>>> =>
    apiClient.post('/accounting/debit-notes', data),

  updateDebitNote: (id: string, data: {
    reason?: DebitNoteReason;
    fiscalModificationCode?: DebitNoteFiscalModificationCode;
    dueDate?: string;
    notes?: string;
    lineItems?: DebitNoteLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<DebitNote>>> =>
    apiClient.put(`/accounting/debit-notes/${id}`, data),

  issueDebitNote: (id: string): Promise<AxiosResponse<ApiResponse<{ debitNote: DebitNote; electronicInvoice: ElectronicInvoice }>>> =>
    apiClient.post(`/accounting/debit-notes/${id}/issue`),

  recordPayment: (id: string, data: { amount: number; method: DebitNotePaymentMethod; date?: string; reference?: string }): Promise<AxiosResponse<ApiResponse<DebitNote>>> =>
    apiClient.post(`/accounting/debit-notes/${id}/payments`, data),

  voidDebitNote: (id: string, data?: { reason?: string }): Promise<AxiosResponse<ApiResponse<DebitNote>>> =>
    apiClient.post(`/accounting/debit-notes/${id}/void`, data || {}),
};

// ─── Accounting: Chart of Accounts (read-only here — full CRUD UI lands in Phase 9.2) ─────
// Bill expense lines code straight to an Account, so the picker needs a list now even
// though Chart of Accounts management itself isn't built yet.

export const accountsService = {
  getAccounts: (params?: { active?: boolean | 'all'; type?: string }): Promise<AxiosResponse<ApiResponse<Account[]>>> =>
    apiClient.get('/accounting/accounts', { params }),
};

// ─── Accounting: Manual Journal Entries (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 9.1) ─
// Every auto-posting hook (Phase 7/8) writes through the same `postJournalEntry` primitive
// server-side; this is the one place a human posts directly, for adjustments/corrections
// nothing else in the app produces. `voidJournalEntry` only accepts `source: 'manual'`
// entries — an auto-posted entry is voided through its owning Invoice/Bill/CreditNote/
// DebitNote action instead, so that document's status stays in sync with the ledger.

export interface JournalEntryLineInput {
  account: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export const journalEntriesService = {
  getJournalEntries: (params?: { source?: JournalEntrySource; isVoid?: boolean; from?: string; to?: string; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<JournalEntry[]> & { meta?: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/accounting/journal-entries', { params }),

  getJournalEntry: (id: string): Promise<AxiosResponse<ApiResponse<JournalEntry>>> =>
    apiClient.get(`/accounting/journal-entries/${id}`),

  createJournalEntry: (data: { date?: string; memo: string; lines: JournalEntryLineInput[] }): Promise<AxiosResponse<ApiResponse<JournalEntry>>> =>
    apiClient.post('/accounting/journal-entries', data),

  voidJournalEntry: (id: string, data?: { reason?: string }): Promise<AxiosResponse<ApiResponse<{ journalEntry: JournalEntry; reversal: JournalEntry }>>> =>
    apiClient.post(`/accounting/journal-entries/${id}/void`, data || {}),
};

// ─── Accounting: Financial Reports (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 9.2) ──
// Named `accountingReportsService` (not `reportsService`, already taken by the pre-existing
// PMS-side hotel reports at `/api/reports/*`) — every call here hits `/api/accounting/reports/*`,
// computed live server-side on each request, no cached tables.

// Everything on the Accounting dashboard in one request (each block permission-gated server-side).
export const accountingDashboardService = {
  get: (period: DashboardPeriod): Promise<AxiosResponse<ApiResponse<AccountingDashboardData>>> =>
    apiClient.get('/accounting/dashboard', { params: { period } }),
};

export const accountingReportsService = {
  getTrialBalance: (params?: { asOf?: string }): Promise<AxiosResponse<ApiResponse<TrialBalanceReport>>> =>
    apiClient.get('/accounting/reports/trial-balance', { params }),

  getProfitAndLoss: (params?: { from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<ProfitAndLossReport>>> =>
    apiClient.get('/accounting/reports/profit-and-loss', { params }),

  getBalanceSheet: (params?: { asOf?: string }): Promise<AxiosResponse<ApiResponse<BalanceSheetReport>>> =>
    apiClient.get('/accounting/reports/balance-sheet', { params }),

  getApAging: (params?: { asOf?: string }): Promise<AxiosResponse<ApiResponse<ApAgingReport>>> =>
    apiClient.get('/accounting/reports/ap-aging', { params }),

  getArAging: (params?: { asOf?: string }): Promise<AxiosResponse<ApiResponse<ArAgingReport>>> =>
    apiClient.get('/accounting/reports/ar-aging', { params }),

  getGeneralLedger: (params: { accountId: string; from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<GeneralLedgerReport>>> =>
    apiClient.get('/accounting/reports/general-ledger', { params }),

  getSupplierStatement: (id: string, params?: { from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<SupplierStatementReport>>> =>
    apiClient.get(`/accounting/reports/supplier-statement/${id}`, { params }),

  getCustomerStatement: (id: string, params?: { from?: string; to?: string }): Promise<AxiosResponse<ApiResponse<CustomerStatementReport>>> =>
    apiClient.get(`/accounting/reports/customer-statement/${id}`, { params }),
};

// ─── Accounting: Suppliers (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6.1/6.2) ──────
// AP mirror of accountingCustomersService — a real new model (locked-in decision #5), so
// this is plain CRUD directly against `/api/accounting/suppliers`, guarded by
// `accounting.suppliers.manage`.

export const suppliersService = {
  getSuppliers: (params?: { search?: string; active?: boolean | 'all'; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<Supplier[]>>> =>
    apiClient.get('/accounting/suppliers', { params }),

  getSupplier: (id: string): Promise<AxiosResponse<ApiResponse<Supplier>>> =>
    apiClient.get(`/accounting/suppliers/${id}`),

  createSupplier: (data: Partial<Supplier>): Promise<AxiosResponse<ApiResponse<Supplier>>> =>
    apiClient.post('/accounting/suppliers', data),

  updateSupplier: (id: string, data: Partial<Supplier>): Promise<AxiosResponse<ApiResponse<Supplier>>> =>
    apiClient.put(`/accounting/suppliers/${id}`, data),

  archiveSupplier: (id: string): Promise<AxiosResponse<ApiResponse<Supplier>>> =>
    apiClient.delete(`/accounting/suppliers/${id}`),
};

// ─── Accounting: Bills (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6.1/6.2) ──────────
// AP mirror of invoicesService — 'receive' is Bill's equivalent of Invoice's 'send'
// (draft -> received, deducts nothing but instead adds stock for inventory lines).

export interface BillLineItemInput {
  lineType: 'inventory' | 'expense';
  description?: string;
  taxRate?: number;
  // inventory lines only:
  product?: string;
  purchaseUnitOfMeasure?: string;
  purchaseQuantity?: number;
  purchaseUnitCost?: number;
  stockUnitOfMeasure?: string;
  stockQuantity?: number;
  // expense lines only:
  account?: string;
  lineTotal?: number;
}

export const billsService = {
  getBills: (params?: { status?: string; supplier?: string; search?: string; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<Bill[]> & { meta?: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/accounting/bills', { params }),

  getBill: (id: string): Promise<AxiosResponse<ApiResponse<Bill>>> =>
    apiClient.get(`/accounting/bills/${id}`),

  createBill: (data: {
    supplier: string;
    warehouse?: string;
    vendorInvoiceNumber?: string;
    issueDate?: string;
    dueDate?: string;
    notes?: string;
    lineItems: BillLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<Bill>>> =>
    apiClient.post('/accounting/bills', data),

  updateBill: (id: string, data: {
    supplier?: string;
    warehouse?: string;
    vendorInvoiceNumber?: string;
    issueDate?: string;
    dueDate?: string;
    notes?: string;
    lineItems?: BillLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<Bill>>> =>
    apiClient.put(`/accounting/bills/${id}`, data),

  receiveBill: (id: string): Promise<AxiosResponse<ApiResponse<Bill>>> =>
    apiClient.post(`/accounting/bills/${id}/receive`),

  recordPayment: (id: string, data: { amount: number; method: BillPaymentMethod; date?: string; reference?: string }): Promise<AxiosResponse<ApiResponse<Bill>>> =>
    apiClient.post(`/accounting/bills/${id}/payments`, data),

  voidBill: (id: string, data?: { reason?: string }): Promise<AxiosResponse<ApiResponse<Bill>>> =>
    apiClient.post(`/accounting/bills/${id}/void`, data || {}),
};


// ─── Platform: how Pilloto charges its tenants ──────────────────────────────

type Ok<T> = Promise<AxiosResponse<ApiResponse<T>>>;
const billingBase = '/platform/billing';

export const platformBillingService = {
  overview: (): Ok<BillingOverview> => apiClient.get(`${billingBase}/overview`),
  getSettings: (): Ok<BillingSettings> => apiClient.get(`${billingBase}/settings`),
  saveSettings: (data: Partial<BillingSettings>): Ok<BillingSettings> => apiClient.put(`${billingBase}/settings`, data),

  plans: (): Ok<BillingPlanEntry[]> => apiClient.get(`${billingBase}/plans`),
  setPlanPrice: (product: BillingProduct, plan: string, price: number): Ok<BillingPlanEntry> =>
    apiClient.put(`${billingBase}/plans/${product}/${plan}`, { price }),

  tenants: (): Ok<BillingTenant[]> => apiClient.get(`${billingBase}/tenants`),
  tenant: (id: string): Ok<BillingTenantDetail> => apiClient.get(`${billingBase}/tenants/${id}`),
  updateTenant: (id: string, data: { billingEmail?: string; paused?: boolean }): Ok<BillingTenant> =>
    apiClient.patch(`${billingBase}/tenants/${id}`, data),
  addPriceChange: (id: string, data: { product: BillingProduct; price: number; effectiveFrom: string; reason: string }): Ok<BillingTenant> =>
    apiClient.post(`${billingBase}/tenants/${id}/price-changes`, data),
  cancelPriceChange: (id: string, changeId: string): Ok<BillingTenant> =>
    apiClient.delete(`${billingBase}/tenants/${id}/price-changes/${changeId}`),
  addDiscount: (id: string, data: { product: BillingProduct; type: 'percent' | 'amount'; value: number; effectiveFrom: string; effectiveUntil?: string; reason: string }): Ok<BillingTenant> =>
    apiClient.post(`${billingBase}/tenants/${id}/discounts`, data),
  endDiscount: (id: string, discountId: string): Ok<BillingTenant> =>
    apiClient.delete(`${billingBase}/tenants/${id}/discounts/${discountId}`),

  charges: (params: { status?: string; tenantId?: string; period?: string; overdue?: boolean; page?: number; limit?: number } = {}): Promise<AxiosResponse<{ success: boolean } & Paged<BillingCharge>>> =>
    apiClient.get(`${billingBase}/charges`, { params }),
  charge: (id: string): Ok<BillingCharge> => apiClient.get(`${billingBase}/charges/${id}`),
  generateCharge: (data: { tenantId: string; period: string; notify?: boolean }): Ok<{ created: boolean; charge: BillingCharge }> =>
    apiClient.post(`${billingBase}/charges/generate`, data),
  runBilling: (): Ok<{ period: string; created: number; existing: number; skipped: number; failed: number }> =>
    apiClient.post(`${billingBase}/charges/run`),
  voidCharge: (id: string, reason: string): Ok<BillingCharge> => apiClient.post(`${billingBase}/charges/${id}/void`, { reason }),
  notifyCharge: (id: string): Ok<{ sent: boolean }> => apiClient.post(`${billingBase}/charges/${id}/notify`),
  recordPayment: (chargeId: string, data: RecordPaymentBody): Ok<{ payment: BillingPayment; charge: BillingCharge }> =>
    apiClient.post(`${billingBase}/charges/${chargeId}/payments`, data),

  payments: (params: { status?: string; tenantId?: string; ecf?: 'missing'; page?: number; limit?: number } = {}): Promise<AxiosResponse<{ success: boolean } & Paged<BillingPayment>>> =>
    apiClient.get(`${billingBase}/payments`, { params }),
  retryEcf: (id: string): Ok<BillingPayment> => apiClient.post(`${billingBase}/payments/${id}/ecf`),
  refreshEcf: (id: string): Ok<BillingPayment> => apiClient.post(`${billingBase}/payments/${id}/refresh`, {}),
  reversePayment: (id: string, reason: string): Ok<{ payment: BillingPayment; charge: BillingCharge }> =>
    apiClient.post(`${billingBase}/payments/${id}/reverse`, { reason }),
  ecfPdf: (id: string): Promise<AxiosResponse<Blob>> => apiClient.get(`${billingBase}/payments/${id}/ecf/pdf`, { responseType: 'blob' }),
  ecfXml: (id: string): Promise<AxiosResponse<Blob>> => apiClient.get(`${billingBase}/payments/${id}/ecf/xml`, { responseType: 'blob' }),
  emailEcf: (id: string, email?: string): Ok<{ sentTo: string | null }> => apiClient.post(`${billingBase}/payments/${id}/ecf/email`, { email }),

  issuer: (): Ok<BillingIssuer> => apiClient.get(`${billingBase}/issuer`),
  issuerReadiness: (): Ok<BillingIssuerReadiness> => apiClient.get(`${billingBase}/issuer/readiness`),
  linkIssuer: (): Ok<BillingIssuer> => apiClient.post(`${billingBase}/issuer/link`),
  syncIssuer: (): Ok<BillingIssuer> => apiClient.post(`${billingBase}/issuer/sync`),
  recordSequence: (data: { documentType: string; rangeStart: number; rangeEnd: number; expiresOn?: string }): Ok<BillingSequence> =>
    apiClient.post(`${billingBase}/issuer/sequences`, data),
};
