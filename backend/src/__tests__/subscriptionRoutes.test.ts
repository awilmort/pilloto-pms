/**
 * The tenant's "Plan y facturación" API (routes/subscription.ts) and HandyPay online payments
 * (routes/handypayWebhook.ts), against a local Mongo with a fake HandyPay client.
 */
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

jest.mock('../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue('email-id') }));
const mockUser: any = { _id: new (require('mongoose').Types.ObjectId)(), email: 'owner@sol.com', isSuperAdmin: true };
jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = mockUser; next(); },
  userHasPermission: async (user: any, app: string, perms: string[]) => (user.grants ?? []).some((g: string) => perms.includes(g) && g.startsWith(app === 'pms' ? 'admin' : 'accounting')),
}));

/* eslint-disable import/first */
import subscriptionRoutes from '../routes/subscription';
import handypayWebhook from '../routes/handypayWebhook';
import { tenantLocalStorage } from '../middleware/tenantContext';
import BillingCharge from '../models/BillingCharge';
import BillingOnlinePayment from '../models/BillingOnlinePayment';
import BillingPayment from '../models/BillingPayment';
import PlanPrice from '../models/PlanPrice';
import PlatformSettings from '../models/PlatformSettings';
import Room from '../models/Room';
import Tenant from '../models/Tenant';
import Account from '../models/Account';
import { HandyPayClient, HandyPaySession, parseSession, setHandyPayClient, verifyHandyPaySignature } from '../services/handypay/handypayClient';
import { setBillingSoftClient } from '../services/fiscal/fiscalClient';
import { startSubscription, subscriptionOf } from '../services/platformBilling/subscriptions';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import { createFakeBillingSoft } from './helpers/fakeBillingSoft';
/* eslint-enable import/first */

jest.setTimeout(30_000);
const SECRET = 'whsec_test';

function fakeHandyPay() {
  const sessions = new Map<string, HandyPaySession>();
  let n = 0;
  const created: any[] = [];
  const client: HandyPayClient = {
    async createSession(input) {
      const id = `cs_test_${++n}`;
      created.push(input);
      sessions.set(id, { id, url: `https://pay.handypay.me/c/${id}`, status: 'open', paymentStatus: 'unpaid', amountTotal: input.amount, currency: input.currency });
      return sessions.get(id)!;
    },
    async getSession(id) {
      const s = sessions.get(id);
      if (!s) throw new Error('not found');
      return s;
    },
  };
  return { client, created, pay: (id: string) => sessions.set(id, { ...sessions.get(id)!, status: 'complete', paymentStatus: 'paid', paymentIntent: 'pi_123' }) };
}

