/**
 * Channels — the tenant's OTA connections (CHANNEX_ARCHITECTURE.md §8.4; plan Phases 8.1–8.2).
 *
 * Tenants create, map and activate channels inside the Channex iframe. Pilloto:
 *   - mints the iframe session: a one-time token for the tenant's OWN property and group
 *     (always read from its ChannexProperty, never from the request) and the exchange URL,
 *     built server-side with `app_mode=headless`, `redirect_to=/channels`,
 *     `read_only_availability=true`, the user's language, and either `channels=<code>`
 *     (one OTA, the connect wizard) or `available_channels=<the OTAs offered>`;
 *   - lists the property's channels (`GET /channels?filter[property_id]=…`) into the
 *     ChannexChannel cache, merged with health from webhooks (open alerts, last event);
 *   - reads one channel's state and readiness (`GET /channels/:id`,
 *     `POST /channels/:id/check_readiness`) for the wizard's "activate and verify" step;
 *   - keeps the OTAs offered to tenants (platform setting, chosen in the platform console);
 *   - decides who may open the channel screen: the tenant, or superadmins only
 *     ('platform_only', per tenant or from the platform default — the fallback if the
 *     iframe isolation check of plan 9.5 fails).
 *
 * Tenant views carry no Channex ids: a channel is addressed by its ChannexChannel `_id`.
 * DB functions run in the current tenant context (see `runInTenant`).
 */

import mongoose from 'mongoose';
import AppSettings, { ChannelConnectionSetting } from '../../models/AppSettings';
import ChannelAlert from '../../models/ChannelAlert';
import ChannelOnboarding, { IChannelOnboarding } from '../../models/ChannelOnboarding';
import ChannexChannel, { IChannexChannel } from '../../models/ChannexChannel';
import { IChannexProperty } from '../../models/ChannexProperty';
import ChannexSyncLog from '../../models/ChannexSyncLog';
import PlatformSettings from '../../models/PlatformSettings';
import { ChannexClient, ChannexError, Unwrapped, unwrapOne } from './channexClient';
import { assertCurrentEnvironment, ChannexEnvironment } from './config';
import { parseChannexTimestamp } from './dates';
import { otaDisplayName } from './otaSettlement';

