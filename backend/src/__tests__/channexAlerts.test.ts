/**
 * Channel alerts (services/channex/alerts.service.ts, plan Phase 9.1): catalog, transitions,
 * white-label views, dedupe/reopen, auto-resolve (`push_failing`, `unmapped_booking`,
 * `non_acked_booking`), the email digest (one per 15 minutes per tenant), and producing the
 * alert types other suites do not (webhook channel events, Airbnb alteration/inquiry,
 * structural sync, push failures). Local Mongo; Channex mocked.
 */
import mongoose from 'mongoose';
import {
  ALERT_DEFINITIONS, alertAction, alertFilter, alertSummary, airbnbRequestFacts, listTenantAlerts, nextStatus, providerMessages, raiseAlert,
  reconcileAlerts, resolveAlerts, scrubProviderText, sendAlertDigests, TENANT_ALERT_TYPES, transitionAlert, EMAIL_DIGEST_INTERVAL_MS,
} from '../services/channex/alerts.service';
import { digestLine, renderChannelAlertDigest } from '../utils/emailTemplates/channelAlertDigest';
import { ariTick, isPushFailing } from '../services/channex/ariWorker';
import { ChannexRetryableError, ChannexValidationError } from '../services/channex/channexClient';
import { dispatchWebhookEvent, recordWebhookEvent } from '../services/channex/webhookHandler';
import { syncStructure } from '../services/channex/structuralSync';
import { runInTenant } from '../services/channex/provisioning';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import { CHANNEL_ALERT_TYPES } from '../models/ChannelAlert';
import ChannelAlert from '../models/ChannelAlert';
import ChannelAriChange from '../models/ChannelAriChange';
import ChannexBookingRevision from '../models/ChannexBookingRevision';
import ChannexChannel from '../models/ChannexChannel';
import ChannexEntityMap from '../models/ChannexEntityMap';
import ChannexProperty from '../models/ChannexProperty';
import RatePlan from '../models/RatePlan';
import Reservation from '../models/Reservation';
import Room from '../models/Room';
import RoomType from '../models/RoomType';
import Tenant from '../models/Tenant';
import User from '../models/User';

// ─── Pure ────────────────────────────────────────────────────────────────────

