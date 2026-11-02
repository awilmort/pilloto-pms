/**
 * Channex webhook (plan Phase 7.1): HMAC verification over the raw body, the route mounted
 * before express.json()/resolveTenant, dispatch by event type inside the owning tenant's
 * scope, and the platform webhook-setup actions (Channex client mocked).
 */
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import channexWebhookRoutes from '../routes/channexWebhook';
import { resolveTenant } from '../middleware/tenantContext';
import { computeSignature, dispatchWebhookEvent, recordWebhookEvent, verifyChannexSignature, webhookFacts } from '../services/channex/webhookHandler';
import { createSigningKey, globalWebhookBody, testWebhook, upsertGlobalWebhook, WEBHOOK_EVENT_MASK } from '../services/channex/webhookSetup';
import { ChannexError } from '../services/channex/channexClient';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import ChannelAlert from '../models/ChannelAlert';
import ChannelAriChange from '../models/ChannelAriChange';
import ChannexBookingRevision from '../models/ChannexBookingRevision';
import ChannexEntityMap from '../models/ChannexEntityMap';
import ChannexProperty from '../models/ChannexProperty';
import ChannexWebhookEvent from '../models/ChannexWebhookEvent';
import PlatformSettings from '../models/PlatformSettings';

const SECRET = 'whsec_test_0123456789abcdef';
const OTHER_SECRET = 'whsec_next_fedcba9876543210';
const nowSeconds = () => String(Math.floor(Date.now() / 1000));
const sign = (raw: string, ts: string, secret = SECRET) => computeSignature(secret, ts, Buffer.from(raw));

// ─── Signature (pure) ────────────────────────────────────────────────────────

