/**
 * /api/platform/billing against a local Mongo, through the real platform router: only superadmins
 * get in, and the console's flows work end to end — price list, a tenant's contract, generating a
 * charge, recording a payment (which issues the e-CF), the e-CF files, a reversal, and Pilloto's
 * own e-CF link. Only `authenticate` is replaced (it stands in for the JWT).
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

let currentUser: any;
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return { ...actual, authenticate: (req: any, _res: any, next: any) => { req.user = currentUser; next(); } };
});
jest.mock('../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue('email-id') }));

/* eslint-disable import/first */
import { sendEmail } from '../utils/email';
import BillingCharge from '../models/BillingCharge';
import BillingPayment from '../models/BillingPayment';
import ElectronicInvoice from '../models/ElectronicInvoice';
import FiscalStatement from '../models/FiscalStatement';
import PlanPrice from '../models/PlanPrice';
import PlatformSettings from '../models/PlatformSettings';
import Tenant from '../models/Tenant';
import platformRoutes from '../routes/platform';
import { setBillingSoftClient } from '../services/fiscal/fiscalClient';
import { PLATFORM_ISSUER_ID } from '../services/fiscal/platformIssuer';
import fiscalWebhookRoutes from '../routes/fiscalWebhook';
import { computeSignature } from '../services/fiscal/fiscalWebhook';
import { encrypt } from '../utils/encryption';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import { createFakeBillingSoft, FakeBillingSoft } from './helpers/fakeBillingSoft';
/* eslint-enable import/first */

// Each test seeds a database and goes through the real router: allow for a busy machine.
jest.setTimeout(30_000);

