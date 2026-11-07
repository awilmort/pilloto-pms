/**
 * BookingContext — manages state for the public booking flow.
 *
 * Provides booking configuration, search state, selected items,
 * verification state and booking progress to all booking pages.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { bookingService } from '../services/api';
import type { PublicRateOffer } from '../services/api';
import { useTranslation } from 'react-i18next';

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
  /** The first offer: the room type's "from" price */
  ratePlan: { _id: string; name: string };
  /** Every rate plan the guest can choose for the stay (promo-code plans first, then cheapest) */
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
}

export interface BookingItem {
  kind: 'room' | 'service';
  roomTypeId?: string;
  ratePlanId?: string;
  ratePlanName?: string;
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

export interface BookingSearchParams {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  /** Promo code that unlocks private rate plans */
  promoCode?: string;
}

/** What the last search did with the promo code */
export interface PromoResult {
  code: string;
  /** The code unlocks a rate plan of the property */
  valid: boolean;
  /** One of those plans is offered for this search */
  applied: boolean;
}

interface BookingContextValue {
  config: BookingConfig | null;
  configLoading: boolean;
  configError: string | null;

  // Search state
  searchParams: BookingSearchParams | null;
  setSearchParams: (params: BookingSearchParams) => void;
  availability: RoomAvailability[];
  availabilityLoading: boolean;
  searchAvailability: (params: BookingSearchParams) => Promise<void>;
  promo: PromoResult | null;

  // Cart
  items: BookingItem[];
  /** Adds an item; a room item for a room type already in the cart replaces it (another rate plan) */
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
  const { t } = useTranslation();
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useState<BookingSearchParams | null>(null);
  const [availability, setAvailability] = useState<RoomAvailability[]>([]);
  const [promo, setPromo] = useState<PromoResult | null>(null);
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
            setConfigError(t('bookingEngine.config.unavailable'));
          }
        }
      })
      .catch(err => {
        const msg = err?.response?.data?.message || t('bookingEngine.config.loadFailed');
        setConfigError(msg);
      })
      .finally(() => setConfigLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchAvailability = useCallback(async (params: BookingSearchParams) => {
    setAvailabilityLoading(true);
    const promoCode = params.promoCode?.trim().toUpperCase() || undefined;
    setSearchParams({ ...params, promoCode });
    try {
      const res = await bookingService.getAvailability({ ...params, promoCode });
      const rooms = (res.data?.data || []).map(r => ({ ...r, ratePlans: r.ratePlans ?? [] }));
      setAvailability(rooms);
      setPromo(res.data?.promo ?? null);
      // Items priced for another search (dates, party or promo code) no longer apply
      setItems(prev => prev.filter(i => i.kind !== 'room'
        || (i.checkIn === params.checkIn && i.checkOut === params.checkOut
          && rooms.some(r => r.roomType._id === i.roomTypeId && r.ratePlans.some(p => p._id === i.ratePlanId && p.pricing.finalTotal === i.pricing.total)))));
      setCurrentStep('results');
    } catch (err: any) {
      setAvailability([]);
      setPromo(null);
      throw err;
    } finally {
      setAvailabilityLoading(false);
    }
  }, []);

  const addItem = useCallback((item: BookingItem) => {
    setItems(prev => {
      // One rate plan per room type: the same plan again is a no-op (guards against React
      // StrictMode double-fire); another plan replaces the room type's item
      if (item.kind === 'room' && item.roomTypeId) {
        const index = prev.findIndex(i => i.kind === 'room' && i.roomTypeId === item.roomTypeId);
        if (index >= 0) {
          if (prev[index].ratePlanId === item.ratePlanId) return prev;
          return prev.map((i, n) => (n === index ? item : i));
        }
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
        promo,
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
