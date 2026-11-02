/**
 * OTA names as hoteliers write them. The channel manager reports names like "BookingCom" or
 * "AirBNB"; reservations store the friendly name already ("Booking.com"), legacy iCal imports
 * a lowercase one ("airbnb").
 */
import type { ChannelState } from '../services/api';

/** Every state a connected channel can be in (each has a label and a sentence in the locales) */
export const CHANNEL_STATES: ChannelState[] = ['active', 'attention', 'waiting_ota', 'needs_mapping', 'ready_to_activate', 'inactive', 'removal_scheduled', 'removed'];

const OTA_LABELS: Record<string, string> = {
  bookingcom: 'Booking.com', expedia: 'Expedia', airbnb: 'Airbnb', vrbo: 'Vrbo', homeaway: 'Vrbo', agoda: 'Agoda',
  despegar: 'Despegar', tripcom: 'Trip.com', ctrip: 'Trip.com', hotelbeds: 'Hotelbeds', hostelworld: 'Hostelworld',
};

export const otaLabel = (name?: string | null): string =>
  (name ? OTA_LABELS[name.toLowerCase().replace(/[^a-z]/g, '')] ?? name : '—');

/** Short tag for tight spaces (calendar bars): the OTA code from the booking, else the name's start. */
export const otaShortTag = (source: { otaCode?: string; otaName?: string }): string =>
  (source.otaCode || otaLabel(source.otaName).replace(/[^A-Za-z0-9]/g, '').slice(0, 3)).toUpperCase().slice(0, 4);

/** "Booking.com 4021337" — the OTA and its reservation code. */
export const channelText = (source: { otaName?: string; otaReservationCode?: string }): string =>
  [otaLabel(source.otaName), source.otaReservationCode].filter(Boolean).join(' ');
