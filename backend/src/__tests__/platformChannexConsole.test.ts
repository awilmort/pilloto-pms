/**
 * Platform console (plan Phase 9.3) against a FAKE Channex HTTP server (a real express app on a
 * random port; the real Channex client talks to it): a superadmin sees two tenants' states,
 * runs the webhook setup actions, flips the kill switch, triggers a full sync, pauses and resumes
 * pushes (the real ARI worker), lists platform alerts, and re-links a deliberately broken
 * mapping back to the right Channex rate plan from the repair screen. Auth mocked; local Mongo.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import mongoose from 'mongoose';
import request from 'supertest';

jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'superadmin', role: 'superadmin', email: 'ops@pilloto.test' }; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
  };
});

// eslint-disable-next-line import/first
import platformRoutes from '../routes/platform';
// eslint-disable-next-line import/first
import { ariTick } from '../services/channex/ariWorker';
// eslint-disable-next-line import/first
import { createChannexClient } from '../services/channex/channexClient';
// eslint-disable-next-line import/first
import { getChannexConfig } from '../services/channex/config';
// eslint-disable-next-line import/first
import { raiseAlert } from '../services/channex/alerts.service';
// eslint-disable-next-line import/first
import { connectTestDb, dropTestDb } from './helpers/testDb';
// eslint-disable-next-line import/first
import ChannelAriChange from '../models/ChannelAriChange';
// eslint-disable-next-line import/first
import ChannexEntityMap from '../models/ChannexEntityMap';
// eslint-disable-next-line import/first
import ChannexProperty from '../models/ChannexProperty';
// eslint-disable-next-line import/first
import ChannexSyncLog from '../models/ChannexSyncLog';
// eslint-disable-next-line import/first
import PlatformSettings from '../models/PlatformSettings';
// eslint-disable-next-line import/first
import RatePlan from '../models/RatePlan';
// eslint-disable-next-line import/first
import Room from '../models/Room';
// eslint-disable-next-line import/first
import RoomType from '../models/RoomType';
// eslint-disable-next-line import/first
import Tenant from '../models/Tenant';

// ─── Fake Channex ────────────────────────────────────────────────────────────

interface Call { method: string; path: string; query: any; body: any }
const calls: Call[] = [];
const fake = express();
fake.use(express.json({ limit: '20mb' }));
fake.use((req, _res, next) => { if (req.headers['user-api-key'] !== 'fake-key') { _res.status(401).json({ errors: { code: 'unauthorized', title: 'Unauthorized' } }); return; } calls.push({ method: req.method, path: req.path, query: req.query, body: req.body }); next(); });
const OPTIONS: Record<string, { roomTypes: any[]; ratePlans: any[] }> = {
  'cx-prop-a': {
    roomTypes: [{ id: 'cx-rt-a', title: 'Twin Room' }],
    ratePlans: [
      { id: 'cx-rp-a1', title: 'Best Available Rate', room_type_id: 'cx-rt-a', occupancy: 1 },
      { id: 'cx-rp-a1', title: 'Best Available Rate', room_type_id: 'cx-rt-a', occupancy: 2 },
    ],
  },
  'cx-prop-b': { roomTypes: [{ id: 'cx-rt-b', title: 'Villa' }], ratePlans: [{ id: 'cx-rp-b1', title: 'BAR', room_type_id: 'cx-rt-b', occupancy: 2 }] },
};
fake.get('/api/v1/properties', (_req, res) => res.json({ data: [], meta: { total: 0 } }));
fake.get('/api/v1/room_types/options', (req, res) => res.json({ data: (OPTIONS[String(req.query['filter[property_id]'] ?? (req.query as any).filter?.property_id)]?.roomTypes ?? []).map((o) => ({ attributes: o })) }));
fake.get('/api/v1/rate_plans/options', (req, res) => res.json({ data: (OPTIONS[String(req.query['filter[property_id]'] ?? (req.query as any).filter?.property_id)]?.ratePlans ?? []).map((o) => ({ attributes: o })) }));
fake.post('/api/v1/signing_keys', (_req, res) => res.json({ data: { id: 'sk-123', type: 'signing_key', attributes: { id: 'sk-123', secret: 'shown-once-secret' } } }));
fake.get('/api/v1/webhooks', (_req, res) => res.json({ data: [], meta: { total: 0 } }));
fake.post('/api/v1/webhooks', (_req, res) => res.json({ data: { id: 'wh-9', type: 'webhook', attributes: {} } }));
fake.put('/api/v1/webhooks/:id', (_req, res) => res.json({ data: { id: _req.params.id } }));
fake.post('/api/v1/webhooks/:id/test', (_req, res) => res.json({ data: { attributes: { status_code: 200, body: '{"ok":true}' } } }));
fake.put('/api/v1/room_types/:id', (req, res) => res.json({ data: { id: req.params.id, type: 'room_type', attributes: {} } }));
fake.put('/api/v1/rate_plans/:id', (req, res) => res.json({ data: { id: req.params.id, type: 'rate_plan', attributes: {} } }));
let task = 0;
fake.post('/api/v1/availability', (_req, res) => res.json({ data: [{ id: `task-av-${++task}`, type: 'task' }], meta: {} }));
fake.post('/api/v1/restrictions', (_req, res) => res.json({ data: [{ id: `task-rs-${++task}`, type: 'task' }], meta: {} }));
fake.use((req, res) => res.status(404).json({ errors: { code: 'not_found', title: `No fake route ${req.method} ${req.path}` } }));

describe('platform Channex console (fake Channex server)', () => {
  let ready = false;
  let server: http.Server;
  const envBackup = { ...process.env };
  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();
  const rtA = new mongoose.Types.ObjectId();
  const rpA = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  app.use('/api/platform', platformRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const later = (s: number) => () => new Date(Date.now() + s * 1000);
  const tick = (s = 60) => ariTick({ client: createChannexClient(getChannexConfig(), { logger: { info: () => undefined, warn: () => undefined } }), now: later(s) });
  const pushes = () => calls.filter((c) => c.method === 'POST' && (c.path === '/api/v1/availability' || c.path === '/api/v1/restrictions'));

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_platform_console');
    if (!ready) { console.warn('Mongo unreachable — skipping platform console tests'); return; }
    server = fake.listen(0);
    const port = (server.address() as AddressInfo).port;
    Object.assign(process.env, {
      CHANNEX_ENV: 'staging', CHANNEX_API_KEY: 'fake-key', CHANNEX_BASE_URL: `http://127.0.0.1:${port}`,
      CHANNEX_WEBHOOK_URL: 'https://pilloto-test.trycloudflare.com/api/webhooks/channex',
    });
    await Tenant.collection.insertMany([
      { _id: tenantA, name: 'Hotel A', slug: 'hotel-a', plan: 'pro', isActive: true, products: ['pms'], settings: { timezone: 'America/Santo_Domingo', currency: 'USD' } },
      { _id: tenantB, name: 'Villa B', slug: 'villa-b', plan: 'enterprise', isActive: true, products: ['pms'] },
    ]);
    const prop = (tenantId: mongoose.Types.ObjectId, id: string, extra = {}) => ({
      tenantId, environment: 'staging', status: 'active', channexPropertyId: id, channexGroupId: `g-${id}`, timezone: 'America/Santo_Domingo', currency: 'USD',
      pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0, pushesPaused: false, ...extra,
    });
    await ChannexProperty.collection.insertMany([prop(tenantA, 'cx-prop-a'), prop(tenantB, 'cx-prop-b', { lastError: 'Channex unreachable (503)', consecutiveFailures: 3 })]);
    await RoomType.collection.insertOne({ _id: rtA, tenantId: tenantA, name: 'Twin Room', capacity: 2, isActive: true });
    await Room.collection.insertMany([{ tenantId: tenantA, name: 'T1', roomTypeId: rtA, status: 'active' }, { tenantId: tenantA, name: 'T2', roomTypeId: rtA, status: 'active' }]);
    await RatePlan.collection.insertOne({ _id: rpA, tenantId: tenantA, name: 'Best Available Rate', roomTypeId: rtA, basePrice: 100, isActive: true, occupancyTiers: [] });
    await ChannexEntityMap.collection.insertMany([
      { tenantId: tenantA, environment: 'staging', kind: 'room_type', localId: rtA, channexId: 'cx-rt-a', channexPropertyId: 'cx-prop-a', status: 'active', syncedSnapshot: { title: 'Twin Room', occupancyOptions: [1, 2], countOfRooms: 2 } },
      // Deliberately broken: points at a Channex rate plan that does not exist
      { tenantId: tenantA, environment: 'staging', kind: 'rate_plan', localId: rpA, channexId: 'cx-rp-gone', channexPropertyId: 'cx-prop-a', status: 'active', syncedSnapshot: { title: 'Best Available Rate', occupancyOptions: [1, 2], childrenFee: 0 } },
    ]);
  });
  afterAll(async () => {
    process.env = envBackup;
    if (server) await new Promise((r) => server.close(r));
    if (ready) await dropTestDb();
  });

  itDb('overview and tenants table: two tenants with their states', async () => {
    await ChannelAriChange.collection.insertOne({ tenantId: tenantB, kind: 'availability', status: 'pending', dateFrom: '2026-12-01', dateTo: '2026-12-02', fields: ['*'], createdAt: new Date() });
    const ov = await request(app).get('/api/platform/channex/overview').expect(200);
    expect(ov.body.data).toMatchObject({ environment: 'staging', configured: true, globalEnabled: true, webhookSecretConfigured: false, workers: { running: false } });
    expect(JSON.stringify(ov.body)).not.toContain('fake-key');

    const list = await request(app).get('/api/platform/channex/tenants').expect(200);
    const a = list.body.data.tenants.find((t: any) => t.slug === 'hotel-a');
    const b = list.body.data.tenants.find((t: any) => t.slug === 'villa-b');
    expect(a).toMatchObject({ property: { status: 'active', channexPropertyId: 'cx-prop-a', pushesPaused: false }, pendingOutbox: 0, openCriticalAlerts: 0 });
    expect(b).toMatchObject({ property: { channexPropertyId: 'cx-prop-b', lastError: 'Channex unreachable (503)', consecutiveFailures: 3 }, pendingOutbox: 1 });
    await ChannelAriChange.collection.deleteMany({});
  });

  itDb('webhook setup: signing key (secret shown once, not stored), global webhook, test delivery', async () => {
    await request(app).post('/api/platform/channex/signing-key').send({}).expect(400);
    const key = await request(app).post('/api/platform/channex/signing-key').send({ billingAccountId: '11111111-2222-3333-4444-555555555555' }).expect(200);
    expect(key.headers['cache-control']).toBe('no-store');
    expect(key.body.data).toMatchObject({ signingKeyId: 'sk-123', secret: 'shown-once-secret' });
    expect(JSON.stringify(await PlatformSettings.collection.findOne({ key: 'global' }))).not.toContain('shown-once-secret');

    const wh = await request(app).put('/api/platform/channex/webhook').send({}).expect(200);
    expect(wh.body.data).toMatchObject({ webhookId: 'wh-9', created: true });
    const posted = calls.find((c) => c.method === 'POST' && c.path === '/api/v1/webhooks')!;
    expect(posted.body.webhook).toMatchObject({ is_global: true, is_signed: true, signing_key_id: 'sk-123', callback_url: 'https://pilloto-test.trycloudflare.com/api/webhooks/channex' });
    const test = await request(app).post('/api/platform/channex/webhook/test').expect(200);
    expect(test.body.data.result).toMatchObject({ status_code: 200 });
    const ov = await request(app).get('/api/platform/channex/overview').expect(200);
    expect(ov.body.data.webhook).toMatchObject({ webhookId: 'wh-9', signingKeyId: 'sk-123' });
  });

  itDb('repair screen: a broken mapping is shown and re-linked to the right Channex rate plan', async () => {
    const view = await request(app).get(`/api/platform/channex/tenants/${tenantA}/repair`).expect(200);
    const row = view.body.data.rows.find((r: any) => r.kind === 'rate_plan');
    expect(row).toMatchObject({ channexId: 'cx-rp-gone', problems: ['missing_in_channex'] });
    expect(view.body.data.unlinked.ratePlans).toEqual([{ id: 'cx-rp-a1', title: 'Best Available Rate', roomTypeId: 'cx-rt-a', occupancies: [1, 2] }]);

    // Another property's rate plan is refused; so is an unknown kind
    await request(app).post(`/api/platform/channex/tenants/${tenantA}/repair/relink`).send({ kind: 'rate_plan', localId: String(rpA), channexId: 'cx-rp-b1' }).expect(400);
    await request(app).post(`/api/platform/channex/tenants/${tenantA}/repair/relink`).send({ kind: 'room', localId: String(rpA), channexId: 'cx-rp-a1' }).expect(400);

    const relinked = await request(app).post(`/api/platform/channex/tenants/${tenantA}/repair/relink`).send({ kind: 'rate_plan', localId: String(rpA), channexId: 'cx-rp-a1' }).expect(200);
    expect(relinked.body.data.view.rows.find((r: any) => r.kind === 'rate_plan')).toMatchObject({ channexId: 'cx-rp-a1', status: 'active', problems: [] });
    expect(await ChannexEntityMap.collection.findOne({ localId: rpA })).toMatchObject({ channexId: 'cx-rp-a1', syncedSnapshot: { occupancyOptions: [1, 2] } });
    // The re-linked plan's rates go out over the whole window through the outbox
    expect(await ChannelAriChange.collection.countDocuments({ tenantId: tenantA, kind: 'rates', ratePlanId: rpA, reason: 'manual:repair' })).toBe(1);
    await tick();
    const restrictions = pushes().filter((c) => c.path === '/api/v1/restrictions');
    expect(restrictions).toHaveLength(1);
    expect(restrictions[0].body.values.every((v: any) => v.rate_plan_id === 'cx-rp-a1')).toBe(true);
    expect(await ChannelAriChange.collection.countDocuments({ status: 'pending' })).toBe(0);
  });

  itDb('pause and resume pushes; full sync while paused is held, then sent as two calls', async () => {
    calls.length = 0;
    await request(app).post(`/api/platform/channex/tenants/${tenantA}/pause`).expect(200);
    expect((await request(app).get('/api/platform/channex/tenants')).body.data.tenants.find((t: any) => t.slug === 'hotel-a').property.pushesPaused).toBe(true);
    await ChannexProperty.collection.updateOne({ tenantId: tenantA }, { $unset: { lastFullSyncAt: '' } });
    const fs = await request(app).post(`/api/platform/channex/tenants/${tenantA}/full-sync`).expect(200);
    expect(fs.body.data.queued).toBe(2);
    expect(await tick()).toEqual([]);
    expect(pushes()).toHaveLength(0);
    expect(await ChannelAriChange.collection.countDocuments({ tenantId: tenantA, status: 'pending' })).toBe(2);

    const resumed = await request(app).post(`/api/platform/channex/tenants/${tenantA}/resume`).expect(200);
    expect(resumed.body.data).toMatchObject({ pushesPaused: false, pending: 2 });
    expect(await tick()).toEqual([String(tenantA)]);
    expect(pushes().map((c) => c.path).sort()).toEqual(['/api/v1/availability', '/api/v1/restrictions']);
    const logs = await request(app).get(`/api/platform/channex/tenants/${tenantA}/sync-activity`).expect(200);
    expect(logs.body.data.logs.filter((l: any) => l.trigger === 'full_sync').every((l: any) => l.taskIds.length === 1)).toBe(true);
    await request(app).post(`/api/platform/channex/tenants/${tenantA}/full-sync`).expect(409); // 10-minute guard
  });

  itDb('kill switch: turned off and on from the console (validated)', async () => {
    await request(app).put('/api/platform/channex/settings').send({ globalEnabled: 'no' }).expect(400);
    const off = await request(app).put('/api/platform/channex/settings').send({ globalEnabled: false }).expect(200);
    expect(off.body.data.globalEnabled).toBe(false);
    expect((await request(app).get('/api/platform/channex/overview')).body.data.globalEnabled).toBe(false);
    await request(app).put('/api/platform/channex/settings').send({ globalEnabled: true }).expect(200);
  });

  itDb('platform alerts are listed and resolvable; tenant alerts come with raw details per tenant', async () => {
    await raiseAlert({ type: 'unknown_property', dedupeKey: 'cx-prop-zzz', title: 'Channex sent a booking for a property no tenant owns', details: { propertyId: 'cx-prop-zzz' } });
    await mongoose.connection.collection('channelalerts').insertOne({ tenantId: tenantB, type: 'sync_error', severity: 'critical', status: 'open', dedupeKey: 'ch', title: 't', details: { payload: { raw: 'Channex raw error' } }, occurrences: 1, createdAt: new Date(), updatedAt: new Date() });
    const list = await request(app).get('/api/platform/channex/alerts').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ type: 'unknown_property', details: { propertyId: 'cx-prop-zzz' } });
    await request(app).post(`/api/platform/channex/alerts/${list.body.data[0]._id}/resolve`).send({ notes: 'test property' }).expect(200);
    expect((await request(app).get('/api/platform/channex/alerts')).body.data).toHaveLength(0);

    const tenantAlerts = await request(app).get(`/api/platform/channex/tenants/${tenantB}/alerts`).expect(200);
    expect(tenantAlerts.body.data).toHaveLength(1);
    expect(tenantAlerts.body.data[0].details.payload.raw).toBe('Channex raw error');
    expect((await request(app).get('/api/platform/channex/tenants')).body.data.tenants.find((t: any) => t.slug === 'villa-b').openCriticalAlerts).toBe(1);
  });

  itDb('recreate rate plans for a room type after a capacity change: old plan closed if Channex keeps it, alert moves to "map in channels"', async () => {
    // Channex refuses to delete the mapped plan; creation of the new one is answered by the fake below
    const extra = express.Router();
    extra.delete('/api/v1/rate_plans/:id', (_req, res) => res.status(422).json({ errors: { code: 'validation_error', title: 'Rate plan is mapped to a channel' } }));
    extra.post('/api/v1/rate_plans', (_req, res) => res.json({ data: { id: 'cx-rp-a2', type: 'rate_plan', attributes: {} } }));
    (fake as any)._router.stack.splice((fake as any)._router.stack.length - 1, 0, ...(extra as any).stack);
    await ChannexEntityMap.collection.updateOne({ localId: rpA }, { $set: { status: 'remap_required' } });
    await raiseAlert({ type: 'remap_required', dedupeKey: `room_type:${rtA}`, title: 'capacity', tenantId: tenantA, details: { name: 'Twin Room' } });
    calls.length = 0;
    const manualLogs = () => ChannexSyncLog.collection.countDocuments({ tenantId: tenantA, trigger: 'manual', kind: 'restrictions' });
    const logsBefore = await manualLogs();
    const r = await request(app).post(`/api/platform/channex/tenants/${tenantA}/repair/recreate-rate-plans`).send({ roomTypeId: String(rtA) }).expect(200);
    expect(r.body.data).toMatchObject({ recreated: 1, closed: 1 });
    const stop = calls.find((c) => c.path === '/api/v1/restrictions')!;
    expect(stop.body.values).toEqual([expect.objectContaining({ property_id: 'cx-prop-a', rate_plan_id: 'cx-rp-a1', stop_sell: true })]);
    expect(await ChannexEntityMap.collection.findOne({ localId: rpA })).toMatchObject({ channexId: 'cx-rp-a2', status: 'active' });
    expect(await manualLogs()).toBe(logsBefore + 1);
    const alerts = await mongoose.connection.collection('channelalerts').find({ tenantId: tenantA, type: 'remap_required' }).toArray();
    expect(alerts.map((a) => [a.dedupeKey, a.status]).sort()).toEqual([[`room_type:${rtA}`, 'resolved'], [`room_type:${rtA}:map`, 'open']]);
  });
});
