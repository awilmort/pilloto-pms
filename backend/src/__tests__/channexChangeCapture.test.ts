/**
 * Change capture (services/channex/changeCapture.ts, plan Phase 6.1): one pure suite for the
 * §6.2 derivation table, and a DB-backed suite for the Mongoose hooks (document and query
 * paths, disabled tenants, enqueue failures). The DB suite skips when local Mongo is down.
 */
import mongoose from 'mongoose';
import { AriRow, CaptureLookups, deriveRows, FULL_WINDOW, invalidateChannelManagerCache, onOutboxWrite } from '../services/channex/changeCapture';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import AppSettings from '../models/AppSettings';
import ChannelAriChange from '../models/ChannelAriChange';
import RatePlan from '../models/RatePlan';
import Reservation from '../models/Reservation';
import RestrictionRule from '../models/RestrictionRule';
import Room from '../models/Room';

const lookups = (over: Partial<CaptureLookups> = {}): CaptureLookups => ({ roomTypeOfRoom: { r1: 'twin', r2: 'dbl' }, ratePlans: [], ...over });
const d = (s: string) => new Date(`${s}T12:00:00Z`);
const res = (over: Record<string, unknown> = {}) => ({
  _id: 'res1', type: 'room', status: 'confirmed', checkInDate: d('2026-12-01'), checkOutDate: d('2026-12-04'), room: 'r1', ...over,
});
const avail = (roomTypeId: string, dateFrom: string, dateTo: string): Partial<AriRow> => ({ kind: 'availability', roomTypeId, dateFrom, dateTo, fields: ['*'] });

describe('deriveRows — Reservation', () => {
  it('create → availability for the assigned room type over the nights', () => {
    expect(deriveRows('Reservation', null, res(), lookups())).toMatchObject([avail('twin', '2026-12-01', '2026-12-03')]);
  });

  it('room item without an assigned room → item room type', () => {
    const r = res({ room: undefined, items: [{ kind: 'room', roomTypeId: 'dbl', quantity: 1 }] });
    expect(deriveRows('Reservation', null, r, lookups())).toMatchObject([avail('dbl', '2026-12-01', '2026-12-03')]);
  });

  it('item-level dates win over reservation dates', () => {
    const r = res({ room: undefined, items: [{ kind: 'room', roomTypeId: 'dbl', quantity: 1, checkIn: d('2026-12-02'), checkOut: d('2026-12-03') }] });
    expect(deriveRows('Reservation', null, r, lookups())).toMatchObject([avail('dbl', '2026-12-02', '2026-12-02')]);
  });

  it('date move → old and new nights (not their hull)', () => {
    const rows = deriveRows('Reservation', res(), res({ checkInDate: d('2026-12-20'), checkOutDate: d('2026-12-22') }), lookups());
    expect(rows).toMatchObject([avail('twin', '2026-12-01', '2026-12-03'), avail('twin', '2026-12-20', '2026-12-21')]);
  });

  it('status change to cancelled → the old nights are freed', () => {
    expect(deriveRows('Reservation', res(), res({ status: 'cancelled' }), lookups())).toMatchObject([avail('twin', '2026-12-01', '2026-12-03')]);
  });

  it('room reassignment across types → both types', () => {
    const rows = deriveRows('Reservation', res(), res({ room: 'r2' }), lookups());
    expect(rows.map((r) => r.roomTypeId).sort()).toEqual(['dbl', 'twin']);
  });

  it('delete → freed nights', () => {
    expect(deriveRows('Reservation', res(), null, lookups())).toMatchObject([avail('twin', '2026-12-01', '2026-12-03')]);
  });

  it('irrelevant edits and non-blocking reservations enqueue nothing', () => {
    expect(deriveRows('Reservation', res(), res({ notes: 'late arrival' }), lookups())).toEqual([]);
    expect(deriveRows('Reservation', res({ status: 'cancelled' }), res({ status: 'cancelled', notes: 'x' }), lookups())).toEqual([]);
    expect(deriveRows('Reservation', null, res({ type: 'daypass' }), lookups())).toEqual([]);
  });

  it('pending → checked-in changes nothing', () => {
    expect(deriveRows('Reservation', res({ status: 'pending' }), res({ status: 'checked-in' }), lookups())).toEqual([]);
  });
});

