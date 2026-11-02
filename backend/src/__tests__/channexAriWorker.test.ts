/**
 * ARI worker (services/channex/ariWorker.ts, plan Phase 6.2): pure compression/merge/limits,
 * and DB-backed ticks against a mocked Channex client (skips when local Mongo is down).
 */
import mongoose from 'mongoose';
import {
  ariTick, backoffMs, buildAvailabilityValues, buildRestrictionValues, clampAndMerge, compressRuns, flushMode, groupAvailabilityRows,
  groupRateRows, restrictionFieldValues, shouldFlush, SlidingWindowLimiter,
} from '../services/channex/ariWorker';
import { ChannexAuthError, ChannexRateLimitError, ChannexValidationError } from '../services/channex/channexClient';
import type { ResolvedDay } from '../services/channex/rateResolver';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import ChannelAlert from '../models/ChannelAlert';
import ChannelAriChange from '../models/ChannelAriChange';
import ChannexEntityMap from '../models/ChannexEntityMap';
import ChannexProperty from '../models/ChannexProperty';
import ChannexSyncLog from '../models/ChannexSyncLog';
import RatePlan from '../models/RatePlan';
import Room from '../models/Room';
import RoomType from '../models/RoomType';
import RestrictionRule from '../models/RestrictionRule';

const day = (over: Partial<ResolvedDay> = {}): ResolvedDay => ({
  basePrice: 10000, rates: { 1: 9000, 2: 10000 }, minStayArrival: 1, maxStay: 0, closedToArrival: false, closedToDeparture: false, stopSell: false,
  priceSource: { kind: 'plan' }, restrictionSources: {} as any, ...over,
});