/** One-time tokens live 15 minutes (Channex docs) */
export const IFRAME_TOKEN_TTL_MS = 15 * 60_000;
export const IFRAME_LANGUAGES = ['es', 'en'] as const;
export type IframeLanguage = typeof IFRAME_LANGUAGES[number];

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Channex adapter names (the channel's `channel` attribute) → short codes of /channels/codes */
const ADAPTER_CODES: Record<string, string> = {
  bookingcom: 'BDC', booking: 'BDC',
  expedia: 'EXP',
  airbnb: 'ABB',
  vrbo: 'VRB', homeaway: 'VRB',
  agoda: 'AGO',
  despegar: 'DDC', decolar: 'DDC',
  ctrip: 'CTP', tripcom: 'CTP', ctriptripcom: 'CTP',
  hotelbeds: 'HBD',
  googlehotelads: 'GHA', googlehotelari: 'GHA', google: 'GHA',
  hostelworld: 'HWL',
};

/** OTA short code of a channel, from its adapter name (or the code itself). */
export function channelCodeFor(adapter: string | undefined | null): string | undefined {
  if (!adapter || !adapter.trim()) return undefined;
  const raw = adapter.trim();
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  return ADAPTER_CODES[raw.toLowerCase().replace(/[^a-z]/g, '')];
}

export function iframeLanguage(raw: unknown): IframeLanguage {
  return typeof raw === 'string' && raw.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export const isOtaCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);

export interface IframeUrlInput {
  baseUrl: string;
  token: string;
  propertyId: string;
  groupId?: string;
  language: IframeLanguage;
  /** One OTA: the iframe lists and connects only it */
  otaCode?: string;
  /** Otherwise: the OTAs that may be connected */
  availableChannels?: string[];
}

/** `{base}/auth/exchange?…` — the URL the tenant's browser opens (in a frame or a window). */
export function buildIframeUrl(input: IframeUrlInput): string {
  const params = new URLSearchParams();
  params.set('oauth_session_key', input.token);
  params.set('app_mode', 'headless');
  params.set('redirect_to', '/channels');
  params.set('property_id', input.propertyId);
  if (input.groupId) params.set('group_id', input.groupId);
  params.set('lng', input.language);
  if (input.otaCode) params.set('channels', input.otaCode);
  else if (input.availableChannels?.length) params.set('available_channels', input.availableChannels.join(','));
  // Tenants edit availability only in Pilloto (locked-in decision 2)
  params.set('read_only_availability', 'true');
  return `${input.baseUrl.replace(/\/+$/, '')}/auth/exchange?${params.toString()}`;
}

export type ChannelConnectionMode = 'tenant' | 'platform_only';

export function channelConnectionMode(setting: ChannelConnectionSetting | undefined, platformDefaultPlatformOnly: boolean | undefined): ChannelConnectionMode {
  if (setting === 'tenant' || setting === 'platform_only') return setting;
  return platformDefaultPlatformOnly ? 'platform_only' : 'tenant';
}

/** A channel's state as the tenant reads it (each has a sentence in the UI). */
export type ChannelState =
  | 'active'             // selling, nothing wrong
  | 'attention'          // active, but a channel error/disconnection is open
  | 'waiting_ota'        // connection requested; the OTA has not approved it yet
  | 'needs_mapping'      // rooms or rates still to map before it can be activated
  | 'ready_to_activate'  // mapped; press Activate
  | 'inactive'           // created and switched off (readiness unknown)
  | 'removal_scheduled'  // disabled and about to be deleted
  | 'removed';           // no longer exists

export interface ChannelStateInput {
  isActive: boolean;
  channexStatus?: string;
  expectedRemovalDate?: string | null;
  removed?: boolean;
  openCritical: number;
  /** Readiness problems, when checked */
  problems?: number;
  onboardingStatus?: string;
}

export function channelState(i: ChannelStateInput): ChannelState {
  if (i.removed) return 'removed';
  if (i.isActive) {
    return i.openCritical > 0 || i.channexStatus === 'temporal_error' || i.channexStatus === 'permanent_error' ? 'attention' : 'active';
  }
  if (i.expectedRemovalDate) return 'removal_scheduled';
  if (i.channexStatus === 'pending' || i.onboardingStatus === 'waiting_ota') return 'waiting_ota';
  if (i.problems !== undefined) return i.problems > 0 ? 'needs_mapping' : 'ready_to_activate';
  return 'inactive';
}

export type ReadinessProblemKind = 'mapping' | 'settings' | 'other';

/** `check_readiness` issues → what the tenant must do, counted by kind (no ids or codes). */
export function readinessProblems(body: unknown): { kind: ReadinessProblemKind; count: number }[] {
  const data = Array.isArray((body as any)?.data) ? (body as any).data : [];
  const counts = new Map<ReadinessProblemKind, number>();
  for (const raw of data) {
    const issue = raw?.attributes && typeof raw.attributes === 'object' ? { ...raw, ...raw.attributes } : raw;
    const text = `${issue?.entity ?? ''} ${issue?.relation ?? ''}`;
    const kind: ReadinessProblemKind = /mapping/i.test(text) ? 'mapping'
      : /setting|property|credential|auth|hotel|listing|account/i.test(text) ? 'settings' : 'other';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, count]) => ({ kind, count }));
}

// ─── Tenant views ────────────────────────────────────────────────────────────

export interface ChannelHealth { critical: number; warning: number }

export interface TenantChannel {
  id: string;
  title: string;
  otaCode?: string;
  otaName: string;
  active: boolean;
  state: ChannelState;
  alerts: ChannelHealth;
  connectedAt?: Date;
  activatedAt?: Date;
  lastEventAt?: Date;
  /** The connect wizard of this channel, while it is not finished */
  onboarding?: { otaCode: string; step: number; status: string };
}

