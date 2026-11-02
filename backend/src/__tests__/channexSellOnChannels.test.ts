/**
 * "Vender en canales" (RoomType/RatePlan.sellOnChannels, default on): what the channel manager
 * offers. Off = removed from Channex (or, while a channel still maps it, closed there by the
 * ARI worker — see channexAriWorker.test.ts); the booking engine is not affected.
 */
import mongoose from 'mongoose';
import { computePrerequisites, ProvisioningInput, runInTenant } from '../services/channex/provisioning';
import { isOnChannels, syncStructure } from '../services/channex/structuralSync';
import { ChannexError } from '../services/channex/channexClient';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import ChannexEntityMap from '../models/ChannexEntityMap';
import RatePlan from '../models/RatePlan';
import Room from '../models/Room';
import RoomType from '../models/RoomType';

describe('isOnChannels', () => {
  it('active and not switched off; unset counts as on', () => {
    expect(isOnChannels({ isActive: true })).toBe(true);
    expect(isOnChannels({ isActive: true, sellOnChannels: true })).toBe(true);
    expect(isOnChannels({ isActive: true, sellOnChannels: false })).toBe(false);
    expect(isOnChannels({ isActive: false, sellOnChannels: true })).toBe(false);
  });

  it('new room types and rate plans default to on', () => {
    expect(new RoomType({ name: 'Twin' }).sellOnChannels).toBe(true);
    expect(new RatePlan({ name: 'BAR', roomTypeId: new mongoose.Types.ObjectId(), basePrice: 100 }).sellOnChannels).toBe(true);
  });
});

describe('prerequisites only count what is sold on channels', () => {
  const contact = { email: 'h@x.co', phone: '1', address: 'a', city: 'c', country: 'DO', zipCode: '1' };
  const base: ProvisioningInput = {
    tenantName: 'T', currency: 'USD', timezone: 'America/Santo_Domingo', contact,
    roomTypes: [{ _id: 'twin', name: 'Twin', isActive: true }], activeRooms: { twin: 2 },
    ratePlans: [{ _id: 'bar', roomTypeId: 'twin', isActive: true }],
  };
  const failing = (i: ProvisioningInput) => computePrerequisites(i).filter((p) => !p.ok).map((p) => p.id);

  it('the only room type off channels → nothing to sell', () => {
    expect(failing({ ...base, roomTypes: [{ _id: 'twin', name: 'Twin', isActive: true, sellOnChannels: false }] })).toEqual(['roomTypes', 'rooms', 'ratePlans']);
  });
  it('the only rate plan off channels → no sellable rate plan', () => {
    expect(failing({ ...base, ratePlans: [{ _id: 'bar', roomTypeId: 'twin', isActive: true, sellOnChannels: false }] })).toEqual(['ratePlans']);
  });
});

describe('structural sync (local Mongo, mocked Channex)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const twin = new mongoose.Types.ObjectId();
  const suite = new mongoose.Types.ObjectId();
  const bar = new mongoose.Types.ObjectId();
  const suiteBar = new mongoose.Types.ObjectId();
  const post = jest.fn();
  const put = jest.fn();
  const del = jest.fn();
  const client: any = { config: { environment: 'staging' }, post, put, delete: del };
  const property: any = { channexPropertyId: 'cx-prop', currency: 'USD', environment: 'staging' };
  const sync = () => runInTenant(tenantId, () => syncStructure({ client, property }));
  let n = 0;

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_sellonchannels');
    if (!ready) console.warn('Mongo unreachable — skipping sell-on-channels DB tests');
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    [post, put, del].forEach((f) => f.mockReset());
    post.mockImplementation(async () => ({ data: { id: `cx-${++n}`, type: 'x' } }));
    if (!ready) return;
    await Promise.all([RoomType, RatePlan, Room, ChannexEntityMap].map((m) => m.collection.deleteMany({})));
    await RoomType.collection.insertMany([
      { _id: twin, tenantId, name: 'Twin', capacity: 2, isActive: true },
      { _id: suite, tenantId, name: 'Suite', capacity: 2, isActive: true, sellOnChannels: false },
    ]);
    await Room.collection.insertMany([{ tenantId, name: 'T1', roomTypeId: twin, status: 'active' }, { tenantId, name: 'S1', roomTypeId: suite, status: 'active' }]);
    await RatePlan.collection.insertMany([
      { _id: bar, tenantId, name: 'BAR', roomTypeId: twin, basePrice: 100, isActive: true, occupancyTiers: [] },
      { _id: suiteBar, tenantId, name: 'Suite BAR', roomTypeId: suite, basePrice: 300, isActive: true, occupancyTiers: [] },
    ]);
  });
  const run = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!ready) return; await fn(); });

  run('activation creates only what is sold on channels', async () => {
    const report = await sync();
    expect(post.mock.calls.map(([path, body]) => `${path}:${(body.room_type ?? body.rate_plan).title}`)).toEqual(['/room_types:Twin', '/rate_plans:BAR']);
    expect(report.ok).toBe(true);
  });

  run('switching a synced room type off removes it and its rate plans from Channex', async () => {
    await RoomType.collection.updateOne({ _id: suite }, { $set: { sellOnChannels: true } });
    await sync();
    await RoomType.collection.updateOne({ _id: suite }, { $set: { sellOnChannels: false } });
    del.mockResolvedValue({});
    const report = await sync();
    expect(del).toHaveBeenCalledTimes(1);
    expect(report.results.find((r) => r.name === 'Suite')?.action).toBe('deleted');
    expect(await ChannexEntityMap.collection.countDocuments({ localId: { $in: [suite, suiteBar] } })).toBe(0);
  });

  run('a rate plan switched off while a channel maps it is kept (closed there by the worker)', async () => {
    await sync();
    await RatePlan.collection.updateOne({ _id: bar }, { $set: { sellOnChannels: false } });
    del.mockRejectedValue(new ChannexError('Rate plan is mapped to a channel', { status: 422 }));
    const report = await sync();
    expect(report.results.find((r) => r.name === 'BAR')?.action).toBe('kept_mapped');
    expect(await ChannexEntityMap.collection.countDocuments({ localId: bar })).toBe(1);
  });
});
