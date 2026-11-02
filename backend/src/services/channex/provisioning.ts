/**
 * Provisioning — enabling the channel manager for a tenant (CHANNEX_ARCHITECTURE.md §6.5;
 * plan Phase 5.1).
 *
 * Enable: check prerequisites → create the Channex group (title = tenant name) → create the
 * property (`min_stay_type: arrival`, `state_length: 500`, no auto-update on modification or
 * cancellation, contact data from the property profile) → structural sync (room types and
 * rate plans). Every step
 * saves its Channex id before the next one, and a re-run skips what exists, so a failed enable
 * can simply be run again and a second enable is a no-op.
 *
 * Properties are created only when a tenant enables the channel manager (Channex removes a
 * property with no channel after 90 days), never at tenant creation.
 *
 * Every property is created with `property_type: hotel`: Pilloto only uses Channex's
 * per-property billing (never the per-unit vacation-rental types).
 *
 * Tenants never see the word Channex: messages returned here are about "the channel
 * manager" and "your channels"; raw Channex errors go to `lastError`, the logs and the
 * platform console only.
 *
 * All DB functions run in the current tenant context (see `runInTenant`).
 */

import mongoose from 'mongoose';
import AppSettings from '../../models/AppSettings';
import { ITenantProfile } from '../../models/Tenant';
import ChannexProperty, { IChannexProperty } from '../../models/ChannexProperty';
import Room from '../../models/Room';
import RoomType from '../../models/RoomType';
import RatePlan from '../../models/RatePlan';
import { getTenantId, tenantLocalStorage } from '../../middleware/tenantContext';
import { invalidateChannelManagerCache } from './changeCapture';
import { queueGoLiveSync } from './fullSync';
import {
  createChannexClient, ChannexClient, ChannexError, ChannexNotConfiguredError, unwrapMany, unwrapOne,
} from './channexClient';
import { getChannexConfig, isChannexConfigured, ChannexConfig } from './config';
import { CHANNEX_MAX_RATE_PLANS, CHANNEX_MAX_ROOM_TYPES, StructuralSyncReport, isOnChannels, syncStructure } from './structuralSync';
import { EMAIL_RE, isValidTimezone, missingContactFields } from '../propertyProfile';

export { isValidTimezone };

/** Billed per property by Channex (the per-unit types are never used). */
export const CHANNEX_PROPERTY_TYPE = 'hotel';
export const CHANNEX_STATE_LENGTH = 500;
/** Where the tenant edits currency, time zone and contact data */
export const PROFILE_ROUTE = '/admin/settings/profile';

/** Run `fn` with the tenant plugin scoped to `tenantId` (platform routes, workers). */
export function runInTenant<T>(tenantId: Id, fn: () => Promise<T>): Promise<T> {
  return tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);
}

type Id = mongoose.Types.ObjectId | string;

// ─── Prerequisites ───────────────────────────────────────────────────────────

export interface ProvisioningInput {
  tenantName: string;
  currency?: string;
  timezone?: string;
  contact?: Pick<ITenantProfile, 'email' | 'phone' | 'address' | 'city' | 'state' | 'country' | 'zipCode'>;
  roomTypes: { _id: Id; name: string; isActive: boolean; sellOnChannels?: boolean }[];
  /** Active rooms per room type id */
  activeRooms: Record<string, number>;
  ratePlans: { _id: Id; roomTypeId: Id; isActive: boolean; sellOnChannels?: boolean }[];
}

export type PrerequisiteId =
  | 'currency' | 'timezone' | 'contact' | 'roomTypes' | 'rooms' | 'ratePlans' | 'limits';

export interface Prerequisite {
  id: PrerequisiteId;
  ok: boolean;
  /** Plain-language problem (empty when ok) */
  message: string;
  /** Where the tenant fixes it, relative to the admin app */
  fixRoute: string;
}

