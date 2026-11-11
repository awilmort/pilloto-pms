/**
 * Activation, plan changes and monthly statements against a local Mongo, with BillingSoft faked.
 * These are the commercial rules: Pro includes Essential, Enterprise includes Pro, upgrades are
 * immediate and downgrades wait for the 1st, overage is charged at BillingSoft's published rate.
 */
import mongoose from 'mongoose';
import FiscalStatement from '../models/FiscalStatement';
import Tenant from '../models/Tenant';
import { decrypt } from '../utils/encryption';
import { setBillingSoftClient } from '../services/fiscal/fiscalClient';
import { resetPlanCatalogCache } from '../services/fiscal/fiscalPlans';
import { activateFiscal, applyScheduledPlanChanges, changeFiscalPlan, setFiscalActive, syncFiscal } from '../services/fiscal/fiscalLifecycle';
import {
  closeDuePeriods,
  closeStatement,
  hasUnclosedPreviousPeriod,
  markStatementPaid,
  snapshotUsage,
  voidStatement,
} from '../services/fiscal/fiscalStatements';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import { createFakeBillingSoft, FakeBillingSoft } from './helpers/fakeBillingSoft';
import { tenantLocalStorage } from '../middleware/tenantContext';

const NOV_10 = new Date('2026-11-10T15:00:00Z'); // Santo Domingo, 11:00
const DEC_1 = new Date('2026-12-01T05:00:00Z'); // Santo Domingo, 01:00 on the 1st