describe('verifyChannexSignature', () => {
  const raw = '{"event":"booking","property_id":"p-1","payload":{"booking_id":"b-1", "revision_id":"r-1"}}';
  const ts = '1793000000';
  const nowMs = 1793000000 * 1000;
  const base = { rawBody: Buffer.from(raw), timestamp: ts, secret: SECRET, nowMs };

  it('matches the documented algorithm: hex(HMAC_SHA256(secret, "{ts}.{raw}"))', () => {
    const expected = crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
    expect(sign(raw, ts)).toBe(expected);
  });

  it('accepts a correctly signed raw body and returns the key label', () => {
    expect(verifyChannexSignature({ ...base, signatures: sign(raw, ts), keyLabels: '...abcdef' }))
      .toEqual({ ok: true, keyLabel: '...abcdef' });
  });

  it('rejects a re-serialized body (same JSON, different bytes)', () => {
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(reserialized).not.toBe(raw);
    expect(verifyChannexSignature({ ...base, rawBody: Buffer.from(reserialized), signatures: sign(raw, ts) }))
      .toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyChannexSignature({ ...base, signatures: sign(raw, ts, OTHER_SECRET) })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a stale or far-future timestamp (±300 s) even when correctly signed', () => {
    for (const t of [String(1793000000 - 301), String(1793000000 + 301)]) {
      expect(verifyChannexSignature({ ...base, timestamp: t, signatures: sign(raw, t) })).toEqual({ ok: false, reason: 'stale_timestamp' });
    }
    const edge = String(1793000000 - 300);
    expect(verifyChannexSignature({ ...base, timestamp: edge, signatures: sign(raw, edge) }).ok).toBe(true);
  });

  it('a signature cannot be replayed with another timestamp', () => {
    const t2 = String(1793000000 + 10);
    expect(verifyChannexSignature({ ...base, timestamp: t2, signatures: sign(raw, ts) }).ok).toBe(false);
  });

  it('accepts either of two rotation signatures (and labels the matching key)', () => {
    const current = sign(raw, ts, SECRET);
    const pending = sign(raw, ts, OTHER_SECRET);
    const labels = '...cur123,...new456';
    expect(verifyChannexSignature({ ...base, signatures: `${pending}, ${current}`, keyLabels: labels }))
      .toEqual({ ok: true, keyLabel: '...new456' });
    expect(verifyChannexSignature({ ...base, secret: OTHER_SECRET, signatures: `${current},${pending}`, keyLabels: labels }))
      .toEqual({ ok: true, keyLabel: '...new456' });
    expect(verifyChannexSignature({ ...base, signatures: `${pending},${pending}` }).ok).toBe(false);
  });

  it('accepts uppercase hex and rejects missing/garbled headers', () => {
    expect(verifyChannexSignature({ ...base, signatures: sign(raw, ts).toUpperCase() }).ok).toBe(true);
    expect(verifyChannexSignature({ ...base, signatures: undefined })).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifyChannexSignature({ ...base, timestamp: undefined, signatures: sign(raw, ts) })).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifyChannexSignature({ ...base, timestamp: '17930000.5', signatures: 'x' })).toEqual({ ok: false, reason: 'bad_timestamp' });
    expect(verifyChannexSignature({ ...base, signatures: 'deadbeef' })).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('webhookFacts', () => {
  it('reads property, booking, revision, channel and live-feed ids', () => {
    expect(webhookFacts({ event: 'booking', property_id: 'p', payload: { booking_id: 'b', revision_id: 'r', property_id: 'p' } }))
      .toMatchObject({ event: 'booking', propertyId: 'p', bookingId: 'b', revisionId: 'r' });
    expect(webhookFacts({ event: 'disconnect_channel', payload: { property_id: 'p2', channel_id: 'c' } }))
      .toMatchObject({ propertyId: 'p2', channelId: 'c' });
    expect(webhookFacts({ event: 'reservation_request', property_id: 'p', payload: { id: 'lf-1' } }).liveFeedEventId).toBe('lf-1');
    expect(webhookFacts(null).event).toBe('unknown');
  });
});

// ─── Route, dispatch (local Mongo) ───────────────────────────────────────────

/** Same order as index.ts: the Channex route, then express.json(), then resolveTenant. */
function buildApp() {
  const app = express();
  app.use('/api/webhooks/channex', channexWebhookRoutes);
  app.use(express.json());
  app.use('/api', resolveTenant);
  app.post('/api/webhooks/other', (_req, res) => res.json({ reached: true }));
  return app;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Channex webhook (local Mongo)', () => {
  let ready = false;
  const saved = { ...process.env };
  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();
  const PROP_A = '11111111-1111-1111-1111-111111111111';
  const PROP_B = '22222222-2222-2222-2222-222222222222';
  const PROP_PROD = '33333333-3333-3333-3333-333333333333';
  const app = buildApp();

  const post = (body: unknown, opts: { raw?: string; secret?: string; ts?: string; host?: string } = {}) => {
    const raw = opts.raw ?? JSON.stringify(body);
    const ts = opts.ts ?? nowSeconds();
    return request(app).post('/api/webhooks/channex')
      .set('Host', opts.host ?? 'no-such-hotel.localhost')
      .set('Content-Type', 'application/json')
      .set('x-hmac-timestamp', ts)
      .set('x-hmac-signature-256', sign(raw, ts, opts.secret))
      .set('x-hmac-keys-256', '...abcdef')
      .send(raw);
  };
  const deliver = async (body: any) => (await dispatchWebhookEvent(String((await recordWebhookEvent(body))._id)));

  beforeAll(async () => {
    process.env = { ...saved, CHANNEX_ENV: 'staging', CHANNEX_WEBHOOK_SECRET: SECRET };
    ready = await connectTestDb('pilloto_webhook');
    if (!ready) { console.warn('Mongo unreachable — skipping webhook DB tests'); return; }
    await ChannexProperty.collection.insertMany([
      { tenantId: tenantA, environment: 'staging', channexPropertyId: PROP_A, status: 'active', pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0 },
      { tenantId: tenantB, environment: 'staging', channexPropertyId: PROP_B, status: 'active', pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0 },
      { tenantId: tenantB, environment: 'production', channexPropertyId: PROP_PROD, status: 'active', pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0 },
    ]);
    await ChannexEntityMap.collection.insertMany([
      { tenantId: tenantA, environment: 'staging', kind: 'room_type', localId: new mongoose.Types.ObjectId(), channexId: 'rt-a', channexPropertyId: PROP_A, status: 'active' },
      { tenantId: tenantA, environment: 'staging', kind: 'rate_plan', localId: new mongoose.Types.ObjectId(), channexId: 'rp-a', channexPropertyId: PROP_A, status: 'active' },
    ]);
  });
  afterAll(async () => {
    process.env = saved;
    if (ready) await dropTestDb();
  });

  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  itDb('accepts a signed delivery on a Host that would resolve to a bogus tenant, stores it, and enqueues the revision', async () => {
    // Control: the same Host on any other /api route is rejected by resolveTenant
    const control = await request(app).post('/api/webhooks/other').set('Host', 'no-such-hotel.localhost').send({});
    expect(control.status).toBe(404);
    expect(control.body.message).toMatch(/not found/);

    const raw = `{"event":"booking","property_id":"${PROP_A}",  "user_id":null,"timestamp":"2026-10-31T12:00:00Z","payload":{"booking_id":"bk-1","property_id":"${PROP_A}","revision_id":"rev-1"}}`;
    const res = await post(null, { raw });
    expect(res.status).toBe(200);

    const event = await waitFor(() => ChannexWebhookEvent.findOne({ event: 'booking', processedAt: { $exists: true } }).lean());
    expect(event.channexPropertyId).toBe(PROP_A);
    expect(String(event.tenantId)).toBe(String(tenantA));
    expect(event.signatureKeyLabel).toBe('...abcdef');
    expect(event.error).toBeUndefined();

    const rev = await ChannexBookingRevision.collection.findOne({ channexRevisionId: 'rev-1' });
    expect(rev).toMatchObject({ channexBookingId: 'bk-1', channexPropertyId: PROP_A, source: 'webhook', processing: 'received' });
    expect(String(rev!.tenantId)).toBe(String(tenantA));
    expect((await PlatformSettings.findOne({ key: 'global' }).lean())?.channex?.lastWebhookAt).toBeInstanceOf(Date);
  });

  itDb('rejects a re-serialized body, a wrong secret, a stale timestamp, and unsigned requests with 401 (nothing stored)', async () => {
    const before = await ChannexWebhookEvent.countDocuments({});
    const raw = `{"event":"booking",  "property_id":"${PROP_A}"}`;
    const ts = nowSeconds();
    const r1 = await request(app).post('/api/webhooks/channex').set('Content-Type', 'application/json')
      .set('x-hmac-timestamp', ts).set('x-hmac-signature-256', sign(raw, ts)).send(JSON.stringify(JSON.parse(raw)));
    const r2 = await post(null, { raw, secret: OTHER_SECRET });
    const old = String(Math.floor(Date.now() / 1000) - 400);
    const r3 = await post(null, { raw, ts: old });
    const r4 = await request(app).post('/api/webhooks/channex').set('Content-Type', 'application/json').send(raw);
    expect([r1.status, r2.status, r3.status, r4.status]).toEqual([401, 401, 401, 401]);
    expect(await ChannexWebhookEvent.countDocuments({})).toBe(before);
  });

  itDb('answers 503 (so Channex retries) when the secret is not configured, 400 for a signed non-JSON body', async () => {
    delete process.env.CHANNEX_WEBHOOK_SECRET;
    expect((await post({ event: 'booking' })).status).toBe(503);
    process.env.CHANNEX_WEBHOOK_SECRET = SECRET;
    expect((await post(null, { raw: 'not json' })).status).toBe(400);
  });

  itDb('a duplicate booking delivery keeps one inbox row', async () => {
    const body = { event: 'booking', property_id: PROP_A, payload: { booking_id: 'bk-2', revision_id: 'rev-2', property_id: PROP_A } };
    expect(await deliver(body)).toBe('revision_enqueued');
    expect(await deliver(body)).toBe('revision_enqueued');
    expect(await ChannexBookingRevision.collection.countDocuments({ channexRevisionId: 'rev-2' })).toBe(1);
  });

  itDb('a booking for an unknown property (or another environment) raises one platform alert and enqueues nothing', async () => {
    for (const pid of ['99999999-9999-9999-9999-999999999999', PROP_PROD]) {
      const body = { event: 'booking', property_id: pid, payload: { booking_id: `bk-${pid}`, revision_id: `rev-${pid}`, property_id: pid } };
      expect(await deliver(body)).toBe('unknown_property');
      expect(await ChannexBookingRevision.collection.countDocuments({ channexRevisionId: `rev-${pid}` })).toBe(0);
      const alert = await ChannelAlert.collection.findOne({ type: 'unknown_property', dedupeKey: pid });
      expect(alert).toMatchObject({ severity: 'critical', status: 'open' });
      expect(alert!.tenantId).toBeUndefined();
    }
    const ev = await ChannexWebhookEvent.findOne({ channexPropertyId: PROP_PROD }).lean();
    expect(ev?.error).toMatch(/No Pilloto tenant/);
  });

  itDb('channel events raise alerts in the owning tenant only; activate_channel resolves them and queues a full sync', async () => {
    const body = { event: 'disconnect_channel', property_id: PROP_A, payload: { property_id: PROP_A, channel_id: 'ch-1' } };
    expect(await deliver(body)).toBe('alert');
    const alert = await ChannelAlert.collection.findOne({ type: 'channel_disconnected', dedupeKey: 'ch-1' });
    expect(String(alert!.tenantId)).toBe(String(tenantA));
    expect(alert!.title).not.toMatch(/channex/i);
    expect(await ChannelAlert.collection.countDocuments({ tenantId: tenantB })).toBe(0);

    expect(await deliver({ event: 'activate_channel', property_id: PROP_A, payload: { channel_id: 'ch-1' } })).toBe('full_sync_queued');
    expect((await ChannelAlert.collection.findOne({ type: 'channel_disconnected', dedupeKey: 'ch-1' }))!.status).toBe('resolved');
    const rows = await ChannelAriChange.collection.find({ tenantId: tenantA, reason: 'full_sync:channel_activated' }).toArray();
    expect(rows.map((r) => r.kind).sort()).toEqual(['availability', 'rates']);
    expect((await ChannexProperty.collection.findOne({ channexPropertyId: PROP_A }))!.lastFullSyncAt).toBeInstanceOf(Date);
  });

  itDb('unmapped bookings enqueue the revision and raise a critical alert; non-acked and sync errors alert', async () => {
    expect(await deliver({ event: 'booking_unmapped_rate', property_id: PROP_B, payload: { booking_id: 'bk-u', revision_id: 'rev-u' } })).toBe('alert');
    expect(await ChannexBookingRevision.collection.countDocuments({ channexRevisionId: 'rev-u', tenantId: tenantB })).toBe(1);
    expect(await ChannelAlert.collection.findOne({ tenantId: tenantB, type: 'unmapped_booking', dedupeKey: 'bk-u' })).toMatchObject({ severity: 'critical' });
    await deliver({ event: 'non_acked_booking', property_id: PROP_B, payload: { booking_id: 'bk-n' } });
    await deliver({ event: 'sync_error', property_id: PROP_B, payload: { channel_id: 'ch-9' } });
    expect(await ChannelAlert.collection.countDocuments({ tenantId: tenantB, type: { $in: ['non_acked_booking', 'sync_error'] } })).toBe(2);
  });

  itDb('Airbnb requests get a 24 h deadline and are resolved by accepted/declined', async () => {
    const t0 = new Date('2026-11-01T10:00:00Z');
    const ev = await recordWebhookEvent({ event: 'reservation_request', property_id: PROP_A, payload: { id: 'lf-7' } });
    expect(await dispatchWebhookEvent(String(ev._id), { now: () => t0 })).toBe('alert');
    const alert = await ChannelAlert.collection.findOne({ type: 'airbnb_reservation_request', dedupeKey: 'lf-7' });
    expect(alert!.dueAt.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(alert!.liveFeedEventId).toBe('lf-7');
    expect(await deliver({ event: 'accepted_reservation', property_id: PROP_A, payload: { id: 'lf-7' } })).toBe('alert_resolved');
    expect((await ChannelAlert.collection.findOne({ _id: alert!._id }))!.status).toBe('resolved');
  });

  itDb('events without a property and unhandled events are only recorded', async () => {
    expect(await deliver({ event: 'test', payload: {} })).toBe('no_property');
    expect(await deliver({ event: 'new_channel', property_id: PROP_A, payload: { channel_id: 'ch-2' } })).toBe('recorded');
  });
});

// ─── Platform webhook setup (client mocked) ──────────────────────────────────

describe('webhook setup actions (local Mongo, client mocked)', () => {
  let ready = false;
  const saved = { ...process.env };
  const BILLING = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const mk = () => ({ post: jest.fn(), put: jest.fn(), paginateAll: jest.fn() }) as any;

  beforeAll(async () => {
    process.env = { ...saved, CHANNEX_ENV: 'staging', CHANNEX_WEBHOOK_URL: 'https://abc.trycloudflare.com/api/webhooks/channex' };
    ready = await connectTestDb('pilloto_webhook_setup');
  });
  afterAll(async () => {
    process.env = saved;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => { if (ready) await PlatformSettings.deleteMany({}); });
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  itDb('createSigningKey returns the secret once and stores only the key id', async () => {
    const c = mk();
    c.post.mockResolvedValue({ data: { id: 'sk-1', type: 'signing_key', attributes: { id: 'sk-1', title: 't', secret: 'the-secret' } } });
    const r: any = await createSigningKey({ billingAccountId: BILLING }, c);
    expect(r).toMatchObject({ ok: true, signingKeyId: 'sk-1', secret: 'the-secret' });
    expect(c.post).toHaveBeenCalledWith('/signing_keys', { signing_key: { title: 'Pilloto staging webhooks', billing_account_id: BILLING } });
    const doc = await PlatformSettings.collection.findOne({ key: 'global' });
    expect(doc!.channex.signingKeyId).toBe('sk-1');
    expect(JSON.stringify(doc)).not.toContain('the-secret');
    expect(await createSigningKey({}, c)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  itDb('upsertGlobalWebhook requires a URL and a key, creates once, then updates the stored webhook', async () => {
    const c = mk();
    expect(await upsertGlobalWebhook({}, c)).toMatchObject({ ok: false, reason: 'missing_prerequisite' });
    await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'channex.signingKeyId': 'sk-1' } }, { upsert: true });

    c.paginateAll.mockResolvedValue([]);
    c.post.mockResolvedValue({ data: { id: 'wh-1' } });
    expect(await upsertGlobalWebhook({}, c)).toMatchObject({ ok: true, webhookId: 'wh-1', created: true });
    const body = globalWebhookBody('https://abc.trycloudflare.com/api/webhooks/channex', 'sk-1');
    expect(c.post).toHaveBeenCalledWith('/webhooks', body);
    expect(body.webhook).toMatchObject({ property_id: null, is_global: true, send_data: true, is_signed: true, is_active: true, event_mask: WEBHOOK_EVENT_MASK });
    expect(WEBHOOK_EVENT_MASK.split(';')).toHaveLength(20);
    expect(WEBHOOK_EVENT_MASK).not.toMatch(/(^|;)ari(;|$)/);

    c.post.mockClear();
    expect(await upsertGlobalWebhook({}, c)).toMatchObject({ ok: true, webhookId: 'wh-1', created: false });
    expect(c.put).toHaveBeenCalledWith('/webhooks/wh-1', body);
    expect(c.post).not.toHaveBeenCalled();
  });

  itDb('a stored webhook deleted in Channex is replaced by one already registered for the same URL', async () => {
    const c = mk();
    await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'channex.signingKeyId': 'sk-1', 'channex.webhookId': 'gone' } }, { upsert: true });
    c.put.mockRejectedValueOnce(new ChannexError('not found', { status: 404 })).mockResolvedValue({});
    c.paginateAll.mockResolvedValue([
      { id: 'wh-other', is_global: true, callback_url: 'https://elsewhere/x' },
      { id: 'wh-2', is_global: true, callback_url: 'https://abc.trycloudflare.com/api/webhooks/channex' },
    ]);
    expect(await upsertGlobalWebhook({}, c)).toMatchObject({ ok: true, webhookId: 'wh-2', created: false });
    expect((await PlatformSettings.collection.findOne({ key: 'global' }))!.channex.webhookId).toBe('wh-2');
  });

  itDb('testWebhook needs a webhook and relays what Channex reports', async () => {
    const c = mk();
    expect(await testWebhook(c)).toMatchObject({ ok: false, reason: 'missing_prerequisite' });
    await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'channex.webhookId': 'wh-1' } }, { upsert: true });
    c.post.mockResolvedValue({ data: { attributes: { status_code: 200, body: '{"success":true}' } } });
    expect(await testWebhook(c)).toMatchObject({ ok: true, result: { status_code: 200 } });
    expect(c.post).toHaveBeenCalledWith('/webhooks/wh-1/test');
  });
});
