/**
 * Channel alerts in words: every alert type has a title, a "what happened" and a "what to do"
 * in the locales (`admin.channelAlerts.types.<type>`), written from the alert's safe params.
 * Kept free of React and the API client so it can be tested on its own.
 */
import type { ChannelAlert, ChannelAlertType } from '../services/api';
import { otaLabel } from './channels';

/** Every type a tenant can see (mirrors backend TENANT_ALERT_TYPES) */
export const CHANNEL_ALERT_TYPES: ChannelAlertType[] = [
  'overbooking', 'unmapped_booking', 'non_acked_booking', 'modification_needs_review', 'currency_mismatch',
  'sync_error', 'sync_warning', 'rate_error', 'ari_warning', 'push_failing',
  'channel_disconnected', 'listing_disconnected', 'channel_removal_warning', 'property_removal_warning',
  'remap_required', 'unmap_before_delete',
  'airbnb_reservation_request', 'airbnb_alteration_request', 'airbnb_inquiry',
];

export const AIRBNB_REQUEST_TYPES: ChannelAlertType[] = ['airbnb_reservation_request', 'airbnb_alteration_request', 'airbnb_inquiry'];
export const isAirbnbRequest = (a: Pick<ChannelAlert, 'type'>) => AIRBNB_REQUEST_TYPES.includes(a.type);
export const isActive = (a: Pick<ChannelAlert, 'status'>) => a.status === 'open' || a.status === 'acknowledged';

type T = (key: string, opts?: Record<string, unknown>) => string;

/** "1 dic 2026" in the interface language (dates arrive as YYYY-MM-DD) */
export function formatDay(day: string | undefined, language: string): string {
  if (!day) return '';
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(language.startsWith('en') ? 'en-US' : 'es-DO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatTime(iso: string | undefined, language: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(language.startsWith('en') ? 'en-US' : 'es-DO', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The values the locale strings interpolate, with plain-language fallbacks. */
export function alertTextParams(a: Pick<ChannelAlert, 'params'>, t: T, language: string): Record<string, string> {
  const p = a.params ?? {};
  const ota = p.otaName ? otaLabel(p.otaName) : '';
  const code = p.otaReservationCode || p.reservationCode || '';
  const booking = ota || code
    ? (p.guestName ? t('admin.channelAlerts.bookingGuest', { ota, code, guest: p.guestName }) : t('admin.channelAlerts.booking', { ota, code })).replace(/\s+/g, ' ').trim()
    : t('admin.channelAlerts.aBooking');
  const nights: string[] = Array.isArray(p.nights) ? p.nights : [];
  const stay = p.checkIn && p.checkOut
    ? t('admin.channelAlerts.stay', { checkIn: formatDay(p.checkIn, language), checkOut: formatDay(p.checkOut, language), nights: p.nights && !Array.isArray(p.nights) ? p.nights : '?' })
    : p.checkIn ? t('admin.channelAlerts.stayFrom', { checkIn: formatDay(p.checkIn, language) }) : t('admin.channelAlerts.someDates');
  return {
    booking,
    guest: p.guestName || t('admin.channelAlerts.aGuest'),
    channel: p.channelName || t('admin.channelAlerts.aChannel'),
    nights: nights.slice(0, 5).map((n) => formatDay(n, language)).join(', ') + (nights.length > 5 ? '…' : ''),
    stay,
    name: String(p.name ?? ''),
    count: String(p.count ?? 1),
    since: formatTime(p.since, language),
    removalDate: formatDay(p.removalDate, language),
    bookingCurrency: String(p.bookingCurrency ?? ''),
    propertyCurrency: String(p.propertyCurrency ?? ''),
  };
}

/** Which "what" sentence applies (some types have variants). */
export function whatKey(a: Pick<ChannelAlert, 'type' | 'params'>): string {
  const base = `admin.channelAlerts.types.${a.type}`;
  const p = a.params ?? {};
  if (a.type === 'modification_needs_review' && (p.change === 'cancelled' || p.change === 'reinstated')) return `${base}.what_${p.change}`;
  if (a.type === 'ari_warning' && p.what === 'rates') return `${base}.what_rates`;
  if (a.type === 'channel_removal_warning' && p.removalDate) return `${base}.what_date`;
  if (a.type === 'remap_required' && p.phase === 'map_in_channels') return `${base}.what_map_in_channels`;
  return `${base}.what`;
}

export function todoKey(a: Pick<ChannelAlert, 'type' | 'params'>): string {
  const base = `admin.channelAlerts.types.${a.type}`;
  if (a.type === 'remap_required' && a.params?.phase === 'map_in_channels') return `${base}.todo_map_in_channels`;
  return `${base}.todo`;
}

export function alertTexts(a: Pick<ChannelAlert, 'type' | 'params'>, t: T, language: string) {
  const params = alertTextParams(a, t, language);
  return {
    title: t(`admin.channelAlerts.types.${a.type}.title`),
    what: t(whatKey(a), params),
    todo: t(todoKey(a), params),
  };
}

/** Time left before an Airbnb request expires. */
export function deadlineLeft(dueAt: string | undefined, nowMs: number): { expired: boolean; hours: number; minutes: number } | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - nowMs;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { expired: true, hours: 0, minutes: 0 };
  return { expired: false, hours: Math.floor(ms / 3600_000), minutes: Math.floor((ms % 3600_000) / 60_000) };
}