const sign = (body: string) => `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;

describe('HandyPay pieces (pure)', () => {
  it('verifies the signature over the raw body in constant time', () => {
    const body = '{"id":"evt_1"}';
    expect(verifyHandyPaySignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyHandyPaySignature(body + ' ', sign(body), SECRET)).toBe(false);
    expect(verifyHandyPaySignature(body, 'sha256=abc', SECRET)).toBe(false);
    expect(verifyHandyPaySignature(body, undefined, SECRET)).toBe(false);
    expect(verifyHandyPaySignature(body, sign(body), '')).toBe(false);
  });

  it('reads a session whether HandyPay wraps it or not', () => {
    expect(parseSession({ id: 'cs_1', url: 'u', payment_status: 'paid', amount_total: 500 })).toMatchObject({ id: 'cs_1', paymentStatus: 'paid', amountTotal: 500 });
    expect(parseSession({ success: true, data: { session: { id: 'cs_2', checkout_url: 'u2' } } })).toMatchObject({ id: 'cs_2', url: 'u2' });
    expect(() => parseSession({ success: true })).toThrow();
  });
});

describe('subscription API (local Mongo)', () => {
  let ready = false;
  let hp: ReturnType<typeof fakeHandyPay>;
  const tenantId = new mongoose.Types.ObjectId();
  const app = express();
  app.use('/api/webhooks/handypay', handypayWebhook);
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = String(tenantId);
    Tenant.findById(tenantId).lean().then((t) => { req.tenant = t; tenantLocalStorage.run({ tenantId: String(tenantId) }, next); });
  });
  app.use('/api/subscription', subscriptionRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const load = () => Tenant.findById(tenantId).then((t) => t!);
  const inTenant = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);

  beforeAll(async () => {
    process.env.BILLINGSOFT_PARTNER_API_KEY = 'test-partner-key';
    process.env.HANDYPAY_API_KEY = 'hp_test_key';
    process.env.HANDYPAY_WEBHOOK_SECRET = SECRET;
    ready = await connectTestDb('pilloto_subscription_api');
    if (ready) await Promise.all([BillingCharge.init(), PlanPrice.init(), BillingOnlinePayment.init(), BillingPayment.init()]);
    if (!ready) console.warn('Mongo unreachable — skipping subscription API tests');
  });
  afterAll(async () => {
    setHandyPayClient(null);
    setBillingSoftClient(null);
    ['BILLINGSOFT_PARTNER_API_KEY', 'HANDYPAY_API_KEY', 'HANDYPAY_WEBHOOK_SECRET'].forEach((k) => delete process.env[k]);
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    if (!ready) return;
    mockUser.isSuperAdmin = true;
    delete mockUser.grants;
    hp = fakeHandyPay();
    setHandyPayClient(hp.client);
    setBillingSoftClient(createFakeBillingSoft().client);
    await Promise.all([BillingCharge, BillingOnlinePayment, BillingPayment, PlanPrice, PlatformSettings, Tenant, Room, Account].map((m: any) => m.collection.deleteMany({})));
    await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'billing.tax': 'itbis18', 'billing.dueDays': 10, 'billing.paymentInstructions': 'Banco X 123' } }, { upsert: true });
    await Tenant.collection.insertOne({
      _id: tenantId, name: 'Hotel Sol', slug: 'sol', plan: 'basic', plans: {}, products: [], ownerEmail: 'owner@sol.com', isActive: true,
      createdAt: new Date('2026-09-01T12:00:00Z'), updatedAt: new Date(), profile: { legalName: 'Hotel Sol SRL', rnc: '131880681' },
    });
    await startSubscription(await load(), 'pms', 'pro', { trialDays: 0, now: new Date('2026-09-01T15:00:00Z') });
  });

  itDb('the overview shows each product, its price, usage and what can be added', async () => {
    const r = await request(app).get('/api/subscription');
    expect(r.status).toBe(200);
    expect(r.body.data.products).toEqual([expect.objectContaining({ product: 'pms', plan: 'pro', planName: 'Pro', status: 'active', price: 5540, monthly: 5540, discount: null })]);
    expect(r.body.data.available).toEqual(['accounting']);
    expect(r.body.data.usage.pms).toEqual({ users: 0, rooms: 0 });
    expect(r.body.data.ecf.includedPlan).toBe('essential');
  });

  itDb('only the owner or a holder of the subscription permission gets in', async () => {
    mockUser.isSuperAdmin = false;
    expect((await request(app).get('/api/subscription')).status).toBe(403);
    mockUser.grants = ['admin.subscription'];
    expect((await request(app).get('/api/subscription')).status).toBe(200);
  });

  itDb('adding Accounting starts a trial, seeds its chart and brings the suite discount', async () => {
    const r = await request(app).post('/api/subscription/products').send({ product: 'accounting', plan: 'essentials' });
    expect(r.status).toBe(201);
    const acc = r.body.data.products.find((p: any) => p.product === 'accounting');
    expect(acc).toMatchObject({ status: 'trial', price: 4090, discount: { kind: 'suite', value: 20, amount: 818 }, monthly: 3272 });
    expect((await load()).products).toEqual(['pms', 'accounting']);
    expect(await inTenant(() => Account.countDocuments({}))).toBeGreaterThan(5);
    expect((await request(app).post('/api/subscription/products').send({ product: 'accounting', plan: 'pro' })).body.code).toBe('BILLING_STATE');
  });

  itDb('an upgrade applies today; a downgrade is blocked while usage is above it, then scheduled', async () => {
    const up = await request(app).post('/api/subscription/change').send({ product: 'pms', plan: 'enterprise' });
    expect(up.body.data.outcome).toBe('upgraded');
    expect((await load()).plan).toBe('enterprise');

    await inTenant(() => Room.collection.insertMany(Array.from({ length: 16 }, (_, i) => ({ tenantId, roomNumber: String(100 + i), status: 'active' }))));
    const blocked = await request(app).post('/api/subscription/change').send({ product: 'pms', plan: 'basic' });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: 'PLAN_DOWNGRADE_BLOCKED', violations: [{ limit: 'rooms', max: 15, current: 16 }] });

    const catalog = await request(app).get('/api/subscription/catalog');
    expect(catalog.body.data.pms.find((p: any) => p.slug === 'basic')).toMatchObject({ direction: -2, violations: [{ limit: 'rooms' }] });

    const down = await request(app).post('/api/subscription/change').send({ product: 'pms', plan: 'pro' });
    expect(down.body.data.outcome).toBe('scheduled');
    expect(subscriptionOf(await load(), 'pms')!.pendingPlan!.plan).toBe('pro');
    expect((await load()).plan).toBe('enterprise'); // until next month
    const undo = await request(app).post('/api/subscription/change').send({ product: 'pms', plan: 'enterprise' });
    expect(undo.body.data.outcome).toBe('unscheduled');
  });

  itDb('the only product cannot be cancelled here; a second one can, and be kept again', async () => {
    expect((await request(app).delete('/api/subscription/products/pms')).body.code).toBe('BILLING_LAST_PRODUCT');
    await startSubscription(await load(), 'accounting', 'invoicing', { trialDays: 0, now: new Date('2026-09-01T15:00:00Z') });
    const cancelled = await request(app).delete('/api/subscription/products/accounting');
    expect(cancelled.body.data.products.find((p: any) => p.product === 'accounting').status).toBe('cancelling');
    const kept = await request(app).post('/api/subscription/products/accounting/keep');
    expect(kept.body.data.products.find((p: any) => p.product === 'accounting').status).toBe('active');
  });

  describe('listing charges', () => {
    const seed = (n: number, period: string, over: Record<string, unknown> = {}) =>
      BillingCharge.create({
        tenantId, number: `COB-${String(n).padStart(6, '0')}`, period, lines: [{ kind: 'subscription', product: 'pms', description: 'Suscripción', amount: 1000 }],
        subtotal: 1000, tax: 'itbis18', itbis: 180, total: 1180, paidAmount: 0, balance: 1180, status: 'open', dueDate: '2020-01-15', ...over,
      });
    const paid = { status: 'paid', paidAmount: 1180, balance: 0 };

    itDb('pages newest first, past the old 36-charge cap, with totals over every page', async () => {
      for (let i = 0; i < 40; i++) {
        const month = i % 12 + 1;
        await seed(900 + i, `${2022 + Math.floor(i / 12)}-${String(month).padStart(2, '0')}`, i < 38 ? paid : {});
      }
      const first = await request(app).get('/api/subscription/charges');
      expect(first.body.data).toHaveLength(12);
      expect(first.body.meta).toMatchObject({ total: 40, page: 1, limit: 12, pages: 4 });
      const periods = first.body.data.map((c: any) => c.period);
      expect(periods).toEqual([...periods].sort().reverse());
      const last = await request(app).get('/api/subscription/charges?page=4');
      expect(last.body.data).toHaveLength(4);
      // the two unpaid charges are counted even though they are not on page 4
      expect(last.body.summary).toEqual({ outstanding: 2360, overdueCount: 2, overdueBalance: 2360 });
    });

    itDb('filters by status and searches by number or month, never leaking another tenant or voided charges', async () => {
      await seed(801, '2026-01', paid);
      await seed(802, '2026-02');
      await seed(803, '2026-03', { status: 'partial', paidAmount: 500, balance: 680 });
      await seed(804, '2026-04', { status: 'void', isCurrent: false });
      await BillingCharge.create({
        tenantId: new mongoose.Types.ObjectId(), number: 'COB-000805', period: '2026-02', lines: [{ kind: 'subscription', description: 'x', amount: 1 }],
        subtotal: 1, tax: 'itbis18', itbis: 0, total: 1, paidAmount: 0, balance: 1, status: 'open', dueDate: '2026-12-01',
      });
      const numbers = async (qs: string) => (await request(app).get(`/api/subscription/charges?${qs}`)).body.data.map((c: any) => c.number);
      expect(await numbers('')).toEqual(['COB-000803', 'COB-000802', 'COB-000801']);
      expect(await numbers('status=pending')).toEqual(['COB-000803', 'COB-000802']);
      expect(await numbers('status=paid')).toEqual(['COB-000801']);
      expect(await numbers('search=2026-02')).toEqual(['COB-000802']);
      expect(await numbers('search=cob-000801')).toEqual(['COB-000801']);
      expect(await numbers('search=2026&status=paid')).toEqual(['COB-000801']);
      expect(await numbers('search=nothing')).toEqual([]);
      // regex characters in a search are text, not a pattern
      expect(await numbers('search=.*')).toEqual([]);
    });

    itDb('clamps a silly page size and page number', async () => {
      await seed(701, '2026-01');
      const r = await request(app).get('/api/subscription/charges?limit=100000&page=-3');
      expect(r.body.meta).toMatchObject({ page: 1, limit: 50, total: 1 });
    });
  });

  describe('paying a charge online', () => {
    const seedCharge = () =>
      BillingCharge.create({
        tenantId, number: 'COB-000777', period: '2026-10', lines: [{ kind: 'subscription', product: 'pms', description: 'Suscripción', amount: 5540 }],
        subtotal: 5540, tax: 'itbis18', itbis: 997.2, total: 6537.2, paidAmount: 0, balance: 6537.2, status: 'open', dueDate: '2026-11-15',
      });
    const event = (type: string, id: string, eventId = `evt_${Math.random()}`) => JSON.stringify({ id: eventId, type, data: { object: { id } } });

    itDb('creates a HandyPay session for the balance in centavos and returns to the tenant\'s page', async () => {
      const c = await seedCharge();
      const r = await request(app).post(`/api/subscription/charges/${c._id}/pay`).send({ returnUrl: '/accounting/subscription' });
      expect(r.status).toBe(200);
      expect(r.body.data.url).toMatch(/^https:\/\/pay\.handypay\.me\//);
      expect(hp.created[0]).toMatchObject({ amount: 653720, currency: 'dop', customerEmail: 'owner@sol.com' });
      expect(hp.created[0].successUrl).toMatch(/sol\..*\/accounting\/subscription\?payment=success&session=\{CHECKOUT_SESSION_ID\}$/);
      // a second click reuses the open session
      const again = await request(app).post(`/api/subscription/charges/${c._id}/pay`).send({ returnUrl: 'https://evil.example' });
      expect(again.body.data.sessionId).toBe(r.body.data.sessionId);
      expect(hp.created).toHaveLength(1);
    });

    itDb('a signed completed event records the payment once, as a card payment from HandyPay', async () => {
      const c = await seedCharge();
      const { body } = await request(app).post(`/api/subscription/charges/${c._id}/pay`).send({});
      const sessionId = body.data.sessionId;

      const unpaid = event('checkout.session.completed', sessionId, 'evt_early');
      expect((await request(app).post('/api/webhooks/handypay').set('X-HandyPay-Signature', sign(unpaid)).set('Content-Type', 'application/json').send(unpaid)).body.outcome).toBe('not_paid');

      hp.pay(sessionId);
      const paid = event('checkout.session.completed', sessionId, 'evt_paid');
      const first = await request(app).post('/api/webhooks/handypay').set('X-HandyPay-Signature', sign(paid)).set('Content-Type', 'application/json').send(paid);
      expect(first.body.outcome).toBe('recorded');
      const dup = await request(app).post('/api/webhooks/handypay').set('X-HandyPay-Signature', sign(paid)).set('Content-Type', 'application/json').send(paid);
      expect(dup.body.duplicate).toBe(true);
      // the return page confirms too, without a second payment
      expect((await request(app).post(`/api/subscription/online-payments/${sessionId}/confirm`)).body.data.outcome).toBe('already_recorded');

      const payments = await BillingPayment.find({ chargeId: c._id });
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({ amount: 6537.2, method: 'card', source: 'handypay', reference: 'pi_123' });
      expect((await BillingCharge.findById(c._id))!.status).toBe('paid');

      const detail = await request(app).get(`/api/subscription/charges/${c._id}`);
      expect(detail.body.data.payments).toHaveLength(1);
    });

    itDb('an unsigned or forged event is refused', async () => {
      const body = event('checkout.session.completed', 'cs_x');
      expect((await request(app).post('/api/webhooks/handypay').set('Content-Type', 'application/json').send(body)).status).toBe(401);
      expect((await request(app).post('/api/webhooks/handypay').set('X-HandyPay-Signature', sign(body + 'x')).set('Content-Type', 'application/json').send(body)).status).toBe(401);
    });

    itDb('a payment that no longer fits the charge is set aside for review, not lost', async () => {
      const c = await seedCharge();
      const { body } = await request(app).post(`/api/subscription/charges/${c._id}/pay`).send({});
      await BillingCharge.updateOne({ _id: c._id }, { $set: { balance: 100, paidAmount: 6437.2, status: 'partial' } }); // paid by transfer meanwhile
      hp.pay(body.data.sessionId);
      const r = await request(app).post(`/api/subscription/online-payments/${body.data.sessionId}/confirm`);
      expect(r.body.data.outcome).toBe('needs_review');
      expect((await BillingOnlinePayment.findOne({ sessionId: body.data.sessionId }))!.status).toBe('needs_review');
    });

    itDb('without HandyPay keys online payment is unavailable', async () => {
      const c = await seedCharge();
      delete process.env.HANDYPAY_API_KEY;
      const r = await request(app).post(`/api/subscription/charges/${c._id}/pay`).send({});
      process.env.HANDYPAY_API_KEY = 'hp_test_key';
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('PAYMENT_GATEWAY_OFF');
    });
  });
});
