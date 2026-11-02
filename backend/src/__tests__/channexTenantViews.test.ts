/**
 * White-label tenant views (services/channex/tenantViews.ts): what tenants receive carries no
 * Channex ids, task ids, environment or raw Channex errors; the platform console's detailed
 * view keeps them.
 */
import mongoose from 'mongoose';
import { loadSyncActivity, toTenantStatus, toTenantSyncReport } from '../services/channex/tenantViews';
import { runInTenant } from '../services/channex/provisioning';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import ChannexSyncLog from '../models/ChannexSyncLog';
import ChannexProperty from '../models/ChannexProperty';

const status: any = {
  environment: 'staging', configured: true, enabled: true,
  property: { status: 'active', channexPropertyId: 'cx-prop-123', channexGroupId: 'cx-group-9', lastFullSyncAt: new Date('2026-10-31T10:00:00Z'), lastError: 'Channex 422: currency mismatch' },
  prerequisites: [], settings: { name: 'Hotel Mar', autoAssignRooms: true, sendGuestConfirmationEmail: false, ratesIncludeTaxes: false },
};
const mappings: any[] = [
  { kind: 'room_type', localId: 'rt1', name: 'Twin', channexId: 'cx-rt-1', status: 'active' },
  { kind: 'room_type', localId: 'rt2', name: 'Family', channexId: 'cx-rt-2', status: 'remap_required' },
  { kind: 'rate_plan', localId: 'rp1', name: 'BAR', parentName: 'Twin', channexId: 'cx-rp-1', status: 'active', error: 'Channex 500' },
];

describe('tenant status', () => {
  const view = toTenantStatus(status, mappings);

  it('has no Channex ids, environment or raw error text', () => {
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/cx-|channex|staging/i);
    expect(view).not.toHaveProperty('environment');
  });

  it('reports problems in plain terms: a flag and the names that need attention', () => {
    expect(view.property).toEqual({ status: 'active', lastFullSyncAt: status.property.lastFullSyncAt, hasProblem: true });
    expect(view.issues).toEqual([
      { kind: 'room_type', name: 'Family', status: 'remap_required' },
      { kind: 'rate_plan', name: 'BAR', parentName: 'Twin', status: 'active' },
    ]);
    expect(toTenantStatus({ ...status, property: { status: 'active' } }, []).property?.hasProblem).toBe(false);
    expect(toTenantStatus({ ...status, property: null }, []).property).toBeNull();
  });

  it('the activation report keeps names and actions only', () => {
    const r = toTenantSyncReport({ ok: false, calls: 3, results: [{ kind: 'room_type', localId: 'rt1', name: 'Twin', action: 'failed', channexId: 'cx-1', error: 'Channex 422' }] });
    expect(r).toEqual({ ok: false, results: [{ kind: 'room_type', localId: 'rt1', name: 'Twin', action: 'failed' }] });
  });
});

describe('sync activity (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_tenantviews');
    if (!ready) { console.warn('Mongo unreachable — skipping sync activity DB tests'); return; }
    await ChannexSyncLog.collection.insertMany([
      { tenantId, trigger: 'delta', kind: 'restrictions', dateFrom: '2026-11-02', dateTo: '2026-11-02', valuesCount: 1, taskIds: ['task-aaa'], warnings: [], createdAt: new Date('2026-10-31T10:00:00Z') },
      { tenantId, trigger: 'full_sync', kind: 'availability', dateFrom: '2026-10-31', dateTo: '2028-03-13', valuesCount: 2, taskIds: ['task-bbb'], warnings: [{ x: 1 }], createdAt: new Date('2026-10-31T10:01:00Z') },
      { tenantId, trigger: 'delta', kind: 'availability', valuesCount: 1, taskIds: [], error: 'Channex 500 Internal', httpStatus: 500, createdAt: new Date('2026-10-31T10:02:00Z') },
    ]);
    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', status: 'active', channexPropertyId: 'cx1', pausedUntil: new Date(0) });
  });
  afterAll(async () => { if (ready) await dropTestDb(); });

  it('tenants get time, origin, what, dates and a status — no task ids, values or error text', async () => {
    if (!ready) return;
    const data = await runInTenant(tenantId, () => loadSyncActivity('staging', { page: 1, limit: 10, detailed: false }));
    expect(data.total).toBe(3);
    expect(data.logs.map((l) => l.status)).toEqual(['error', 'warning', 'ok']);
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/task-|Channex 500|taskIds|valuesCount|httpStatus/);
    expect(data.pausedUntil).toBeUndefined();
  });

  it('the platform console gets the task ids and raw errors', async () => {
    if (!ready) return;
    const data: any = await runInTenant(tenantId, () => loadSyncActivity('staging', { page: 1, limit: 10, detailed: true }));
    expect(data.logs[2].taskIds).toEqual(['task-aaa']);
    expect(data.logs[0]).toMatchObject({ error: 'Channex 500 Internal', httpStatus: 500 });
  });
});