/** What must be true before the channel manager can be set up for the tenant, each with where to fix it. */
export function computePrerequisites(input: ProvisioningInput): Prerequisite[] {
  const c = input.contact ?? {};
  const missing = missingContactFields(c);
  const emailOk = EMAIL_RE.test(String(c.email ?? '').trim());
  const countryOk = /^[A-Za-z]{2}$/.test(String(c.country ?? '').trim());
  // Only what is offered on channels counts (active and "sell on channels" on)
  const activeTypes = input.roomTypes.filter(isOnChannels);
  const typesWithRooms = activeTypes.filter((rt) => (input.activeRooms[String(rt._id)] ?? 0) > 0);
  const activeTypeIds = new Set(activeTypes.map((rt) => String(rt._id)));
  const plansOnTypes = input.ratePlans.filter((p) => isOnChannels(p) && activeTypeIds.has(String(p.roomTypeId)));
  const syncable = typesWithRooms.filter((rt) => plansOnTypes.some((p) => String(p.roomTypeId) === String(rt._id)));

  const contactProblems = [
    ...(missing.length ? [`missing: ${missing.join(', ')}`] : []),
    ...(c.email && !emailOk ? ['the email is not valid'] : []),
    ...(c.country && !countryOk ? ['the country must be a 2-letter code such as DO'] : []),
  ];

  return [
    {
      id: 'currency', fixRoute: PROFILE_ROUTE,
      ok: /^[A-Za-z]{3}$/.test(String(input.currency ?? '').trim()),
      message: 'Set the currency your property sells in in the property profile.',
    },
    {
      id: 'timezone', fixRoute: PROFILE_ROUTE,
      ok: isValidTimezone(input.timezone),
      message: 'Set the property time zone in the property profile.',
    },
    {
      id: 'contact', fixRoute: PROFILE_ROUTE,
      ok: contactProblems.length === 0,
      message: `Complete the contact details in the property profile (${contactProblems.join('; ')}). Booking sites require them before a channel can be connected.`,
    },
    {
      id: 'roomTypes', fixRoute: '/admin/settings/room-types',
      ok: activeTypes.length > 0,
      message: 'Create at least one active room type that is sold on channels.',
    },
    {
      id: 'rooms', fixRoute: '/admin/rooms',
      ok: typesWithRooms.length > 0,
      message: 'Add at least one active room to an active room type.',
    },
    {
      id: 'ratePlans', fixRoute: '/admin/pricing',
      ok: syncable.length > 0,
      message: 'Create an active rate plan, sold on channels, for a room type that has active rooms.',
    },
    {
      id: 'limits', fixRoute: '/admin/pricing',
      ok: activeTypes.length <= CHANNEX_MAX_ROOM_TYPES && plansOnTypes.length <= CHANNEX_MAX_RATE_PLANS,
      message: `The channel manager supports at most ${CHANNEX_MAX_ROOM_TYPES} room types and ${CHANNEX_MAX_RATE_PLANS} rate plans per property.`,
    },
  ];
}

/** Payload of `POST /properties` (architecture §2, §6.5). */
export function propertyBody(input: Pick<ProvisioningInput, 'tenantName' | 'currency' | 'timezone' | 'contact'>, groupId: string) {
  return {
    property: {
      ...propertyDetails(input),
      currency: String(input.currency).trim().toUpperCase(),
      property_type: CHANNEX_PROPERTY_TYPE,
      group_id: groupId,
      settings: {
        min_stay_type: 'arrival',
        state_length: CHANNEX_STATE_LENGTH,
        allow_availability_autoupdate_on_modification: false,
        allow_availability_autoupdate_on_cancellation: false,
      },
    },
  };
}

/** Title, time zone and contact data: what a property-profile edit updates in Channex. The currency never changes after creation. */
export function propertyDetails(input: Pick<ProvisioningInput, 'tenantName' | 'timezone' | 'contact'>) {
  const c = input.contact ?? {};
  const opt = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  return {
    title: input.tenantName.trim().slice(0, 255),
    timezone: String(input.timezone).trim(),
    email: opt(c.email),
    phone: opt(c.phone)?.slice(0, 32),
    address: opt(c.address)?.slice(0, 255),
    city: opt(c.city)?.slice(0, 255),
    state: opt(c.state)?.slice(0, 255),
    country: opt(c.country)?.toUpperCase(),
    zip_code: opt(c.zipCode)?.slice(0, 32),
  };
}

// ─── DB access ───────────────────────────────────────────────────────────────

export type ProvisioningTenant = { name: string; settings?: { currency?: string; timezone?: string }; profile?: ITenantProfile | null };

export async function loadProvisioningInput(tenant: ProvisioningTenant): Promise<ProvisioningInput> {
  const [roomTypes, rooms, ratePlans] = await Promise.all([
    RoomType.find({}).select('_id name isActive sellOnChannels').lean(),
    Room.find({ status: 'active' }).select('roomTypeId').lean(),
    RatePlan.find({}).select('_id roomTypeId isActive sellOnChannels').lean(),
  ]);
  const activeRooms: Record<string, number> = {};
  for (const r of rooms) if (r.roomTypeId) activeRooms[String(r.roomTypeId)] = (activeRooms[String(r.roomTypeId)] ?? 0) + 1;
  return {
    tenantName: tenant.name,
    currency: tenant.settings?.currency,
    timezone: tenant.settings?.timezone,
    contact: tenant.profile ?? {},
    roomTypes: roomTypes as unknown as ProvisioningInput['roomTypes'],
    activeRooms,
    ratePlans: ratePlans as unknown as ProvisioningInput['ratePlans'],
  };
}

