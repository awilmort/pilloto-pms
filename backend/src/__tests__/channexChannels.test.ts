/**
 * Channels (services/channex/channels.ts, plan Phases 8.1–8.2): the iframe session (property and
 * group always the tenant's own, exchange URL parameters), the platform-only switch, the channel
 * list merged with webhook health, one channel's state + readiness, and the connect-a-channel
 * wizard taken through every step with a mid-way resume. Channex client faked; auth mocked;
 * local Mongo. Tenant responses (other than the iframe URL itself, which the browser must load
 * from Channex) carry no Channex ids and never name Channex.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

let mockTenant: any = null;
let mockUser: any = null;
jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = mockUser; req.tenant = mockTenant; req.tenantId = mockTenant?._id; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
  };
});
const mockClient: any = {
  config: { environment: 'staging', baseUrl: 'https://staging.channex.io' },
  get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), paginateAll: jest.fn(),
};
jest.mock('../services/channex/channexClient', () => {
  const actual = jest.requireActual('../services/channex/channexClient');
  return { ...actual, createChannexClient: () => mockClient };
});

// eslint-disable-next-line import/first
import channelManagerRoutes from '../routes/channelManager';
// eslint-disable-next-line import/first
import platformRoutes from '../routes/platform';
// eslint-disable-next-line import/first
import { tenantLocalStorage } from '../middleware/tenantContext';
// eslint-disable-next-line import/first
import { runInTenant } from '../services/channex/provisioning';
// eslint-disable-next-line import/first
import {
  buildIframeUrl, channelCodeFor, channelConnectionMode, channelState, iframeLanguage, parseChannelOnboardingUpdate,
  readinessProblems, recordChannelEvent,
} from '../services/channex/channels';
// eslint-disable-next-line import/first
import { ChannexError } from '../services/channex/channexClient';
// eslint-disable-next-line import/first
import { connectTestDb, dropTestDb } from './helpers/testDb';
// eslint-disable-next-line import/first
import AppSettings from '../models/AppSettings';
// eslint-disable-next-line import/first
import ChannelAlert from '../models/ChannelAlert';
// eslint-disable-next-line import/first
import ChannelOnboarding from '../models/ChannelOnboarding';
// eslint-disable-next-line import/first
import ChannexChannel from '../models/ChannexChannel';
// eslint-disable-next-line import/first
import ChannexProperty from '../models/ChannexProperty';
// eslint-disable-next-line import/first
import ChannexSyncLog from '../models/ChannexSyncLog';
// eslint-disable-next-line import/first
import PlatformSettings from '../models/PlatformSettings';
// eslint-disable-next-line import/first
import Tenant from '../models/Tenant';

const PROP = '5f1c5c9e-0000-4000-8000-00000000a001';
const GROUP = '5f1c5c9e-0000-4000-8000-00000000b001';
const BDC_ID = '7a7a7a7a-1111-4111-8111-000000000bdc';
const ABB_ID = '7a7a7a7a-2222-4222-8222-000000000abb';
/** A tenant JSON response must not leak any of these */
const LEAKS = new RegExp([PROP, GROUP, BDC_ID, ABB_ID, 'channex', 'staging'].join('|'), 'i');

