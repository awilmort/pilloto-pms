/**
 * Channel manager hardening (plan Phase 9.4; CHANNEX_ARCHITECTURE.md §6–§11):
 *   - every reservations route that changes availability writes availability outbox rows
 *     through change capture (create, update, assign room, check-out early, cancel, delete);
 *   - privacy erasure removes guest data from the booking inbox and raw webhook deliveries;
 *   - logs never contain the API key, the webhook secret or card fields;
 *   - 10 minutes of Channex 5xx: no data loss, pushes resume, `push_failing` raised and
 *     auto-resolved;
 *   - a 20-room-type × 10-plan full sync stays well under Channex's 10 MB request limit.
 * Auth mocked; local Mongo; Channex faked at the client level.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

let mockTenant: any = null;
const userId = new mongoose.Types.ObjectId();
jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: String(userId), _id: userId, role: 'admin', email: 'staff@example.com' }; req.tenant = mockTenant; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
  };
});
jest.mock('../utils/email', () => ({
  sendReservationConfirmationEmail: jest.fn(() => Promise.resolve()),
  sendInvoiceEmail: jest.fn(() => Promise.resolve()),
  sendCorporatePriceRequestEmail: jest.fn(() => Promise.resolve()),
  tenantBaseUrl: () => 'http://hardening.localhost:3000',
}));

// eslint-disable-next-line import/first
import reservationRoutes from '../routes/reservations';
// eslint-disable-next-line import/first
import guestRoutes from '../routes/guests';
// eslint-disable-next-line import/first
import channexWebhookRoutes from '../routes/channexWebhook';
// eslint-disable-next-line import/first
import { tenantLocalStorage } from '../middleware/tenantContext';
// eslint-disable-next-line import/first
import { invalidateChannelManagerCache } from '../services/channex/changeCapture';
// eslint-disable-next-line import/first
import { ariTick, buildRestrictionValues, compressWeekdayRuns, flushProperty } from '../services/channex/ariWorker';
// eslint-disable-next-line import/first
import { ChannexRetryableError, createChannexClient, loggableBody, redactCardData } from '../services/channex/channexClient';
// eslint-disable-next-line import/first
import { computeSignature, dispatchWebhookEvent } from '../services/channex/webhookHandler';
// eslint-disable-next-line import/first
import { scrubRevisionPayload } from '../services/channex/bookingInbox';
// eslint-disable-next-line import/first
import { erasePayload, eraseChannelGuestData } from '../services/channex/privacy';
// eslint-disable-next-line import/first
import { queueFullSync } from '../services/channex/fullSync';
// eslint-disable-next-line import/first
import { runInTenant } from '../services/channex/provisioning';
// eslint-disable-next-line import/first
import { addDays, todayInTz } from '../services/channex/dates';
// eslint-disable-next-line import/first
import { connectTestDb, dropTestDb } from './helpers/testDb';
// eslint-disable-next-line import/first
import AppSettings from '../models/AppSettings';
// eslint-disable-next-line import/first
import ChannelAlert from '../models/ChannelAlert';
// eslint-disable-next-line import/first
import ChannelAriChange from '../models/ChannelAriChange';
// eslint-disable-next-line import/first
import ChannexBookingRevision from '../models/ChannexBookingRevision';
// eslint-disable-next-line import/first
import ChannexEntityMap from '../models/ChannexEntityMap';
// eslint-disable-next-line import/first
import ChannexProperty from '../models/ChannexProperty';
// eslint-disable-next-line import/first
import ChannexWebhookEvent from '../models/ChannexWebhookEvent';
// eslint-disable-next-line import/first
import Guest from '../models/Guest';
// eslint-disable-next-line import/first
import PricingRule from '../models/PricingRule';
// eslint-disable-next-line import/first
import RatePlan from '../models/RatePlan';
// eslint-disable-next-line import/first
import Reservation from '../models/Reservation';
// eslint-disable-next-line import/first
import RestrictionRule from '../models/RestrictionRule';
// eslint-disable-next-line import/first
import Room from '../models/Room';
// eslint-disable-next-line import/first
import RoomType from '../models/RoomType';
// eslint-disable-next-line import/first
import Tenant from '../models/Tenant';

const TZ = 'America/Santo_Domingo';
const noon = (d: string) => new Date(`${d}T12:00:00Z`);

// ─── Pure: log redaction ─────────────────────────────────────────────────────

describe('log redaction (pure)', () => {
  it('masks card fields and card-number-shaped digits; keeps dates, amounts and ids', () => {
    const body = { guarantee: { card_number: '4111111111111111', cvv: '123', cardholder_name: 'Ana Pérez', card_type: 'visa', expiration_date: '12/29' }, amount: '250.00', arrival_date: '2026-12-01', id: '3e8f5809-3a1e-4f80-90a2-38d33e37b317' };
    const text = loggableBody(body, 'secret-key');
    expect(text).not.toContain('4111111111111111');
    expect(text).not.toContain('"123"');
    expect(text).not.toContain('Ana Pérez');
    expect(text).toContain('"card_type":"visa"');
    expect(text).toContain('2026-12-01');
    expect(text).toContain('250.00');
    expect(text).toContain('3e8f5809-3a1e-4f80-90a2-38d33e37b317');
    expect(redactCardData('note: card 4111 1111 1111 1111 exp 12/29')).toBe('note: card [CARD] exp 12/29');
  });
});

// ─── Pure: weekday compression ───────────────────────────────────────────────

describe('weekday-run compression (pure)', () => {
  const DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
  const each = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
  /** Expand values back to date → value (later values win, as in Channex) */
  const expand = (values: Record<string, any>[]) => {
    const out = new Map<string, string>();
    for (const v of values) {
      const { property_id: _p, rate_plan_id: _r, date, date_from, date_to, days, ...rest } = v;
      const dates = date ? [date] : each(date_from, Math.round((Date.parse(date_to) - Date.parse(date_from)) / 86400000) + 1);
      for (const d of dates) if (!days || days.includes(DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()])) out.set(d, JSON.stringify(rest));
    }
    return out;
  };
  const resolved = (rate: number, extra: Record<string, unknown> = {}) => ({ rates: { 1: rate, 2: rate + 1000 }, minStayArrival: 1, maxStay: 0, closedToArrival: false, closedToDeparture: false, stopSell: false, ...extra }) as any;

  it('is exact on random data and on gaps, and never needs value ordering', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let trial = 0; trial < 50; trial++) {
      const start = addDays('2026-11-01', Math.floor(rnd() * 7));
      const dates = each(start, 30 + Math.floor(rnd() * 200)).filter(() => rnd() > 0.05);
      const days: Record<string, any> = {};
      for (const d of dates) days[d] = resolved(10000 + 500 * Math.floor(rnd() * 3), { minStayArrival: rnd() > 0.8 ? 2 : 1 });
      const values = buildRestrictionValues([{ channexPropertyId: 'p', channexRatePlanId: 'r', ranges: [{ dateFrom: dates[0], dateTo: dates[dates.length - 1] }], fields: ['*'], days }]);
      const got = expand(values);
      expect(got.size).toBe(dates.length);
      for (const d of dates) {
        const { property_id: _p, rate_plan_id: _r, date: _d, ...want } = buildRestrictionValues([{ channexPropertyId: 'p', channexRatePlanId: 'r', ranges: [{ dateFrom: d, dateTo: d }], fields: ['*'], days }])[0];
        expect(got.get(d)).toBe(JSON.stringify(want));
      }
      // Reversed order gives the same result: the values never overlap
      expect(expand([...values].reverse())).toEqual(got);
    }
  });

  it('a 500-day weekend pattern takes a few values with `days` instead of ~140 runs', () => {
    const dates = each('2026-11-02', 500);
    const days: Record<string, any> = {};
    for (const d of dates) { const wd = new Date(`${d}T12:00:00Z`).getUTCDay(); days[d] = resolved(wd === 5 || wd === 6 ? 12000 : 10000, { minStayArrival: wd === 5 || wd === 6 ? 2 : 1 }); }
    const values = buildRestrictionValues([{ channexPropertyId: 'p', channexRatePlanId: 'r', ranges: [{ dateFrom: dates[0], dateTo: dates[499] }], fields: ['*'], days }]);
    // 500 days are 71 weeks + 3 days, so Mon–Wed have one week more than Thu/Sun: 3 values
    expect(values.length).toBeLessThanOrEqual(4);
    expect(values.find((v) => (v.days as string[] | undefined)?.join() === 'fr,sa')).toMatchObject({ min_stay_arrival: 2 });
    expect(values.flatMap((v) => (v.days as string[] | undefined) ?? []).sort()).toEqual(['fr', 'mo', 'sa', 'su', 'th', 'tu', 'we']);
    expect(expand(values).size).toBe(500);
    // Short edits keep their plain shape (certification scenarios)
    expect(buildRestrictionValues([{ channexPropertyId: 'p', channexRatePlanId: 'r', ranges: [{ dateFrom: '2026-12-01', dateTo: '2026-12-03' }], fields: ['rate'], days }])
      .every((v) => !('days' in v))).toBe(true);
    expect(compressWeekdayRuns([], () => 1)).toEqual([]);
  });
});

