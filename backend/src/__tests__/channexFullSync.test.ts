/**
 * Full sync (services/channex/fullSync.ts, plan Phase 6.3): guards, nightly selection, and the
 * end-to-end promise that a full sync is exactly two Channex calls covering 500 days.
 */
import mongoose from 'mongoose';
import { ariTick } from '../services/channex/ariWorker';
import {
  isNightlyDue, localHour, manualGuardRemainingMs, queueGoLiveSync, requestManualFullSync, runNightlyFullSyncs,
} from '../services/channex/fullSync';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import ChannelAriChange from '../models/ChannelAriChange';
import ChannexEntityMap from '../models/ChannexEntityMap';
import ChannexProperty from '../models/ChannexProperty';
import ChannexSyncLog from '../models/ChannexSyncLog';
import RatePlan from '../models/RatePlan';
import Room from '../models/Room';
import RoomType from '../models/RoomType';

describe('pure guards', () => {
  const now = new Date('2026-12-02T07:30:00Z'); // 03:30 in Santo Domingo (UTC-4), 08:30 in Madrid

  it('localHour follows the property timezone', () => {
    expect(localHour('America/Santo_Domingo', now)).toBe(3);
    expect(localHour('Europe/Madrid', now)).toBe(8);
    expect(localHour('Mars/Olympus', now)).toBeNull();
    expect(localHour(undefined, now)).toBeNull();
  });

  it('manual guard is 10 minutes', () => {
    expect(manualGuardRemainingMs(undefined, now)).toBe(0);
    expect(manualGuardRemainingMs(new Date(now.getTime() - 9 * 60_000), now)).toBe(60_000);
    expect(manualGuardRemainingMs(new Date(now.getTime() - 10 * 60_000), now)).toBe(0);
  });

  it('nightly is due at 03:xx local, unless a full sync ran in the last 20 h', () => {
    const tz = 'America/Santo_Domingo';
    expect(isNightlyDue({ timezone: tz }, now)).toBe(true);
    expect(isNightlyDue({ timezone: 'Europe/Madrid' }, now)).toBe(false);
    expect(isNightlyDue({ timezone: tz, lastFullSyncAt: new Date(now.getTime() - 19 * 3600e3) }, now)).toBe(false);
    expect(isNightlyDue({ timezone: tz, lastFullSyncAt: new Date(now.getTime() - 21 * 3600e3) }, now)).toBe(true);
  });
});

describe('full sync (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const rt = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const rp = [0, 1, 2, 3].map(() => new mongoose.Types.ObjectId());
  const T0 = new Date('2026-12-02T07:30:00Z');
  const post = jest.fn();
  const client: any = { config: { environment: 'staging' }, post };
  let property: any;

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_fullsync');
    if (!ready) { console.warn('Mongo unreachable — skipping full sync DB tests'); return; }
    await RoomType.collection.insertMany(rt.map((_id, i) => ({ _id, tenantId, name: `RT${i}`, capacity: 2, isActive: true })));
    await Room.collection.insertMany(rt.map((roomTypeId, i) => ({ tenantId, name: `R${i}`, roomTypeId, status: 'active' })));
    await RatePlan.collection.insertMany(rp.map((_id, i) => ({ _id, tenantId, name: `P${i}`, roomTypeId: rt[i % 2], basePrice: 100, isActive: true, occupancyTiers: [] })));
    await ChannexEntityMap.collection.insertMany([
      ...rt.map((localId, i) => ({ tenantId, environment: 'staging', kind: 'room_type', localId, channexId: `crt${i}`, channexPropertyId: 'cx', status: 'active' })),
      ...rp.map((localId, i) => ({ tenantId, environment: 'staging', kind: 'rate_plan', localId, channexId: `crp${i}`, channexPropertyId: 'cx', status: 'active' })),
    ]);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    post.mockReset();
    if (!ready) return;
    await ChannelAriChange.deleteMany({});
    await ChannexSyncLog.deleteMany({});
    await ChannexProperty.deleteMany({});
    property = await ChannexProperty.create({
      tenantId, environment: 'staging', status: 'active', channexPropertyId: 'cx', timezone: 'America/Santo_Domingo', currency: 'USD',
    });
  });
  const run = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!ready) return; await fn(); });

  run('manual full sync → exactly two Channex calls covering 500 days, with task ids logged', async () => {
    expect(await requestManualFullSync(property, T0)).toEqual({ ok: true, queued: 6 });
    post.mockImplementation(async (path: string) => ({ data: [{ id: `task-${path}`, type: 'task' }] }));
    await ariTick({ client, now: () => new Date(T0.getTime() + 10_000) });

    expect(post).toHaveBeenCalledTimes(2);
    const byPath = Object.fromEntries(post.mock.calls.map(([p, b]) => [p, b.values]));
    // today in Santo Domingo is 2026-12-02; the window ends 499 days later
    expect(byPath['/availability']).toEqual(expect.arrayContaining([expect.objectContaining({ date_from: '2026-12-02', date_to: '2028-04-14' })]));
    expect(byPath['/availability']).toHaveLength(2);
    expect(byPath['/restrictions']).toHaveLength(4);
    for (const v of byPath['/restrictions']) {
      expect(v).toMatchObject({ date_from: '2026-12-02', date_to: '2028-04-14', min_stay_arrival: 1, stop_sell: false });
      expect(v.rates).toHaveLength(2);
    }
    const logs = await ChannexSyncLog.find({ tenantId }).lean();
    expect(logs.map((l) => l.trigger)).toEqual(['full_sync', 'full_sync']);
    expect(logs.flatMap((l) => l.taskIds).sort()).toEqual(['task-/availability', 'task-/restrictions']);
  });

  run('manual full sync is refused within 10 minutes', async () => {
    await requestManualFullSync(property, T0);
    const again = await ChannexProperty.findById(property._id);
    expect(await requestManualFullSync(again!, new Date(T0.getTime() + 5 * 60_000))).toEqual({ ok: false, retryAfterSeconds: 300 });
    expect(await ChannelAriChange.countDocuments({})).toBe(6);
    expect((await requestManualFullSync(again!, new Date(T0.getTime() + 11 * 60_000))).ok).toBe(true);
  });

  run('go-live queues once', async () => {
    expect(await queueGoLiveSync(property, T0)).toBe(6);
    expect(await queueGoLiveSync((await ChannexProperty.findById(property._id))!, T0)).toBe(0);
  });

  run('nightly: only properties at 03:xx local, not twice, capped per tick', async () => {
    const other = new mongoose.Types.ObjectId();
    await ChannexProperty.collection.insertOne({
      tenantId: other, environment: 'staging', status: 'active', channexPropertyId: 'cx2', timezone: 'Europe/Madrid', currency: 'EUR',
      pausedUntil: new Date(0), ariLeaseUntil: new Date(0),
    });
    expect(await runNightlyFullSyncs('staging', T0)).toEqual([String(tenantId)]);
    expect(await ChannelAriChange.countDocuments({ reason: 'full_sync:nightly' })).toBe(6);
    expect(await runNightlyFullSyncs('staging', new Date(T0.getTime() + 60_000))).toEqual([]); // 20 h guard
    expect(await runNightlyFullSyncs('staging', new Date(T0.getTime() + 21 * 3600e3))).toEqual([]); // 04:30 local: not the 03:00 hour
  });
});
