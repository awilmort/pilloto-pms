/**
 * Phase 2.2 — Channex data model, settings and plan flag (CHANNEX_ARCHITECTURE.md §10).
 *
 * Index declarations are checked through `schema.indexes()`. Tenant scoping is checked by
 * really executing queries: with command buffering off and no connection, the tenant
 * plugin's pre hooks still run (they shape the filter) before the driver call fails.
 */

import mongoose, { Model } from 'mongoose';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { tenantPlugin } from '../plugins/tenantPlugin';
import ChannexProperty from '../models/ChannexProperty';
import ChannexEntityMap from '../models/ChannexEntityMap';
import ChannelAriChange, { ARI_CHANGE_DONE_TTL_SECONDS } from '../models/ChannelAriChange';
import ChannexSyncLog, { SYNC_LOG_TTL_SECONDS } from '../models/ChannexSyncLog';
import ChannexBookingRevision from '../models/ChannexBookingRevision';
import ChannexWebhookEvent, { WEBHOOK_EVENT_TTL_SECONDS } from '../models/ChannexWebhookEvent';
import ChannelAlert from '../models/ChannelAlert';
import ChannelOnboarding from '../models/ChannelOnboarding';
import AppSettings from '../models/AppSettings';
import PlatformSettings from '../models/PlatformSettings';
import Tenant from '../models/Tenant';
import { PLANS, getPlanFeatures } from '../config/plans';

type IndexSpec = [Record<string, unknown>, Record<string, unknown>];

const usesTenantPlugin = (model: Model<any>) =>
  ((model.schema as any).plugins as { fn: unknown }[]).some((p) => p.fn === tenantPlugin);

function indexes(model: Model<any>): IndexSpec[] {
  return model.schema.indexes() as IndexSpec[];
}

function findIndex(model: Model<any>, keys: Record<string, number>): Record<string, unknown> | undefined {
  const match = indexes(model).find(([k]) => JSON.stringify(k) === JSON.stringify(keys));
  return match?.[1];
}

const DAY = 24 * 60 * 60;

describe('indexes and TTLs (architecture §10.1)', () => {
  it('ChannexProperty', () => {
    expect(findIndex(ChannexProperty, { tenantId: 1, environment: 1 })).toMatchObject({ unique: true });
    expect(findIndex(ChannexProperty, { channexPropertyId: 1 })).toMatchObject({
      unique: true, partialFilterExpression: { channexPropertyId: { $type: 'string' } },
    });
  });

  it('ChannexEntityMap', () => {
    expect(findIndex(ChannexEntityMap, { tenantId: 1, environment: 1, kind: 1, localId: 1 })).toMatchObject({ unique: true });
    expect(findIndex(ChannexEntityMap, { environment: 1, channexId: 1 })).toMatchObject({ unique: true });
  });

  it('ChannelAriChange: worker index + TTL on done rows after 14 days', () => {
    expect(findIndex(ChannelAriChange, { tenantId: 1, status: 1, createdAt: 1 })).toBeDefined();
    expect(ARI_CHANGE_DONE_TTL_SECONDS).toBe(14 * DAY);
    expect(findIndex(ChannelAriChange, { completedAt: 1 })).toMatchObject({
      expireAfterSeconds: 14 * DAY, partialFilterExpression: { status: 'done' },
    });
  });

  it('ChannexSyncLog: listing index + 90-day TTL', () => {
    expect(findIndex(ChannexSyncLog, { tenantId: 1, createdAt: -1 })).toBeDefined();
    expect(SYNC_LOG_TTL_SECONDS).toBe(90 * DAY);
    expect(findIndex(ChannexSyncLog, { createdAt: 1 })).toMatchObject({ expireAfterSeconds: 90 * DAY });
  });

  it('ChannexBookingRevision', () => {
    expect(findIndex(ChannexBookingRevision, { channexRevisionId: 1 })).toMatchObject({ unique: true });
    expect(findIndex(ChannexBookingRevision, { channexBookingId: 1, insertedAt: 1 })).toBeDefined();
    expect(findIndex(ChannexBookingRevision, { tenantId: 1, processing: 1 })).toBeDefined();
  });

  it('ChannexWebhookEvent: 14-day TTL', () => {
    expect(WEBHOOK_EVENT_TTL_SECONDS).toBe(14 * DAY);
    expect(findIndex(ChannexWebhookEvent, { receivedAt: 1 })).toMatchObject({ expireAfterSeconds: 14 * DAY });
  });

  it('ChannelAlert: dedupe + listing', () => {
    expect(findIndex(ChannelAlert, { tenantId: 1, type: 1, dedupeKey: 1 })).toMatchObject({ unique: true });
    expect(findIndex(ChannelAlert, { tenantId: 1, status: 1, severity: 1, createdAt: -1 })).toBeDefined();
  });

  it('ChannelOnboarding: one per (tenant, kind, OTA)', () => {
    expect(findIndex(ChannelOnboarding, { tenantId: 1, kind: 1, otaCode: 1 })).toMatchObject({ unique: true });
  });

  it('Reservation keeps its channelSource booking index', () => {
    const Reservation = require('../models/Reservation').default as Model<any>;
    expect(findIndex(Reservation, { 'channelSource.channexBookingId': 1 })).toBeDefined();
  });
});

