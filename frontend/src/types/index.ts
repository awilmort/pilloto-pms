export interface Tenant {
  _id: string;
  name: string;
  slug: string;
  plan: 'basic' | 'pro' | 'enterprise';
  isActive: boolean;
  ownerEmail: string;
  settings: {
    language?: string;
    currency?: string;
    timezone?: string;
    logoUrl?: string;
    primaryColor?: string;
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

export interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  avatar?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  _id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Guest {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditAccount {
  _id: string;
  scope: 'guest' | 'company';
  referenceId: string;
  creditLimit: number;
  currentExposure: number;
  status: 'active' | 'suspended';
  reference?: {
    _id: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Room {
  _id: string;
  name: string;
  type: 'standard' | 'deluxe' | 'suite' | 'villa';
  description: string;
  amenities: string[];
  bedConfiguration: string;
  images: string[];
  status: 'active' | 'inactive';
  condition: 'pending_cleanup' | 'clean';
  comment?: string;
  features?: {
    wifi: boolean;
    airConditioning: boolean;
    miniBar: boolean;
    balcony: boolean;
    oceanView: boolean;
    kitchenette: boolean;
    jacuzzi: boolean;
  };
  adultCapacity?: number; // Max adults the room can accommodate
  childrenCapacity?: number; // Max children the room can accommodate
  roomPrice?: number; // Optional per-room nightly price override
  createdAt: string;
  updatedAt: string;
}

export interface Reservation {
  _id: string;
  reservationCode?: string;
  user?: string | User; // Optional for guest bookings

  // Guest identification (required when user is not logged in)
  guestName?: {
    firstName: string;
    lastName: string;
  };

  // Unique confirmation token for guest access
  confirmationToken?: string;

  // Reservation type - determines which fields are required
  type: 'room' | 'daypass' | 'PasaTarde' | 'event';

  // Room-specific fields (required for room reservations)
  room?: string | Room; // Specific room assigned by admin
  rooms?: Array<string | Room>; // Multiple rooms assigned
  roomType?: 'standard' | 'deluxe' | 'suite' | 'villa'; // For compatibility during transition

  // Event-specific fields (required for event reservations)
  eventType?: string;
  eventDescription?: string;
  expectedAttendees?: number;

  // Common date fields
  checkInDate: string;
  checkOutDate?: string; // Optional for day pass and some events
  actualCheckInAt?: string;
  actualCheckOutAt?: string;
  identificationDocument?: string;
  identificationType?: string;

  // Guest information
  guests: number;
  guestDetails: {
    adults: number;
    children: number;
    infants: number;
  };
  adultPrice?: number;
  childrenPrice?: number;

  // Pricing and payment
  estimatedTotal: number;
  totalPrice?: number; // compatibility alias
  totalPayments?: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  paymentMethod?: string;
  payments?: Payment[];

  // Contact and requests
  contactInfo: {
    phone: string;
    email: string;
    emergencyContact?: string;
    country?: string;
  };
  specialRequests?: string;

  // Calculated fields
  totalNights?: number; // For room reservations
  totalDays?: number; // For multi-day events

  // Administrative fields
  assignedBy?: string | User;
  assignedAt?: string;

  // Corporate booking
  isCorporate?: boolean;
  company?: string | Company;
  guestRecord?: string | Guest;

  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  _id?: string;
  folioId?: string;
  amount: number;
  method: 'cash' | 'card' | 'transfer' | 'credit' | 'check';
  status?: 'completed' | 'pending' | 'reversed';
  reference?: string;
  note?: string;
  createdAt: string;
  createdBy?: string | User;
}

export interface Charge {
  _id: string;
  folioId: string;
  description: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MediaItem {
  _id: string;
  title: string;
  description?: string;
  url: string;
  type: 'image' | 'video';
  category: 'rooms' | 'aquapark' | 'facilities' | 'dining' | 'activities' | 'general';
  isPublic: boolean;
  isFeatured: boolean;
  tags: string[];
  uploadedBy: string | {
    _id: string;
    firstName: string;
    lastName: string;
  };
  fileSize: number;
  dimensions?: {
    width: number;
    height: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Amenity {
  _id: string;
  name: string;
  description: string;
  image: string;
  isActive: boolean;
  category: 'accommodation' | 'dining' | 'recreation' | 'wellness' | 'business' | 'general';
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventType {
  _id: string;
  type: string; // identifier e.g., 'wedding'
  title: string; // display name
  description?: string;
  features: string[];
  priceFrom: number;
  maxGuests: number;
  maxChildren: number;
  maxAdults?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WristbandDelivery {
  _id: string;
  date: string;
  type: 'delivery' | 'collection';
  deliveredBy?: string | User;
  recipient?: string;
  counts: {
    daypassAdults: number;
    daypassChildren: number;
    accommodations: number;
    pasatarde: number;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (userData: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
  permissions: string[];
  refreshUser: () => Promise<void>;
}

export interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface SearchFilters {
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  roomType?: string;
  minPrice?: number;
  maxPrice?: number;
}

export interface BookingData {
  roomId: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  specialRequests?: string;
}