describe('pure helpers', () => {
  it('shouldFlush: 5 s quiet or 30 s since the first change', () => {
    expect(shouldFlush(0, 0, 4_999)).toBe(false);
    expect(shouldFlush(0, 0, 5_000)).toBe(true);
    expect(shouldFlush(0, 28_000, 29_000)).toBe(false); // still being edited
    expect(shouldFlush(0, 29_000, 30_000)).toBe(true);  // max wait reached
  });

  it('flushMode: availability after 1 s quiet (not while structure is pending), everything after 5 s / 30 s', () => {
    const p = { oldestMs: 0, newestMs: 0, newestAvailabilityMs: 0, hasStructure: false };
    expect(flushMode(p, 999)).toBeNull();
    expect(flushMode(p, 1_000)).toBe('availability');
    expect(flushMode({ ...p, hasStructure: true }, 1_000)).toBeNull();
    expect(flushMode({ ...p, newestAvailabilityMs: undefined }, 1_000)).toBeNull(); // prices and rules keep the 5 s batch
    expect(flushMode(p, 5_000)).toBe('all');
    expect(flushMode({ ...p, newestMs: 29_500, newestAvailabilityMs: 29_500 }, 30_000)).toBe('all');
  });

  it('backoff doubles from 60 s up to 15 min', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000, 900_000, 900_000]);
  });

  it('sliding window limiter allows 8 per minute per key', () => {
    const l = new SlidingWindowLimiter(8, 60_000);
    for (let i = 0; i < 8; i++) expect(l.tryAcquire('p:availability', i * 1000)).toBe(true);
    expect(l.tryAcquire('p:availability', 9_000)).toBe(false);
    expect(l.tryAcquire('p:restrictions', 9_000)).toBe(true); // separate kind
    expect(l.tryAcquire('p:availability', 60_500)).toBe(true); // window slid
  });

  it('compressRuns: single date, runs, gaps and value changes', () => {
    const v: Record<string, number> = { '2026-12-01': 5, '2026-12-02': 5, '2026-12-03': 4, '2026-12-05': 4, '2026-12-06': 4 };
    expect(compressRuns(Object.keys(v), (d) => v[d])).toEqual([
      { dateFrom: '2026-12-01', dateTo: '2026-12-02', value: 5 },
      { dateFrom: '2026-12-03', dateTo: '2026-12-03', value: 4 },
      { dateFrom: '2026-12-05', dateTo: '2026-12-06', value: 4 }, // gap on the 4th keeps runs apart
    ]);
  });

  it('clampAndMerge clamps to today..today+499 and unions overlaps', () => {
    const out = clampAndMerge([
      { dateFrom: '2000-01-01', dateTo: '2026-12-03' }, { dateFrom: '2026-12-03', dateTo: '2026-12-05' },
      { dateFrom: '2026-12-20', dateTo: '2099-12-31' }, { dateFrom: '2020-01-01', dateTo: '2020-02-01' },
    ], '2026-12-01');
    expect(out).toEqual([{ dateFrom: '2026-12-01', dateTo: '2026-12-05' }, { dateFrom: '2026-12-20', dateTo: '2028-04-13' }]);
  });

  it('merges overlapping availability rows per room type', () => {
    const g = groupAvailabilityRows([
      { roomTypeId: 'a', dateFrom: '2026-12-05', dateTo: '2026-12-07' } as any,
      { roomTypeId: 'a', dateFrom: '2026-12-06', dateTo: '2026-12-09' } as any,
      { roomTypeId: 'b', dateFrom: '2026-12-06', dateTo: '2026-12-06' } as any,
    ], '2026-12-01');
    expect(g).toEqual([
      { roomTypeId: 'a', ranges: [{ dateFrom: '2026-12-05', dateTo: '2026-12-09' }] },
      { roomTypeId: 'b', ranges: [{ dateFrom: '2026-12-06', dateTo: '2026-12-06' }] },
    ]);
  });

  it('rate rows are grouped per (plan, field set); "*" is its own set', () => {
    const g = groupRateRows([
      { ratePlanId: 'p', dateFrom: '2026-12-05', dateTo: '2026-12-06', fields: ['rate'] },
      { ratePlanId: 'p', dateFrom: '2026-12-07', dateTo: '2026-12-08', fields: ['rate'] },
      { ratePlanId: 'p', dateFrom: '2026-12-05', dateTo: '2026-12-05', fields: ['stop_sell'] },
      { ratePlanId: 'p', dateFrom: '2026-12-10', dateTo: '2026-12-10', fields: ['*'] },
    ] as any, '2026-12-01');
    expect(g.map((x) => [x.fields.join(','), x.ranges.map((r) => `${r.dateFrom}..${r.dateTo}`).join('|')])).toEqual([
      ['rate', '2026-12-05..2026-12-08'], ['stop_sell', '2026-12-05..2026-12-05'], ['*', '2026-12-10..2026-12-10'],
    ]);
  });

  it('availability values: a single date uses `date`, runs use date_from/date_to', () => {
    const out = buildAvailabilityValues('prop', [{
      channexRoomTypeId: 'rt', ranges: [{ dateFrom: '2026-12-01', dateTo: '2026-12-03' }],
      availability: { '2026-12-01': 8, '2026-12-02': 8, '2026-12-03': 7 },
    }]);
    expect(out).toEqual([
      { property_id: 'prop', room_type_id: 'rt', availability: 8, date_from: '2026-12-01', date_to: '2026-12-02' },
      { property_id: 'prop', room_type_id: 'rt', availability: 7, date: '2026-12-03' },
    ]);
  });

  it('restriction fields: per-occupancy decimal rates, subsets, and no rate when it is not positive', () => {
    expect(restrictionFieldValues(day(), ['rate'])).toEqual({ rates: [{ occupancy: 1, rate: '90.00' }, { occupancy: 2, rate: '100.00' }] });
    expect(restrictionFieldValues(day({ minStayArrival: 3, stopSell: true }), ['min_stay_arrival', 'stop_sell'])).toEqual({ min_stay_arrival: 3, stop_sell: true });
    expect(Object.keys(restrictionFieldValues(day(), ['*'])).sort()).toEqual(['closed_to_arrival', 'closed_to_departure', 'max_stay', 'min_stay_arrival', 'rates', 'stop_sell']);
    expect(restrictionFieldValues(day({ rates: { 1: 0, 2: 0 }, stopSell: true }), ['*']).rates).toBeUndefined();
  });

  it('restriction values compress runs and only carry the touched fields', () => {
    const days: Record<string, ResolvedDay> = {
      '2026-12-01': day(), '2026-12-02': day(), '2026-12-03': day({ rates: { 1: 9500, 2: 10500 } }),
    };
    const out = buildRestrictionValues([{ channexPropertyId: 'prop', channexRatePlanId: 'rp', ranges: [{ dateFrom: '2026-12-01', dateTo: '2026-12-03' }], fields: ['rate'], days }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ property_id: 'prop', rate_plan_id: 'rp', date_from: '2026-12-01', date_to: '2026-12-02' });
    expect(Object.keys(out[1]).sort()).toEqual(['date', 'property_id', 'rate_plan_id', 'rates']);
  });
});