describe('alert catalog and pure helpers', () => {
  it('every alert type has a definition; platform types are kept apart', () => {
    for (const t of CHANNEL_ALERT_TYPES) expect(ALERT_DEFINITIONS[t]).toBeDefined();
    expect(TENANT_ALERT_TYPES).not.toContain('api_auth_failed');
    expect(TENANT_ALERT_TYPES).not.toContain('unknown_property');
    expect(TENANT_ALERT_TYPES).toHaveLength(CHANNEL_ALERT_TYPES.length - 2);
    // architecture §9.1 severities
    expect(ALERT_DEFINITIONS.overbooking.severity).toBe('critical');
    expect(ALERT_DEFINITIONS.modification_needs_review.severity).toBe('warning');
    expect(ALERT_DEFINITIONS.airbnb_inquiry.severity).toBe('critical');
    expect(ALERT_DEFINITIONS.push_failing).toMatchObject({ severity: 'critical', autoResolves: true });
  });

  it('transitions: open → acknowledged → resolved/dismissed; closed alerts stay closed', () => {
    expect(nextStatus('open', 'acknowledge')).toBe('acknowledged');
    expect(nextStatus('acknowledged', 'acknowledge')).toBeNull();
    expect(nextStatus('open', 'resolve')).toBe('resolved');
    expect(nextStatus('acknowledged', 'dismiss')).toBe('dismissed');
    expect(nextStatus('resolved', 'dismiss')).toBeNull();
    expect(nextStatus('dismissed', 'resolve')).toBeNull();
  });

  it('list filters are validated; platform types cannot be listed by tenants', () => {
    expect(alertFilter({})).toMatchObject({ status: { $in: ['open', 'acknowledged'] } });
    expect(alertFilter({ status: 'resolved', severity: 'critical', type: 'overbooking' })).toMatchObject({ status: 'resolved', severity: 'critical', type: 'overbooking' });
    expect(alertFilter({ status: 'all' })).not.toHaveProperty('status');
    expect(alertFilter({ status: 'nope' })).toHaveProperty('error');
    expect(alertFilter({ type: 'api_auth_failed' })).toHaveProperty('error');
    expect(alertFilter({ severity: 'loud' })).toHaveProperty('error');
  });

  it('provider text is white-labelled: no Channex name, no ids', () => {
    expect(scrubProviderText('Channex rate plan 3e8f5809-3a1e-4f80-90a2-38d33e37b317 rejected by channex.io'))
      .toBe('channel manager rate plan … rejected by channel manager');
    const msgs = providerMessages({ errors: [{ message: 'Rate is below the minimum allowed' }, { title: 'Room 1234-abcd closed' }], id: '3e8f5809-3a1e-4f80-90a2-38d33e37b317' });
    expect(msgs).toEqual(['Rate is below the minimum allowed', 'Room 1234-abcd closed']);
    expect(providerMessages(undefined)).toEqual([]);
  });

  it('every tenant alert type has a screen to go to (reservation types go to the reservation)', () => {
    for (const type of TENANT_ALERT_TYPES) {
      const a = alertAction({ type, reservationId: undefined } as any);
      expect(a.kind).not.toBe('none');
    }
    expect(alertAction({ type: 'overbooking', reservationId: 'abc' } as any)).toEqual({ kind: 'reservation', path: '/admin/reservations?id=abc' });
    expect(alertAction({ type: 'ari_warning' } as any).path).toBe('/admin/pricing?tab=calendar');
    expect(alertAction({ type: 'airbnb_inquiry' } as any)).toEqual({ kind: 'airbnb_request' });
  });

  it('push_failing is due after 5 failures or when the property goes 15 minutes without a push', () => {
    const t0 = new Date('2026-11-01T10:00:00Z');
    const plus = (min: number) => new Date(t0.getTime() + min * 60_000);
    expect(isPushFailing({ failures: 1, failingSince: t0, pausedUntil: plus(1) })).toBe(false);
    expect(isPushFailing({ failures: 3, failingSince: t0, pausedUntil: plus(7) })).toBe(false);
    expect(isPushFailing({ failures: 4, failingSince: t0, pausedUntil: plus(15) })).toBe(true);
    expect(isPushFailing({ failures: 5, failingSince: t0, pausedUntil: plus(2) })).toBe(true);
  });

  it('Airbnb request facts from reservation-request (bms) and inquiry (booking_details) payloads', () => {
    const req = airbnbRequestFacts({ payload: { bms: {
      arrival_date: '2026-12-10', departure_date: '2026-12-13', amount: '450.00', currency: 'USD', ota_reservation_code: 'HMABC',
      customer: { name: 'Ana', surname: 'Pérez' }, rooms: [{ occupancy: { adults: 2, children: 1 }, room_type_id: 'cx-rt' }],
    }, resolved: false } });
    expect(req).toMatchObject({ checkIn: '2026-12-10', checkOut: '2026-12-13', nights: 3, guestName: 'Ana Pérez', adults: 2, children: 1, payout: 450, currency: 'USD', channexRoomTypeId: 'cx-rt', resolved: false });
    const inq = airbnbRequestFacts({ payload: { booking_details: { checkin_date: '2026-12-20', nights: 2, currency: 'USD', guest_name: 'Luis' } } });
    expect(inq).toMatchObject({ checkIn: '2026-12-20', checkOut: '2026-12-22', nights: 2, guestName: 'Luis' });
  });

  it('digest lines and email never name the provider', () => {
    for (const type of TENANT_ALERT_TYPES) expect(digestLine(type, { otaName: 'Booking.com', guestName: 'Ana' })).not.toMatch(/channex/i);
    const mail = renderChannelAlertDigest({ tenantName: 'Hotel', alertsUrl: 'http://h.localhost:3000/admin/channel-alerts', alerts: [{ type: 'overbooking', params: { otaName: 'Airbnb', nights: ['2026-12-01'] }, createdAt: new Date() }] });
    expect(mail.subject).toBe('Alerta del Channel Manager — Hotel');
    expect(mail.html).toContain('/admin/channel-alerts');
    expect(`${mail.html}${mail.text}`).not.toMatch(/channex/i);
  });
});