export interface ChannelManagerStatus {
  environment: ChannexConfig['environment'];
  /** CHANNEX_API_KEY is set on this server */
  configured: boolean;
  enabled: boolean;
  property: null | {
    status: IChannexProperty['status'];
    channexPropertyId?: string;
    channexGroupId?: string;
    lastFullSyncAt?: Date;
    lastError?: string;
  };
  prerequisites: Prerequisite[];
  /** Channel-manager options */
  settings: ChannelManagerSettingsView;
}

export interface ChannelManagerSettingsView {
  /** Property name shown on the channels (the commercial name in the property profile) */
  name: string;
  autoAssignRooms: boolean;
  sendGuestConfirmationEmail: boolean;
  ratesIncludeTaxes: boolean;
}

/** Full status, Channex ids and raw errors included: platform console only. */
export async function getChannelManagerStatus(tenant: ProvisioningTenant, config: ChannexConfig = getChannexConfig()): Promise<ChannelManagerStatus> {
  const [input, settings, property] = await Promise.all([
    loadProvisioningInput(tenant),
    AppSettings.findOne({}).select('channelManager').lean(),
    ChannexProperty.findOne({ environment: config.environment }).lean(),
  ]);
  return {
    environment: config.environment,
    configured: isChannexConfigured(config),
    enabled: Boolean(settings?.channelManager?.enabled),
    property: property ? {
      status: property.status, channexPropertyId: property.channexPropertyId, channexGroupId: property.channexGroupId,
      lastFullSyncAt: property.lastFullSyncAt, lastError: property.lastError,
    } : null,
    prerequisites: computePrerequisites(input),
    settings: settingsView(tenant, settings?.channelManager),
  };
}

export function settingsView(tenant: { name: string }, cm?: Partial<ChannelManagerSettingsView>): ChannelManagerSettingsView {
  return {
    name: tenant.name,
    autoAssignRooms: cm?.autoAssignRooms ?? true,
    sendGuestConfirmationEmail: cm?.sendGuestConfirmationEmail ?? false,
    ratesIncludeTaxes: cm?.ratesIncludeTaxes ?? false,
  };
}

/** Validate a channel-manager options PUT body (partial updates allowed). Returns `{ errors }` or the AppSettings `$set`. */
export function parseSettingsUpdate(body: any): { errors: string[] } | { appSettings: Record<string, unknown> } {
  const errors: string[] = [];
  const appSettings: Record<string, unknown> = {};
  for (const f of ['autoAssignRooms', 'sendGuestConfirmationEmail', 'ratesIncludeTaxes'] as const) {
    if (body?.[f] !== undefined) {
      if (typeof body[f] !== 'boolean') errors.push(`${f} must be true or false.`); else appSettings[`channelManager.${f}`] = body[f];
    }
  }
  return errors.length ? { errors } : { appSettings };
}

// ─── Enable / disable ────────────────────────────────────────────────────────

export const NOT_CONFIGURED_MESSAGE = 'The channel manager is not available on this server yet.';

export type EnableResult =
  | { ok: true; property: IChannexProperty; created: { group: boolean; property: boolean }; sync: StructuralSyncReport }
  | { ok: false; reason: 'not_configured' | 'prerequisites' | 'channex_error'; message: string; prerequisites?: Prerequisite[]; property?: IChannexProperty };

export interface EnableOptions {
  tenant: ProvisioningTenant;
  client?: ChannexClient;
}

async function setEnabled(enabled: boolean) {
  await AppSettings.updateOne({}, { $set: { 'channelManager.enabled': enabled } }, { upsert: true });
  invalidateChannelManagerCache(getTenantId());
}