describe('deriveRows — Room, RoomBlock, RoomType', () => {
  it('room create/delete → availability (full window) + structure for its type', () => {
    const room = { _id: 'r9', roomTypeId: 'twin', status: 'active' };
    for (const rows of [deriveRows('Room', null, room, lookups()), deriveRows('Room', room, null, lookups())]) {
      expect(rows).toMatchObject([{ kind: 'availability', roomTypeId: 'twin', ...FULL_WINDOW }, { kind: 'structure', roomTypeId: 'twin' }]);
    }
  });

  it('room status flip and type change cover old and new type', () => {
    const base = { _id: 'r9', roomTypeId: 'twin', status: 'active' };
    expect(deriveRows('Room', base, { ...base, status: 'inactive' }, lookups()).map((r) => r.kind)).toEqual(['availability', 'structure']);
    const moved = deriveRows('Room', base, { ...base, roomTypeId: 'dbl' }, lookups());
    expect(moved.map((r) => r.roomTypeId).sort()).toEqual(['dbl', 'dbl', 'twin', 'twin']);
  });

  it('room edits that do not touch status or type enqueue nothing', () => {
    const base = { _id: 'r9', roomTypeId: 'twin', status: 'active' };
    expect(deriveRows('Room', base, { ...base, condition: 'clean' }, lookups())).toEqual([]);
  });

  it('room block → availability over the blocked nights (end exclusive), old ∪ new', () => {
    const block = { roomId: 'r1', startDate: d('2026-12-10'), endDate: d('2026-12-13') };
    expect(deriveRows('RoomBlock', null, block, lookups())).toMatchObject([avail('twin', '2026-12-10', '2026-12-12')]);
    const moved = deriveRows('RoomBlock', block, { ...block, startDate: d('2026-12-20'), endDate: d('2026-12-21') }, lookups());
    expect(moved).toMatchObject([avail('twin', '2026-12-10', '2026-12-12'), avail('twin', '2026-12-20', '2026-12-20')]);
    expect(deriveRows('RoomBlock', block, null, lookups())).toMatchObject([avail('twin', '2026-12-10', '2026-12-12')]);
  });

  it('room type rename/capacity → structure only; deactivation also availability + rates for its plans', () => {
    const rt = { _id: 'twin', name: 'Twin', capacity: 2, isActive: true };
    const l = lookups({ ratePlans: [{ id: 'bar', roomTypeId: 'twin' }, { id: 'bb', roomTypeId: 'twin' }, { id: 'other', roomTypeId: 'dbl' }] });
    expect(deriveRows('RoomType', rt, { ...rt, name: 'Twin Room' }, l)).toMatchObject([{ kind: 'structure', roomTypeId: 'twin' }]);
    const flip = deriveRows('RoomType', rt, { ...rt, isActive: false }, l);
    expect(flip.map((r) => `${r.kind}:${r.ratePlanId ?? r.roomTypeId}`)).toEqual(['structure:twin', 'availability:twin', 'rates:bar', 'rates:bb']);
    expect(deriveRows('RoomType', rt, { ...rt, description: 'x' }, l)).toEqual([]);
  });

  it('"sell on channels" off/on on a room type → like a deactivation (structure, availability, its plans)', () => {
    const rt = { _id: 'twin', name: 'Twin', capacity: 2, isActive: true };
    const l = lookups({ ratePlans: [{ id: 'bar', roomTypeId: 'twin' }] });
    for (const [before, after] of [[rt, { ...rt, sellOnChannels: false }], [{ ...rt, sellOnChannels: false }, { ...rt, sellOnChannels: true }]]) {
      expect(deriveRows('RoomType', before, after, l).map((r) => `${r.kind}:${r.ratePlanId ?? r.roomTypeId}`)).toEqual(['structure:twin', 'availability:twin', 'rates:bar']);
    }
    // unset (older documents) counts as on
    expect(deriveRows('RoomType', rt, { ...rt, sellOnChannels: true }, l)).toEqual([]);
  });
});