// ── Tenant scoping ────────────────────────────────────────────────────────────

describe('tenant scoping', () => {
  beforeAll(() => mongoose.set('bufferCommands', false));
  afterAll(() => mongoose.set('bufferCommands', true));

  const TENANT = new mongoose.Types.ObjectId().toString();

  /** Execute a query inside a tenant context and return the filter the driver would receive. */
  async function filterInTenantContext(model: Model<any>, filter: Record<string, unknown> = {}) {
    const query = model.find(filter);
    await tenantLocalStorage.run({ tenantId: TENANT }, () => query.exec().catch(() => undefined));
    return query.getFilter();
  }

  const tenantOwned: [string, Model<any>][] = [
    ['ChannexProperty', ChannexProperty],
    ['ChannexEntityMap', ChannexEntityMap],
    ['ChannelAriChange', ChannelAriChange],
    ['ChannexSyncLog', ChannexSyncLog],
    ['ChannexBookingRevision', ChannexBookingRevision],
    ['ChannelAlert', ChannelAlert],
    ['ChannelOnboarding', ChannelOnboarding],
  ];

  it.each(tenantOwned)('%s is scoped to the current tenant', async (_name, model) => {
    expect(usesTenantPlugin(model)).toBe(true);
    expect(model.schema.path('tenantId')).toBeDefined();
    const filter = await filterInTenantContext(model, { status: 'x' });
    expect(String(filter.tenantId)).toBe(TENANT);
    expect(filter.status).toBe('x');
  });

  it.each(tenantOwned)('%s is not scoped outside tenant context (platform/webhook lookups)', async (_name, model) => {
    const query = model.find({ channexPropertyId: 'p1' });
    await query.exec().catch(() => undefined);
    expect(query.getFilter().tenantId).toBeUndefined();
  });

  it('ChannexWebhookEvent is queryable without tenant scoping, even inside a tenant context', async () => {
    expect(usesTenantPlugin(ChannexWebhookEvent)).toBe(false);
    const filter = await filterInTenantContext(ChannexWebhookEvent, { event: 'booking' });
    expect(filter).toEqual({ event: 'booking' });
  });

  it('new tenant-owned documents are stamped with the tenant on save', async () => {
    const doc = new ChannelAlert({ type: 'overbooking', severity: 'critical', dedupeKey: 'k', title: 't' });
    await tenantLocalStorage.run({ tenantId: TENANT }, () => doc.save().catch(() => undefined));
    expect(String(doc.get('tenantId'))).toBe(TENANT);
  });
});

// ── Validation and defaults ───────────────────────────────────────────────────

