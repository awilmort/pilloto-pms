/**
 * Property profile — the property's own details, edited in Settings → Property profile and
 * read by every module (booking engine, guest emails, e-invoicing, channel manager).
 *
 * Stored on the Tenant: the commercial name is `name`, the currency and time zone are
 * `settings.currency` / `settings.timezone`, everything else is `profile.*`.
 *
 * The currency is chosen once: while it is unset (shown as DOP, what every screen showed before
 * it was configurable) it can be saved to any supported currency, even when the property
 * already has reservations — their amounts are not converted. Once saved, it cannot change
 * while the property has reservations or is connected to the channel manager: existing prices,
 * folios and the channel listings are all in that currency.
 */

import Reservation from '../models/Reservation';
import ChannexProperty from '../models/ChannexProperty';
import { ITenantProfile } from '../models/Tenant';

export const DEFAULT_CURRENCY = 'DOP';

/** Currencies a property can sell in (ISO 4217). */
export const PROFILE_CURRENCIES = ['DOP', 'USD', 'EUR'] as const;

type TenantLike = { name: string; settings?: { currency?: string; timezone?: string }; profile?: ITenantProfile | null };

export interface PropertyProfileView {
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
  currency: string;
  timezone: string;
}

export type CurrencyLockReason = 'channel_manager' | 'reservations';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const RNC_RE = /^\d{9}$|^\d{11}$/;

export function isValidTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

/** The currency the property sells in. */
export function tenantCurrency(tenant?: { settings?: { currency?: string; timezone?: string } | null } | null): string {
  return tenant?.settings?.currency || DEFAULT_CURRENCY;
}

export function profileView(tenant: TenantLike): PropertyProfileView {
  const p: ITenantProfile = tenant.profile ?? {};
  return {
    name: tenant.name ?? '',
    legalName: p.legalName ?? '',
    rnc: p.rnc ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    address: p.address ?? '',
    city: p.city ?? '',
    state: p.state ?? '',
    country: p.country ?? '',
    zipCode: p.zipCode ?? '',
    currency: tenant.settings?.currency ?? '',
    timezone: tenant.settings?.timezone ?? '',
  };
}

/** One line for guests: street, city, state, zip, country (empty parts skipped). */
export function formatAddress(p?: ITenantProfile | null): string {
  if (!p) return '';
  return [p.address, p.city, p.state, p.zipCode, p.country].map((v) => (v ?? '').trim()).filter(Boolean).join(', ');
}

const TEXT_LIMITS: Record<string, number> = {
  legalName: 150, email: 100, phone: 30, address: 300, city: 100, state: 100, zipCode: 20,
};

/** Validate a profile PUT body (partial updates allowed). Returns `{ errors }` or the Tenant `$set`. */
export function parseProfileUpdate(body: any): { errors: string[] } | { set: Record<string, unknown> } {
  const errors: string[] = [];
  const set: Record<string, unknown> = {};
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);

  if (body?.name !== undefined) {
    const v = str(body.name);
    if (!v || v.length > 100) errors.push('name is required (at most 100 characters).'); else set.name = v;
  }
  for (const [k, max] of Object.entries(TEXT_LIMITS)) {
    if (body?.[k] === undefined) continue;
    const v = str(body[k]);
    if (v === undefined || v.length > max) { errors.push(`${k} must be text of at most ${max} characters.`); continue; }
    if (k === 'email' && v && !EMAIL_RE.test(v)) { errors.push('email is not a valid email.'); continue; }
    set[`profile.${k}`] = k === 'email' ? v.toLowerCase() : v;
  }
  if (body?.rnc !== undefined) {
    const v = str(body.rnc)?.replace(/-/g, '');
    if (v === undefined || (v && !RNC_RE.test(v))) errors.push('rnc must be 9 or 11 digits.'); else set['profile.rnc'] = v;
  }
  if (body?.country !== undefined) {
    const v = str(body.country)?.toUpperCase();
    if (v === undefined || (v && !/^[A-Z]{2}$/.test(v))) errors.push('country must be a 2-letter code such as DO.'); else set['profile.country'] = v;
  }
  if (body?.currency !== undefined) {
    const v = str(body.currency)?.toUpperCase();
    if (!v || !(PROFILE_CURRENCIES as readonly string[]).includes(v)) errors.push(`currency must be one of ${PROFILE_CURRENCIES.join(', ')}.`);
    else set['settings.currency'] = v;
  }
  if (body?.timezone !== undefined) {
    if (!isValidTimezone(body.timezone)) errors.push('timezone must be a time zone such as America/Santo_Domingo.');
    else set['settings.timezone'] = String(body.timezone).trim();
  }
  return errors.length ? { errors } : { set };
}

/** What would make a saved currency permanent (reservations, channel manager), or null. Runs in the tenant context. */
export async function currencyDataReason(): Promise<CurrencyLockReason | null> {
  if (await ChannexProperty.exists({ channexPropertyId: { $exists: true, $ne: null } })) return 'channel_manager';
  if (await Reservation.exists({})) return 'reservations';
  return null;
}

/** The currency is locked only once it has been saved and there is data in it. */
export function currencyLock(savedCurrency: string | undefined | null, dataReason: CurrencyLockReason | null): CurrencyLockReason | null {
  return savedCurrency ? dataReason : null;
}

/** Fields the channel manager needs before a channel can be connected, that are still empty. */
export function missingContactFields(p?: ITenantProfile | null): Array<'email' | 'phone' | 'address' | 'city' | 'country' | 'zipCode'> {
  return (['email', 'phone', 'address', 'city', 'country', 'zipCode'] as const).filter((k) => !String(p?.[k] ?? '').trim());
}