describe('fiscal lifecycle and statements (local Mongo)', () => {
  let ready = false;
  let fake: FakeBillingSoft;
  const tenantId = new mongoose.Types.ObjectId();
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const loadTenant = () => Tenant.findById(tenantId).then((t) => t!);
  const input = (over: Record<string, unknown> = {}) => ({
    plan: 'essential' as const,
    rnc: '131-88068-1',
    razonSocial: 'Hotel Prueba SRL',
    address: 'Av. Principal 1, Sosúa',
    admin: { name: 'Carla Pérez', email: 'Carla@Prueba.com' },
    confirmPreviousPostulationConcluded: true,
    ...over,
  });
  const seedTenant = (over: Record<string, unknown> = {}) =>
    Tenant.collection.insertOne({
      _id: tenantId, name: 'Hotel Prueba', slug: 'prueba', plan: 'pro', ownerEmail: 'dueno@prueba.com', isActive: true, products: ['pms'], plans: {},
      ...over,
    });
  const activated = (fiscal: Record<string, unknown> = {}) => ({
    organizationId: 'org-1', rnc: '131880681', environment: 'testecf', certification: 'not_started', isActive: true, plan: 'essential',
    provisionedAt: new Date('2026-10-01T12:00:00Z'), ...fiscal,
  });

  beforeAll(async () => {
    process.env.BILLINGSOFT_PARTNER_API_KEY = 'test-partner-key';
    process.env.BACKEND_PUBLIC_URL = 'https://backend.test';
    process.env.ECF_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    ready = await connectTestDb('pilloto_fiscal_lifecycle');
    if (ready) await Promise.all([FiscalStatement.init(), Tenant.init()]); // unique indexes exist before the first write
    if (!ready) console.warn('Mongo unreachable — skipping fiscal lifecycle DB tests');
  });
  afterAll(async () => {
    setBillingSoftClient(null);
    delete process.env.BILLINGSOFT_PARTNER_API_KEY;
    delete process.env.BACKEND_PUBLIC_URL;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    if (!ready) return;
    resetPlanCatalogCache();
    fake = createFakeBillingSoft();
    setBillingSoftClient(fake.client);
    await Tenant.collection.deleteMany({});
    await FiscalStatement.collection.deleteMany({});
  });

  // ── Activation ──────────────────────────────────────────────────────────────

  describe('activation', () => {
    itDb('creates the BillingSoft Organization, records the link and registers the webhook', async () => {
      await seedTenant();
      const tenant = await activateFiscal(await loadTenant(), input(), { userId: new mongoose.Types.ObjectId(), email: 'dueno@prueba.com' }, NOV_10);
      const org = [...fake.organizations.values()][0];
      expect(org).toMatchObject({ externalRef: String(tenantId), rnc: '131880681', razonSocial: 'Hotel Prueba SRL', plan: 'essential' });
      expect(tenant.fiscal).toMatchObject({
        organizationId: org.id, rnc: '131880681', adminEmail: 'carla@prueba.com', environment: 'testecf', certification: 'not_started', isActive: true, plan: 'essential',
      });
      expect(tenant.toObject().fiscal?.previousPostulationConfirmed).toMatchObject({ byEmail: 'dueno@prueba.com', at: NOV_10 });
      // the webhook is registered for this company and its secret kept encrypted
      expect(fake.calls).toContain(`setWebhook https://backend.test/api/webhooks/billingsoft/${tenantId}`);
      expect(tenant.fiscal?.webhookSecret).toBeDefined();
      expect(tenant.fiscal?.webhookSecret).not.toContain('whsec_');
      expect(decrypt(tenant.fiscal!.webhookSecret!)).toBe('whsec_fake_secret');
    });

    itDb('fills the company profile where it is empty, never overwriting it', async () => {
      await seedTenant({ profile: { legalName: 'Nombre Existente SRL' } });
      const tenant = await activateFiscal(await loadTenant(), input(), {}, NOV_10);
      expect(tenant.toObject().profile).toMatchObject({ legalName: 'Nombre Existente SRL', rnc: '131880681', address: 'Av. Principal 1, Sosúa' });
    });

    itDb('requires the confirmation that any earlier postulation is concluded', async () => {
      await seedTenant();
      await expect(activateFiscal(await loadTenant(), input({ confirmPreviousPostulationConcluded: false }), {}, NOV_10))
        .rejects.toMatchObject({ code: 'FISCAL_REJECTED', fields: { confirmPreviousPostulationConcluded: expect.any(String) } });
      expect(fake.organizations.size).toBe(0);
    });

    it.each([
      ['a short RNC', { rnc: '1234' }, 'rnc'],
      ['an empty legal name', { razonSocial: ' ' }, 'razonSocial'],
      ['a legal name over 150 characters', { razonSocial: 'x'.repeat(151) }, 'razonSocial'],
      ['an empty address', { address: '' }, 'address'],
      ['an address over 100 characters', { address: 'x'.repeat(101) }, 'address'],
      ['no administrator name', { admin: { name: '', email: 'a@b.com' } }, 'admin.name'],
      ['a bad administrator email', { admin: { name: 'Ana', email: 'not-an-email' } }, 'admin.email'],
      ['an unknown plan', { plan: 'gold' }, 'plan'],
    ])('rejects %s', async (_name, over, field) => {
      if (!ready) return;
      await seedTenant();
      await expect(activateFiscal(await loadTenant(), input(over), {}, NOV_10)).rejects.toMatchObject({ fields: { [field]: expect.any(String) } });
      expect(fake.organizations.size).toBe(0);
    });

    itDb('refuses a plan below the one the Pilloto plan includes', async () => {
      await seedTenant({ plan: 'enterprise' }); // includes Pro
      await expect(activateFiscal(await loadTenant(), input({ plan: 'essential' }), {}, NOV_10)).rejects.toMatchObject({ fields: { plan: expect.any(String) } });
      const tenant = await activateFiscal(await loadTenant(), input({ plan: 'pro' }), {}, NOV_10);
      expect(tenant.fiscal?.plan).toBe('pro');
    });

    itDb('resumes an interrupted activation instead of creating a second Organization', async () => {
      await seedTenant();
      // BillingSoft already has this company (the first attempt died before Pilloto saved the link)
      await fake.client.provisionOrganization({ externalRef: String(tenantId), rnc: '131880681', razonSocial: 'Hotel Prueba SRL', address: 'x', plan: 'essential', admin: { name: 'C', email: 'c@p.com' } });
      const tenant = await activateFiscal(await loadTenant(), input(), {}, NOV_10);
      expect(fake.organizations.size).toBe(1);
      expect(tenant.fiscal?.organizationId).toBe([...fake.organizations.values()][0].id);
    });

    itDb('says so when another account already uses the RNC', async () => {
      await seedTenant();
      await fake.client.provisionOrganization({ externalRef: 'someone-else', rnc: '131880681', razonSocial: 'Otra', address: 'x', plan: 'essential', admin: { name: 'O', email: 'o@p.com' } });
      await expect(activateFiscal(await loadTenant(), input(), {}, NOV_10)).rejects.toMatchObject({ statusCode: 409, code: 'FISCAL_RNC_IN_USE' });
    });

    itDb('cannot be activated twice', async () => {
      await seedTenant({ fiscal: activated() });
      await expect(activateFiscal(await loadTenant(), input(), {}, NOV_10)).rejects.toMatchObject({ code: 'FISCAL_ALREADY_ACTIVE' });
    });

    itDb('activation survives a webhook BillingSoft will not accept (the sweep covers it)', async () => {
      await seedTenant();
      fake.failNext('setWebhook', new Error('https required'));
      const tenant = await activateFiscal(await loadTenant(), input(), {}, NOV_10);
      expect(tenant.fiscal?.organizationId).toBeDefined();
      expect(tenant.fiscal?.webhookSecret).toBeUndefined();
    });
  });

  // ── Following certification ─────────────────────────────────────────────────

  describe('certification', () => {
    itDb('is followed from BillingSoft: environment, certification, status and plan', async () => {
      await seedTenant();
      const tenant = await activateFiscal(await loadTenant(), input(), {}, NOV_10);
      const org = fake.organizations.get(tenant.fiscal!.organizationId!)!;
      Object.assign(org, { environment: 'ecf', certification: 'certified' });
      const synced = await syncFiscal(tenant, NOV_10);
      expect(synced.fiscal).toMatchObject({ environment: 'ecf', certification: 'certified' });
      expect(synced.fiscal?.lastSyncedAt).toEqual(NOV_10);
    });

    itDb('a platform operator can suspend and resume e-CF without deleting anything', async () => {
      await seedTenant({ fiscal: activated() });
      fake.organizations.set('org-1', { id: 'org-1', externalRef: String(tenantId), isActive: true } as any);
      expect((await setFiscalActive(await loadTenant(), false)).fiscal?.isActive).toBe(false);
      expect(fake.organizations.get('org-1')?.isActive).toBe(false);
      expect((await setFiscalActive(await loadTenant(), true)).fiscal?.isActive).toBe(true);
    });
  });

  // ── Plan changes ────────────────────────────────────────────────────────────

  describe('plan changes', () => {
    const withOrg = async (tenantOver: Record<string, unknown> = {}, fiscal: Record<string, unknown> = {}) => {
      await seedTenant({ fiscal: activated(fiscal), ...tenantOver });
      fake.organizations.set('org-1', { id: 'org-1', plan: 'essential', externalRef: String(tenantId), isActive: true } as any);
    };

    itDb('an upgrade applies at once at BillingSoft and is noted on the month\'s statement', async () => {
      await withOrg();
      const { tenant, outcome } = await changeFiscalPlan(await loadTenant(), 'pro', NOV_10);
      expect(outcome).toBe('applied');
      expect(tenant.fiscal?.plan).toBe('pro');
      expect(fake.organizations.get('org-1')?.plan).toBe('pro');
      const statement = await FiscalStatement.findOne({ tenantId, period: '2026-11' });
      expect(statement).toMatchObject({ status: 'open', plan: 'pro', planCharge: 325 });
      expect(statement?.planChanges[0]).toMatchObject({ from: 'essential', to: 'pro' });
    });

    itDb('a downgrade waits for the 1st of next month and leaves BillingSoft untouched until then', async () => {
      await withOrg({}, { plan: 'max' });
      const { tenant, outcome } = await changeFiscalPlan(await loadTenant(), 'pro', NOV_10);
      expect(outcome).toBe('scheduled');
      expect(tenant.fiscal?.plan).toBe('max');
      expect(tenant.toObject().fiscal?.pendingPlan).toEqual({ plan: 'pro', effectiveOn: '2026-12-01' });
      expect(fake.calls.some((c) => c.startsWith('updateOrganization'))).toBe(false);
    });

    itDb('choosing the current plan again cancels a scheduled downgrade', async () => {
      await withOrg({}, { plan: 'max', pendingPlan: { plan: 'pro', effectiveOn: '2026-12-01' } });
      const { tenant, outcome } = await changeFiscalPlan(await loadTenant(), 'max', NOV_10);
      expect(outcome).toBe('cancelled');
      expect(tenant.fiscal?.pendingPlan).toBeUndefined();
      expect((await changeFiscalPlan(tenant, 'max', NOV_10)).outcome).toBe('unchanged');
    });

    itDb('never goes below the plan the Pilloto plan includes', async () => {
      await withOrg({ plan: 'enterprise' }, { plan: 'pro' }); // Enterprise includes Pro
      await expect(changeFiscalPlan(await loadTenant(), 'essential', NOV_10)).rejects.toMatchObject({ fields: { plan: expect.any(String) } });
    });

    itDb('an upgrade clears a downgrade that was waiting', async () => {
      await withOrg({}, { plan: 'pro', pendingPlan: { plan: 'essential', effectiveOn: '2026-12-01' } });
      const { tenant } = await changeFiscalPlan(await loadTenant(), 'max', NOV_10);
      expect(tenant.fiscal).toMatchObject({ plan: 'max' });
      expect(tenant.fiscal?.pendingPlan).toBeUndefined();
    });

    itDb('applies a due downgrade on the 1st, and not a day earlier', async () => {
      await withOrg({}, { plan: 'max', pendingPlan: { plan: 'pro', effectiveOn: '2026-12-01' } });
      await FiscalStatement.create({ tenantId, period: '2026-11', status: 'closed', plan: 'max', planPrice: 1500, includedPlanPrice: 475, planCharge: 1025, total: 1025 });
      expect(await applyScheduledPlanChanges(new Date('2026-12-01T03:00:00Z'))).toBe(0); // still Nov 30 in Santo Domingo
      expect(await applyScheduledPlanChanges(DEC_1)).toBe(1);
      const tenant = await loadTenant();
      expect(tenant.fiscal?.plan).toBe('pro');
      expect(tenant.fiscal?.pendingPlan).toBeUndefined();
      expect(fake.organizations.get('org-1')?.plan).toBe('pro');
    });

    itDb('waits while last month\'s statement is still open, so it is priced at the plan it ran on', async () => {
      await withOrg({}, { plan: 'max', pendingPlan: { plan: 'pro', effectiveOn: '2026-12-01' } });
      await FiscalStatement.create({ tenantId, period: '2026-11', status: 'open', plan: 'max', planPrice: 1500, includedPlanPrice: 475, planCharge: 1025, total: 1025 });
      expect(await applyScheduledPlanChanges(DEC_1)).toBe(0);
      expect((await loadTenant()).fiscal?.plan).toBe('max');
    });

    itDb('never lands below what the Pilloto plan includes if that changed meanwhile', async () => {
      await withOrg({ plan: 'enterprise' }, { plan: 'max', pendingPlan: { plan: 'essential', effectiveOn: '2026-12-01' } });
      await FiscalStatement.create({ tenantId, period: '2026-11', status: 'closed', plan: 'max', planPrice: 1500, includedPlanPrice: 800, planCharge: 700, total: 700 });
      await applyScheduledPlanChanges(DEC_1);
      expect((await loadTenant()).fiscal?.plan).toBe('pro');
    });
  });

  // ── Statements ──────────────────────────────────────────────────────────────

  describe('monthly statements', () => {
    const withOrg = async (tenantOver: Record<string, unknown> = {}, fiscal: Record<string, unknown> = {}) => {
      await seedTenant({ fiscal: activated({ certification: 'certified', environment: 'ecf', ...fiscal }), ...tenantOver });
    };

    itDb('opens the month\'s statement from BillingSoft\'s usage: Pro includes Essential, so a within-allowance month costs nothing', async () => {
      await withOrg(); // PMS Pro → Essential included
      fake.usage.used = 120;
      const s = await snapshotUsage(await loadTenant(), NOV_10);
      expect(s).toMatchObject({
        period: '2026-11', status: 'open', plan: 'essential', includedPlan: 'essential', planPrice: 475, includedPlanPrice: 475, planCharge: 0,
        overageAmount: 0, total: 0, usageSource: 'billingsoft',
      });
      expect(s?.transactions).toMatchObject({ included: 300, used: 120, extra: 0 });
    });

    itDb('charges overage at the plan\'s published rate', async () => {
      await withOrg();
      fake.usage.used = 350;
      const s = await snapshotUsage(await loadTenant(), NOV_10);
      expect(s).toMatchObject({ overageUnitPrice: 4.75, overageAmount: 237.5, total: 237.5 });
      expect(s?.transactions).toMatchObject({ used: 350, extra: 50 });
    });

    itDb('a tenant with nothing included pays the plan\'s full price', async () => {
      await withOrg({ plan: 'basic' }, { plan: 'pro' });
      fake.usage.used = 10;
      const s = await snapshotUsage(await loadTenant(), NOV_10);
      expect(s).toMatchObject({ includedPlan: undefined, includedPlanPrice: 0, planCharge: 800, total: 800 });
    });

    itDb('refreshing the snapshot updates the same open statement', async () => {
      await withOrg();
      fake.usage.used = 10;
      await snapshotUsage(await loadTenant(), NOV_10);
      fake.usage.used = 20;
      await snapshotUsage(await loadTenant(), new Date(NOV_10.getTime() + 3600_000));
      const all = await FiscalStatement.find({ tenantId });
      expect(all).toHaveLength(1);
      expect(all[0].transactions.used).toBe(20);
    });

    itDb('closes a past month from BillingSoft when it can answer for that month', async () => {
      await withOrg();
      fake.usage = { used: 410, periodStart: '2026-11-01T04:00:00.000Z' };
      const closed = await closeStatement(await loadTenant(), '2026-11', DEC_1);
      expect(closed).toMatchObject({ status: 'closed', usageSource: 'billingsoft', total: 522.5 }); // 110 × 4.75
      expect(closed.closedAt).toEqual(DEC_1);
      expect(closed.transactions).toMatchObject({ used: 410, extra: 110 });
    });

    itDb('when BillingSoft only answers for the current month, closes from the last snapshot checked against the document count', async () => {
      await withOrg();
      fake.usage = { used: 100, periodStart: '2026-12-01T04:00:00.000Z' }; // BillingSoft reports December: not the month being closed
      await snapshotUsage(await loadTenant(), new Date('2026-11-30T23:00:00Z'));
      // 3 documents in BillingSoft's list for the month; the snapshot saw 100 — never fewer than either
      const closed = await closeStatement(await loadTenant(), '2026-11', DEC_1);
      expect(closed.usageSource).toBe('snapshot');
      expect(closed.transactions.used).toBe(100);
      // a month where the documents outnumber the snapshot uses the documents
      for (let i = 0; i < 3; i++) await fake.client.issue('org-1', 'invoices', { type: '32', payment: { type: 'cash' }, lines: [] } as any, `k${i}`);
      await FiscalStatement.deleteMany({});
      const rebuilt = await closeStatement(await loadTenant(), '2026-10', DEC_1);
      expect(rebuilt).toMatchObject({ usageSource: 'documents', transactions: expect.objectContaining({ used: 3 }) });
    });

    itDb('a closed statement never changes again', async () => {
      await withOrg();
      fake.usage = { used: 410, periodStart: '2026-11-01T04:00:00.000Z' };
      const closed = await closeStatement(await loadTenant(), '2026-11', DEC_1);
      fake.usage = { used: 999, periodStart: '2026-11-01T04:00:00.000Z' };
      const again = await closeStatement(await loadTenant(), '2026-11', new Date(DEC_1.getTime() + 86_400_000));
      expect(again.total).toBe(closed.total);
      expect(again.closedAt).toEqual(DEC_1);
      // and a snapshot cannot reopen it
      const afterSnapshot = await snapshotUsage(await loadTenant(), new Date('2026-11-15T12:00:00Z'));
      expect(afterSnapshot?.status).toBe('closed');
    });

    itDb('prices the month at the plan it ran on, even if the plan changed since', async () => {
      await withOrg({}, { plan: 'pro' });
      fake.usage = { used: 50 };
      await snapshotUsage(await loadTenant(), new Date('2026-11-20T12:00:00Z')); // snapshot while on Pro
      await Tenant.collection.updateOne({ _id: tenantId }, { $set: { 'fiscal.plan': 'essential' } });
      fake.usage = { used: 50, periodStart: '2026-11-01T04:00:00.000Z' };
      const closed = await closeStatement(await loadTenant(), '2026-11', DEC_1);
      expect(closed).toMatchObject({ plan: 'pro', planCharge: 325 });
    });

    itDb('closes last month for every company once, and only if it existed then', async () => {
      await withOrg({}, { provisionedAt: new Date('2026-10-01T12:00:00Z') });
      fake.usage = { used: 5, periodStart: '2026-11-01T04:00:00.000Z' };
      expect(await closeDuePeriods(DEC_1)).toBe(1);
      expect(await closeDuePeriods(DEC_1)).toBe(0); // already closed
      expect((await FiscalStatement.findOne({ tenantId, period: '2026-11' }))?.status).toBe('closed');

      // a company activated in December has no November to close
      await Tenant.collection.updateOne({ _id: tenantId }, { $set: { 'fiscal.provisionedAt': new Date('2026-12-01T10:00:00Z') } });
      await FiscalStatement.deleteMany({});
      expect(await hasUnclosedPreviousPeriod(await loadTenant(), DEC_1)).toBe(false);
      expect(await closeDuePeriods(DEC_1)).toBe(0);
    });

    itDb('only a closed statement can be paid, and a paid one carries the payment reference', async () => {
      await withOrg();
      fake.usage = { used: 1, periodStart: '2026-11-01T04:00:00.000Z' };
      await snapshotUsage(await loadTenant(), NOV_10);
      await expect(markStatementPaid(tenantId, '2026-11', { reference: 'PD-1' })).rejects.toMatchObject({ code: 'FISCAL_STATEMENT_STATE' });
      await closeStatement(await loadTenant(), '2026-11', DEC_1);
      const paid = await markStatementPaid(tenantId, '2026-11', { reference: 'PD-1', method: 'card' }, DEC_1);
      expect(paid).toMatchObject({ status: 'paid', payment: { reference: 'PD-1', method: 'card' } });
      await expect(markStatementPaid(tenantId, '2026-11', { reference: 'PD-2' })).rejects.toMatchObject({ code: 'FISCAL_STATEMENT_STATE' });
    });

    itDb('a statement can be voided with a reason, but not once paid', async () => {
      await withOrg();
      fake.usage = { used: 1, periodStart: '2026-11-01T04:00:00.000Z' };
      await closeStatement(await loadTenant(), '2026-11', DEC_1);
      await expect(voidStatement(tenantId, '2026-11', '  ')).rejects.toMatchObject({ code: 'FISCAL_REJECTED' });
      expect(await voidStatement(tenantId, '2026-11', 'Billed in error')).toMatchObject({ status: 'void', voidReason: 'Billed in error' });
      await expect(voidStatement(tenantId, '2026-11', 'again')).rejects.toMatchObject({ code: 'FISCAL_STATEMENT_STATE' });
    });

    itDb('keeps one company\'s statements away from another\'s', async () => {
      await withOrg();
      fake.usage = { used: 1 };
      await snapshotUsage(await loadTenant(), NOV_10);
      const other = new mongoose.Types.ObjectId();
      expect(await tenantLocalStorage.run({ tenantId: String(other) }, async () => FiscalStatement.countDocuments({}))).toBe(0);
    });
  });
});