const channel = (id: string, adapter: string, isActive: boolean, extra: Record<string, unknown> = {}) => ({
  id, type: 'channel', title: `My ${adapter}`, channel: adapter, is_active: isActive, properties: [PROP], inserted_at: '2026-11-02T10:00:00Z', ...extra,
});

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('pure helpers', () => {
  it('channel codes from Channex adapter names', () => {
    expect(channelCodeFor('BookingCom')).toBe('BDC');
    expect(channelCodeFor('AirBNB')).toBe('ABB');
    expect(channelCodeFor('Airbnb')).toBe('ABB');
    expect(channelCodeFor('VRBO')).toBe('VRB');
    expect(channelCodeFor('Ctrip')).toBe('CTP');
    expect(channelCodeFor('EXP')).toBe('EXP');
    expect(channelCodeFor('SomethingNew')).toBeUndefined();
    expect(channelCodeFor(undefined)).toBeUndefined();
  });

  it('iframe language follows the user (Spanish by default)', () => {
    expect(iframeLanguage('en-US')).toBe('en');
    expect(iframeLanguage('es')).toBe('es');
    expect(iframeLanguage(undefined)).toBe('es');
    expect(iframeLanguage('fr')).toBe('es');
  });

  it('exchange URL: one OTA → channels=<code>; otherwise available_channels; availability always read-only', () => {
    const base = { baseUrl: 'https://staging.channex.io/', token: 'tok', propertyId: PROP, groupId: GROUP, language: 'es' as const };
    const one = new URL(buildIframeUrl({ ...base, otaCode: 'BDC', availableChannels: ['BDC', 'EXP'] }));
    expect(one.origin + one.pathname).toBe('https://staging.channex.io/auth/exchange');
    expect(Object.fromEntries(one.searchParams)).toEqual({
      oauth_session_key: 'tok', app_mode: 'headless', redirect_to: '/channels', property_id: PROP, group_id: GROUP, lng: 'es',
      channels: 'BDC', read_only_availability: 'true',
    });
    const all = new URL(buildIframeUrl({ ...base, language: 'en', availableChannels: ['BDC', 'EXP', 'ABB'] }));
    expect(all.searchParams.get('available_channels')).toBe('BDC,EXP,ABB');
    expect(all.searchParams.get('channels')).toBeNull();
    expect(all.searchParams.get('lng')).toBe('en');
    expect(all.searchParams.get('read_only_availability')).toBe('true');
  });

  it('who connects channels: the tenant setting wins, else the platform default', () => {
    expect(channelConnectionMode('default', false)).toBe('tenant');
    expect(channelConnectionMode('default', true)).toBe('platform_only');
    expect(channelConnectionMode(undefined, true)).toBe('platform_only');
    expect(channelConnectionMode('tenant', true)).toBe('tenant');
    expect(channelConnectionMode('platform_only', false)).toBe('platform_only');
  });

  it('channel state in every situation', () => {
    const s = (over: Partial<Parameters<typeof channelState>[0]>) => channelState({ isActive: false, openCritical: 0, ...over });
    expect(s({ isActive: true })).toBe('active');
    expect(s({ isActive: true, openCritical: 1 })).toBe('attention');
    expect(s({ isActive: true, channexStatus: 'temporal_error' })).toBe('attention');
    expect(s({ channexStatus: 'pending' })).toBe('waiting_ota');
    expect(s({ onboardingStatus: 'waiting_ota', problems: 0 })).toBe('waiting_ota');
    expect(s({ problems: 3 })).toBe('needs_mapping');
    expect(s({ problems: 0 })).toBe('ready_to_activate');
    expect(s({})).toBe('inactive');
    expect(s({ expectedRemovalDate: '2026-12-01' })).toBe('removal_scheduled');
    expect(s({ removed: true, isActive: true })).toBe('removed');
  });

  it('readiness issues become counts by kind, without ids or codes', () => {
    expect(readinessProblems({ data: [
      { id: 'u1', type: 'entity', entity: 'Channel', relation: 'Mapping', error_code: 'required' },
      { id: 'u2', type: 'entity', attributes: { entity: 'RatePlanMapping', relation: 'RatePlan', error_code: 'required' } },
      { id: 'u3', type: 'entity', entity: 'Channel', relation: 'Settings', error_code: 'invalid' },
      { id: 'u4', type: 'entity', entity: 'Channel', relation: 'Whatever', error_code: 'x' },
    ], meta: { message: 'Channel not ready' } })).toEqual([{ kind: 'mapping', count: 2 }, { kind: 'settings', count: 1 }, { kind: 'other', count: 1 }]);
    expect(readinessProblems({ data: [], meta: {} })).toEqual([]);
    expect(readinessProblems(undefined)).toEqual([]);
  });

  it('wizard progress validation', () => {
    expect(parseChannelOnboardingUpdate({ step: 3, answers: { checklist: { ical: true } } })).toEqual({ set: { step: 3, answers: { checklist: { ical: true } } } });
    expect(parseChannelOnboardingUpdate({ step: 6 })).toHaveProperty('errors');
    expect(parseChannelOnboardingUpdate({ step: 0 })).toHaveProperty('errors');
    expect(parseChannelOnboardingUpdate({ answers: [] })).toHaveProperty('errors');
    expect(parseChannelOnboardingUpdate({ status: 'done' })).toHaveProperty('errors');
    const done = parseChannelOnboardingUpdate({ status: 'completed' }) as { set: Record<string, unknown> };
    expect(done.set.status).toBe('completed');
    expect(done.set.completedAt).toBeInstanceOf(Date);
  });
});