// ─── DB-backed ───────────────────────────────────────────────────────────────

describe('channel manager hardening (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const twin = new mongoose.Types.ObjectId();
  const plan = new mongoose.Types.ObjectId();
  const roomIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
  app.use('/api/reservations', reservationRoutes);
  app.use('/api/guests', guestRoutes);
  const itDb = (name: string, fn: () => Promise<void>, timeout?: number) => it(name, async () => { if (ready) await fn(); }, timeout);
  // POST /api/reservations compares arrival with UTC midnight (pre-existing), so the route tests use the later of both "todays"
  const today = [todayInTz(TZ), new Date().toISOString().slice(0, 10)].sort()[1];
  const day = (n: number) => addDays(today, n);

  /** Availability outbox rows written for a reservation since `since` */
  const availRows = (reservationId: unknown, since: Date) => ChannelAriChange.collection
    .find({ tenantId, kind: 'availability', sourceId: new mongoose.Types.ObjectId(String(reservationId)), createdAt: { $gte: since } }).toArray();
  /** Every night from..to is in some availability row of the room type (rows may split old and new nights) */
  const covers = (rows: any[], from: string, to: string) => {
    const mine = rows.filter((r) => String(r.roomTypeId) === String(twin));
    for (let d = from; d <= to; d = addDays(d, 1)) if (!mine.some((r) => r.dateFrom <= d && r.dateTo >= d)) return false;
    return true;
  };

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_hardening');
    if (!ready) { console.warn('Mongo unreachable — skipping hardening DB tests'); return; }
    mockTenant = { _id: tenantId, products: ['pms'], plan: 'pro' };
    await Tenant.collection.insertOne({ _id: tenantId, name: 'Hardening Hotel', slug: 'hardening', isActive: true, products: ['pms'], plan: 'pro', settings: { currency: 'USD', timezone: TZ } });
    await AppSettings.collection.insertOne({ tenantId, key: 'global', channelManager: { enabled: true, autoAssignRooms: true } });
    await RoomType.collection.insertOne({ _id: twin, tenantId, name: 'Twin Room', capacity: 2, isActive: true });
    await RatePlan.collection.insertOne({ _id: plan, tenantId, name: 'BAR', roomTypeId: twin, basePrice: 100, isActive: true, occupancyTiers: [] });
    await Room.collection.insertMany(roomIds.map((_id, i) => ({ _id, tenantId, name: `T${i + 1}`, description: 'Twin', bedConfiguration: '2 twin beds', images: [], roomTypeId: twin, status: 'active', condition: 'clean', capacity: 2 })));
    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', status: 'active', channexPropertyId: 'cx-prop-h', timezone: TZ, currency: 'USD', pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0, pushesPaused: false });
    await ChannexEntityMap.collection.insertMany([
      { tenantId, environment: 'staging', kind: 'room_type', localId: twin, channexId: 'cx-rt-h', channexPropertyId: 'cx-prop-h', status: 'active' },
      { tenantId, environment: 'staging', kind: 'rate_plan', localId: plan, channexId: 'cx-rp-h', channexPropertyId: 'cx-prop-h', status: 'active' },
    ]);
    invalidateChannelManagerCache();
  });
  afterAll(async () => { if (ready) await dropTestDb(); });

  // ── Change capture on every reservations route ──

  describe('reservations routes → availability outbox', () => {
    let id: string;

    itDb('create (POST /api/reservations)', async () => {
      const since = new Date();
      const res = await request(app).post('/api/reservations').set('Authorization', 'Bearer test').send({
        type: 'room', rooms: [String(roomIds[0])], checkInDate: day(0), checkOutDate: day(3),
        guestName: { firstName: 'Ana', lastName: 'Pérez' }, contactInfo: { email: 'ana@example.com', phone: '8095550000' },
        guestDetails: { adults: 2, children: 0, infants: 0 },
      });
      if (res.status !== 201) throw new Error(`create: ${res.status} ${JSON.stringify(res.body)}`);
      id = String(res.body.data._id);
      expect(covers(await availRows(id, since), day(0), day(2))).toBe(true);
    });

    itDb('update dates (PUT /api/reservations/:id): old ∪ new nights', async () => {
      const since = new Date();
      const res = await request(app).put(`/api/reservations/${id}`).send({ checkInDate: day(1), checkOutDate: day(5) });
      expect(res.status).toBe(200);
      expect(covers(await availRows(id, since), day(0), day(4))).toBe(true);
    });

    itDb('assign room (PUT /api/reservations/:id/assign-room)', async () => {
      const since = new Date();
      const res = await request(app).put(`/api/reservations/${id}/assign-room`).send({ roomId: String(roomIds[1]) });
      expect(res.status).toBe(200);
      expect(covers(await availRows(id, since), day(1), day(4))).toBe(true);
    });

    itDb('check-out early (PATCH check-in, then check-out): the remaining nights are freed', async () => {
      // Arrival moved back to today so it can be checked in
      await request(app).put(`/api/reservations/${id}`).send({ checkInDate: day(0), checkOutDate: day(4) }).expect(200);
      const checkedIn = await request(app).patch(`/api/reservations/${id}/check-in`).send({ identificationDocument: 'P1234567', identificationType: 'pasaporte' });
      expect(checkedIn.status).toBe(200);
      const since = new Date();
      const out = await request(app).patch(`/api/reservations/${id}/check-out`).send({ checkOutAt: new Date().toISOString(), forceCheckout: true });
      if (out.status === 400 && out.body?.data?.balance !== undefined) {
        // PMS-only tenant with a balance: settle it, then check out
        const paid = await request(app).post(`/api/reservations/${id}/payments`).send({ amount: out.body.data.balance, method: 'cash' });
        expect([200, 201]).toContain(paid.status);
        await request(app).patch(`/api/reservations/${id}/check-out`).send({ checkOutAt: new Date().toISOString() }).expect(200);
      } else {
        expect(out.status).toBe(200);
      }
      expect((await Reservation.collection.findOne({ _id: new mongoose.Types.ObjectId(id) }))!.status).toBe('completed');
      expect(covers(await availRows(id, since), day(1), day(3))).toBe(true);
    });

    itDb('cancel (PATCH /api/reservations/:id/status)', async () => {
      const created = await request(app).post('/api/reservations').set('Authorization', 'Bearer test').send({
        type: 'room', rooms: [String(roomIds[2])], checkInDate: day(10), checkOutDate: day(12),
        guestName: { firstName: 'Luis', lastName: 'Gómez' }, contactInfo: { email: 'luis@example.com' }, guestDetails: { adults: 1, children: 0, infants: 0 },
      }).expect(201);
      id = String(created.body.data._id);
      const since = new Date();
      await request(app).patch(`/api/reservations/${id}/status`).send({ status: 'cancelled' }).expect(200);
      expect(covers(await availRows(id, since), day(10), day(11))).toBe(true);
    });

    itDb('delete (DELETE /api/reservations/:id)', async () => {
      const created = await request(app).post('/api/reservations').set('Authorization', 'Bearer test').send({
        type: 'room', rooms: [String(roomIds[2])], checkInDate: day(20), checkOutDate: day(23),
        guestName: { firstName: 'Eva', lastName: 'Ruiz' }, contactInfo: { email: 'eva@example.com' }, guestDetails: { adults: 1, children: 0, infants: 0 },
      }).expect(201);
      const delId = String(created.body.data._id);
      const since = new Date();
      await request(app).delete(`/api/reservations/${delId}`).expect(200);
      expect(covers(await availRows(delId, since), day(20), day(22))).toBe(true);
    });
  });

  // ── Privacy erasure ──

  itDb('privacy erasure: guest data leaves every revision of their bookings and the raw webhooks; amounts and codes stay', async () => {
    const guestId = (await Guest.collection.insertOne({ tenantId, email: 'erase.me@guest.booking.com', firstName: 'Erase', lastName: 'Me' })).insertedId;
    const resId = (await Reservation.collection.insertOne({ tenantId, type: 'room', status: 'confirmed', guestRecord: guestId, channelSource: { provider: 'channex', channexBookingId: 'bk-erase' } })).insertedId;
    const payload = (rev: string, mail?: string) => scrubRevisionPayload({
      booking_id: 'bk-erase', revision_id: rev, ota_reservation_code: '4021', amount: '300.00', currency: 'USD', notes: 'Allergic to nuts, call +1 809 555 0000',
      customer: { name: 'Erase', surname: 'Me', mail: mail ?? 'erase.me@guest.booking.com', phone: '+18095550000', address: 'Calle 1' },
      rooms: [{ room_type_id: 'cx-rt-h', amount: '300.00', guests: [{ name: 'Erase', surname: 'Me' }] }],
      guarantee: { card_type: 'visa', last4: '1111', card_number: '4111111111111111', cardholder_name: 'Erase Me' },
    } as any);
    await ChannexBookingRevision.collection.insertMany([
      { tenantId, channexRevisionId: 'rv-e1', channexBookingId: 'bk-erase', payload: payload('rv-e1'), processing: 'applied', source: 'feed', reservationId: resId, attempts: 0 },
      { tenantId, channexRevisionId: 'rv-e2', channexBookingId: 'bk-erase', payload: payload('rv-e2', 'changed@guest.booking.com'), processing: 'applied', source: 'feed', attempts: 0 },
      { tenantId, channexRevisionId: 'rv-other', channexBookingId: 'bk-other', payload: { customer: { name: 'Keep', mail: 'keep@x.com' } }, processing: 'applied', source: 'feed', attempts: 0 },
    ]);
    await ChannexWebhookEvent.collection.insertMany([
      { event: 'booking', payload: { event: 'booking', payload: { booking_id: 'bk-erase', revision_id: 'rv-e1' } }, receivedAt: new Date() },
      { event: 'booking', payload: { event: 'booking', payload: { booking_id: 'bk-other' } }, receivedAt: new Date() },
    ]);
    // Card data never reached the inbox in the first place
    expect(JSON.stringify(payload('x'))).not.toMatch(/4111111111111111|cardholder/);

    await request(app).delete(`/api/guests/${guestId}`).expect(200);
    const rows = await ChannexBookingRevision.collection.find({ channexBookingId: 'bk-erase' }).toArray();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      const text = JSON.stringify(r.payload);
      expect(text).not.toMatch(/erase\.me|changed@|Erase|\+18095550000|Calle 1|Allergic/);
      expect(r.payload).toMatchObject({ ota_reservation_code: '4021', amount: '300.00', guarantee: { card_type: 'visa', last4: '1111' } });
      expect(r.erasedAt).toBeInstanceOf(Date);
    }
    expect((await ChannexBookingRevision.collection.findOne({ channexRevisionId: 'rv-other' }))!.payload.customer.mail).toBe('keep@x.com');
    expect(await ChannexWebhookEvent.collection.countDocuments({ 'payload.payload.booking_id': 'bk-erase' })).toBe(0);
    expect(await ChannexWebhookEvent.collection.countDocuments({ 'payload.payload.booking_id': 'bk-other' })).toBe(1);
    // By email only (privacy request, every tenant): nothing left to match, idempotent
    expect(await eraseChannelGuestData({ email: 'ERASE.ME@guest.booking.com' })).toEqual({ revisions: 0, webhookEvents: 0 });
    expect(erasePayload(undefined)).toBeUndefined();
  });

  // ── Logs ──

  itDb('logs never contain the API key, the webhook secret or card fields', async () => {
    const API_KEY = 'ck_live_SuperSecretKey_123456';
    const SECRET = 'whsec_SuperSecretWebhook_654321';
    const lines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error'] as const).map((k) => jest.spyOn(console, k).mockImplementation((...a: any[]) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }));
    const envBackup = { ...process.env };
    try {
      process.env.CHANNEX_API_KEY = API_KEY;
      process.env.CHANNEX_WEBHOOK_SECRET = SECRET;
      process.env.CHANNEX_ENV = 'staging';
      // A failing Channex call whose request and error body carry the key and a card
      const adapter = async (cfg: any) => {
        const err: any = new Error('Request failed with status code 422');
        err.isAxiosError = true;
        err.config = cfg;
        err.response = { status: 422, data: { errors: { code: 'validation_error', title: `bad key ${API_KEY}`, details: { card_number: '4111111111111111', cvv: '999' } } }, headers: {}, config: cfg };
        throw err;
      };
      const client = createChannexClient({ environment: 'staging', baseUrl: 'https://staging.channex.io', apiKey: API_KEY, workersDisabled: true }, { adapter: adapter as any });
      await client.post('/bookings', { guarantee: { card_number: '5555 5555 5555 4444', cvv: '321' }, api_key_echo: API_KEY }).catch(() => undefined);

      // Webhooks: rejected and accepted deliveries
      const hook = express();
      hook.use('/api/webhooks/channex', channexWebhookRoutes);
      const raw = JSON.stringify({ event: 'booking', property_id: 'cx-prop-h', payload: { booking_id: 'bk-log', revision_id: 'rv-log', guarantee: { card_number: '4111111111111111' } } });
      const ts = String(Math.floor(Date.now() / 1000));
      await request(hook).post('/api/webhooks/channex').set('Content-Type', 'application/json').set('x-hmac-timestamp', ts).set('x-hmac-signature-256', 'deadbeef').send(raw);
      const ok = await request(hook).post('/api/webhooks/channex').set('Content-Type', 'application/json').set('x-hmac-timestamp', ts)
        .set('x-hmac-signature-256', computeSignature(SECRET, ts, Buffer.from(raw))).send(raw);
      expect(ok.status).toBe(200);
      const ev = await ChannexWebhookEvent.findOne({ 'payload.payload.booking_id': 'bk-log' });
      if (ev) await dispatchWebhookEvent(String(ev._id));
    } finally {
      process.env = envBackup;
      spies.forEach((s) => s.mockRestore());
    }
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain(SECRET);
    expect(all).not.toMatch(/4111111111111111|5555 5555 5555 4444|"cvv":"(999|321)"/);
  });

  // ── Downtime ──

  itDb('10 minutes of Channex 5xx: no data loss, pushes resume with current values, push_failing raised then auto-resolved', async () => {
    await ChannelAriChange.deleteMany({});
    await ChannelAlert.deleteMany({});
    await Reservation.collection.deleteMany({});
    await ChannexProperty.collection.updateOne({ tenantId }, { $set: { pausedUntil: new Date(0), consecutiveFailures: 0, ariLeaseUntil: new Date(0) }, $unset: { failingSince: '', lastError: '' } });
    const T0 = Date.now();
    const at = (min: number) => new Date(T0 + min * 60_000);
    const post = jest.fn().mockRejectedValue(new ChannexRetryableError('Channex unreachable (503)', { status: 503 }));
    const client: any = { config: { environment: 'staging' }, post };
    const book = async (min: number, n: number) => {
      // A booking every few minutes during the outage (written like any front-desk booking)
      await runInTenant(tenantId, () => Reservation.create({
        type: 'room', status: 'confirmed', room: roomIds[n], rooms: [roomIds[n]], checkInDate: noon(day(30)), checkOutDate: noon(day(32)),
        guestName: { firstName: `G${n}`, lastName: 'X' }, contactInfo: { email: `g${n}@example.com` }, guests: 1, guestDetails: { adults: 1, children: 0, infants: 0 },
        estimatedTotal: 200, reservationCode: `HARD${n}${T0 % 1000}`,
      }));
      await ChannelAriChange.collection.updateMany({ tenantId, createdAt: { $gte: new Date(T0 - 60_000) } }, { $set: { createdAt: at(min), updatedAt: at(min) } });
    };

    // t=0..10 min: Channex down. Ticks every 30 s, bookings at t=0, 4, 8
    for (let s = 0; s <= 600; s += 30) {
      const min = s / 60;
      if (s === 0) await book(0, 0);
      if (s === 240) await book(4, 1);
      if (s === 480) await book(8, 2);
      await ariTick({ client, now: () => at(min + 0.05) });
    }
    expect(post.mock.calls.length).toBeGreaterThanOrEqual(4); // backoff: retries at ~1, 3, 7 min
    expect(post.mock.calls.length).toBeLessThan(10);
    const failing = await ChannelAlert.collection.findOne({ tenantId, type: 'push_failing' });
    expect(failing).toMatchObject({ status: 'open', severity: 'critical' });
    expect(await ChannelAriChange.collection.countDocuments({ tenantId, status: { $in: ['done', 'failed'] } })).toBe(0); // nothing lost or dropped

    // Channex back: the next allowed tick pushes the CURRENT availability (3 rooms booked → 0) in one call
    post.mockReset();
    post.mockResolvedValue({ data: [{ id: 'task-back' }], meta: {} });
    for (let s = 630; s <= 1200 && post.mock.calls.length === 0; s += 30) await ariTick({ client, now: () => at(s / 60) });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/availability');
    const values = post.mock.calls[0][1].values;
    expect(values.find((v: any) => (v.date ?? v.date_from) <= day(30) && (v.date ?? v.date_to) >= day(30))).toMatchObject({ availability: 0, room_type_id: 'cx-rt-h' });
    expect(await ChannelAriChange.collection.countDocuments({ tenantId, status: 'pending' })).toBe(0);
    expect(await ChannelAlert.collection.findOne({ tenantId, type: 'push_failing' })).toMatchObject({ status: 'resolved', autoResolved: true });
  });

  // ── Payload size ──

  itDb('full sync of 20 room types × 10 rate plans with varied prices and rules stays well under 10 MB', async () => {
    await ChannelAriChange.deleteMany({});
    const bigTenant = new mongoose.Types.ObjectId();
    const types = Array.from({ length: 20 }, (_, i) => ({ _id: new mongoose.Types.ObjectId(), tenantId: bigTenant, name: `Type ${i}`, capacity: 4, isActive: true }));
    const plans = types.flatMap((t, ti) => Array.from({ length: 10 }, (_, pi) => ({
      _id: new mongoose.Types.ObjectId(), tenantId: bigTenant, name: `Plan ${ti}-${pi}`, roomTypeId: t._id, basePrice: 80 + ti * 3 + pi, isActive: true,
      occupancyTiers: [{ guestType: 'adult', guestNumber: 2, price: 15 }, { guestType: 'adult', guestNumber: 3, price: 20 }, { guestType: 'adult', guestNumber: 4, price: 25 }],
    })));
    await RoomType.collection.insertMany(types);
    await Room.collection.insertMany(types.flatMap((t) => Array.from({ length: 5 }, (_, i) => ({ tenantId: bigTenant, name: `${t.name}-${i}`, roomTypeId: t._id, status: 'active' }))));
    await RatePlan.collection.insertMany(plans);
    await ChannexEntityMap.collection.insertMany([
      ...types.map((t, i) => ({ tenantId: bigTenant, environment: 'staging', kind: 'room_type', localId: t._id, channexId: `cx-rt-big-${i}`, channexPropertyId: 'cx-prop-big', status: 'active' })),
      ...plans.map((p, i) => ({ tenantId: bigTenant, environment: 'staging', kind: 'rate_plan', localId: p._id, channexId: `cx-rp-big-${i}`, channexPropertyId: 'cx-prop-big', status: 'active' })),
    ]);
    // Realistic variety: weekend prices all year, three seasons, a calendar adjustment, booking rules
    const rules = [
      { name: 'Weekend', priority: 1, period: { pattern: 'weekly', daysOfWeek: [5, 6] }, adjustment: { target: 'base', model: 'percentage', direction: 'increase', value: 20 } },
      { name: 'High season', priority: 2, startDate: noon(day(40)), endDate: noon(day(160)), adjustment: { target: 'both', model: 'percentage', direction: 'increase', value: 30 } },
      { name: 'Low season', priority: 2, startDate: noon(day(200)), endDate: noon(day(320)), adjustment: { target: 'base', model: 'fixed', direction: 'decrease', value: 15 } },
    ];
    await runInTenant(bigTenant, async () => {
      for (const p of plans) for (const r of rules) {
        await PricingRule.collection.insertOne({ tenantId: bigTenant, ratePlanId: p._id, isActive: true, origin: 'manual', scope: 'all', ...r, createdAt: new Date(), updatedAt: new Date() });
      }
      await RestrictionRule.collection.insertMany([
        { tenantId: bigTenant, name: 'Weekend min 2', origin: 'manual', scope: 'property', roomTypeIds: [], ratePlanIds: [], days: ['fr', 'sa'], dateStart: day(0), dateEnd: day(499), minStayArrival: 2, isActive: true, createdAt: new Date(), updatedAt: new Date() },
        { tenantId: bigTenant, name: 'Closed Xmas', origin: 'manual', scope: 'property', roomTypeIds: [], ratePlanIds: [], days: [], dateStart: day(50), dateEnd: day(53), stopSell: true, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      ]);
    });
    const propertyId = (await ChannexProperty.collection.insertOne({ tenantId: bigTenant, environment: 'staging', status: 'active', channexPropertyId: 'cx-prop-big', timezone: TZ, currency: 'USD', pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0 })).insertedId;
    const property = (await ChannexProperty.findById(propertyId))!;
    expect(await queueFullSync(property, 'manual')).toBe(220);

    const sizes: Record<string, { bytes: number; values: number }> = {};
    const client: any = {
      config: { environment: 'staging' },
      post: jest.fn(async (path: string, body: any) => { sizes[path] = { bytes: Buffer.byteLength(JSON.stringify(body)), values: body.values.length }; return { data: [{ id: 't' }], meta: {} }; }),
    };
    const started = Date.now();
    const r = await runInTenant(bigTenant, () => flushProperty(property, { client }));
    const ms = Date.now() - started;
    expect(r).toMatchObject({ availabilityCalls: 1, restrictionCalls: 1 });
    // eslint-disable-next-line no-console
    console.log(`[hardening] full sync 20×10: availability ${sizes['/availability'].values} values / ${(sizes['/availability'].bytes / 1024).toFixed(0)} KB, restrictions ${sizes['/restrictions'].values} values / ${(sizes['/restrictions'].bytes / 1024 / 1024).toFixed(2)} MB, ${ms} ms`);
    expect(sizes['/availability'].bytes).toBeLessThan(1024 * 1024);
    expect(sizes['/restrictions'].bytes).toBeLessThan(5 * 1024 * 1024); // "well under" Channex's 10 MB
  }, 120_000);
});
