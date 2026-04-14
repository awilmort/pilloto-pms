/**
 * BookingContext — manages state for the public booking flow.
 *
 * Provides booking configuration, search state, selected items,
 * verification state and booking progress to all booking pages.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { bookingService } from '../services/api';

export interface BookingConfig {
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
}

export interface RoomAvailability {
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
}

export interface BookingItem {
  kind: 'room' | 'service';
  roomTypeId?: string;
  ratePlanId?: string;
  roomTypeName?: string;
  checkIn?: string;
  checkOut?: string;
  serviceId?: string;
  serviceName?: string;
  date?: string;
  adults: number;
  children: number;
  quantity: number;
  pricing: {
    subtotal: number;
    taxes: number;
    total: number;
    perNight?: number;
    nights?: number;
  };
}

export interface GuestInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  specialRequests: string;
}

export type BookingStep = 'search' | 'results' | 'details' | 'verify' | 'review' | 'confirmation';

interface BookingContextValue {
  config: BookingConfig | null;
  configLoading: boolean;
  configError: string | null;

  // Search state
  searchParams: { checkIn: string; checkOut: string; adults: number; children: number } | null;
  setSearchParams: (params: { checkIn: string; checkOut: string; adults: number; children: number }) => void;
  availability: RoomAvailability[];
  availabilityLoading: boolean;
  searchAvailability: (params: { checkIn: string; checkOut: string; adults: number; children: number }) => Promise<void>;

  // Cart
  items: BookingItem[];
  addItem: (item: BookingItem) => void;
  removeItem: (index: number) => void;
  clearItems: () => void;
  totalPrice: number;

  // Guest info
  guestInfo: GuestInfo;
  setGuestInfo: (info: GuestInfo) => void;

  // Verification
  verificationId: string | null;
  setVerificationId: (id: string | null) => void;

  // Step navigation
  currentStep: BookingStep;
  setCurrentStep: (step: BookingStep) => void;
  prevStep: BookingStep | null;
  setPrevStep: (step: BookingStep | null) => void;

  // Pre-selected room type (from showcase click)
  preselectedRoomTypeId: string | null;
  setPreselectedRoomTypeId: (id: string | null) => void;

  // Booking result
  bookingResult: {
    reservationCode: string;
    confirmationToken: string;
    estimatedTotal: number;
    checkIn?: string;
    checkOut?: string;
  } | null;
  setBookingResult: (result: any) => void;
}

const BookingContext = createContext<BookingContextValue>({} as BookingContextValue);

export const useBooking = () => useContext(BookingContext);

export const BookingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useState<{ checkIn: string; checkOut: string; adults: number; children: number } | null>(null);
  const [availability, setAvailability] = useState<RoomAvailability[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const [items, setItems] = useState<BookingItem[]>([]);
  const [guestInfo, setGuestInfo] = useState<GuestInfo>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialRequests: '',
  });
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<BookingStep>('search');
  const [prevStep, setPrevStep] = useState<BookingStep | null>(null);
  const [bookingResult, setBookingResult] = useState<any>(null);
  const [preselectedRoomTypeId, setPreselectedRoomTypeId] = useState<string | null>(null);

  // Load booking config on mount
  useEffect(() => {
    bookingService.getConfig()
      .then(res => {
        if (res.data?.data) {
          setConfig(res.data.data);
          if (!res.data.data.enabled) {
            setConfigError('Online booking is not currently available.');
          }
        }
      })
      .catch(err => {
        const msg = err?.response?.data?.message || 'Failed to load booking configuration.';
        setConfigError(msg);
      })
      .finally(() => setConfigLoading(false));
  }, []);

  const searchAvailability = useCallback(async (params: { checkIn: string; checkOut: string; adults: number; children: number }) => {
    setAvailabilityLoading(true);
    setSearchParams(params);
    try {
      const res = await bookingService.getAvailability(params);
      setAvailability(res.data?.data || []);
      setCurrentStep('results');
    } catch (err: any) {
      setAvailability([]);
      throw err;
    } finally {
      setAvailabilityLoading(false);
    }
  }, []);

  const addItem = useCallback((item: BookingItem) => {
    setItems(prev => {
      // Prevent duplicate room type selections (guards against React StrictMode double-fire)
      if (item.kind === 'room' && item.roomTypeId && prev.some(i => i.roomTypeId === item.roomTypeId)) {
        return prev;
      }
      if (item.kind === 'service' && item.serviceId && prev.some(i => i.serviceId === item.serviceId)) {
        return prev;
      }
      return [...prev, item];
    });
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearItems = useCallback(() => {
    setItems([]);
  }, []);

  const totalPrice = items.reduce((sum, item) => sum + item.pricing.total, 0);

  return (
    <BookingContext.Provider
      value={{
        config,
        configLoading,
        configError,
        searchParams,
        setSearchParams,
        availability,
        availabilityLoading,
        searchAvailability,
        items,
        addItem,
        removeItem,
        clearItems,
        totalPrice,
        guestInfo,
        setGuestInfo,
        verificationId,
        setVerificationId,
        currentStep,
        setCurrentStep,
        prevStep,
        setPrevStep,
        preselectedRoomTypeId,
        setPreselectedRoomTypeId,
        bookingResult,
        setBookingResult,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
};