describe('deriveRows — RatePlan, PricingRule, RestrictionRule', () => {
  const plan = { _id: 'bar', name: 'BAR', roomTypeId: 'twin', basePrice: 100, isActive: true, occupancyTiers: [] };

  it('rate plan create → structure + full-window rates; delete → structure', () => {
    expect(deriveRows('RatePlan', null, plan, lookups())).toMatchObject([{ kind: 'structure' }, { kind: 'rates', ...FULL_WINDOW, fields: ['*'] }]);
    expect(deriveRows('RatePlan', plan, null, lookups())).toMatchObject([{ kind: 'structure', ratePlanId: 'bar' }]);
  });

  it('price change → rates [rate]; rename → structure only; deactivation → rate+stop_sell', () => {
    expect(deriveRows('RatePlan', plan, { ...plan, basePrice: 110 }, lookups()).find((r) => r.kind === 'rates')).toMatchObject({ fields: ['rate'], ...FULL_WINDOW });
    expect(deriveRows('RatePlan', plan, { ...plan, name: 'Best' }, lookups()).map((r) => r.kind)).toEqual(['structure']);
    expect(deriveRows('RatePlan', plan, { ...plan, isActive: false }, lookups()).find((r) => r.kind === 'rates')).toMatchObject({ fields: ['rate', 'stop_sell'] });
    expect(deriveRows('RatePlan', plan, { ...plan, description: 'x' }, lookups())).toEqual([]);
  });

  it('"sell on channels" off on a rate plan → structure + rate/stop_sell over the full window', () => {
    const rows = deriveRows('RatePlan', plan, { ...plan, sellOnChannels: false }, lookups());
    expect(rows).toMatchObject([{ kind: 'structure', ratePlanId: 'bar' }, { kind: 'rates', fields: ['rate', 'stop_sell'], ...FULL_WINDOW }]);
  });

  const rule = { _id: 'pr', ratePlanId: 'bar', ruleTarget: 'promotional', dateStart: d('2026-12-10'), dateEnd: d('2026-12-12') };
  it('calendar pricing rule → exactly its own nights, no slack', () => {
    const cal = { ...rule, origin: 'calendar', dateStart: d('2027-11-22'), dateEnd: d('2027-11-22') };
    expect(deriveRows('PricingRule', null, cal, lookups())).toMatchObject([{ kind: 'rates', ratePlanId: 'bar', dateFrom: '2027-11-22', dateTo: '2027-11-22', fields: ['rate'] }]);
    const changed = deriveRows('PricingRule', cal, { ...cal, dateStart: d('2027-11-01'), dateEnd: d('2027-11-10') }, lookups());
    expect(changed.map((r) => `${r.dateFrom}..${r.dateTo}`)).toEqual(['2027-11-22..2027-11-22', '2027-11-01..2027-11-10']);
  });
  it('promotional pricing rule → rate over old ∪ new validity window (with a day of slack)', () => {
    expect(deriveRows('PricingRule', null, rule, lookups())).toMatchObject([{ kind: 'rates', ratePlanId: 'bar', dateFrom: '2026-12-09', dateTo: '2026-12-13', fields: ['rate'] }]);
    const moved = deriveRows('PricingRule', rule, { ...rule, dateStart: d('2026-12-20'), dateEnd: d('2026-12-21') }, lookups());
    expect(moved.map((r) => r.dateFrom)).toEqual(['2026-12-09', '2026-12-19']);
  });

  it('open-ended pricing rule → full window; non-promotional rules are ignored', () => {
    expect(deriveRows('PricingRule', null, { ...rule, dateStart: undefined, dateEnd: undefined }, lookups())).toMatchObject([{ ...FULL_WINDOW }]);
    expect(deriveRows('PricingRule', null, { ...rule, ruleTarget: 'company' }, lookups())).toEqual([]);
  });

  const rr = { _id: 'rr', scope: 'rate_plans', ratePlanIds: ['bar'], dateStart: '2026-12-10', dateEnd: '2026-12-12', minStayArrival: 3, stopSell: true };
  const l = lookups({ ratePlans: [{ id: 'bar', roomTypeId: 'twin' }, { id: 'bb', roomTypeId: 'twin' }, { id: 'other', roomTypeId: 'dbl' }] });
  it('restriction rule → rates for the plans in scope with exactly the fields it sets', () => {
    expect(deriveRows('RestrictionRule', null, rr, l)).toMatchObject([{ kind: 'rates', ratePlanId: 'bar', dateFrom: '2026-12-10', dateTo: '2026-12-12', fields: ['min_stay_arrival', 'stop_sell'] }]);
  });

  it('restriction scopes: room types and whole property', () => {
    expect(deriveRows('RestrictionRule', null, { ...rr, scope: 'room_types', roomTypeIds: ['twin'] }, l).map((r) => r.ratePlanId)).toEqual(['bar', 'bb']);
    expect(deriveRows('RestrictionRule', null, { ...rr, scope: 'property' }, l).map((r) => r.ratePlanId)).toEqual(['bar', 'bb', 'other']);
  });

  it('restriction rule edit covers old ∪ new scope and range; deleting covers the old one', () => {
    const moved = deriveRows('RestrictionRule', rr, { ...rr, ratePlanIds: ['bb'], dateStart: '2026-12-20', dateEnd: '2026-12-21', minStayArrival: undefined }, l);
    expect(moved.map((r) => `${r.ratePlanId}:${r.dateFrom}`).sort()).toEqual(['bar:2026-12-10', 'bar:2026-12-20', 'bb:2026-12-10', 'bb:2026-12-20']);
    expect(moved[0].fields).toEqual(['min_stay_arrival', 'stop_sell']);
    expect(deriveRows('RestrictionRule', rr, null, l)).toHaveLength(1);
  });
});