// ─── Routes (local Mongo) ────────────────────────────────────────────────────

describe('channel routes (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const otherTenant = new mongoose.Types.ObjectId();
  const envBackup = { ...process.env };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
  app.use('/api/channel-manager', channelManagerRoutes);
  const platformApp = express();
  platformApp.use(express.json());
  platformApp.use((req, _res, next) => tenantLocalStorage.run(null, next));
  platformApp.use('/api/platform', platformRoutes);

  const tenantGet = (path: string) => request(app).get(`/api/channel-manager${path}`);
  const tenantPost = (path: string, body: unknown = {}) => request(app).post(`/api/channel-manager${path}`).send(body as object);
  const tenantPut = (path: string, body: unknown) => request(app).put(`/api/channel-manager${path}`).send(body as object);
  const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);

  beforeAll(async () => {
    process.env.CHANNEX_API_KEY = 'test-key';
    process.env.CHANNEX_ENV = 'staging';
    ready = await connectTestDb('pilloto_channels');
    if (!ready) { console.warn('Mongo unreachable — skipping channel route tests'); return; }
    await ChannexChannel.init();
    await Tenant.collection.insertOne({ _id: tenantId, name: 'Test Property - Pilloto', slug: 'channels-test', plan: 'pro', isActive: true, products: ['pms'] });
  });
  afterAll(async () => {
    process.env = envBackup;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    mockTenant = { _id: tenantId, plan: 'pro', name: 'Test Property - Pilloto', settings: { timezone: 'America/Santo_Domingo', currency: 'USD' } };
    mockUser = { id: String(new mongoose.Types.ObjectId()), email: 'staff@example.com', role: 'superadmin' };
    for (const fn of ['get', 'post', 'paginateAll'] as const) mockClient[fn].mockReset();
    if (!ready) return;
    await Promise.all([ChannexProperty, ChannexChannel, ChannelOnboarding, ChannelAlert, ChannexSyncLog, AppSettings, PlatformSettings]
      .map((m: any) => m.collection.deleteMany({})));
    await ChannexProperty.collection.insertOne({
      tenantId, environment: 'staging', status: 'active', channexPropertyId: PROP, channexGroupId: GROUP, timezone: 'America/Santo_Domingo', currency: 'USD',
      pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0,
    });
    await AppSettings.collection.insertOne({ tenantId, key: 'global', channelManager: { enabled: true, channelConnection: 'default' } });
    await PlatformSettings.collection.insertOne({ key: 'global', channex: { globalEnabled: true, offeredChannels: ['BDC', 'EXP', 'ABB'] } });
    mockClient.post.mockImplementation(async (path: string) => {
      if (path === '/auth/one_time_token') return { data: { token: 'one-time-123' }, meta: { message: 'Success' } };
      if (path.endsWith('/check_readiness')) return { data: [], meta: { message: 'ready' } };
      throw new Error(`unexpected POST ${path}`);
    });
  });
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  // ── OTAs offered: a platform setting ──

  itDb('the platform chooses the OTAs offered; unset = the ones with a guide', async () => {
    await PlatformSettings.collection.deleteMany({});
    mockClient.paginateAll.mockResolvedValue([]);
    expect((await request(platformApp).get('/api/platform/channex/settings')).body.data).toEqual({ globalEnabled: true, iframePlatformOnly: false, offeredChannels: ['BDC', 'EXP', 'ABB', 'VRB'] });
    expect((await tenantGet('/channels')).body.data.offered).toEqual(['BDC', 'EXP', 'ABB', 'VRB']);

    // Order kept, lowercase accepted, repeats dropped; the other setting is untouched
    await request(platformApp).put('/api/platform/channex/settings').send({ iframePlatformOnly: true });
    let res = await request(platformApp).put('/api/platform/channex/settings').send({ offeredChannels: ['ago', 'BDC', 'AGO'] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ globalEnabled: true, iframePlatformOnly: true, offeredChannels: ['AGO', 'BDC'] });
    expect((await tenantGet('/channels')).body.data.offered).toEqual(['AGO', 'BDC']);
    await request(platformApp).put('/api/platform/channex/settings').send({ iframePlatformOnly: false });
    expect((await tenantPost('/iframe-session', { otaCode: 'EXP' })).status).toBe(400); // no longer offered
    expect(new URL((await tenantPost('/iframe-session', {})).body.data.url).searchParams.get('available_channels')).toBe('AGO,BDC');
    expect((await tenantPut('/channel-onboarding/EXP', { step: 1 })).status).toBe(400);

    // Offering nothing is a valid choice (no connect cards)
    res = await request(platformApp).put('/api/platform/channex/settings').send({ offeredChannels: [] });
    expect(res.body.data.offeredChannels).toEqual([]);
    expect((await tenantGet('/channels')).body.data.offered).toEqual([]);

    for (const bad of [['BOOKING'], 'BDC', [12], {}]) {
      expect((await request(platformApp).put('/api/platform/channex/settings').send({ offeredChannels: bad })).status).toBe(400);
    }
    expect((await request(platformApp).put('/api/platform/channex/settings').send({})).status).toBe(400);
  });

  // ── 8.1: iframe session ──

  itDb('iframe session for one OTA: token for the tenant’s own property and group, whatever the client sends', async () => {
    const res = await tenantPost('/iframe-session', { otaCode: 'BDC', language: 'en', property_id: 'someone-else', propertyId: 'evil', group_id: 'evil' });
    expect(res.status).toBe(200);
    expect(mockClient.post).toHaveBeenCalledWith('/auth/one_time_token', { one_time_token: { property_id: PROP, group_id: GROUP, username: 'staff@example.com' } });
    const url = new URL(res.body.data.url);
    expect(url.searchParams.get('oauth_session_key')).toBe('one-time-123');
    expect(url.searchParams.get('property_id')).toBe(PROP);
    expect(url.searchParams.get('group_id')).toBe(GROUP);
    expect(url.searchParams.get('channels')).toBe('BDC');
    expect(url.searchParams.get('available_channels')).toBeNull();
    expect(url.searchParams.get('lng')).toBe('en');
    expect(url.searchParams.get('read_only_availability')).toBe('true');
    expect(url.searchParams.get('app_mode')).toBe('headless');
    expect(new Date(res.body.data.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  itDb('iframe session without an OTA offers every configured channel, in Spanish by default', async () => {
    const res = await tenantPost('/iframe-session', {});
    const url = new URL(res.body.data.url);
    expect(url.searchParams.get('available_channels')).toBe('BDC,EXP,ABB');
    expect(url.searchParams.get('channels')).toBeNull();
    expect(url.searchParams.get('lng')).toBe('es');
  });

  itDb('refuses OTAs that are not offered or malformed, and inactive properties', async () => {
    expect((await tenantPost('/iframe-session', { otaCode: 'HBD' })).status).toBe(400);
    expect((await tenantPost('/iframe-session', { otaCode: 'bdc' })).status).toBe(400);
    await ChannexProperty.collection.updateOne({ tenantId }, { $set: { status: 'disabled' } });
    expect((await tenantPost('/iframe-session', {})).status).toBe(409);
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  itDb('Channex failure → a plain message, no Channex error text', async () => {
    mockClient.post.mockRejectedValueOnce(new ChannexError('Channex rejected the request (422) — property_id: invalid'));
    const res = await tenantPost('/iframe-session', { otaCode: 'BDC' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/channex|422|property_id/i);
  });

  itDb('platform-only: the tenant setting or the platform default hides the connection screen from tenants', async () => {
    await AppSettings.collection.updateOne({ tenantId }, { $set: { 'channelManager.channelConnection': 'platform_only' } });
    let res = await tenantPost('/iframe-session', { otaCode: 'BDC' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('platform_only');
    mockClient.paginateAll.mockResolvedValue([]);
    expect((await tenantGet('/channels')).body.data.connection).toBe('platform_only');

    // Platform default, tenant following it
    await AppSettings.collection.updateOne({ tenantId }, { $set: { 'channelManager.channelConnection': 'default' } });
    expect((await request(platformApp).put('/api/platform/channex/settings').send({ iframePlatformOnly: true })).status).toBe(200);
    expect((await request(platformApp).get('/api/platform/channex/settings')).body.data).toEqual({ globalEnabled: true, iframePlatformOnly: true, offeredChannels: ['BDC', 'EXP', 'ABB'] });
    expect((await tenantPost('/iframe-session', {})).status).toBe(403);

    // Tenant explicitly allowed, set from the platform console
    res = await request(platformApp).put(`/api/platform/channex/tenants/${tenantId}/channel-connection`).send({ setting: 'tenant' });
    expect(res.body.data).toEqual({ mode: 'tenant', setting: 'tenant', platformDefault: 'platform_only' });
    expect((await tenantPost('/iframe-session', {})).status).toBe(200);
    expect((await request(platformApp).put(`/api/platform/channex/tenants/${tenantId}/channel-connection`).send({ setting: 'nope' })).status).toBe(400);

    // Superadmins can always open it for the tenant
    await AppSettings.collection.updateOne({ tenantId }, { $set: { 'channelManager.channelConnection': 'platform_only' } });
    mockClient.post.mockClear();
    res = await request(platformApp).post(`/api/platform/channex/tenants/${tenantId}/iframe-session`).send({ otaCode: 'ABB' });
    expect(res.status).toBe(200);
    expect(new URL(res.body.data.url).searchParams.get('channels')).toBe('ABB');
    expect(mockClient.post.mock.calls[0][1].one_time_token.property_id).toBe(PROP);
  });

  itDb('the tenant cannot change who connects channels through its own settings', async () => {
    expect((await tenantPut('/settings', { channelConnection: 'tenant' })).status).toBe(200);
    const cm = (await AppSettings.collection.findOne({ tenantId }))!.channelManager;
    expect(cm.channelConnection).toBe('default');
  });

  // ── 8.1: channel list + health ──

  itDb('channel list: from Channex, merged with webhook health, without Channex ids', async () => {
    mockClient.paginateAll.mockResolvedValue([channel(BDC_ID, 'BookingCom', true), channel(ABB_ID, 'AirBNB', false)]);
    await ChannelAlert.collection.insertOne({
      tenantId, type: 'sync_error', severity: 'critical', status: 'open', dedupeKey: BDC_ID, channelId: BDC_ID, title: 'A channel reported an error', createdAt: new Date(),
    });
    const res = await tenantGet('/channels');
    expect(res.status).toBe(200);
    expect(mockClient.paginateAll).toHaveBeenCalledWith('/channels', { 'filter[property_id]': PROP });
    const { channels, offered, connection, stale } = res.body.data;
    expect({ offered, connection, stale }).toEqual({ offered: ['BDC', 'EXP', 'ABB'], connection: 'tenant', stale: false });
    expect(channels.map((c: any) => [c.otaCode, c.otaName, c.title, c.state, c.alerts.critical])).toEqual([
      ['BDC', 'Booking.com', 'My BookingCom', 'attention', 1],
      ['ABB', 'Airbnb', 'My AirBNB', 'inactive', 0],
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(LEAKS);

    // Webhook: Airbnb activated → shown active before the next list read
    await inTenant(() => recordChannelEvent('staging', ABB_ID, 'activate_channel'));
    mockClient.paginateAll.mockRejectedValueOnce(new ChannexError('Channex server error (503)'));
    const cached = await tenantGet('/channels');
    expect(cached.body.data.stale).toBe(true);
    expect(cached.body.data.channels.find((c: any) => c.otaCode === 'ABB')).toMatchObject({ state: 'active', active: true });
    expect(JSON.stringify(cached.body)).not.toMatch(LEAKS);

    // A channel Channex no longer returns disappears from the list
    mockClient.paginateAll.mockResolvedValue([channel(BDC_ID, 'BookingCom', true)]);
    const after = await tenantGet('/channels');
    expect(after.body.data.channels.map((c: any) => c.otaCode)).toEqual(['BDC']);
  });

  itDb('platform view of the same list carries the Channex ids', async () => {
    mockClient.paginateAll.mockResolvedValue([channel(BDC_ID, 'BookingCom', true)]);
    const res = await request(platformApp).get(`/api/platform/channex/tenants/${tenantId}/channels`);
    expect(res.status).toBe(200);
    expect(res.body.data.channels[0]).toMatchObject({ channexChannelId: BDC_ID, adapter: 'BookingCom', otaCode: 'BDC' });
    expect(res.body.data.connection.mode).toBe('tenant');
  });

  // ── 8.1: one channel's status ──

  itDb('channel status: state and readiness in words; isolation by tenant', async () => {
    mockClient.paginateAll.mockResolvedValue([channel(BDC_ID, 'BookingCom', false)]);
    const id = (await tenantGet('/channels')).body.data.channels[0].id;

    mockClient.get.mockResolvedValue({ data: { id: BDC_ID, type: 'channel', attributes: channel(BDC_ID, 'BookingCom', false) } });
    mockClient.post.mockImplementation(async (path: string) => ({ data: [
      { id: 'i1', type: 'entity', entity: 'Channel', relation: 'Mapping', error_code: 'required' },
      { id: 'i2', type: 'entity', entity: 'Channel', relation: 'Mapping', error_code: 'required' },
    ], meta: { message: path } }));
    let res = await tenantGet(`/channels/${id}/status`);
    expect(res.status).toBe(200);
    expect(mockClient.get).toHaveBeenCalledWith(`/channels/${BDC_ID}`);
    expect(mockClient.post).toHaveBeenCalledWith(`/channels/${BDC_ID}/check_readiness`);
    expect(res.body.data).toMatchObject({ id, state: 'needs_mapping', problems: [{ kind: 'mapping', count: 2 }], stale: false });
    expect(JSON.stringify(res.body)).not.toMatch(LEAKS);

    mockClient.post.mockResolvedValue({ data: [], meta: { message: 'ok' } });
    res = await tenantGet(`/channels/${id}/status`);
    expect(res.body.data).toMatchObject({ state: 'ready_to_activate', problems: [] });

    // Deleted in Channex → removed
    mockClient.get.mockRejectedValueOnce(new ChannexError('Channex request failed (404)', { status: 404 }));
    res = await tenantGet(`/channels/${id}/status`);
    expect(res.body.data.state).toBe('removed');

    expect((await tenantGet('/channels/not-an-id/status')).status).toBe(400);
    const foreign = await ChannexChannel.collection.insertOne({ tenantId: otherTenant, environment: 'staging', channexChannelId: 'other-tenant-channel', channexPropertyId: 'other-prop', isActive: true, lastSeenAt: new Date() });
    expect((await tenantGet(`/channels/${foreign.insertedId}/status`)).status).toBe(404);
  });

  // ── 8.2: connect-a-channel wizard ──

  itDb('wizard: every step, closed mid-way and resumed, states in words through activation, then done', async () => {
    mockClient.paginateAll.mockResolvedValue([]);
    // Not started yet
    let res = await tenantGet('/channel-onboarding/BDC');
    expect(res.body.data).toMatchObject({ otaCode: 'BDC', step: 1, started: false, channel: null });
    expect((await tenantPut('/channel-onboarding/HBD', { step: 1 })).status).toBe(400); // not offered
    expect((await tenantPut('/channel-onboarding/BDC', { step: 9 })).status).toBe(400);

    // Step 1 → 2: checklist ticked
    const checklist = { ical: true, otherManager: true, currency: true, taxes: true };
    res = await tenantPut('/channel-onboarding/BDC', { step: 2, answers: { checklist } });
    expect(res.body.data).toMatchObject({ step: 2, started: true, answers: { checklist }, channel: null });
    // Started without a channel → listed for the home's "continue" card
    expect((await tenantGet('/channels')).body.data.onboardings).toEqual([{ otaCode: 'BDC', step: 2, status: 'in_progress' }]);

    // Step 3: the iframe for this OTA only
    await tenantPut('/channel-onboarding/BDC', { step: 3, answers: { checklist, authorized: true } });
    const session = await tenantPost('/iframe-session', { otaCode: 'BDC' });
    expect(new URL(session.body.data.url).searchParams.get('channels')).toBe('BDC');

    // The user creates the channel in the iframe and closes the wizard; later they come back
    mockClient.paginateAll.mockResolvedValue([channel(BDC_ID, 'BookingCom', false)]);
    res = await tenantGet('/channel-onboarding/BDC');
    expect(res.body.data).toMatchObject({ step: 3, answers: { checklist, authorized: true }, channel: { otaCode: 'BDC', state: 'inactive' } });
    // The home shows the channel card with "continue" instead of a separate onboarding row
    const home = (await tenantGet('/channels')).body.data;
    expect(home.onboardings).toEqual([]);
    expect(home.channels[0].onboarding).toEqual({ otaCode: 'BDC', step: 3, status: 'in_progress' });

    // Step 4: activate and verify, polled live
    await tenantPut('/channel-onboarding/BDC', { step: 4 });
    mockClient.get.mockResolvedValue({ data: { id: BDC_ID, type: 'channel', attributes: channel(BDC_ID, 'BookingCom', false) } });
    mockClient.post.mockResolvedValue({ data: [{ id: 'x', type: 'entity', entity: 'Channel', relation: 'Mapping', error_code: 'required' }], meta: {} });
    expect((await tenantGet('/channel-onboarding/BDC?live=1')).body.data.channel.state).toBe('needs_mapping');
    mockClient.post.mockResolvedValue({ data: [], meta: {} });
    expect((await tenantGet('/channel-onboarding/BDC?live=1')).body.data.channel.state).toBe('ready_to_activate');
    await tenantPut('/channel-onboarding/BDC', { status: 'waiting_ota' });
    res = await tenantGet('/channel-onboarding/BDC?live=1');
    expect(res.body.data.channel.state).toBe('waiting_ota');
    expect(JSON.stringify(res.body)).not.toMatch(LEAKS);

    // Booking.com approves; the user activates; Channex reports it active and the full sync runs
    mockClient.get.mockResolvedValue({ data: { id: BDC_ID, type: 'channel', attributes: channel(BDC_ID, 'BookingCom', true) } });
    mockClient.post.mockClear();
    res = await tenantGet('/channel-onboarding/BDC?live=1');
    expect(res.body.data.channel).toMatchObject({ state: 'active', active: true });
    expect(res.body.data.channel.fullSync).toBeUndefined();
    expect(mockClient.post).not.toHaveBeenCalled(); // no readiness check for an active channel
    await ChannexSyncLog.collection.insertMany(['availability', 'restrictions'].map((kind) => ({
      tenantId, trigger: 'full_sync', kind, valuesCount: 4, taskIds: ['task-1'], warnings: [], createdAt: new Date(Date.now() + 1000), updatedAt: new Date(),
    })));
    res = await tenantGet('/channel-onboarding/BDC?live=1');
    expect(res.body.data.channel.fullSync).toMatchObject({ status: 'ok' });
    expect(JSON.stringify(res.body)).not.toMatch(/task-1|LEAK/);

    // Step 5: done → no longer "in progress" on the channel card
    res = await tenantPut('/channel-onboarding/BDC', { step: 5, status: 'completed' });
    expect(res.body.data).toMatchObject({ step: 5, status: 'completed' });
    const done = (await tenantGet('/channels')).body.data;
    expect(done.channels[0].onboarding).toBeUndefined();
    expect(done.onboardings).toEqual([]);
    const row = await ChannelOnboarding.collection.findOne({ tenantId, kind: 'channel', otaCode: 'BDC' });
    expect(row!.completedAt).toBeInstanceOf(Date);
    expect(row!.channexChannelId).toBe(BDC_ID);
  });

  itDb('a second wizard for another OTA links only to its own OTA’s channel', async () => {
    mockClient.paginateAll.mockResolvedValue([channel(BDC_ID, 'BookingCom', true)]);
    await tenantPut('/channel-onboarding/ABB', { step: 3 });
    expect((await tenantGet('/channel-onboarding/ABB')).body.data.channel).toBeNull();
    mockClient.paginateAll.mockResolvedValue([channel(BDC_ID, 'BookingCom', true), channel(ABB_ID, 'Airbnb', false, { inserted_at: '2026-11-03T10:00:00Z' })]);
    expect((await tenantGet('/channel-onboarding/ABB')).body.data.channel).toMatchObject({ otaCode: 'ABB' });
  });
});