// ─── DB-backed ticks ─────────────────────────────────────────────────────────

describe('ARI worker ticks (local Mongo, mocked Channex)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const rtId = new mongoose.Types.ObjectId();
  const rpId = new mongoose.Types.ObjectId();
  const T0 = new Date('2026-12-01T15:00:00Z'); // 11:00 in Santo Domingo → today = 2026-12-01
  const at = (secs: number) => new Date(T0.getTime() + secs * 1000);
  const post = jest.fn();
  const client: any = { config: { environment: 'staging' }, post };
  let propertyId: mongoose.Types.ObjectId;

  const ok = (id = 'task-1', meta: any = {}) => ({ data: [{ id, type: 'task' }], meta });
  const addRows = (rows: Record<string, unknown>[], createdAt = T0) =>
    ChannelAriChange.collection.insertMany(rows.map((r) => ({
      tenantId, status: 'pending', attempts: 0, fields: ['*'], createdAt, updatedAt: createdAt, ...r,
    })));
  const availRow = (dateFrom: string, dateTo: string) => ({ kind: 'availability', roomTypeId: rtId, dateFrom, dateTo });
  const rateRow = (dateFrom: string, dateTo: string, fields: string[] = ['rate']) => ({ kind: 'rates', ratePlanId: rpId, dateFrom, dateTo, fields });
  const statuses = async () => (await ChannelAriChange.find({ tenantId }).lean()).map((r) => r.status);
  const tick = (secs: number, limiter?: SlidingWindowLimiter) => ariTick({ client, now: () => at(secs), limiter });

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_ariworker');
    if (!ready) { console.warn('Mongo unreachable — skipping ARI worker DB tests'); return; }
    await RoomType.collection.insertOne({ _id: rtId, tenantId, name: 'Twin', capacity: 2, isActive: true });
    await Room.collection.insertMany(Array.from({ length: 3 }, (_, i) => ({ tenantId, name: `T${i}`, roomTypeId: rtId, status: 'active' })));
    await RatePlan.collection.insertOne({ _id: rpId, tenantId, name: 'BAR', roomTypeId: rtId, basePrice: 100, isActive: true, occupancyTiers: [] });
    await ChannexEntityMap.collection.insertMany([
      { tenantId, environment: 'staging', kind: 'room_type', localId: rtId, channexId: 'cx-rt', channexPropertyId: 'cx-prop', status: 'active' },
      { tenantId, environment: 'staging', kind: 'rate_plan', localId: rpId, channexId: 'cx-rp', channexPropertyId: 'cx-prop', status: 'active' },
    ]);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    post.mockReset();
    if (!ready) return;
    await ChannelAriChange.deleteMany({});
    await ChannexSyncLog.deleteMany({});
    await ChannelAlert.deleteMany({});
    await ChannexProperty.deleteMany({});
    propertyId = (await ChannexProperty.collection.insertOne({
      tenantId, environment: 'staging', status: 'active', channexPropertyId: 'cx-prop', timezone: 'America/Santo_Domingo', currency: 'USD',
      pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0,
    })).insertedId;
  });
  const run = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!ready) return; await fn(); });

  run('three availability writes within 1 s → one call 1 s after the last one', async () => {
    await addRows([availRow('2026-12-05', '2026-12-06')], at(0));
    await addRows([availRow('2026-12-06', '2026-12-08')], at(0.4));
    await addRows([availRow('2026-12-20', '2026-12-20')], at(0.8));
    post.mockResolvedValue(ok());

    expect(await tick(1.5)).toEqual([]);        // still inside the 1 s availability quiet window
    expect(post).not.toHaveBeenCalled();
    expect(await tick(1.8)).toEqual([String(tenantId)]);
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/availability');
    expect(body.values).toEqual([
      { property_id: 'cx-prop', room_type_id: 'cx-rt', availability: 3, date_from: '2026-12-05', date_to: '2026-12-08' },
      { property_id: 'cx-prop', room_type_id: 'cx-rt', availability: 3, date: '2026-12-20' },
    ]);
    expect(new Set(await statuses())).toEqual(new Set(['done']));
    const log = await ChannexSyncLog.findOne({ tenantId, kind: 'availability' }).lean();
    expect(log).toMatchObject({ trigger: 'delta', taskIds: ['task-1'], valuesCount: 2, httpStatus: 200, dateFrom: '2026-12-05', dateTo: '2026-12-20' });
  });

  run('a steady stream still flushes once the first change is 30 s old', async () => {
    await addRows([rateRow('2026-12-05', '2026-12-05')], at(0));
    await addRows([rateRow('2026-12-06', '2026-12-06')], at(28));
    post.mockResolvedValue(ok());
    expect(await tick(29)).toEqual([]);
    expect(await tick(30)).toHaveLength(1);
  });

  run('a sold room goes out after 1 s on its own; price edits in progress keep their batch', async () => {
    await addRows([rateRow('2026-12-10', '2026-12-10')], at(0));
    await addRows([availRow('2026-12-05', '2026-12-06')], at(0.5));
    post.mockResolvedValue(ok());
    expect(await tick(1.6)).toEqual([String(tenantId)]);
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/availability']);
    expect((await ChannelAriChange.find({ tenantId, kind: 'rates' }).lean())[0].status).toBe('pending');
    expect(await tick(3)).toEqual([]);          // rates: still inside their 5 s quiet window
    await tick(5.5);
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/availability', '/restrictions']);
  });

  run('availability waits while a room type or rate plan change is pending, then goes with it', async () => {
    await addRows([{ kind: 'structure' }, availRow('2026-12-05', '2026-12-06')], at(0));
    post.mockResolvedValue(ok());
    expect(await tick(2)).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  run('a burst of bookings: 8 calls a minute, the rest merged into the next call when the window frees', async () => {
    const limiter = new SlidingWindowLimiter();
    post.mockResolvedValue(ok());
    for (let i = 0; i < 10; i++) {
      await addRows([availRow(`2026-12-${String(5 + i).padStart(2, '0')}`, `2026-12-${String(5 + i).padStart(2, '0')}`)], at(i * 2));
      await tick(i * 2 + 1.5, limiter);
    }
    expect(post).toHaveBeenCalledTimes(8);
    expect((await ChannelAriChange.find({ tenantId, status: 'pending' }).lean())).toHaveLength(2);
    await tick(62, limiter);
    expect(post).toHaveBeenCalledTimes(9);
    expect(post.mock.calls[8][1].values).toEqual([
      { property_id: 'cx-prop', room_type_id: 'cx-rt', availability: 3, date_from: '2026-12-13', date_to: '2026-12-14' },
    ]);
  });

  run('one grid-cell edit → one /restrictions call with only the edited field', async () => {
    await RestrictionRule.collection.insertOne({
      tenantId, name: 'Min 3', origin: 'calendar', scope: 'rate_plans', ratePlanIds: [rpId], roomTypeIds: [], days: [], isActive: true,
      dateStart: '2026-12-10', dateEnd: '2026-12-11', minStayArrival: 3, createdAt: T0, updatedAt: T0,
    });
    await addRows([rateRow('2026-12-10', '2026-12-11', ['min_stay_arrival'])]);
    post.mockResolvedValue(ok('task-r'));
    await tick(10);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/restrictions');
    expect(post.mock.calls[0][1].values).toEqual([
      { property_id: 'cx-prop', rate_plan_id: 'cx-rp', date_from: '2026-12-10', date_to: '2026-12-11', min_stay_arrival: 3 },
    ]);
  });

  run('rate rows push per-occupancy decimal rates computed by the RateResolver', async () => {
    await addRows([rateRow('2026-12-02', '2026-12-02')]);
    post.mockResolvedValue(ok());
    await tick(10);
    expect(post.mock.calls[0][1].values).toEqual([
      { property_id: 'cx-prop', rate_plan_id: 'cx-rp', date: '2026-12-02', rates: [{ occupancy: 1, rate: '100.00' }, { occupancy: 2, rate: '100.00' }] },
    ]);
  });

  run('availability and rates in one flush → exactly one call of each kind', async () => {
    await addRows([availRow('2026-12-05', '2026-12-05'), availRow('2026-12-09', '2026-12-09'), rateRow('2026-12-05', '2026-12-09'), rateRow('2026-12-11', '2026-12-11', ['stop_sell'])]);
    post.mockResolvedValue(ok());
    await tick(10);
    expect(post.mock.calls.map((c) => c[0]).sort()).toEqual(['/availability', '/restrictions']);
  });

  run('dates in the past are clamped away; a row entirely in the past sends nothing', async () => {
    await addRows([availRow('2026-11-01', '2026-11-30')]);
    await tick(10);
    expect(post).not.toHaveBeenCalled();
    expect(new Set(await statuses())).toEqual(new Set(['done']));
  });

  run('429 → rows back to pending, property paused with backoff, then retried with no data loss', async () => {
    await addRows([availRow('2026-12-05', '2026-12-06'), rateRow('2026-12-05', '2026-12-06')]);
    post.mockRejectedValueOnce(new ChannexRateLimitError('slow down', { status: 429 }));
    await tick(10);

    expect(post).toHaveBeenCalledTimes(1); // availability failed → restrictions not attempted
    expect(new Set(await statuses())).toEqual(new Set(['pending']));
    const paused = (await ChannexProperty.findById(propertyId).lean())!;
    expect(paused.pausedUntil.getTime()).toBe(at(10).getTime() + 60_000);
    expect(paused.consecutiveFailures).toBe(1);
    const attempts = (await ChannelAriChange.find({ tenantId }).lean()).map((r) => r.attempts);
    expect(attempts).toEqual([1, 0]); // only the call that failed counts as an attempt

    expect(await tick(40)).toEqual([]); // still paused
    expect(post).toHaveBeenCalledTimes(1);

    post.mockResolvedValue(ok('after-pause'));
    expect(await tick(80)).toHaveLength(1);
    expect(post).toHaveBeenCalledTimes(3);
    expect(new Set(await statuses())).toEqual(new Set(['done']));
    const healed = (await ChannexProperty.findById(propertyId).lean())!;
    expect(healed.consecutiveFailures).toBe(0);
  });

  run('consecutive failures back off exponentially', async () => {
    await addRows([availRow('2026-12-05', '2026-12-05')]);
    post.mockRejectedValue(new ChannexRateLimitError('slow', { status: 429 }));
    await tick(10);
    await tick(71);
    const p = (await ChannexProperty.findById(propertyId).lean())!;
    expect(p.consecutiveFailures).toBe(2);
    expect(p.pausedUntil.getTime()).toBe(at(71).getTime() + 120_000);
  });

  run('401/403 → 15-minute pause and a platform alert', async () => {
    await addRows([availRow('2026-12-05', '2026-12-05')]);
    post.mockRejectedValue(new ChannexAuthError('forbidden', { status: 403 }));
    await tick(10);
    const p = (await ChannexProperty.findById(propertyId).lean())!;
    expect(p.pausedUntil.getTime()).toBe(at(10).getTime() + 15 * 60_000);
    expect(await ChannelAlert.countDocuments({ type: 'api_auth_failed' })).toBe(1);
    expect(await statuses()).toEqual(['pending']);
  });

  run('validation errors fail the rows (no retry loop) and raise an alert', async () => {
    await addRows([availRow('2026-12-05', '2026-12-05')]);
    post.mockRejectedValue(new ChannexValidationError('bad', { status: 422 }));
    await tick(10);
    expect(await statuses()).toEqual(['failed']);
    expect(await ChannelAlert.countDocuments({ type: 'sync_error', tenantId })).toBe(1);
    expect((await ChannexProperty.findById(propertyId).lean())!.pausedUntil.getTime()).toBe(0);
  });

  run('Channex warnings (HTTP 200) become ari_warning alerts and are logged', async () => {
    await addRows([availRow('2026-12-05', '2026-12-05')]);
    post.mockResolvedValue(ok('t', { warnings: [{ warning: { date: 'is in the past' } }] }));
    await tick(10);
    expect(await ChannelAlert.countDocuments({ type: 'ari_warning', tenantId })).toBe(1);
    expect((await ChannexSyncLog.findOne({ tenantId }).lean())!.warnings).toHaveLength(1);
  });

  run('per-kind limit: calls over the limit stay pending without pausing the property', async () => {
    const limiter = new SlidingWindowLimiter(1, 60_000);
    await addRows([availRow('2026-12-05', '2026-12-05')]);
    post.mockResolvedValue(ok());
    await tick(10, limiter);
    await addRows([availRow('2026-12-06', '2026-12-06')], at(11));
    await tick(20, limiter);
    expect(post).toHaveBeenCalledTimes(1);
    expect((await statuses()).sort()).toEqual(['done', 'pending']);
    expect((await ChannexProperty.findById(propertyId).lean())!.pausedUntil.getTime()).toBe(0);
    await tick(75, limiter);
    expect(post).toHaveBeenCalledTimes(2);
  });

  run('unmapped room types and rate plans are skipped, not pushed', async () => {
    await addRows([{ kind: 'availability', roomTypeId: new mongoose.Types.ObjectId(), dateFrom: '2026-12-05', dateTo: '2026-12-05' }]);
    await tick(10);
    expect(post).not.toHaveBeenCalled();
    expect(await statuses()).toEqual(['done']);
  });

  run('a leased property is not flushed twice, and full-sync rows are logged as full_sync', async () => {
    await addRows([{ ...availRow('2026-12-05', '2026-12-05'), reason: 'full_sync' }]);
    await ChannexProperty.updateOne({ _id: propertyId }, { $set: { ariLeaseUntil: at(60) } });
    expect(await tick(10)).toEqual([]);
    post.mockResolvedValue(ok());
    expect(await tick(61)).toHaveLength(1);
    expect((await ChannexSyncLog.findOne({ tenantId }).lean())!.trigger).toBe('full_sync');
  });

  run('"sell on channels" off but still mapped → 0 availability and stop sell on the channels', async () => {
    await RoomType.collection.updateOne({ _id: rtId }, { $set: { sellOnChannels: false } });
    try {
      await addRows([availRow('2026-12-05', '2026-12-06'), rateRow('2026-12-05', '2026-12-06', ['rate', 'stop_sell'])]);
      post.mockResolvedValue(ok());
      await tick(10);
      const byPath = Object.fromEntries(post.mock.calls.map(([path, body]) => [path, body.values]));
      expect(byPath['/availability']).toEqual([{ property_id: 'cx-prop', room_type_id: 'cx-rt', availability: 0, date_from: '2026-12-05', date_to: '2026-12-06' }]);
      expect(byPath['/restrictions']).toEqual([expect.objectContaining({ rate_plan_id: 'cx-rp', stop_sell: true, date_from: '2026-12-05', date_to: '2026-12-06' })]);
    } finally {
      await RoomType.collection.updateOne({ _id: rtId }, { $unset: { sellOnChannels: '' } });
    }
  });

  run('a rate plan alone off channels is stop-sold; its room type keeps its availability', async () => {
    await RatePlan.collection.updateOne({ _id: rpId }, { $set: { sellOnChannels: false } });
    try {
      await addRows([availRow('2026-12-05', '2026-12-05'), rateRow('2026-12-05', '2026-12-05', ['rate', 'stop_sell'])]);
      post.mockResolvedValue(ok());
      await tick(10);
      const byPath = Object.fromEntries(post.mock.calls.map(([path, body]) => [path, body.values]));
      expect(byPath['/availability'][0].availability).toBe(3);
      expect(byPath['/restrictions'][0]).toMatchObject({ stop_sell: true });
    } finally {
      await RatePlan.collection.updateOne({ _id: rpId }, { $unset: { sellOnChannels: '' } });
    }
  });

  run('rows stuck in flight after a crash are recovered', async () => {
    await addRows([{ ...availRow('2026-12-05', '2026-12-05'), status: 'in_flight', batchId: 'dead' }], at(-3600));
    post.mockResolvedValue(ok());
    await tick(10);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