// ─── DB-backed hooks ─────────────────────────────────────────────────────────

describe('change capture hooks (local Mongo)', () => {
  let ready = false;
  const on = new mongoose.Types.ObjectId();
  const off = new mongoose.Types.ObjectId();
  const twin = new mongoose.Types.ObjectId();
  const dbl = new mongoose.Types.ObjectId();
  const roomTwin = new mongoose.Types.ObjectId();
  const roomDbl = new mongoose.Types.ObjectId();
  const Outbox: any = ChannelAriChange;

  const resDoc = (tenantId: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) => ({
    _id: new mongoose.Types.ObjectId(), tenantId, type: 'room', status: 'confirmed', room: roomTwin,
    checkInDate: d('2026-12-01'), checkOutDate: d('2026-12-04'), ...extra,
  });
  const rows = (tenantId: mongoose.Types.ObjectId) => Outbox.find({ tenantId }).sort({ createdAt: 1, _id: 1 }).lean();

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_capture');
    if (!ready) { console.warn('Mongo unreachable — skipping change-capture hook tests'); return; }
    await AppSettings.collection.insertMany([
      { tenantId: on, key: 'global', channelManager: { enabled: true } },
      { tenantId: off, key: 'global', channelManager: { enabled: false } },
    ]);
    await Room.collection.insertMany([
      { _id: roomTwin, tenantId: on, name: 'T1', roomTypeId: twin, status: 'active' },
      { _id: roomDbl, tenantId: on, name: 'D1', roomTypeId: dbl, status: 'active' },
      { _id: new mongoose.Types.ObjectId(), tenantId: off, name: 'X', roomTypeId: twin, status: 'active' },
    ]);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => { if (ready) { await Outbox.deleteMany({ tenantId: { $in: [on, off] } }); invalidateChannelManagerCache(); } });

  const run = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!ready) return; await fn(); });

  run('findByIdAndUpdate on a reservation (status → cancelled) enqueues the freed nights', async () => {
    const r = resDoc(on);
    await Reservation.collection.insertOne(r);
    await Reservation.findByIdAndUpdate(r._id, { $set: { status: 'cancelled' } }, { runValidators: false });
    const out = await rows(on);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'availability', dateFrom: '2026-12-01', dateTo: '2026-12-03', status: 'pending', sourceModel: 'Reservation' });
    expect(String(out[0].roomTypeId)).toBe(String(twin));
  });

  run('updateMany on reservations (date move) enqueues old ∪ new per reservation', async () => {
    const a = resDoc(on);
    const b = resDoc(on, { room: roomDbl });
    await Reservation.collection.insertMany([a, b]);
    await Reservation.updateMany({ _id: { $in: [a._id, b._id] } }, { $set: { checkInDate: d('2026-12-20'), checkOutDate: d('2026-12-22') } });
    const out = await rows(on);
    expect(out.map((o: any) => `${o.dateFrom}`).sort()).toEqual(['2026-12-01', '2026-12-01', '2026-12-20', '2026-12-20']);
    expect(new Set(out.map((o: any) => String(o.roomTypeId)))).toEqual(new Set([String(twin), String(dbl)]));
  });

  run('writing outbox rows notifies listeners (the ARI worker pushes availability at once); nothing written, no call', async () => {
    const calls: { tenantId: string; kinds: string[] }[] = [];
    const stop = onOutboxWrite((tenantId, kinds) => calls.push({ tenantId, kinds: [...kinds] }));
    try {
      const r = resDoc(on);
      await Reservation.collection.insertOne(r);
      await Reservation.updateOne({ _id: r._id }, { $set: { notes: 'irrelevant' } });
      expect(calls).toEqual([]);
      await Reservation.updateOne({ _id: r._id }, { $set: { status: 'cancelled' } });
      expect(calls).toEqual([{ tenantId: String(on), kinds: ['availability'] }]);
      const r2 = resDoc(off);
      await Reservation.collection.insertOne(r2);
      await Reservation.updateOne({ _id: r2._id }, { $set: { status: 'cancelled' } });
      expect(calls).toHaveLength(1); // channel manager off: no rows, no call
    } finally {
      stop();
    }
  });

  run('updateMany that changes nothing relevant enqueues nothing', async () => {
    await Reservation.collection.insertOne(resDoc(on));
    await Reservation.updateMany({ tenantId: on }, { $set: { notes: 'x' } });
    expect(await rows(on)).toHaveLength(0);
  });

  run('document save and document delete of a reservation', async () => {
    const r = resDoc(on);
    await Reservation.collection.insertOne(r);
    const doc = (await Reservation.findOne({ _id: r._id, tenantId: on }))!;
    doc.status = 'cancelled';
    await doc.save({ validateBeforeSave: false });
    expect(await rows(on)).toHaveLength(1);

    await Outbox.deleteMany({ tenantId: on });
    const again = (await Reservation.findOne({ _id: r._id, tenantId: on }))!;
    await again.deleteOne();
    expect(await rows(on)).toHaveLength(0); // already cancelled: nothing left to free
    const live = resDoc(on);
    await Reservation.collection.insertOne(live);
    await (await Reservation.findOne({ _id: live._id, tenantId: on }))!.deleteOne();
    expect(await rows(on)).toHaveLength(1);
  });

  run('deleteOne / deleteMany by query', async () => {
    const a = resDoc(on);
    const b = resDoc(on);
    await Reservation.collection.insertMany([a, b]);
    await Reservation.deleteOne({ _id: a._id, tenantId: on });
    await Reservation.deleteMany({ _id: b._id, tenantId: on });
    expect(await rows(on)).toHaveLength(2);
  });

  run('creating rooms and room types enqueues availability + structure', async () => {
    await Room.create({ tenantId: on, name: 'T2', description: 'd', roomTypeId: twin, status: 'active', bedConfiguration: 'Twin', images: [], amenities: [] });
    const out = await rows(on);
    expect(out.map((o: any) => o.kind).sort()).toEqual(['availability', 'structure']);
    expect(out[0].dateFrom).toBe('2000-01-01');
  });

  run('restriction rule create via insertMany/create enqueues rates for plans in scope', async () => {
    const plan = new mongoose.Types.ObjectId();
    await RatePlan.collection.insertOne({ _id: plan, tenantId: on, name: 'BAR', roomTypeId: twin, basePrice: 100, isActive: true, occupancyTiers: [] });
    await RestrictionRule.create({
      tenantId: on, name: 'Min 3', scope: 'rate_plans', ratePlanIds: [plan], dateStart: '2026-12-10', dateEnd: '2026-12-12', minStayArrival: 3,
    });
    const out = await rows(on);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'rates', dateFrom: '2026-12-10', dateTo: '2026-12-12', fields: ['min_stay_arrival'] });
    expect(String(out[0].ratePlanId)).toBe(String(plan));
  });

  run('a tenant without the channel manager enqueues nothing', async () => {
    const r = resDoc(off);
    await Reservation.collection.insertOne(r);
    await Reservation.findByIdAndUpdate(r._id, { $set: { status: 'cancelled' } });
    await Room.updateMany({ tenantId: off }, { $set: { status: 'inactive' } });
    expect(await rows(off)).toHaveLength(0);
  });

  run('a failing enqueue does not fail the write', async () => {
    const r = resDoc(on);
    await Reservation.collection.insertOne(r);
    const spy = jest.spyOn(Outbox, 'insertMany').mockRejectedValue(new Error('outbox down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(Reservation.findByIdAndUpdate(r._id, { $set: { status: 'cancelled' } }, { new: true })).resolves.toMatchObject({ status: 'cancelled' });
    expect(errSpy).toHaveBeenCalled();
    spy.mockRestore();
    errSpy.mockRestore();
  });
});
