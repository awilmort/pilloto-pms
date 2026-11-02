/**
 * Airbnb booking requests (services/channex/airbnbRequests.ts, plan Phase 9.2): the
 * `resolution` payload per request kind, the "already resolved" answer, finding the live feed
 * event when the webhook had no id, errors, the availability preview, and the tenant alert
 * routes (white-label list, staff transitions, answering). Channex client faked; auth mocked.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

let mockTenant: any = null;
const mockUserId = new mongoose.Types.ObjectId();
jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: String(mockUserId), role: 'admin', email: 'gm@hotel.test' }; req.tenant = mockTenant; req.tenantId = mockTenant?._id; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
  };
});
const mockClient: any = { config: { environment: 'staging', baseUrl: 'https://staging.channex.io' }, get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
jest.mock('../services/channex/channexClient', () => {
  const actual = jest.requireActual('../services/channex/channexClient');
  return { ...actual, createChannexClient: () => mockClient };
});

// eslint-disable-next-line import/first
import channelManagerRoutes from '../routes/channelManager';
// eslint-disable-next-line import/first
import { tenantLocalStorage } from '../middleware/tenantContext';
// eslint-disable-next-line import/first
import { answerAirbnbRequest, liveFeedState, requestAvailability, resolutionBody } from '../services/channex/airbnbRequests';
// eslint-disable-next-line import/first
import { ChannexError, ChannexRetryableError, ChannexValidationError } from '../services/channex/channexClient';
// eslint-disable-next-line import/first
import { runInTenant } from '../services/channex/provisioning';
// eslint-disable-next-line import/first
import { connectTestDb, dropTestDb } from './helpers/testDb';
// eslint-disable-next-line import/first
import ChannelAlert from '../models/ChannelAlert';
// eslint-disable-next-line import/first
import ChannexEntityMap from '../models/ChannexEntityMap';
// eslint-disable-next-line import/first
import ChannexProperty from '../models/ChannexProperty';
// eslint-disable-next-line import/first
import Reservation from '../models/Reservation';
// eslint-disable-next-line import/first
import Room from '../models/Room';
// eslint-disable-next-line import/first
import RoomType from '../models/RoomType';

describe('resolutionBody (pure)', () => {
  it('reservation request: accept true; decline false with reason and optional messages', () => {
    expect(resolutionBody('airbnb_reservation_request', { decision: 'accept' })).toEqual({ resolution: { accept: true } });
    expect(resolutionBody('airbnb_reservation_request', { decision: 'decline', reason: 'dates_not_available', messageToGuest: ' Sorry! ', messageToAirbnb: '' }))
      .toEqual({ resolution: { accept: false, reason: 'dates_not_available', decline_message_to_guest: 'Sorry!' } });
    expect(resolutionBody('airbnb_reservation_request', { decision: 'decline' })).toEqual({ resolution: { accept: false, reason: 'not_comfortable' } });
    expect(resolutionBody('airbnb_reservation_request', { decision: 'decline', reason: 'bad_vibes' })).toHaveProperty('error');
  });
  it('alteration request: "accept" / "decline" strings', () => {
    expect(resolutionBody('airbnb_alteration_request', { decision: 'accept' })).toEqual({ resolution: { accept: 'accept' } });
    expect(resolutionBody('airbnb_alteration_request', { decision: 'decline' })).toEqual({ resolution: { accept: 'decline' } });
  });
  it('inquiry: accept = pre-approval; decline sends nothing', () => {
    expect(resolutionBody('airbnb_inquiry', { decision: 'accept' })).toEqual({ resolution: { type: 'preapproval' } });
    expect(resolutionBody('airbnb_inquiry', { decision: 'decline' })).toBeNull();
  });
  it('rejects other alert types and unknown decisions', () => {
    expect(resolutionBody('overbooking', { decision: 'accept' })).toHaveProperty('error');
    expect(resolutionBody('airbnb_inquiry', { decision: 'maybe' as any })).toHaveProperty('error');
  });
  it('reads the live feed event state', () => {
    expect(liveFeedState({ data: { id: 'lf', attributes: { payload: { resolved: true, resolution: 'accepted' } } } })).toEqual({ resolved: true, resolution: 'accepted' });
    expect(liveFeedState({ data: { attributes: { payload: { resolved: false } } } })).toEqual({ resolved: false, resolution: undefined });
    expect(liveFeedState({ data: { attributes: { payload: { status: 'DECLINED' } } } })).toEqual({ resolved: true, resolution: 'declined' });
  });
});

describe('Airbnb requests (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const rt = new mongoose.Types.ObjectId();
  const envBackup = { ...process.env };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
  app.use('/api/channel-manager', channelManagerRoutes);
  const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const bms = { booking_id: 'bk-1', arrival_date: '2026-12-10', departure_date: '2026-12-12', amount: '300.00', currency: 'USD', ota_reservation_code: 'HMXYZ', customer: { name: 'Ana', surname: 'Pérez' }, rooms: [{ room_type_id: 'cx-rt', occupancy: { adults: 2 } }] };
  const makeAlert = (type: string, extra: Record<string, unknown> = {}) => ChannelAlert.create({
    tenantId, type, severity: 'critical', status: 'open', dedupeKey: `k-${Math.random()}`, title: 'Airbnb request',
    liveFeedEventId: 'lf-1', details: { event: type.replace('airbnb_', ''), payload: { bms, resolved: false } }, dueAt: new Date(Date.now() + 3600_000), ...extra,
  });
  const resolved = (resolution: string) => ({ data: { id: 'lf-1', type: 'live_feed_event', attributes: { payload: { resolved: true, resolution } } } });

  beforeAll(async () => {
    process.env.CHANNEX_API_KEY = 'test-key';
    process.env.CHANNEX_ENV = 'staging';
    ready = await connectTestDb('pilloto_airbnb');
    if (!ready) { console.warn('Mongo unreachable — skipping Airbnb request DB tests'); return; }
    mockTenant = { _id: tenantId, name: 'Casa', slug: 'casa', plan: 'pro', products: ['pms'], settings: { timezone: 'America/Santo_Domingo' } };
    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', status: 'active', channexPropertyId: 'cx-prop', pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0 });
    await RoomType.collection.insertOne({ _id: rt, tenantId, name: 'Casita', capacity: 2, isActive: true });
    await Room.collection.insertOne({ tenantId, name: 'C1', roomTypeId: rt, status: 'active' });
    await ChannexEntityMap.collection.insertOne({ tenantId, environment: 'staging', kind: 'room_type', localId: rt, channexId: 'cx-rt', channexPropertyId: 'cx-prop', status: 'active' });
  });
  afterAll(async () => { process.env = envBackup; if (ready) await dropTestDb(); });
  beforeEach(async () => {
    mockClient.get.mockReset();
    mockClient.post.mockReset();
    if (ready) { await ChannelAlert.deleteMany({}); await Reservation.collection.deleteMany({}); }
  });

  itDb('accepting a reservation request sends {accept: true} and resolves the alert with the decision', async () => {
    const a = await makeAlert('airbnb_reservation_request');
    mockClient.post.mockResolvedValue(resolved('accepted'));
    const r = await inTenant(() => answerAirbnbRequest(String(a._id), { decision: 'accept' }, { client: mockClient, userId: mockUserId }));
    expect(r).toEqual({ ok: true, alreadyResolved: false, resolution: 'accepted', sent: true });
    expect(mockClient.post).toHaveBeenCalledWith('/live_feed/lf-1/resolve', { resolution: { accept: true } });
    const doc = (await ChannelAlert.findById(a._id).lean())!;
    expect(doc).toMatchObject({ status: 'resolved', autoResolved: false, details: { decision: { decision: 'accept', sent: true } } });
    expect(String(doc.resolvedBy)).toBe(String(mockUserId));
    // A second answer is refused (closed)
    expect(await inTenant(() => answerAirbnbRequest(String(a._id), { decision: 'decline' }, { client: mockClient }))).toMatchObject({ ok: false, reason: 'closed' });
  });

  itDb('declining an alteration request sends {accept: "decline"}', async () => {
    const a = await makeAlert('airbnb_alteration_request');
    mockClient.post.mockResolvedValue(resolved('declined'));
    await inTenant(() => answerAirbnbRequest(String(a._id), { decision: 'decline' }, { client: mockClient }));
    expect(mockClient.post).toHaveBeenCalledWith('/live_feed/lf-1/resolve', { resolution: { accept: 'decline' } });
  });

  itDb('inquiry: pre-approval is sent; declining sends nothing and only closes the alert', async () => {
    const a = await makeAlert('airbnb_inquiry');
    mockClient.post.mockResolvedValue(resolved('preapproved'));
    expect(await inTenant(() => answerAirbnbRequest(String(a._id), { decision: 'accept' }, { client: mockClient }))).toMatchObject({ ok: true, alreadyResolved: false });
    expect(mockClient.post).toHaveBeenCalledWith('/live_feed/lf-1/resolve', { resolution: { type: 'preapproval' } });
    const b = await makeAlert('airbnb_inquiry');
    mockClient.post.mockReset();
    expect(await inTenant(() => answerAirbnbRequest(String(b._id), { decision: 'decline' }, { client: mockClient }))).toEqual({ ok: true, alreadyResolved: false, sent: false });
    expect(mockClient.post).not.toHaveBeenCalled();
    expect((await ChannelAlert.findById(b._id).lean())!.status).toBe('resolved');
  });

  itDb('already answered on Airbnb: Channex returns the event unchanged → Pilloto records its resolution', async () => {
    const a = await makeAlert('airbnb_reservation_request');
    mockClient.post.mockResolvedValue(resolved('declined'));
    const r = await inTenant(() => answerAirbnbRequest(String(a._id), { decision: 'accept' }, { client: mockClient }));
    expect(r).toEqual({ ok: true, alreadyResolved: true, resolution: 'declined', sent: true });
    expect((await ChannelAlert.findById(a._id).lean())!.details).toMatchObject({ decision: { alreadyResolved: true, resolution: 'declined' } });
  });

  itDb('no live feed id from the webhook: found in the live feed by the OTA code', async () => {
    const a = await makeAlert('airbnb_reservation_request', { liveFeedEventId: undefined });
    mockClient.get.mockResolvedValue({ data: [
      { id: 'lf-other', attributes: { payload: { bms: { ...bms, ota_reservation_code: 'HMOTHER', booking_id: 'x' }, resolved: false } } },
      { id: 'lf-9', attributes: { payload: { bms, resolved: false } } },
    ] });
    mockClient.post.mockResolvedValue(resolved('accepted'));
    await inTenant(() => answerAirbnbRequest(String(a._id), { decision: 'accept' }, { client: mockClient }));
    expect(mockClient.get.mock.calls[0][0]).toBe('/live_feed');
    expect(mockClient.get.mock.calls[0][1]).toMatchObject({ 'filter[property_id]': 'cx-prop', 'filter[event]': 'reservation_request' });
    expect(mockClient.post).toHaveBeenCalledWith('/live_feed/lf-9/resolve', { resolution: { accept: true } });
  });

  itDb('errors: 404 not found, 422 rejected (alert stays open), 503 unavailable', async () => {
    const a = await makeAlert('airbnb_reservation_request');
    mockClient.post.mockRejectedValueOnce(new ChannexError('Not found', { status: 404 }));
    expect(await inTenant(() => answerAirbnbRequest(String(a._id), { decision: 'accept' }, { client: mockClient }))).toMatchObject({ ok: false, reason: 'not_found' });
    mockClient.post.mockRejectedValueOnce(new ChannexValidationError('validation_error', { status: 422, code: 'validation_error' }));
    const rejected = await inTenant(() => answerAirbnbRequest(String(a._id), { decision: 'accept' }, { client: mockClient }));
    expect(rejected).toMatchObject({ ok: false, reason: 'rejected' });
    expect((rejected as any).message).not.toMatch(/channex/i);
    mockClient.post.mockRejectedValueOnce(new ChannexRetryableError('Channex unreachable (503)', { status: 503 }));
    expect(await inTenant(() => answerAirbnbRequest(String(a._id), { decision: 'accept' }, { client: mockClient }))).toMatchObject({ ok: false, reason: 'unavailable' });
    expect((await ChannelAlert.findById(a._id).lean())!.status).toBe('open');
  });

  itDb('availability preview of the requested nights for the mapped room type', async () => {
    await Reservation.collection.insertOne({ tenantId, type: 'room', status: 'confirmed', checkInDate: new Date('2026-12-11T12:00:00Z'), checkOutDate: new Date('2026-12-12T12:00:00Z'),
      items: [{ kind: 'room', roomTypeId: rt, quantity: 1 }], guestName: { firstName: 'X', lastName: 'Y' } });
    const a = await makeAlert('airbnb_reservation_request');
    const av = (await inTenant(() => requestAvailability(a)))!;
    expect(av.nights).toEqual(['2026-12-10', '2026-12-11']);
    expect(av.requestedRoomType).toBe(true);
    expect(av.roomTypes).toEqual([{ roomTypeId: String(rt), name: 'Casita', bookable: false, nights: [{ date: '2026-12-10', available: 1 }, { date: '2026-12-11', available: 0 }] }]);
  });

  itDb('tenant routes: white-label list, detail with availability, staff transitions, answering', async () => {
    const a = await makeAlert('airbnb_reservation_request');
    await ChannelAlert.create({ tenantId, type: 'sync_error', severity: 'critical', dedupeKey: 'ch', title: 't', channelId: 'cx-channel-1', details: { payload: { message: 'Channex says room 3e8f5809-3a1e-4f80-90a2-38d33e37b317 invalid' } } });
    await ChannelAlert.create({ type: 'api_auth_failed', severity: 'critical', dedupeKey: 'channex', title: 'platform' }); // platform alert: never listed

    const list = await request(app).get('/api/channel-manager/alerts').expect(200);
    expect(list.body.data.total).toBe(2);
    const body = JSON.stringify(list.body);
    expect(body).not.toMatch(/channex|cx-prop|cx-rt|cx-channel|lf-1|bk-1|3e8f5809/i);
    expect(list.body.data.alerts.find((x: any) => x.type === 'sync_error').params.messages).toEqual(['channel manager says room … invalid']);

    const summary = await request(app).get('/api/channel-manager/alerts/summary').expect(200);
    expect(summary.body.data).toMatchObject({ openCritical: 2, open: 2 });

    const detail = await request(app).get(`/api/channel-manager/alerts/${a._id}`).expect(200);
    expect(detail.body.data.params).toMatchObject({ guestName: 'Ana Pérez', checkIn: '2026-12-10', payout: 300 });
    expect(detail.body.data.availability.roomTypes[0].name).toBe('Casita');
    expect(detail.body.data.action).toEqual({ kind: 'airbnb_request' });

    const syncId = list.body.data.alerts.find((x: any) => x.type === 'sync_error')._id;
    await request(app).post(`/api/channel-manager/alerts/${syncId}/acknowledge`).send({ notes: 'calling support' }).expect(200);
    const resolvedRes = await request(app).post(`/api/channel-manager/alerts/${syncId}/resolve`).send({}).expect(200);
    expect(resolvedRes.body.data).toMatchObject({ status: 'resolved', notes: 'calling support' });
    await request(app).post(`/api/channel-manager/alerts/${syncId}/resolve`).expect(409);
    await request(app).post(`/api/channel-manager/alerts/${syncId}/explode`).expect(404);

    await request(app).post(`/api/channel-manager/alerts/${a._id}/airbnb-answer`).send({ decision: 'decline', reason: 'nope' }).expect(400);
    mockClient.post.mockResolvedValue(resolved('declined'));
    const answered = await request(app).post(`/api/channel-manager/alerts/${a._id}/airbnb-answer`).send({ decision: 'decline', reason: 'dates_not_available', messageToGuest: 'Lo siento' }).expect(200);
    expect(mockClient.post).toHaveBeenCalledWith('/live_feed/lf-1/resolve', { resolution: { accept: false, reason: 'dates_not_available', decline_message_to_guest: 'Lo siento' } });
    expect(answered.body.data).toMatchObject({ alreadyResolved: false, alert: { status: 'resolved', params: { decision: { decision: 'decline' } } } });
    expect(JSON.stringify(answered.body)).not.toMatch(/lf-1|channex/i);
  });
});
