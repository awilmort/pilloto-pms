import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { User, Room, Reservation, MediaItem, Amenity, EventType, Company, Guest, CreditAccount } from '../types';
import type { ChargeTemplate, ChargeRule, ChargeRuleExecution, AuditRun } from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
// Derive the API origin to resolve file URLs like /uploads/xxx
export const API_ORIGIN = (() => {
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
  }): Promise<AxiosResponse<ApiResponse<{ users: User[]; totalPages: number; currentPage: number }>>> =>
    apiClient.get('/admin/users', { params }),

  updateUserRole: (id: string, role: string): Promise<AxiosResponse<ApiResponse<User>>> =>
    apiClient.patch(`/admin/users/${id}/role`, { role }),
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
  getRoles: (): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    apiClient.get('/roles'),
  createRole: (data: { name: string; description?: string; permissions: string[]; discountLimit?: number }): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.post('/roles', data),
  updateRole: (id: string, data: Partial<{ name: string; description?: string; permissions: string[]; discountLimit?: number }>): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.put(`/roles/${id}`, data),
  deleteRole: (id: string): Promise<AxiosResponse<ApiResponse<any>>> =>
    apiClient.delete(`/roles/${id}`),
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
    priority?: number;
    dateStart?: string;
    dateEnd?: string;
    roomTypeId?: string;
    ratePlanId?: string;
    companyId?: string;
    guestEmail?: string;
    adjustmentType: 'replace' | 'percent' | 'fixed';
    adjustmentValue: number;
    adjustmentScope: 'base' | 'occupancy' | 'subtotal';
    isActive?: boolean;
  }): Promise<AxiosResponse<ApiResponse<any>>> => apiClient.post('/pricing/rules', data),

  updatePricingRule: (id: string, data: Partial<{
    name: string;
    priority: number;
    dateStart?: string;
    dateEnd?: string;
    roomTypeId?: string;
    ratePlanId?: string;
    companyId?: string;
    guestEmail?: string;
    adjustmentType: 'replace' | 'percent' | 'fixed';
    adjustmentValue: number;
    adjustmentScope: 'base' | 'occupancy' | 'subtotal';
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

export interface ServiceRecord {
  _id: string;
  code: string;
  name: string;
  kind: ServiceKind;
  chargeBasis: ChargeBasis;
  isActive: boolean;
  isOnlineBookable: boolean;
  isVisibleInPOS: boolean;
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
  createGuest: (data: Partial<Guest>): Promise<AxiosResponse<ApiResponse<Guest>>> =>
    apiClient.post('/guests', data),
  updateGuest: (id: string, data: Partial<Guest>): Promise<AxiosResponse<ApiResponse<Guest>>> =>
    apiClient.put(`/guests/${id}`, data),
  deleteGuest: (id: string): Promise<AxiosResponse<ApiResponse>> =>
    apiClient.delete(`/guests/${id}`),
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
export interface TenantRecord {
  _id: string;
  name: string;
  slug: string;
  plan: string;
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
}

export const platformService = {
  listTenants: (): Promise<AxiosResponse<ApiResponse<TenantRecord[]>>> =>
    apiClient.get('/platform/tenants'),

  getTenant: (id: string): Promise<AxiosResponse<ApiResponse<TenantRecord>>> =>
    apiClient.get(`/platform/tenants/${id}`),

  createTenant: (data: ProvisionTenantPayload): Promise<AxiosResponse<ApiResponse<{ tenant: TenantRecord; adminUser: any; loginUrl: string }>>> =>
    apiClient.post('/platform/tenants', data),

  updateTenant: (id: string, data: Partial<{ name: string; plan: string; isActive: boolean; ownerEmail: string; settings: any }>): Promise<AxiosResponse<ApiResponse<TenantRecord>>> =>
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