// ─── DB-backed ───────────────────────────────────────────────────────────────

describe('channel alerts (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const otherTenant = new mongoose.Types.ObjectId();
  const PROP = 'cx-prop-alerts';
  const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const find = (type: string, key?: string) => ChannelAlert.collection.findOne({ type, ...(key ? { dedupeKey: key } : {}) });

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_alerts');
    if (!ready) { console.warn('Mongo unreachable — skipping channel alert DB tests'); return; }
    await Tenant.collection.insertMany([
      { _id: tenantId, name: 'Hotel Alertas', slug: 'alertas', isActive: true, products: ['pms'], settings: { currency: 'USD', timezone: 'America/Santo_Domingo' } },
      { _id: otherTenant, name: 'Otro', slug: 'otro', isActive: true, products: ['pms'] },
    ]);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    if (!ready) return;
    await Promise.all([ChannelAlert.deleteMany({}), ChannexProperty.deleteMany({}), ChannelAriChange.deleteMany({}), Reservation.collection.deleteMany({}),
      ChannexBookingRevision.deleteMany({}), User.collection.deleteMany({}), ChannexChannel.collection.deleteMany({})]);
  });

  itDb('duplicates dedupe: one alert, occurrences counted, acknowledgement kept; a resolved alert reopens', async () => {
    const raise = () => inTenant(() => raiseAlert({ type: 'sync_error', dedupeKey: 'ch-1', title: 'x', channelId: 'ch-1' }));
    expect(await raise()).toBe('created');
    expect(await raise()).toBe('updated');
    expect(await ChannelAlert.collection.countDocuments({})).toBe(1);
    const a = (await find('sync_error'))!;
    expect(a).toMatchObject({ occurrences: 2, status: 'open', emailPending: true, severity: 'critical' });

    expect((await inTenant(() => transitionAlert(String(a._id), 'acknowledge', { notes: 'looking' }))).ok).toBe(true);
    await raise();
    expect(await find('sync_error')).toMatchObject({ status: 'acknowledged', occurrences: 3, notes: 'looking' });

    await inTenant(() => transitionAlert(String(a._id), 'resolve', { notes: 'fixed' }));
    await ChannelAlert.collection.updateOne({ _id: a._id }, { $set: { emailPending: false } });
    expect(await raise()).toBe('reopened');
    expect(await find('sync_error')).toMatchObject({ status: 'open', occurrences: 4, emailPending: true });
    expect((await find('sync_error'))!.resolvedAt).toBeUndefined();
    // Same key in another tenant is another alert
    await runInTenant(otherTenant, () => raiseAlert({ type: 'sync_error', dedupeKey: 'ch-1', title: 'x' }));
    expect(await ChannelAlert.collection.countDocuments({})).toBe(2);
  });

  itDb('staff transitions: invalid ones refused; another tenant\'s alert is not found', async () => {
    await inTenant(() => raiseAlert({ type: 'overbooking', dedupeKey: 'b1', title: 'x' }));
    const a = (await find('overbooking'))!;
    const dismissed = await inTenant(() => transitionAlert(String(a._id), 'dismiss', { notes: 'duplicate', userId: new mongoose.Types.ObjectId() }));
    expect(dismissed.ok).toBe(true);
    expect(await find('overbooking')).toMatchObject({ status: 'dismissed', notes: 'duplicate', emailPending: false });
    expect(await inTenant(() => transitionAlert(String(a._id), 'resolve'))).toMatchObject({ ok: false, reason: 'invalid_transition' });
    expect(await runInTenant(otherTenant, () => transitionAlert(String(a._id), 'resolve'))).toMatchObject({ ok: false, reason: 'not_found' });
  });

  itDb('webhook events produce every channel/property/Airbnb alert type (white-label titles)', async () => {
    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', status: 'active', channexPropertyId: PROP, pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0 });
    const t0 = new Date('2026-11-01T10:00:00Z');
    const cases: [string, Record<string, unknown>, string, string][] = [
      ['sync_warning', { channel_id: 'ch-2', warnings: ['Rate too low'] }, 'sync_warning', 'ch-2'],
      ['rate_error', { channel_id: 'ch-2', error: 'Rate rejected' }, 'rate_error', 'ch-2'],
      ['disconnect_listing', { channel_id: 'ch-3' }, 'listing_disconnected', 'ch-3'],
      ['channel_removal_warning', { channel_id: 'ch-4', expected_removal_date: '2026-12-01' }, 'channel_removal_warning', 'ch-4'],
      ['property_removal_warning', {}, 'property_removal_warning', 'property'],
      ['alteration_request', { id: 'lf-alt', bms: { booking_id: 'bk-a', arrival_date: '2026-12-10', departure_date: '2026-12-12' } }, 'airbnb_alteration_request', 'lf-alt'],
      ['inquiry', { live_feed_event_id: 'lf-inq', booking_details: { checkin_date: '2026-12-20', nights: 2, guest_name: 'Luis' } }, 'airbnb_inquiry', 'lf-inq'],
    ];
    for (const [event, payload, type, key] of cases) {
      const ev = await recordWebhookEvent({ event, property_id: PROP, payload });
      expect(await dispatchWebhookEvent(String(ev._id), { now: () => t0 })).toBe('alert');
      const a = (await ChannelAlert.collection.findOne({ tenantId, type, dedupeKey: key }))!;
      expect(a).toBeTruthy();
      expect(a.title).not.toMatch(/channex/i);
    }
    expect((await find('airbnb_inquiry'))!.dueAt.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    // The tenant list shows them with safe params only
    const list = await inTenant(() => listTenantAlerts({}));
    expect(list.ok && list.alerts.length).toBe(cases.length);
    const json = JSON.stringify(list);
    expect(json).not.toMatch(/channex|cx-prop|lf-alt|lf-inq|bk-a/i);
    const warning = list.ok && list.alerts.find((x) => x.type === 'sync_warning');
    expect(warning && warning.params.messages).toEqual(['Rate too low']);
    expect(list.ok && list.alerts[0].severity).toBe('critical'); // critical first
  });

  itDb('structural sync produces unmap_before_delete (delete refused) and remap_required (capacity change)', async () => {
    const rt = new mongoose.Types.ObjectId();
    const rp = new mongoose.Types.ObjectId();
    const gone = new mongoose.Types.ObjectId();
    await RoomType.collection.insertMany([
      { _id: rt, tenantId, name: 'Twin', capacity: 3, isActive: true },
      { _id: gone, tenantId, name: 'Old Villa', capacity: 2, isActive: false },
    ]);
    await Room.collection.insertOne({ tenantId, name: 'T1', roomTypeId: rt, status: 'active' });
    await RatePlan.collection.insertOne({ _id: rp, tenantId, name: 'BAR', roomTypeId: rt, basePrice: 100, isActive: true, occupancyTiers: [] });
    await ChannexEntityMap.collection.insertMany([
      { tenantId, environment: 'staging', kind: 'room_type', localId: rt, channexId: 'cx-rt', channexPropertyId: PROP, status: 'active', syncedSnapshot: { title: 'Twin', occupancyOptions: [1, 2], countOfRooms: 1 } },
      { tenantId, environment: 'staging', kind: 'rate_plan', localId: rp, channexId: 'cx-rp', channexPropertyId: PROP, status: 'active', syncedSnapshot: { title: 'BAR', occupancyOptions: [1, 2], childrenFee: 0 } },
      { tenantId, environment: 'staging', kind: 'room_type', localId: gone, channexId: 'cx-gone', channexPropertyId: PROP, status: 'active', syncedSnapshot: { title: 'Old Villa', occupancyOptions: [1, 2], countOfRooms: 1 } },
    ]);
    const client: any = {
      config: { environment: 'staging' },
      put: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockRejectedValue(new ChannexValidationError('mapped to a channel', { status: 422 })),
      post: jest.fn(),
    };
    await inTenant(() => syncStructure({ client, property: { channexPropertyId: PROP, currency: 'USD', environment: 'staging' } as any }));
    expect(await find('unmap_before_delete', `room_type:${gone}`)).toMatchObject({ severity: 'warning', status: 'open', details: { name: 'Old Villa' } });
    expect(await find('remap_required', `room_type:${rt}`)).toMatchObject({ severity: 'warning', status: 'open' });

    // Once Channex accepts the delete, unmap_before_delete resolves itself
    client.delete.mockResolvedValue({});
    await inTenant(() => syncStructure({ client, property: { channexPropertyId: PROP, currency: 'USD', environment: 'staging' } as any }));
    expect(await find('unmap_before_delete', `room_type:${gone}`)).toMatchObject({ status: 'resolved', autoResolved: true });
    await Promise.all([RoomType.collection.deleteMany({}), Room.collection.deleteMany({}), RatePlan.collection.deleteMany({}), ChannexEntityMap.collection.deleteMany({})]);
  });

  itDb('push_failing: raised while pushes fail, auto-resolved (with the platform auth alert) by the next successful push', async () => {
    const rt = new mongoose.Types.ObjectId();
    await RoomType.collection.insertOne({ _id: rt, tenantId, name: 'Twin', capacity: 2, isActive: true });
    await Room.collection.insertOne({ tenantId, name: 'T1', roomTypeId: rt, status: 'active' });
    await ChannexEntityMap.collection.insertOne({ tenantId, environment: 'staging', kind: 'room_type', localId: rt, channexId: 'cx-rt', channexPropertyId: PROP, status: 'active' });
    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', status: 'active', channexPropertyId: PROP, timezone: 'America/Santo_Domingo', currency: 'USD', pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0 });
    const T0 = new Date('2026-12-01T15:00:00Z');
    await ChannelAriChange.collection.insertOne({ tenantId, kind: 'availability', roomTypeId: rt, dateFrom: '2026-12-05', dateTo: '2026-12-06', fields: ['*'], status: 'pending', attempts: 0, createdAt: T0, updatedAt: T0 });
    await raiseAlert({ type: 'api_auth_failed', dedupeKey: 'channex', title: 'auth' });
    const post = jest.fn().mockRejectedValue(new ChannexRetryableError('Channex unreachable (503)', { status: 503 }));
    const client: any = { config: { environment: 'staging' }, post };
    const at = (min: number) => new Date(T0.getTime() + min * 60_000);

    // Backoff 1, 2, 4, 8 min: the 4th failure (t=7 min) pauses until t=15 → 15 min without a push
    for (const min of [0.1, 1.2, 3.3, 7.4]) await ariTick({ client, now: () => at(min) });
    expect(post).toHaveBeenCalledTimes(4);
    const alert = (await ChannelAlert.collection.findOne({ tenantId, type: 'push_failing' }))!;
    expect(alert).toMatchObject({ status: 'open', severity: 'critical', details: { failures: 4 } });

    post.mockResolvedValue({ data: [{ id: 'task-ok' }], meta: {} });
    await ariTick({ client, now: () => at(15.5) });
    expect(await ChannelAlert.collection.findOne({ tenantId, type: 'push_failing' })).toMatchObject({ status: 'resolved', autoResolved: true });
    expect(await ChannelAlert.collection.findOne({ type: 'api_auth_failed' })).toMatchObject({ status: 'resolved' });
    expect((await ChannexProperty.collection.findOne({ tenantId }))!.failingSince).toBeUndefined();
    await Promise.all([RoomType.collection.deleteMany({}), Room.collection.deleteMany({}), ChannexEntityMap.collection.deleteMany({})]);
  });

  itDb('unmapped_booking resolves once its reservation has a room; non_acked_booking once every revision is acked', async () => {
    const resId = (await Reservation.collection.insertOne({ tenantId, type: 'room', status: 'confirmed', guestName: { firstName: 'A', lastName: 'B' }, channelSource: { provider: 'channex', channexBookingId: 'bk-1', otaName: 'Booking.com' } })).insertedId;
    await inTenant(() => raiseAlert({ type: 'unmapped_booking', dedupeKey: 'bk-1', title: 'x', reservationId: resId, channexBookingId: 'bk-1' }));
    await inTenant(() => raiseAlert({ type: 'unmapped_booking', dedupeKey: 'bk-2', title: 'x', channexBookingId: 'bk-2' })); // webhook first, no reservation yet
    await inTenant(() => raiseAlert({ type: 'non_acked_booking', dedupeKey: 'bk-1', title: 'x', channexBookingId: 'bk-1' }));
    await ChannexBookingRevision.collection.insertOne({ tenantId, channexRevisionId: 'rev-1', channexBookingId: 'bk-1', processing: 'applied', status: 'new' });

    expect(await inTenant(() => reconcileAlerts())).toBe(0);
    expect((await inTenant(() => alertSummary())).openCritical).toBe(3);

    await Reservation.collection.updateOne({ _id: resId }, { $set: { rooms: [new mongoose.Types.ObjectId()] } });
    await ChannexBookingRevision.collection.updateOne({ channexRevisionId: 'rev-1' }, { $set: { ackedAt: new Date() } });
    const summary = await inTenant(() => alertSummary());
    expect(summary.openCritical).toBe(1); // bk-2 still has no reservation
    expect(await find('unmapped_booking', 'bk-1')).toMatchObject({ status: 'resolved', autoResolved: true });
    expect(await find('non_acked_booking', 'bk-1')).toMatchObject({ status: 'resolved', autoResolved: true });
  });

  itDb('resolveAlerts closes only matching active alerts in the current tenant', async () => {
    await inTenant(() => raiseAlert({ type: 'channel_disconnected', dedupeKey: 'ch-9', title: 'x' }));
    await runInTenant(otherTenant, () => raiseAlert({ type: 'channel_disconnected', dedupeKey: 'ch-9', title: 'x' }));
    expect(await inTenant(() => resolveAlerts({ types: ['channel_disconnected'], dedupeKey: 'ch-9' }))).toBe(1);
    expect(await ChannelAlert.collection.countDocuments({ status: 'open' })).toBe(1);
  });

  itDb('email digest: one email per tenant per 15 minutes, to users who can resolve alerts, critical only', async () => {
    const roleId = new mongoose.Types.ObjectId();
    await User.collection.insertMany([
      { tenantId, email: 'owner@hotel.test', firstName: 'O', role: 'admin', isActive: true, appRoles: [] },
      { tenantId, email: 'frontdesk@hotel.test', firstName: 'F', role: 'staff', isActive: true, appRoles: [{ app: 'pms', role: roleId }] },
      { tenantId, email: 'old@hotel.test', firstName: 'X', role: 'admin', isActive: false, appRoles: [] },
    ]);
    const T0 = new Date('2026-11-01T10:00:00Z');
    const send = jest.fn().mockResolvedValue('id');
    await inTenant(() => raiseAlert({ type: 'overbooking', dedupeKey: 'b1', title: 'x' }, T0));
    await inTenant(() => raiseAlert({ type: 'sync_error', dedupeKey: 'c1', title: 'x' }, T0));
    await inTenant(() => raiseAlert({ type: 'currency_mismatch', dedupeKey: 'b1', title: 'x' }, T0)); // warning: no email

    expect(await sendAlertDigests({ now: T0, send })).toEqual([String(tenantId)]);
    expect(send).toHaveBeenCalledTimes(1); // only the owner (front desk role has no admin.ota.resolve, inactive user skipped)
    expect(send.mock.calls[0][0]).toBe('owner@hotel.test');
    expect(send.mock.calls[0][1].subject).toBe('2 alertas del Channel Manager — Hotel Alertas');

    // A new critical alert 5 minutes later waits for the 15-minute window
    const t5 = new Date(T0.getTime() + 5 * 60_000);
    await inTenant(() => raiseAlert({ type: 'channel_disconnected', dedupeKey: 'c2', title: 'x' }, t5));
    expect(await sendAlertDigests({ now: t5, send })).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    const t16 = new Date(T0.getTime() + EMAIL_DIGEST_INTERVAL_MS + 60_000);
    expect(await sendAlertDigests({ now: t16, send })).toEqual([String(tenantId)]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].subject).toBe('Alerta del Channel Manager — Hotel Alertas');
    // Nothing pending any more
    expect(await sendAlertDigests({ now: new Date(t16.getTime() + EMAIL_DIGEST_INTERVAL_MS), send })).toEqual([]);
  });
});