describe('validation and defaults', () => {
  it('ChannexProperty requires a known environment and starts provisioning, unpaused', () => {
    expect(new ChannexProperty({}).validateSync()?.errors.environment).toBeDefined();
    expect(new ChannexProperty({ environment: 'dev' }).validateSync()?.errors.environment).toBeDefined();
    const p = new ChannexProperty({ environment: 'staging' });
    expect(p.validateSync()).toBeUndefined();
    expect(p.status).toBe('provisioning');
    expect(p.pausedUntil.getTime()).toBe(0);
    expect(p.ariLeaseUntil.getTime()).toBe(0);
  });

  it('ChannelAriChange validates YYYY-MM-DD ranges and defaults to all fields', () => {
    const ok = new ChannelAriChange({ kind: 'rates', dateFrom: '2026-11-01', dateTo: '2026-11-03' });
    expect(ok.validateSync()).toBeUndefined();
    expect(ok.fields).toEqual(['*']);
    expect(ok.status).toBe('pending');
    expect(new ChannelAriChange({ kind: 'rates', dateFrom: '2026-02-30', dateTo: '2026-03-01' }).validateSync()?.errors.dateFrom).toBeDefined();
    expect(new ChannelAriChange({ kind: 'rates', dateFrom: '2026-11-05', dateTo: '2026-11-03' }).validateSync()?.errors.dateTo).toBeDefined();
    expect(new ChannelAriChange({ kind: 'structure' }).validateSync()).toBeUndefined();
  });

  it('ChannelOnboarding: channel rows need an OTA code, setup rows must not have one', () => {
    expect(new ChannelOnboarding({ kind: 'channel' }).validateSync()?.errors.otaCode).toBeDefined();
    expect(new ChannelOnboarding({ kind: 'setup', otaCode: 'BDC' }).validateSync()?.errors.otaCode).toBeDefined();
    const ch = new ChannelOnboarding({ kind: 'channel', otaCode: ' bdc ' });
    expect(ch.validateSync()).toBeUndefined();
    expect(ch.otaCode).toBe('BDC');
    expect(ch.step).toBe(1);
  });

  it('ChannelAlert rejects unknown types', () => {
    expect(new ChannelAlert({ type: 'nope', severity: 'critical', dedupeKey: 'k', title: 't' }).validateSync()?.errors.type).toBeDefined();
  });

  it('AppSettings.channelManager defaults (architecture §10.2): options only, contact data lives in the property profile', () => {
    const cm = new AppSettings({}).toObject().channelManager;
    expect(cm).toEqual({ enabled: false, autoAssignRooms: true, sendGuestConfirmationEmail: false, ratesIncludeTaxes: false, channelConnection: 'default' });
  });

  it('Tenant.profile normalizes country/email and validates the RNC', () => {
    const t = new Tenant({ name: 'T', slug: 't', ownerEmail: 'o@x.co', profile: { country: 'do', email: 'A@B.CO', rnc: '123' } });
    expect(t.profile!.country).toBe('DO');
    expect(t.profile!.email).toBe('a@b.co');
    expect(t.validateSync()?.errors['profile.rnc']).toBeDefined();
    expect(new Tenant({ name: 'T', slug: 't', ownerEmail: 'o@x.co', profile: { rnc: '131234567' } }).validateSync()).toBeUndefined();
  });

  it('PlatformSettings.channex defaults to globally enabled, holding ids only', () => {
    const ch = new PlatformSettings({}).toObject().channex;
    expect(ch.globalEnabled).toBe(true);
    expect(Object.keys(PlatformSettings.schema.paths).filter((p) => p.startsWith('channex.')).sort())
      .toEqual(['channex.globalEnabled', 'channex.iframePlatformOnly', 'channex.inboxLeaseUntil', 'channex.lastFeedPollAt', 'channex.lastWebhookAt', 'channex.offeredChannels', 'channex.signingKeyId', 'channex.webhookId']);
  });
});

describe('plan flag', () => {
  it('channelManager is included in Pro and Enterprise only', () => {
    expect(PLANS.basic.features.channelManager).toBe(false);
    expect(PLANS.pro.features.channelManager).toBe(true);
    expect(PLANS.enterprise.features.channelManager).toBe(true);
    expect(getPlanFeatures('unknown').channelManager).toBe(false);
  });

  it('the frontend plans mirror matches the backend', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../../frontend/src/config/plans.ts'), 'utf8');
    const values = [...src.matchAll(/channelManager: (true|false),/g)].map((m) => m[1] === 'true');
    expect(values).toEqual([PLANS.basic, PLANS.pro, PLANS.enterprise].map((p) => p.features.channelManager));
  });
});