describe('/api/platform/billing (local Mongo)', () => {
  let ready = false;
  let fake: FakeBillingSoft;
  const tenantId = new mongoose.Types.ObjectId();
  const superadmin = { _id: new mongoose.Types.ObjectId(), email: 'ops@pilloto.com', role: 'superadmin' };
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const app = express();
  app.use(express.json());
  app.use('/api/platform', platformRoutes);
  const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string) => (request(app) as any)[method](`/api/platform/billing${url}`);

  const seedPlatform = (fiscal: Record<string, unknown> | null = { organizationId: 'self', environment: 'ecf', certification: 'certified', isActive: true, plan: 'essential' }) =>
    PlatformSettings.updateOne({ key: 'global' }, { $set: { 'billing.notifyEmail': 'ops@pilloto.com', ...(fiscal ? { 'billing.fiscal': fiscal } : {}) }, ...(fiscal ? {} : { $unset: { 'billing.fiscal': '' } }) }, { upsert: true });

  /** Charges are for the month that just ended, so this test charges the last month on the real clock. */
  const lastPeriod = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();

  beforeAll(async () => {
    process.env.BILLINGSOFT_PARTNER_API_KEY = 'test-partner-key';
    process.env.BACKEND_PUBLIC_URL = 'https://backend.test';
    process.env.ECF_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    ready = await connectTestDb('pilloto_platform_billing_routes');
    if (ready) await Promise.all([ElectronicInvoice.init(), BillingCharge.init(), BillingPayment.init(), PlanPrice.init()]);
    if (!ready) console.warn('Mongo unreachable — skipping platform billing route tests');
  });
  afterAll(async () => {
    setBillingSoftClient(null);
    delete process.env.BILLINGSOFT_PARTNER_API_KEY;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    if (!ready) return;
    jest.clearAllMocks();
    currentUser = superadmin;
    fake = createFakeBillingSoft();
    setBillingSoftClient(fake.client);
    await Promise.all([BillingCharge, BillingPayment, ElectronicInvoice, FiscalStatement, PlanPrice, PlatformSettings, Tenant].map((m: any) => m.collection.deleteMany({})));
    await seedPlatform();
    await Tenant.collection.insertOne({
      _id: tenantId, name: 'Hotel Prueba', slug: 'prueba', plan: 'pro', plans: { accounting: 'plus' }, products: ['pms', 'accounting'], ownerEmail: 'dueno@prueba.com', isActive: true,
      createdAt: new Date('2025-01-01T12:00:00Z'), updatedAt: new Date(), profile: { legalName: 'Hotel Prueba SRL', rnc: '131880681', email: 'info@prueba.com' },
    });
  });

  const generate = async () => (await api('post', '/charges/generate').send({ tenantId: String(tenantId), period: lastPeriod, notify: false })).body.data.charge;

  itDb('is for superadmins only', async () => {
    currentUser = { _id: new mongoose.Types.ObjectId(), email: 'x@y.com', role: 'admin' };
    expect((await api('get', '/overview')).status).toBe(403);
    expect((await api('get', '/plans')).status).toBe(403);
    expect((await api('post', '/charges/run')).status).toBe(403);
    currentUser = undefined;
    expect((await api('get', '/overview')).status).toBe(401);
  });

  itDb('the price list is read and edited, validating the price', async () => {
    const list = await api('get', '/plans');
    expect(list.body.data).toHaveLength(6);
    expect(list.body.data.find((p: any) => p.product === 'pms' && p.plan === 'basic').monthlyPrice).toBe(2450);

    const edited = await api('put', '/plans/pms/basic').send({ price: 2600 });
    expect(edited.status).toBe(200);
    expect(edited.body.data.monthlyPrice).toBe(2600);
    expect((await api('put', '/plans/pms/basic').send({ price: -5 })).status).toBe(400);
    expect((await api('put', '/plans/pms/gold').send({ price: 100 })).status).toBe(404);
    expect((await api('put', '/plans/hotel/basic').send({ price: 100 })).status).toBe(404);
  });

  itDb('settings: tax, due days and instructions are validated', async () => {
    expect((await api('get', '/settings')).body.data).toMatchObject({ tax: 'itbis18', dueDays: 10 });
    const ok = await api('put', '/settings').send({ tax: 'exempt', dueDays: 15, notifyEmail: 'Ops@Pilloto.com', paymentInstructions: 'Banco X' });
    expect(ok.body.data).toEqual({ tax: 'exempt', dueDays: 15, notifyEmail: 'ops@pilloto.com', paymentInstructions: 'Banco X' });
    const bad = await api('put', '/settings').send({ tax: 'iva', dueDays: 400, notifyEmail: 'nope' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['tax', 'dueDays', 'notifyEmail']));
  });

  itDb('a tenant’s contract, and a scheduled price with its reason', async () => {
    const detail = await api('get', `/tenants/${tenantId}`);
    expect(detail.body.data.products).toEqual([
      expect.objectContaining({ product: 'pms', plan: 'pro', listPrice: 5540, contractPrice: 5540 }),
      expect.objectContaining({ product: 'accounting', plan: 'plus', listPrice: 9370, contractPrice: 9370 }),
    ]);

    const nextMonth = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); })();
    const scheduled = await api('post', `/tenants/${tenantId}/price-changes`).send({ product: 'pms', price: 4000, effectiveFrom: nextMonth, reason: 'Acuerdo comercial anual' });
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.data.priceChanges).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'dueno@prueba.com' }));

    const tooShort = await api('post', `/tenants/${tenantId}/price-changes`).send({ product: 'pms', price: 4000, effectiveFrom: nextMonth, reason: 'x' });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.fields.reason).toBeDefined();
    const past = await api('post', `/tenants/${tenantId}/price-changes`).send({ product: 'pms', price: 4000, effectiveFrom: '2020-01', reason: 'Acuerdo comercial anual' });
    expect(past.status).toBe(409);

    const id = scheduled.body.data.priceChanges[0].id;
    const cancelled = await api('delete', `/tenants/${tenantId}/price-changes/${id}`);
    expect(cancelled.body.data.priceChanges).toHaveLength(0);
  });

  itDb('billing email and pausing', async () => {
    const r = await api('patch', `/tenants/${tenantId}`).send({ billingEmail: 'Pagos@Prueba.com', paused: true });
    expect(r.body.data).toMatchObject({ billingEmail: 'pagos@prueba.com', paused: true });
    expect((await api('patch', `/tenants/${tenantId}`).send({ billingEmail: 'nope' })).status).toBe(400);
  });

  itDb('generates a charge, lists it, shows it, and voids it', async () => {
    const charge = await generate();
    expect(charge).toMatchObject({ period: lastPeriod, status: 'open', total: 17593.8, overdue: false });
    expect(charge.tenant).toMatchObject({ name: 'Hotel Prueba' });

    expect((await api('post', '/charges/generate').send({ tenantId: String(tenantId), period: lastPeriod })).body.data.created).toBe(false);
    expect((await api('post', '/charges/generate').send({ tenantId: String(tenantId), period: '2999-01' })).status).toBe(409);

    const list = await api('get', '/charges?status=open');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toMatchObject({ total: 1, page: 1 });
    expect((await api('get', '/charges?status=paid')).body.data).toHaveLength(0);
    expect((await api('get', `/charges/${charge.id}`)).body.data).toMatchObject({ number: charge.number, payments: [] });

    expect((await api('post', `/charges/${charge.id}/void`).send({ reason: '' })).status).toBe(400);
    expect((await api('post', `/charges/${charge.id}/void`).send({ reason: 'Generado por error' })).body.data.status).toBe('void');
  });

  itDb('lists overdue charges', async () => {
    const charge = await generate();
    await BillingCharge.updateOne({ _id: charge.id }, { $set: { dueDate: '2020-01-01' } });
    const overdue = await api('get', '/charges?overdue=true');
    expect(overdue.body.data).toHaveLength(1);
    expect(overdue.body.data[0].overdue).toBe(true);
    const overview = await api('get', '/overview');
    expect(overview.body.data.overdue).toMatchObject({ count: 1, balance: 17593.8 });
  });

  itDb('recording a payment issues the e-CF and returns both; the files and the email follow', async () => {
    const charge = await generate();
    const paid = await api('post', `/charges/${charge.id}/payments`).send({ amount: charge.total, method: 'transfer', reference: 'TRF-77', paidAt: new Date().toISOString() });
    expect(paid.status).toBe(201);
    expect(paid.body.data.charge).toMatchObject({ status: 'paid', balance: 0 });
    const payment = paid.body.data.payment;
    expect(payment).toMatchObject({ amount: charge.total, method: 'transfer', ecfError: null, status: 'recorded' });
    expect(payment.ecf).toMatchObject({ tipo: 'E31', hasDocument: true, total: charge.total });
    expect(payment.ecf.eNCF).toMatch(/^E31\d{10}$/);

    const pdf = await api('get', `/payments/${payment.id}/ecf/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const xml = await api('get', `/payments/${payment.id}/ecf/xml`);
    expect(xml.headers['content-disposition']).toContain('.xml');

    const email = await api('post', `/payments/${payment.id}/ecf/email`).send({ email: 'contabilidad@prueba.com' });
    expect(email.body.data.sentTo).toBe('contabilidad@prueba.com');

    const list = await api('get', '/payments');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ chargeNumber: charge.number, tenant: { name: 'Hotel Prueba' } });
  });

  itDb('a bad payment answers 400 with the fields and records nothing', async () => {
    const charge = await generate();
    const r = await api('post', `/charges/${charge.id}/payments`).send({ amount: 999999, method: 'transfer' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.fields)).toEqual(expect.arrayContaining(['amount', 'reference']));
    expect(await BillingPayment.countDocuments({})).toBe(0);
  });

  itDb('without Pilloto’s own e-invoicing linked the payment is recorded, says why, and can issue later', async () => {
    await seedPlatform(null);
    const charge = await generate();
    const paid = await api('post', `/charges/${charge.id}/payments`).send({ amount: charge.total, method: 'cash' });
    expect(paid.status).toBe(201);
    expect(paid.body.data.payment).toMatchObject({ ecf: null });
    expect(paid.body.data.payment.ecfError).toMatch(/not set up/i);
    const overview = await api('get', '/overview');
    expect(overview.body.data.ecf.notIssued).toBe(1);

    await seedPlatform();
    const retried = await api('post', `/payments/${paid.body.data.payment.id}/ecf`);
    expect(retried.status).toBe(200);
    expect(retried.body.data.ecf).toMatchObject({ tipo: 'E31' });
    expect(retried.body.data.ecfError).toBeNull();
    expect((await api('get', '/payments?ecf=missing')).body.data).toHaveLength(0);
  });

  itDb('reversing a payment before DGII answers is refused; a refresh then the reversal credits it', async () => {
    const charge = await generate();
    const paid = await api('post', `/charges/${charge.id}/payments`).send({ amount: charge.total, method: 'cash' });
    const payment = paid.body.data.payment;
    const early = await api('post', `/payments/${payment.id}/reverse`).send({ reason: 'Pago duplicado' });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('BILLING_ECF_PENDING');

    const record = await ElectronicInvoice.findById(payment.ecf.id);
    fake.setStatus(record!.billingsoftDocumentId!, 'accepted');
    const refreshed = await api('post', `/payments/${payment.id}/refresh`).send({});
    expect(refreshed.body.data.ecf.estado).toBe('Aceptado');

    const reversed = await api('post', `/payments/${payment.id}/reverse`).send({ reason: 'Pago duplicado' });
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.payment.status).toBe('reversed');
    expect(reversed.body.data.charge).toMatchObject({ status: 'open', balance: charge.total });
    expect(await ElectronicInvoice.countDocuments({ tipo: 'E34' })).toBe(1);
  });

  itDb('the overview adds up what is owed and what came in', async () => {
    const charge = await generate();
    await api('post', `/charges/${charge.id}/payments`).send({ amount: 5000, method: 'cash' });
    const overview = (await api('get', '/overview')).body.data;
    expect(overview.outstanding).toMatchObject({ count: 1, balance: round(charge.total - 5000) });
    expect(overview.collectedThisMonth).toMatchObject({ count: 1, amount: 5000 });
    expect(overview.issuer.state).toBe('ready');
  });

  itDb('tenants: balance and last payment per tenant', async () => {
    const charge = await generate();
    await api('post', `/charges/${charge.id}/payments`).send({ amount: 5000, method: 'cash' });
    const list = (await api('get', '/tenants')).body.data;
    expect(list[0]).toMatchObject({ name: 'Hotel Prueba', outstanding: round(charge.total - 5000), openCharges: 1, rnc: '131880681' });
    expect(list[0].lastPayment.amount).toBe(5000);
  });

  describe('Pilloto’s own e-CF webhook', () => {
    const hook = express();
    hook.use('/api/webhooks/billingsoft', fiscalWebhookRoutes);
    const SECRET = 'whsec_platform_test';
    const send = (body: object, secret = SECRET) => {
      const raw = Buffer.from(JSON.stringify(body));
      const t = String(Math.floor(Date.now() / 1000));
      return request(hook)
        .post(`/api/webhooks/billingsoft/${String(PLATFORM_ISSUER_ID)}`)
        .set('BillingSoft-Signature', `t=${t},v1=${computeSignature(secret, t, raw)}`)
        .set('Content-Type', 'application/json')
        .send(raw.toString('utf8')); // a string: superagent would JSON-encode a Buffer
    };

    itDb('a signed DGII verdict updates the e-CF of a payment, with Pilloto’s real organization id in the event', async () => {
      await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'billing.fiscal.webhookSecret': encrypt(SECRET) } });
      const charge = await generate();
      const paid = await api('post', `/charges/${charge.id}/payments`).send({ amount: charge.total, method: 'cash' });
      const record = await ElectronicInvoice.findById(paid.body.data.payment.ecf.id);
      fake.setStatus(record!.billingsoftDocumentId!, 'accepted');

      const answer = await send({ id: 'evt-1', type: 'document.accepted', organizationId: 'org-pilloto-real', data: { documentId: record!.billingsoftDocumentId } });
      expect(answer.status).toBe(200);
      expect(answer.body.outcome).toBe('handled');
      expect((await ElectronicInvoice.findById(record!._id))!.estadoECF).toBe('Aceptado');
      // The same delivery again is recognised, not handled twice.
      expect((await send({ id: 'evt-1', type: 'document.accepted', organizationId: 'org-pilloto-real', data: { documentId: record!.billingsoftDocumentId } })).body.outcome).toBe('duplicate');
    });

    itDb('a forged signature is refused', async () => {
      await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'billing.fiscal.webhookSecret': encrypt(SECRET) } });
      expect((await send({ id: 'evt-2', type: 'document.accepted', organizationId: 'x', data: {} }, 'wrong-secret')).status).toBe(401);
    });
  });

  describe('Pilloto’s own e-CF', () => {
    itDb('is linked with the partner key acting for itself, certification read from BillingSoft, webhook registered', async () => {
      await seedPlatform(null);
      expect((await api('get', '/issuer')).body.data).toMatchObject({ linked: false, state: 'inactive', configured: true });
      const linked = await api('post', '/issuer/link');
      expect(linked.status).toBe(200);
      expect(linked.body.data).toMatchObject({ linked: true, state: 'ready', certification: 'certified', environment: 'ecf', webhookRegistered: true, rnc: '131000000' });
      expect(fake.calls).toContain('onboarding self');
      expect(fake.calls.some((c) => c.startsWith('setWebhook') && c.includes(`/api/webhooks/billingsoft/${String(PLATFORM_ISSUER_ID)}`))).toBe(true);
      // the secret is stored encrypted and never returned
      expect(JSON.stringify(linked.body)).not.toContain('whsec_');
    });

    itDb('follows certification progress when synced', async () => {
      fake.own = { environment: 'certecf', certification: 'in_progress' };
      await seedPlatform(null);
      await api('post', '/issuer/link');
      expect((await api('get', '/issuer')).body.data).toMatchObject({ state: 'in_progress' });
      fake.own = { environment: 'ecf', certification: 'certified' };
      expect((await api('post', '/issuer/sync')).body.data).toMatchObject({ state: 'ready' });
    });

    itDb('shows live readiness and records e-NCF ranges for itself', async () => {
      const readiness = await api('get', '/issuer/readiness');
      expect(readiness.status).toBe(200);
      expect(readiness.body.data).toMatchObject({ certification: 'certified', certificate: 'valid', usableTypes: ['31', '32'] });
      const recorded = await api('post', '/issuer/sequences').send({ documentType: '31', rangeStart: 1, rangeEnd: 100 });
      expect(recorded.status).toBe(201);
      expect((await api('get', '/issuer/sequences')).body.data).toHaveLength(1);
    });

    itDb('readiness says so when it is not linked', async () => {
      await seedPlatform(null);
      const r = await api('get', '/issuer/readiness');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('FISCAL_NOT_ACTIVATED');
    });
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }
