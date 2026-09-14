import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { User, Room, Reservation, MediaItem, Amenity, EventType, Company, Guest, CreditAccount, AppCode } from '../types';
import type { Customer } from '../types';
import type { ChargeTemplate, ChargeRule, ChargeRuleExecution, AuditRun } from '../types';
import type { TenantEcfConfig, ElectronicInvoice, EcfMonthlyTaxRow, EcfSequenceInfo } from '../types';
import type { Warehouse, Product, InventoryTransaction, InventoryAdjustmentReason } from '../types';
import type { Invoice, InvoicePaymentMethod, Quote } from '../types';
import type { Account, Supplier, Bill, BillPaymentMethod } from '../types';
import type { CreditNote, CreditNoteReason, CreditNoteFiscalModificationCode, CreditNoteRefundMethod } from '../types';
import type { DebitNote, DebitNoteReason, DebitNoteFiscalModificationCode, DebitNotePaymentMethod } from '../types';
import type { JournalEntry, JournalEntrySource } from '../types';
import type {
  TrialBalanceReport, ProfitAndLossReport, BalanceSheetReport,
  ApAgingReport, ArAgingReport, GeneralLedgerReport,
  SupplierStatementReport, CustomerStatementReport,
} from '../types';

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
      const msg = error.response?.data?.message || 'Too many requests. Please try again later.';
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

  getAvailableRooms: (checkIn: string, checkOut: string): Promise<AxiosResponse<ApiResponse<Room[]>>> =>
    apiClient.get('/rooms/available', { params: { checkIn, checkOut } }),

  getAvailableDates: (startDate: string, endDate: string): Promise<AxiosResponse<ApiResponse<{ availableDates: string[]; unavailableDates: string[]; totalActiveRooms: number }>>> =>
    apiClient.get('/rooms/available-dates', { params: { startDate, endDate } }),

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
  }): Promise<AxiosResponse<{ success: boolean; count: number; data: Reservation[]; pagination?: any }>> =>
    apiClient.get('/reservations', { params }),

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
  // Dashboard stats
  getDashboardStats: (): Promise<AxiosResponse<ApiResponse<any>>> =>
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
  createUser: (data: { firstName: string; lastName: string; email: string; phone?: string; role?: string; password: string }): Promise<AxiosResponse<ApiResponse<User>>> =>
    apiClient.post('/admin/users', data),
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
  }): Promise<AxiosResponse<ApiResponse<Array<{
    roomType: { _id: string; name: string; capacity: number; image?: string };
    availableCount: number;
    ratePlan: { _id: string; name: string };
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
  }>>>> =>
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
  }): Promise<AxiosResponse<ApiResponse<any>>> => apiClient.post('/pricing/rate-plans', data),

  updateRatePlan: (id: string, data: Partial<{
    name: string;
    roomTypeId: string;
    basePrice: number;
    occupancyTiers: Array<{ guestType: 'adult' | 'child'; guestNumber: number; price: number }>;
    isActive: boolean;
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
  otaSettings?: {
    enabled: boolean;
    syncIntervalMinutes: number;
    timezone: string;
    conflictAlerts: boolean;
  };
  bookingSettings?: {
    enabled: boolean;
    heroImageUrl?: string;
    heroHeadline?: string;
    heroSubtitle?: string;
    contactPhone?: string;
    contactEmail?: string;
    contactAddress?: string;
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
  adminPassword: string;
  settings?: Record<string, any>;
  products?: TenantProduct[];
  plans?: { accounting?: AccountingPlanSlug };
}

export const platformService = {
  listTenants: (): Promise<AxiosResponse<ApiResponse<TenantRecord[]>>> =>
    apiClient.get('/platform/tenants'),

  getTenant: (id: string): Promise<AxiosResponse<ApiResponse<TenantRecord>>> =>
    apiClient.get(`/platform/tenants/${id}`),

  createTenant: (data: ProvisionTenantPayload): Promise<AxiosResponse<ApiResponse<{ tenant: TenantRecord; adminUser: any; loginUrl: string }>>> =>
    apiClient.post('/platform/tenants', data),

  updateTenant: (id: string, data: Partial<{ name: string; plan: string; isActive: boolean; ownerEmail: string; settings: any; products: TenantProduct[]; plans: { accounting?: AccountingPlanSlug } }>): Promise<AxiosResponse<ApiResponse<TenantRecord>>> =>
    apiClient.patch(`/platform/tenants/${id}`, data),

  deactivateTenant: (id: string): Promise<AxiosResponse<ApiResponse<TenantRecord>>> =>
    apiClient.delete(`/platform/tenants/${id}`),

  getTenantStats: (id: string): Promise<AxiosResponse<ApiResponse<{ tenant: TenantRecord; stats: { users: number; reservations: number; rooms: number } }>>> =>
    apiClient.get(`/platform/tenants/${id}/stats`),
};

// ── Platform OTA service ────────────────────────────────────────────────────────
export interface PlatformOtaConfig {
  globalEnabled: boolean;
  cronIntervalMinutes: number;
  cronStatus: { running: boolean; globalEnabled: boolean; intervalMinutes: number };
}

export interface PlatformOtaTenantRow {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  isActive: boolean;
  otaEnabled: boolean;
  syncIntervalMinutes: number;
  mappingCount: number;
  pendingConflicts: number;
  lastRun: {
    _id: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    imported: number;
    updated: number;
    conflicts: number;
    errorCount: number;
  } | null;
}

export interface PlatformOtaSyncRun {
  _id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  triggeredBy: 'cron' | 'manual';
  status: 'running' | 'completed' | 'failed' | 'partial';
  startedAt: string;
  completedAt?: string;
  imported: number;
  updated: number;
  conflicts: number;
  errorCount: number;
  error?: string;
}

export const platformOtaService = {
  getConfig: (): Promise<AxiosResponse<ApiResponse<PlatformOtaConfig>>> =>
    apiClient.get('/platform/ota/config'),

  updateConfig: (data: { globalEnabled?: boolean; cronIntervalMinutes?: number }): Promise<AxiosResponse<ApiResponse<PlatformOtaConfig>>> =>
    apiClient.patch('/platform/ota/config', data),

  getTenantStats: (): Promise<AxiosResponse<ApiResponse<PlatformOtaTenantRow[]>>> =>
    apiClient.get('/platform/ota/tenant-stats'),

  getSyncRuns: (params?: { page?: number; limit?: number; tenantId?: string; status?: string }): Promise<AxiosResponse<ApiResponse<PlatformOtaSyncRun[]> & { pagination: { page: number; limit: number; total: number; totalPages: number } }>> =>
    apiClient.get('/platform/ota/sync-runs', { params }),

  triggerSync: (tenantId?: string): Promise<AxiosResponse<ApiResponse<{ message: string }>>> =>
    apiClient.post('/platform/ota/sync', tenantId ? { tenantId } : {}),
};

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

// ─────────────────────────────────────────────────────────────
// OTA iCal Sync Service
// ─────────────────────────────────────────────────────────────

export type OtaProvider = 'airbnb' | 'booking_com' | 'vrbo' | 'expedia' | 'other';
export type OtaConflictStatus =
  | 'pending_review'
  | 'resolved_keep_pilloto'
  | 'resolved_accept_ota'
  | 'resolved_outside_system'
  | 'ignored_false_positive';

export interface OtaListingMapping {
  _id: string;
  provider: OtaProvider;
  providerLabel?: string;
  externalListingId?: string;
  inboundFeedUrl?: string;
  outboundFeedUrl?: string;
  outboundToken: string;
  roomId: string | { _id: string; name: string; number?: string };
  isActive: boolean;
  lastSyncedAt?: string;
  lastSyncStatus?: 'success' | 'partial' | 'failed' | 'never';
  lastSyncError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OtaSyncRun {
  _id: string;
  mappingId: string;
  triggeredBy: 'cron' | 'manual';
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  imported: number;
  updated: number;
  conflicts: number;
  errors: string[];
}

export interface OtaConflict {
  _id: string;
  mappingId: string | OtaListingMapping;
  externalEventId: string;
  overlappingReservationId: string;
  conflictType: 'overlap' | 'exact_match';
  status: OtaConflictStatus;
  resolvedBy?: string;
  resolvedAt?: string;
  notes?: string;
  snapshot: {
    otaCheckIn: string;
    otaCheckOut: string;
    otaGuestName?: string;
    pillotoCheckIn: string;
    pillotoCheckOut: string;
    pillotoGuestName?: string;
  };
  createdAt: string;
}

export const otaService = {
  // Listing mappings
  getMappings: (): Promise<AxiosResponse<ApiResponse<OtaListingMapping[]>>> =>
    apiClient.get('/ota/mappings'),

  createMapping: (data: Partial<OtaListingMapping>): Promise<AxiosResponse<ApiResponse<OtaListingMapping>>> =>
    apiClient.post('/ota/mappings', data),

  updateMapping: (id: string, data: Partial<OtaListingMapping>): Promise<AxiosResponse<ApiResponse<OtaListingMapping>>> =>
    apiClient.put(`/ota/mappings/${id}`, data),

  deleteMapping: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/ota/mappings/${id}`),

  rotateToken: (id: string): Promise<AxiosResponse<ApiResponse<{ outboundToken: string; outboundFeedUrl: string }>>> =>
    apiClient.post(`/ota/mappings/${id}/rotate-token`),

  // Sync
  triggerSync: (mappingId?: string): Promise<AxiosResponse<ApiResponse<{ queued: boolean; mappingId?: string }>>> =>
    apiClient.post('/ota/sync', mappingId ? { mappingId } : {}),

  getSyncRuns: (params?: { mappingId?: string; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<OtaSyncRun[]> & { pagination: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/ota/sync-runs', { params }),

  // Conflicts
  getConflicts: (params?: { status?: OtaConflictStatus; page?: number; limit?: number }): Promise<AxiosResponse<ApiResponse<OtaConflict[]> & { pagination: { total: number; page: number; limit: number; pages: number } }>> =>
    apiClient.get('/ota/conflicts', { params }),

  getPendingConflictCount: (): Promise<AxiosResponse<ApiResponse<{ count: number }>>> =>
    apiClient.get('/ota/conflicts/count'),

  resolveConflict: (id: string, data: { status: OtaConflictStatus; notes?: string }): Promise<AxiosResponse<ApiResponse<OtaConflict>>> =>
    apiClient.put(`/ota/conflicts/${id}/resolve`, data),
};

// ─── e-CF (Electronic Fiscal Invoicing) ──────────────────────────────────────

export const ecfService = {
  /** Get tenant's ECF config (token is masked — only hasToken flag is returned) */
  getConfig: (): Promise<AxiosResponse<ApiResponse<TenantEcfConfig | null>>> =>
    apiClient.get('/ecf/config'),

  /** Save/update ECF configuration (pass citrusToken only when rotating) */
  saveConfig: (data: Partial<TenantEcfConfig & { citrusToken?: string }>): Promise<AxiosResponse<ApiResponse<null>>> =>
    apiClient.put('/ecf/config', data),

  /** Revoke the stored Citrus API token */
  revokeToken: (): Promise<AxiosResponse<ApiResponse<null>>> =>
    apiClient.delete('/ecf/config/token'),

  /** Test the Citrus connection with the stored token */
  testConnection: (): Promise<AxiosResponse<ApiResponse<null>>> =>
    apiClient.post('/ecf/config/test'),

  /** List electronic invoices with optional filters */
  getInvoices: (params?: {
    folioId?: string;
    paymentId?: string;
    estadoECF?: string;
    tipo?: string;
    fechaInicio?: string;
    fechaFin?: string;
    eNCF?: string;
    buyerRnc?: string;
    page?: number;
    limit?: number;
  }): Promise<AxiosResponse<ApiResponse<ElectronicInvoice[]>>> =>
    apiClient.get('/ecf/invoices', { params }),

  /** Get a single invoice by ID */
  getInvoice: (id: string): Promise<AxiosResponse<ApiResponse<ElectronicInvoice>>> =>
    apiClient.get(`/ecf/invoices/${id}`),

  /** Generate an invoice from a folio/payment */
  generateInvoice: (data: {
    folioId: string;
    paymentId?: string;
    tipoECF?: string;
    buyerRnc?: string;
    buyerName?: string;
    buyerEmail?: string;
    buyerRazonSocial?: string;
  }): Promise<AxiosResponse<ApiResponse<ElectronicInvoice>>> =>
    apiClient.post('/ecf/invoices', data),

  /** Re-check invoice status with Citrus */
  refreshStatus: (id: string): Promise<AxiosResponse<ApiResponse<ElectronicInvoice>>> =>
    apiClient.post(`/ecf/invoices/${id}/refresh-status`),

  /** Send the representación impresa (PDF) by email for an invoice */
  sendInvoiceEmail: (id: string, email?: string): Promise<AxiosResponse<ApiResponse<null>>> =>
    apiClient.post(`/ecf/invoices/${id}/send-email`, email ? { email } : undefined),

  /** Fetch invoice PDF as blob (auth-aware, avoids direct window navigation issues) */
  getInvoicePdfBlob: (id: string): Promise<AxiosResponse<Blob>> =>
    apiClient.get(`/ecf/invoices/${id}/pdf`, { responseType: 'blob' }),

  /** Fetch invoice XML as blob (auth-aware, avoids direct window navigation issues) */
  getInvoiceXmlBlob: (id: string): Promise<AxiosResponse<Blob>> =>
    apiClient.get(`/ecf/invoices/${id}/xml`, { responseType: 'blob' }),

  /** Create a credit note (E34) for an accepted invoice */
  createCreditNote: (data: {
    originalEcfId: string;
    codigoModificacion: '1' | '2' | '3' | '4' | '5';
    razonModificacion: string;
    items?: Array<{ description: string; amount: number }>;
    totalAmount?: number;
  }): Promise<AxiosResponse<ApiResponse<ElectronicInvoice>>> =>
    apiClient.post('/ecf/credit-notes', data),

  /** Create a debit note (E33) for an accepted invoice */
  createDebitNote: (data: {
    originalEcfId: string;
    reason: string;
    items?: Array<{ description: string; amount: number }>;
    totalAmount?: number;
  }): Promise<AxiosResponse<ApiResponse<ElectronicInvoice>>> =>
    apiClient.post('/ecf/debit-notes', data),

  // ─── Phase 4: Reporting & Operational Tools ────────────────────────────────

  /** Monthly tax report — totals by year-month and tipo */
  getMonthlyTaxReport: (params?: {
    year?: number;
    limit?: number;
  }): Promise<AxiosResponse<ApiResponse<EcfMonthlyTaxRow[]>>> =>
    apiClient.get('/ecf/reports/monthly-tax', { params }),

  /** Sequence info derived from stored invoices (per tipo) */
  getSequences: (): Promise<AxiosResponse<ApiResponse<EcfSequenceInfo[]>>> =>
    apiClient.get('/ecf/sequences'),

  /** Submit sequence annulment to Citrus */
  annulSequences: (data: {
    tipo: string;
    secuencias: string[];
  }): Promise<AxiosResponse<ApiResponse<null>>> =>
    apiClient.post('/ecf/sequences/annul', data),

  /** Bulk refresh all En Proceso / Contingencia invoices */
  bulkRefreshPending: (): Promise<AxiosResponse<ApiResponse<{
    total: number;
    refreshed: number;
    failed: number;
  }>>> =>
    apiClient.post('/ecf/invoices/bulk-refresh'),

  // ─── Phase 5: Received invoices, other types, health, directory, alerts ───

  /** List received invoices (Comprobantes Recibidos) from Citrus */
  getReceivedInvoices: (params?: {
    fechaDesde?: string;
    fechaHasta?: string;
    rnc?: string;
    page?: number;
    limit?: number;
  }): Promise<AxiosResponse<ApiResponse<unknown>>> =>
    apiClient.get('/ecf/received-invoices', { params }),

  /** Submit commercial approval (approve/reject) for a received invoice */
  submitCommercialApproval: (data: {
    trackId: string;
    aprobado: boolean;
    motivoRechazo?: string;
  }): Promise<AxiosResponse<ApiResponse<unknown>>> =>
    apiClient.post('/ecf/commercial-approval', data),

  /** Generate an other invoice type (E41/E43/E44/E45/E46/E47) */
  generateOtherInvoice: (data: {
    tipo: string;
    items: Array<{ description: string; amount: number; exempt?: boolean }>;
    buyer?: {
      rnc?: string;
      razonSocial?: string;
      name?: string;
      email?: string;
      country?: string;
    };
    tipoPago?: number;
    refNumber?: string;
  }): Promise<AxiosResponse<ApiResponse<ElectronicInvoice>>> =>
    apiClient.post('/ecf/invoices/other', data),

  /** Check Citrus connectivity */
  checkHealth: (): Promise<AxiosResponse<ApiResponse<{ online: boolean; reason?: string; checkedAt: string }>>> =>
    apiClient.get('/ecf/health'),

  /** Get the electronic billers directory (cached 24h server-side) */
  getDirectory: (params?: { refresh?: boolean }): Promise<AxiosResponse<ApiResponse<unknown>>> =>
    apiClient.get('/ecf/directory', { params }),

  /** Get current alerts: rejected invoices, stale pending, token/sequence expiry */
  getAlerts: (): Promise<AxiosResponse<ApiResponse<Array<{
    type: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    count?: number;
  }>>>> =>
    apiClient.get('/ecf/alerts'),
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
  getOccupancy: (params?: OccupancyParams): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.get('/admin/reports/occupancy', { params }),

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

  createInvoice: (data: {
    customer?: string;
    isIndividual?: boolean;
    individualCustomer?: { name: string; email?: string; phone?: string };
    dueDate?: string;
    notes?: string;
    lineItems: InvoiceLineItemInput[];
  }): Promise<AxiosResponse<ApiResponse<Invoice>>> =>
    apiClient.post('/accounting/invoices', data),

  updateInvoice: (id: string, data: {
    customer?: string;
    isIndividual?: boolean;
    individualCustomer?: { name: string; email?: string; phone?: string };
    dueDate?: string;
    notes?: string;
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