export async function enableChannelManager({ tenant, client }: EnableOptions): Promise<EnableResult> {
  const config = client?.config ?? getChannexConfig();
  if (!isChannexConfigured(config)) {
    return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };
  }
  const input = await loadProvisioningInput(tenant);
  const prerequisites = computePrerequisites(input);
  const failed = prerequisites.filter((p) => !p.ok);
  if (failed.length) {
    return { ok: false, reason: 'prerequisites', message: failed.map((p) => p.message).join(' '), prerequisites };
  }

  const channex = client ?? createChannexClient(config);
  let property = await ChannexProperty.findOne({ environment: config.environment })
    ?? await ChannexProperty.create({ environment: config.environment, status: 'provisioning' });
  const created = { group: false, property: false };

  try {
    property.status = 'provisioning';
    property.currency = String(input.currency).trim().toUpperCase();
    property.timezone = String(input.timezone).trim();
    property.propertyType = CHANNEX_PROPERTY_TYPE;
    await property.save();

    if (!property.channexGroupId) {
      const res = await channex.post('/groups', { group: { title: input.tenantName.trim().slice(0, 255) } });
      property.channexGroupId = unwrapOne(res).id;
      await property.save();
      created.group = true;
    }
    if (!property.channexPropertyId) {
      const res = await channex.post('/properties', propertyBody(input, property.channexGroupId!));
      property.channexPropertyId = unwrapOne(res).id;
      await property.save();
      created.property = true;
    }

    const sync = await syncStructure({ client: channex, property });
    property.status = sync.ok ? 'active' : 'error';
    property.lastError = sync.ok ? undefined : sync.results.filter((r) => r.action === 'failed').map((r) => `${r.name}: ${r.error}`).join('; ').slice(0, 2000);
    await property.save();
    await setEnabled(true);
    if (sync.ok) await queueGoLiveSync(property).catch((e) => console.error('[Channex] go-live full sync not queued:', e.message));
    return { ok: true, property, created, sync };
  } catch (err) {
    const message = err instanceof ChannexNotConfiguredError ? err.message : err instanceof Error ? err.message : String(err);
    property.status = 'error';
    property.lastError = message.slice(0, 2000);
    await property.save().catch(() => undefined);
    return { ok: false, reason: 'channex_error', message, property };
  }
}

export type DisableResult = { ok: true; property: IChannexProperty | null } | { ok: false; message: string; activeChannels: string[] };

/**
 * Stop the channel manager for the tenant. The Channex property stays (channels keep their last
 * ARI), so channels must be deactivated first: with an active channel this refuses unless `force`.
 */
export async function disableChannelManager({ client, force = false }: { client?: ChannexClient; force?: boolean } = {}): Promise<DisableResult> {
  const config = client?.config ?? getChannexConfig();
  const property = await ChannexProperty.findOne({ environment: config.environment });

  if (property?.channexPropertyId && !force && isChannexConfigured(config)) {
    try {
      const channels = unwrapMany(await (client ?? createChannexClient(config)).get('/channels', { 'filter[property_id]': property.channexPropertyId, 'pagination[limit]': 100 }));
      const active = channels.filter((c: any) => c.is_active).map((c: any) => String(c.title ?? c.channel ?? c.id));
      if (active.length) {
        return { ok: false, activeChannels: active, message: `Deactivate these channels first: ${active.join(', ')}. Otherwise they keep selling with the last prices and availability Pilloto sent.` };
      }
    } catch (err) {
      if (!(err instanceof ChannexError)) throw err;
      console.error('[Channex] disable: channel check failed:', err.message);
      return { ok: false, activeChannels: [], message: 'Could not check your channels right now. Try again in a few minutes.' };
    }
  }
  if (property) { property.status = 'disabled'; await property.save(); }
  await setEnabled(false);
  return { ok: true, property };
}

/**
 * After a property-profile edit: send the new name, time zone and contact data to the Channex
 * property (when one exists in this environment). Best effort — failures are logged and kept
 * in `lastError`; the next edit or a platform resync tries again.
 */
export async function pushPropertyDetails(tenant: ProvisioningTenant, client?: ChannexClient): Promise<{ pushed: boolean; error?: string }> {
  const config = client?.config ?? getChannexConfig();
  if (!isChannexConfigured(config)) return { pushed: false };
  const property = await ChannexProperty.findOne({ environment: config.environment });
  if (!property?.channexPropertyId || property.status === 'disabled') return { pushed: false };
  const input = await loadProvisioningInput(tenant);
  if (!isValidTimezone(input.timezone)) return { pushed: false };
  try {
    await (client ?? createChannexClient(config)).put(`/properties/${property.channexPropertyId}`, { property: propertyDetails(input) });
    property.timezone = String(input.timezone).trim();
    await property.save();
    return { pushed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Channex] property details not updated:', message);
    property.lastError = `Property details update failed: ${message}`.slice(0, 2000);
    await property.save().catch(() => undefined);
    return { pushed: false, error: message };
  }
}