type ChannelRow = Pick<IChannexChannel, 'title' | 'adapter' | 'otaCode' | 'isActive' | 'channexStatus' | 'expectedRemovalDate'
  | 'channexInsertedAt' | 'activatedAt' | 'lastEventAt' | 'removedAt'> & { _id: unknown; channexChannelId: string };

export function toTenantChannel(
  row: ChannelRow,
  health: ChannelHealth = { critical: 0, warning: 0 },
  onboarding?: Pick<IChannelOnboarding, 'otaCode' | 'step' | 'status'> | null,
  problems?: number,
): TenantChannel {
  const otaName = otaDisplayName(row.adapter || undefined);
  return {
    id: String(row._id),
    title: row.title?.trim() || otaName,
    ...(row.otaCode ? { otaCode: row.otaCode } : {}),
    otaName,
    active: Boolean(row.isActive) && !row.removedAt,
    state: channelState({
      isActive: Boolean(row.isActive), channexStatus: row.channexStatus, expectedRemovalDate: row.expectedRemovalDate,
      removed: Boolean(row.removedAt), openCritical: health.critical, problems, onboardingStatus: onboarding?.status,
    }),
    alerts: health,
    ...(row.channexInsertedAt ? { connectedAt: row.channexInsertedAt } : {}),
    ...(row.activatedAt ? { activatedAt: row.activatedAt } : {}),
    ...(row.lastEventAt ? { lastEventAt: row.lastEventAt } : {}),
    ...(onboarding && onboarding.status !== 'completed' && onboarding.status !== 'abandoned' && onboarding.otaCode
      ? { onboarding: { otaCode: onboarding.otaCode, step: onboarding.step, status: onboarding.status } } : {}),
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

/** Offered until the platform chooses: the OTAs with their own guide in the connect wizard */
export const DEFAULT_OFFERED_CHANNELS = ['BDC', 'EXP', 'ABB', 'VRB'];
export const MAX_OFFERED_CHANNELS = 30;

/** Validate the offered-OTA list of the platform settings: 3-letter codes, uppercased, no repeats, order kept. */
export function parseOfferedChannels(raw: unknown): { errors: string[] } | { codes: string[] } {
  if (!Array.isArray(raw)) return { errors: ['offeredChannels must be a list of channel codes.'] };
  const codes: string[] = [];
  const bad: string[] = [];
  for (const v of raw) {
    const code = typeof v === 'string' ? v.trim().toUpperCase() : '';
    if (!isOtaCode(code)) bad.push(String(v));
    else if (!codes.includes(code)) codes.push(code);
  }
  if (bad.length) return { errors: [`Not channel codes (three letters, e.g. BDC): ${bad.slice(0, 5).join(', ')}.`] };
  if (codes.length > MAX_OFFERED_CHANNELS) return { errors: [`At most ${MAX_OFFERED_CHANNELS} channels can be offered.`] };
  return { codes };
}

/** The OTAs tenants can connect, in card order. */
export async function getOfferedChannels(): Promise<string[]> {
  const doc = await PlatformSettings.findOne({ key: 'global' }).select('channex.offeredChannels').lean();
  return doc?.channex?.offeredChannels ?? DEFAULT_OFFERED_CHANNELS;
}

export interface ChannelConnection {
  mode: ChannelConnectionMode;
  /** The tenant's own setting ('default' = follow the platform) */
  setting: ChannelConnectionSetting;
  platformDefault: ChannelConnectionMode;
}

export async function getChannelConnection(): Promise<ChannelConnection> {
  const [settings, platform] = await Promise.all([
    AppSettings.findOne({}).select('channelManager.channelConnection').lean(),
    PlatformSettings.findOne({ key: 'global' }).select('channex.iframePlatformOnly').lean(),
  ]);
  const setting = (settings?.channelManager?.channelConnection ?? 'default') as ChannelConnectionSetting;
  const platformOnly = Boolean(platform?.channex?.iframePlatformOnly);
  return { mode: channelConnectionMode(setting, platformOnly), setting, platformDefault: platformOnly ? 'platform_only' : 'tenant' };
}

// ─── Iframe session ──────────────────────────────────────────────────────────

export type IframeSessionResult =
  | { ok: true; url: string; expiresAt: Date }
  | { ok: false; reason: 'not_active' | 'unknown_channel' | 'unavailable'; message: string };

export interface IframeSessionInput {
  client: ChannexClient;
  /** The tenant's own property (loaded in its scope) — never taken from the request */
  property: Pick<IChannexProperty, 'environment' | 'channexPropertyId' | 'channexGroupId' | 'status'>;
  /** Who opens the screen (user email); Channex shows it in its audit trail */
  username: string;
  language: IframeLanguage;
  otaCode?: string;
  /** OTAs offered (getOfferedChannels) */
  offered: string[];
  now?: Date;
}

export async function createIframeSession(input: IframeSessionInput): Promise<IframeSessionResult> {
  const { client, property } = input;
  if (!property.channexPropertyId || property.status !== 'active') {
    return { ok: false, reason: 'not_active', message: 'Activate the channel manager before connecting channels.' };
  }
  assertCurrentEnvironment(property, client.config);
  if (input.otaCode !== undefined && !input.offered.includes(input.otaCode)) {
    return { ok: false, reason: 'unknown_channel', message: 'This channel is not offered.' };
  }
  const now = input.now ?? new Date();
  try {
    const body = await client.post<{ data?: { token?: string } }>('/auth/one_time_token', {
      one_time_token: {
        property_id: property.channexPropertyId,
        ...(property.channexGroupId ? { group_id: property.channexGroupId } : {}),
        username: input.username.slice(0, 200),
      },
    });
    const token = body?.data?.token;
    if (typeof token !== 'string' || !token) throw new ChannexError('Channex returned no one-time token');
    return {
      ok: true,
      url: buildIframeUrl({
        baseUrl: client.config.baseUrl, token, propertyId: property.channexPropertyId, groupId: property.channexGroupId,
        language: input.language, otaCode: input.otaCode, availableChannels: input.offered,
      }),
      expiresAt: new Date(now.getTime() + IFRAME_TOKEN_TTL_MS),
    };
  } catch (err) {
    console.error('[Channex] iframe session failed:', (err as Error).message);
    return { ok: false, reason: 'unavailable', message: 'The channel screen could not be opened right now. Try again in a few minutes.' };
  }
}

// ─── Channel list (cache + health) ───────────────────────────────────────────

function rowFields(c: Unwrapped, channexPropertyId: string) {
  const insertedAt = parseChannexTimestamp(c.inserted_at);
  return {
    channexPropertyId,
    title: typeof c.title === 'string' ? c.title.slice(0, 200) : undefined,
    adapter: typeof c.channel === 'string' ? c.channel.slice(0, 80) : undefined,
    otaCode: channelCodeFor(c.channel),
    isActive: Boolean(c.is_active),
    channexStatus: typeof c.status === 'string' ? c.status.slice(0, 40) : undefined,
    expectedRemovalDate: c.expected_removal_date ? String(c.expected_removal_date).slice(0, 40) : undefined,
    channexInsertedAt: insertedAt,
  };
}

/** Write one Channex channel into the cache; `activatedAt` moves when it is seen turning active. */
async function upsertChannel(environment: ChannexEnvironment, c: Unwrapped, channexPropertyId: string, existing: IChannexChannel | null | undefined, now: Date) {
  const fields = rowFields(c, channexPropertyId);
  const set: Record<string, unknown> = { ...fields, lastSeenAt: now };
  const unset: Record<string, 1> = { removedAt: 1 };
  for (const [k, v] of Object.entries(fields)) if (v === undefined) { delete set[k]; unset[k] = 1; }
  if (fields.isActive && (!existing?.isActive || !existing.activatedAt)) set.activatedAt = now;
  return ChannexChannel.findOneAndUpdate(
    { environment, channexChannelId: c.id },
    { $set: set, $unset: unset, $setOnInsert: { environment, channexChannelId: c.id } },
    { upsert: true, new: true },
  );
}

/**
 * Read the property's channels from Channex into the cache. Channels Channex no longer
 * returns are marked removed. Then links unfinished connect wizards to their channel.
 */
export async function refreshChannels({ client, property, now = new Date() }: {
  client: ChannexClient; property: Pick<IChannexProperty, 'environment' | 'channexPropertyId'>; now?: Date;
}): Promise<IChannexChannel[]> {
  assertCurrentEnvironment(property, client.config);
  const environment = property.environment as ChannexEnvironment;
  const propertyId = property.channexPropertyId!;
  const listed = await client.paginateAll('/channels', { 'filter[property_id]': propertyId });
  const existing = new Map((await ChannexChannel.find({ environment })).map((r) => [r.channexChannelId, r]));
  const rows: IChannexChannel[] = [];
  for (const c of listed) {
    const row = await upsertChannel(environment, c, propertyId, existing.get(c.id), now);
    if (row) rows.push(row);
  }
  const listedIds = listed.map((c) => c.id);
  await ChannexChannel.updateMany(
    { environment, channexChannelId: { $nin: listedIds }, removedAt: { $exists: false } },
    { $set: { removedAt: now, isActive: false } },
  );
  await linkOnboardings(rows);
  return rows;
}

/**
 * A connect wizard learns which channel it created: an unfinished wizard without a channel
 * takes the newest channel of its OTA that no other wizard has.
 */
export async function linkOnboardings(rows: Pick<IChannexChannel, 'channexChannelId' | 'otaCode' | 'channexInsertedAt' | 'removedAt'>[]) {
  const onboardings = await ChannelOnboarding.find({ kind: 'channel' });
  const linked = new Set(onboardings.map((o) => o.channexChannelId).filter(Boolean));
  for (const o of onboardings) {
    if (o.channexChannelId || o.status === 'completed' || o.status === 'abandoned') continue;
    const candidate = rows
      .filter((r) => r.otaCode === o.otaCode && !r.removedAt && !linked.has(r.channexChannelId))
      .sort((a, b) => (b.channexInsertedAt?.getTime() ?? 0) - (a.channexInsertedAt?.getTime() ?? 0))[0];
    if (!candidate) continue;
    o.channexChannelId = candidate.channexChannelId;
    linked.add(candidate.channexChannelId);
    await o.save();
  }
}

/** Open alerts per Channex channel id (health learned from webhooks). */
export async function channelHealth(channexChannelIds: string[]): Promise<Map<string, ChannelHealth>> {
  const out = new Map<string, ChannelHealth>();
  if (!channexChannelIds.length) return out;
  const alerts = await ChannelAlert.find({ channelId: { $in: channexChannelIds }, status: { $in: ['open', 'acknowledged'] } }).select('channelId severity').lean();
  for (const a of alerts) {
    const h = out.get(a.channelId!) ?? { critical: 0, warning: 0 };
    if (a.severity === 'critical') h.critical++; else if (a.severity === 'warning') h.warning++;
    out.set(a.channelId!, h);
  }
  return out;
}

export interface TenantChannelList {
  channels: TenantChannel[];
  /** Connect wizards started for an OTA whose channel does not exist yet */
  onboardings: { otaCode: string; step: number; status: string }[];
  /** Channex could not be reached: the list is the last one read */
  stale: boolean;
}

/** The tenant's channels: refreshed from Channex when possible, else from the cache. */
export async function listTenantChannels({ client, property }: {
  client?: ChannexClient; property: Pick<IChannexProperty, 'environment' | 'channexPropertyId' | 'status'> | null;
}): Promise<TenantChannelList & { rows: IChannexChannel[] }> {
  if (!property?.channexPropertyId) return { channels: [], onboardings: [], stale: false, rows: [] };
  const environment = property.environment as ChannexEnvironment;
  let stale = false;
  if (client) {
    try {
      await refreshChannels({ client, property });
    } catch (err) {
      stale = true;
      console.error('[Channex] channel list failed:', (err as Error).message);
    }
  } else {
    stale = true;
  }
  const rows = await ChannexChannel.find({ environment, removedAt: { $exists: false } }).sort({ channexInsertedAt: 1, createdAt: 1 });
  const [health, onboardings] = await Promise.all([
    channelHealth(rows.map((r) => r.channexChannelId)),
    ChannelOnboarding.find({ kind: 'channel' }).lean(),
  ]);
  const byChannel = new Map(onboardings.filter((o) => o.channexChannelId).map((o) => [o.channexChannelId!, o]));
  const liveIds = new Set(rows.map((r) => r.channexChannelId));
  return {
    channels: rows.map((r) => toTenantChannel(r, health.get(r.channexChannelId), byChannel.get(r.channexChannelId))),
    onboardings: onboardings
      .filter((o) => o.otaCode && o.status !== 'completed' && o.status !== 'abandoned' && !(o.channexChannelId && liveIds.has(o.channexChannelId)))
      .map((o) => ({ otaCode: o.otaCode!, step: o.step, status: o.status })),
    stale,
    rows,
  };
}

// ─── One channel: state + readiness ──────────────────────────────────────────

export interface TenantChannelStatus extends TenantChannel {
  /** What blocks activation, by kind (empty = ready); absent when it could not be checked */
  problems?: { kind: ReadinessProblemKind; count: number }[];
  /** The full sync sent after the channel was activated */
  fullSync?: { sentAt: Date; status: 'ok' | 'warning' | 'error' };
  /** Channex could not be reached: state is the last one known */
  stale: boolean;
}

/** Live state of a cached channel (GET /channels/:id + check_readiness). Runs in tenant scope. */
export async function loadChannelStatus({ client, row, now = new Date() }: {
  client?: ChannexClient; row: IChannexChannel; now?: Date;
}): Promise<TenantChannelStatus> {
  let current: IChannexChannel = row;
  let problems: TenantChannelStatus['problems'];
  let stale = !client;
  if (client && !row.removedAt) {
    try {
      const channel = unwrapOne(await client.get(`/channels/${encodeURIComponent(row.channexChannelId)}`));
      current = (await upsertChannel(row.environment, channel, row.channexPropertyId, row, now)) ?? row;
      if (!current.isActive) problems = readinessProblems(await client.post(`/channels/${encodeURIComponent(row.channexChannelId)}/check_readiness`));
    } catch (err) {
      if (err instanceof ChannexError && err.status === 404) {
        current = (await ChannexChannel.findOneAndUpdate({ _id: row._id }, { $set: { removedAt: now, isActive: false } }, { new: true })) ?? row;
      } else {
        stale = true;
        console.error('[Channex] channel status failed:', (err as Error).message);
      }
    }
  }
  const [health, onboarding] = await Promise.all([
    channelHealth([current.channexChannelId]),
    ChannelOnboarding.findOne({ kind: 'channel', channexChannelId: current.channexChannelId }).lean(),
  ]);
  const problemCount = problems?.reduce((n, p) => n + p.count, 0);
  const view = toTenantChannel(current, health.get(current.channexChannelId), onboarding, problemCount);
  let fullSync: TenantChannelStatus['fullSync'];
  if (current.activatedAt) {
    const log = await ChannexSyncLog.findOne({ trigger: 'full_sync', createdAt: { $gte: current.activatedAt } }).sort({ createdAt: -1 }).lean();
    if (log) fullSync = { sentAt: log.createdAt, status: log.error ? 'error' : log.warnings?.length ? 'warning' : 'ok' };
  }
  return { ...view, ...(problems ? { problems } : {}), ...(fullSync ? { fullSync } : {}), stale };
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

const CHANNEL_EVENTS = new Set([
  'new_channel', 'updated_channel', 'activate_channel', 'deactivate_channel', 'disconnect_channel', 'disconnect_listing',
  'sync_error', 'sync_warning', 'rate_error', 'channel_removal_warning',
]);

/**
 * Remember a channel event on the cached channel (health shown on the channel cards).
 * Runs in the tenant scope; a channel not cached yet is picked up by the next list read.
 */
export async function recordChannelEvent(environment: ChannexEnvironment, channexChannelId: string | undefined, event: string, now = new Date()): Promise<boolean> {
  if (!channexChannelId || !CHANNEL_EVENTS.has(event)) return false;
  const set: Record<string, unknown> = { lastEvent: event, lastEventAt: now };
  if (event === 'activate_channel') Object.assign(set, { isActive: true, activatedAt: now });
  if (event === 'deactivate_channel') set.isActive = false;
  const res = await ChannexChannel.updateOne({ environment, channexChannelId }, { $set: set });
  return res.matchedCount > 0;
}

export const isObjectId = (v: unknown): v is string => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v) && /^[a-f0-9]{24}$/i.test(v);

// ─── Connect-a-channel wizard (plan 8.2) ─────────────────────────────────────

/** before you start · authorize · connect and map · activate and verify · done */
export const CHANNEL_WIZARD_STEPS = 5;
const WIZARD_STATUSES = ['in_progress', 'waiting_ota', 'completed', 'abandoned'] as const;

/** Validate a wizard progress PUT (`{ step?, answers?, status? }`). Returns `{ errors }` or the `$set`. */
export function parseChannelOnboardingUpdate(body: any): { errors: string[] } | { set: Record<string, unknown> } {
  const errors: string[] = [];
  const set: Record<string, unknown> = {};
  if (body?.step !== undefined) {
    if (!Number.isInteger(body.step) || body.step < 1 || body.step > CHANNEL_WIZARD_STEPS) errors.push(`step must be a whole number from 1 to ${CHANNEL_WIZARD_STEPS}`);
    else set.step = body.step;
  }
  if (body?.answers !== undefined) {
    const a = body.answers;
    if (typeof a !== 'object' || a === null || Array.isArray(a) || JSON.stringify(a).length > 5000) errors.push('answers must be a small object');
    else set.answers = a;
  }
  if (body?.status !== undefined) {
    if (!WIZARD_STATUSES.includes(body.status)) errors.push(`status must be one of ${WIZARD_STATUSES.join(', ')}`);
    else {
      set.status = body.status;
      if (body.status === 'completed') set.completedAt = new Date();
    }
  }
  return errors.length ? { errors } : { set };
}

export interface TenantChannelOnboarding {
  otaCode: string;
  step: number;
  answers: Record<string, unknown>;
  status: string;
  started: boolean;
  /** The channel this wizard created, once it exists */
  channel: TenantChannel | TenantChannelStatus | null;
}

/**
 * One OTA's wizard progress and its channel. From the connect step on, the channel list is
 * re-read so a channel just created in the iframe is linked; `live` adds state + readiness.
 */
export async function loadChannelOnboarding({ otaCode, client, property, live = false }: {
  otaCode: string; client?: ChannexClient; property: Pick<IChannexProperty, 'environment' | 'channexPropertyId'> | null; live?: boolean;
}): Promise<TenantChannelOnboarding> {
  let row = await ChannelOnboarding.findOne({ kind: 'channel', otaCode });
  if (row && !row.channexChannelId && row.step >= 3 && client && property?.channexPropertyId) {
    try {
      await refreshChannels({ client, property });
      row = await ChannelOnboarding.findById(row._id);
    } catch (err) {
      console.error('[Channex] channel list failed:', (err as Error).message);
    }
  }
  let channel: TenantChannelOnboarding['channel'] = null;
  if (row?.channexChannelId && property) {
    const cached = await ChannexChannel.findOne({ environment: property.environment, channexChannelId: row.channexChannelId });
    if (cached) {
      channel = live
        ? await loadChannelStatus({ client, row: cached })
        : toTenantChannel(cached, (await channelHealth([cached.channexChannelId])).get(cached.channexChannelId), row);
    }
  }
  return {
    otaCode,
    step: row?.step ?? 1,
    answers: (row?.answers as Record<string, unknown>) ?? {},
    status: row?.status ?? 'in_progress',
    started: Boolean(row),
    channel,
  };
}
