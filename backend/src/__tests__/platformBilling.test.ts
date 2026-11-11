/**
 * Pilloto's own subscription billing against a local Mongo: the price list, tenant contracts, the
 * monthly charge, payments and the e-CF each one issues (Pilloto as issuer, through the same
 * pipeline as a tenant). The BillingSoft side is the stateful fake.
 */
import mongoose from 'mongoose';

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
import { FiscalError } from '../services/fiscal/fiscalCore';
import { setBillingSoftClient } from '../services/fiscal/fiscalClient';
import { sendIntent } from '../services/fiscal/fiscalIssuer';
import { refreshRecord } from '../services/fiscal/fiscalSync';
import { getPlatformIssuer, PLATFORM_ISSUER_ID } from '../services/fiscal/platformIssuer';
import { generateCharge, runMonthlyBilling, voidCharge } from '../services/platformBilling/billingCharges';
import { cancelPriceChange, endDiscount, grantDiscount, resolveContracts, schedulePriceChange } from '../services/platformBilling/billingContracts';
import { getCatalog, setPlanPrice } from '../services/platformBilling/billingPlans';
import { ecfOf, recordPayment, retryEcf, reversePayment, sendDueReceipts } from '../services/platformBilling/billingPayments';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import { createFakeBillingSoft, FakeBillingSoft, networkError, validationError } from './helpers/fakeBillingSoft';
/* eslint-enable import/first */

// Each test seeds a database and runs the e-CF pipeline: allow for a busy machine.
jest.setTimeout(30_000);

describe('platform billing (local Mongo)', () => {
  let ready = false;
  let fake: FakeBillingSoft;
  const tenantId = new mongoose.Types.ObjectId();
  const actor = { userId: new mongoose.Types.ObjectId(), email: 'ops@pilloto.com' };
  const NOW = new Date('2026-11-05T15:00:00Z'); // Nov 2026 in the Dominican Republic: charges cover 2026-10
  const PERIOD = '2026-10';
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const loadTenant = () => Tenant.findById(tenantId).then((t) => t!);
  const emails = () => (sendEmail as jest.Mock).mock.calls.map((c) => c[0]);

  const seedPlatform = (fiscal: Record<string, unknown> | null = { organizationId: 'self', environment: 'ecf', certification: 'certified', isActive: true, plan: 'essential' }) =>
    PlatformSettings.updateOne(
      { key: 'global' },
      { $set: { 'billing.notifyEmail': 'ops@pilloto.com', 'billing.tax': 'itbis18', 'billing.dueDays': 10, ...(fiscal ? { 'billing.fiscal': fiscal } : {}) }, ...(fiscal ? {} : { $unset: { 'billing.fiscal': '' } }) },
      { upsert: true },
    );

  const seedTenant = (over: Record<string, unknown> = {}) =>
    Tenant.collection.insertOne({
      _id: tenantId, name: 'Hotel Prueba', slug: 'prueba', plan: 'pro', plans: { accounting: 'plus' }, products: ['pms', 'accounting'],
      ownerEmail: 'dueno@prueba.com', isActive: true, createdAt: new Date('2026-01-01T12:00:00Z'), updatedAt: new Date(),
      profile: { legalName: 'Hotel Prueba SRL', rnc: '131880681', email: 'info@prueba.com' },
      ...over,
    });

  const closedStatement = () =>
    FiscalStatement.collection.insertOne({
      tenantId, period: PERIOD, status: 'closed', currency: 'DOP', plan: 'pro', includedPlan: 'essential', planPrice: 800, includedPlanPrice: 475, planCharge: 325,
      transactions: { included: 1000, used: 1200, extra: 200 }, overageUnitPrice: 2.4, overageAmount: 480, total: 805, planChanges: [], usageSource: 'billingsoft',
    });

  const charge = async (opts: { notify?: boolean } = {}) => {
    const result = await generateCharge(await loadTenant(), PERIOD, { now: NOW, notify: false, ...opts });
    return result.charge!;
  };
  const pay = (chargeDoc: any, over: Record<string, unknown> = {}) =>
    recordPayment(chargeDoc._id, { amount: chargeDoc.balance, method: 'transfer', reference: 'TRF-1', paidAt: '2026-11-04T15:00:00Z', ...over }, actor, NOW);

  beforeAll(async () => {
    process.env.BILLINGSOFT_PARTNER_API_KEY = 'test-partner-key';
    ready = await connectTestDb('pilloto_platform_billing');
    if (ready) await Promise.all([ElectronicInvoice.init(), BillingCharge.init(), PlanPrice.init(), BillingPayment.init()]);
    if (!ready) console.warn('Mongo unreachable — skipping platform billing DB tests');
  });
  afterAll(async () => {
    setBillingSoftClient(null);
    delete process.env.BILLINGSOFT_PARTNER_API_KEY;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    if (!ready) return;
    jest.clearAllMocks();
    fake = createFakeBillingSoft();
    setBillingSoftClient(fake.client);
    await Promise.all([BillingCharge, BillingPayment, ElectronicInvoice, FiscalStatement, PlanPrice, PlatformSettings, Tenant].map((m: any) => m.collection.deleteMany({})));
    await seedPlatform();
    await seedTenant();
  });

  describe('price list', () => {
    itDb('starts from the agreed prices, in pesos', async () => {
      const catalog = await getCatalog();
      const price = (product: string, plan: string) => catalog.find((c) => c.product === product && c.plan === plan)!.monthlyPrice;
      expect([price('pms', 'basic'), price('pms', 'pro'), price('pms', 'enterprise')]).toEqual([2450, 5540, 9370]);
      expect([price('accounting', 'starter'), price('accounting', 'pro'), price('accounting', 'plus')]).toEqual([2450, 5540, 9370]);
    });

    itDb('records who changed a price and what it was', async () => {
      await setPlanPrice('pms', 'pro', 6000, actor, NOW);
      const entry = (await getCatalog()).find((c) => c.product === 'pms' && c.plan === 'pro')!;
      expect(entry.monthlyPrice).toBe(6000);
      expect(entry.history.slice(-1)[0]).toMatchObject({ previous: 5540, price: 6000, changedByEmail: 'ops@pilloto.com' });
    });

    itDb('refuses nonsense prices and unknown plans', async () => {
      await expect(setPlanPrice('pms', 'pro', -1, actor)).rejects.toMatchObject({ code: 'BILLING_INVALID' });
      await expect(setPlanPrice('pms', 'pro', 'abc', actor)).rejects.toMatchObject({ code: 'BILLING_INVALID' });
      await expect(setPlanPrice('pms', 'gold', 100, actor)).rejects.toMatchObject({ code: 'BILLING_PLAN_UNKNOWN' });
    });
  });

  describe('contracts', () => {
    itDb('fix the price at the first charge; a later price list change does not reach the tenant', async () => {
      const first = await resolveContracts(await loadTenant(), PERIOD);
      expect(first).toEqual([
        { product: 'pms', plan: 'pro', price: 5540, source: 'catalog' },
        { product: 'accounting', plan: 'plus', price: 9370, source: 'catalog' },
      ]);
      await setPlanPrice('pms', 'pro', 9999, actor);
      const again = await resolveContracts(await loadTenant(), '2026-11');
      expect(again.find((c) => c.product === 'pms')!.price).toBe(5540);
    });

    itDb('take the list price again when the tenant changes plan', async () => {
      await resolveContracts(await loadTenant(), PERIOD);
      await setPlanPrice('pms', 'enterprise', 9500, actor);
      await Tenant.updateOne({ _id: tenantId }, { $set: { plan: 'enterprise' } });
      const after = await resolveContracts(await loadTenant(), '2026-11');
      expect(after.find((c) => c.product === 'pms')).toMatchObject({ plan: 'enterprise', price: 9500 });
    });

    itDb('apply a scheduled price from its month on, not before, and tell the tenant why', async () => {
      await resolveContracts(await loadTenant(), PERIOD);
      await schedulePriceChange(await loadTenant(), { product: 'pms', price: 4000, effectiveFrom: '2026-12', reason: 'Acuerdo comercial por contrato anual' }, actor, NOW);
      expect(emails()).toHaveLength(1);
      expect(emails()[0]).toMatchObject({ to: 'dueno@prueba.com' });
      expect(emails()[0].html).toContain('Acuerdo comercial por contrato anual');
      expect(emails()[0].html).toContain('diciembre 2026');

      expect((await resolveContracts(await loadTenant(), '2026-11')).find((c) => c.product === 'pms')!.price).toBe(5540);
      const december = await resolveContracts(await loadTenant(), '2026-12');
      expect(december.find((c) => c.product === 'pms')).toMatchObject({ price: 4000, source: 'override' });
      expect(december.find((c) => c.product === 'accounting')!.price).toBe(9370);
      const stored = (await loadTenant()).billing!.priceChanges[0];
      expect(stored.appliedAt).toBeInstanceOf(Date);
      expect(stored.notifiedAt).toBeInstanceOf(Date);
    });

    itDb('refuse a month that was already charged, a missing reason and a product the tenant lacks', async () => {
      const t = await loadTenant();
      const base = { product: 'pms' as const, price: 4000, effectiveFrom: '2026-12', reason: 'Acuerdo comercial' };
      await expect(schedulePriceChange(t, { ...base, effectiveFrom: '2026-10' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_PERIOD_CLOSED' });
      await expect(schedulePriceChange(t, { ...base, reason: 'corto' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_INVALID' });
      await Tenant.updateOne({ _id: tenantId }, { $set: { products: ['pms'] } });
      await expect(schedulePriceChange(await loadTenant(), { ...base, product: 'accounting' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_NO_PRODUCT' });
    });

    itDb('let a scheduled price be cancelled until it applies', async () => {
      await schedulePriceChange(await loadTenant(), { product: 'pms', price: 4000, effectiveFrom: '2026-12', reason: 'Acuerdo comercial' }, actor, NOW);
      const id = String((await loadTenant()).billing!.priceChanges[0]._id);
      await cancelPriceChange(await loadTenant(), id);
      expect((await loadTenant()).billing!.priceChanges).toHaveLength(0);
    });
  });

  describe('discounts', () => {
    itDb('are taken off the contract price on the charge, with the discount shown on the line', async () => {
      await Tenant.updateOne({ _id: tenantId }, { $set: { 'billing.discounts': [{ product: 'pms', type: 'percent', value: 20, effectiveFrom: '2026-10', reason: 'Cliente fundador' }] } });
      const c = await charge();
      const [pms, accounting] = c.toObject().lines;
      expect(pms).toMatchObject({ kind: 'subscription', product: 'pms', amount: 4432, discount: { type: 'percent', value: 20, amount: 1108 } });
      expect(pms.description).toContain('descuento 20%');
      expect(accounting).toMatchObject({ product: 'accounting', amount: 9370 });
      expect(accounting.discount).toBeUndefined();
      expect(c.subtotal).toBe(13802);
      expect(c.itbis).toBe(2484.36);
      expect(c.total).toBe(16286.36);
    });

    itDb('take a fixed amount off and prorate it in the first month', async () => {
      await Tenant.collection.updateOne({ _id: tenantId }, { $set: { createdAt: new Date('2026-10-16T16:00:00Z') } });
      await Tenant.updateOne({ _id: tenantId }, { $set: { 'billing.discounts': [{ product: 'pms', type: 'amount', value: 500, effectiveFrom: '2026-10', reason: 'Descuento comercial' }] } });
      const c = await charge();
      const pms = c.toObject().lines[0];
      expect(pms.proration).toBe(0.5161);
      expect(pms.discount).toMatchObject({ type: 'amount', value: 500, amount: 258.05 });
      expect(pms.amount).toBe(round(round(5540 * 0.5161) - 258.05));
    });

    itDb('stop after their last month and do not start before their first', async () => {
      await Tenant.updateOne({ _id: tenantId }, { $set: { 'billing.discounts': [{ product: 'pms', type: 'percent', value: 50, effectiveFrom: '2026-11', effectiveUntil: '2026-12', reason: 'Dos meses de cortesía' }] } });
      const priceIn = async (period: string) => (await resolveContracts(await loadTenant(), period)).find((c) => c.product === 'pms')!.discount;
      expect(await priceIn('2026-10')).toBeUndefined();
      expect(await priceIn('2026-11')).toEqual({ type: 'percent', value: 50 });
      expect(await priceIn('2026-12')).toEqual({ type: 'percent', value: 50 });
      expect(await priceIn('2027-01')).toBeUndefined();
    });

    itDb('a 100 % discount leaves that product off the charge', async () => {
      await Tenant.updateOne({ _id: tenantId }, { $set: { 'billing.discounts': [{ product: 'pms', type: 'percent', value: 100, effectiveFrom: '2026-10', reason: 'Cortesía total' }] } });
      const c = await charge();
      expect(c.lines.map((l) => l.product)).toEqual(['accounting']);
    });

    itDb('reach the e-CF as the discounted line, so its total is the charge total', async () => {
      await Tenant.updateOne({ _id: tenantId }, { $set: { 'billing.discounts': [{ product: 'pms', type: 'percent', value: 20, effectiveFrom: '2026-10', reason: 'Cliente fundador' }] } });
      const c = await charge();
      const { payment } = await pay(c);
      const record = (await ecfOf(payment))!;
      const lines = (record.request as any).lines;
      expect(lines[0]).toMatchObject({ unitPrice: '4432.00', tax: 'itbis18' });
      expect(lines[0].name).toContain('descuento 20%');
      expect(record.totalFactura).toBe(c.total);
    });

    itDb('can be granted from this month on, and are recorded with who and why', async () => {
      const updated = await grantDiscount(await loadTenant(), { product: 'pms', type: 'percent', value: 15, effectiveFrom: '2026-11', effectiveUntil: '2027-04', reason: 'Acuerdo comercial anual' }, actor, NOW);
      expect(updated.billing!.discounts).toHaveLength(1);
      expect(updated.billing!.discounts[0]).toMatchObject({ product: 'pms', type: 'percent', value: 15, effectiveFrom: '2026-11', effectiveUntil: '2027-04', createdByEmail: 'ops@pilloto.com' });
      expect(emails()).toHaveLength(0);
    });

    itDb('are refused for a month already charged, a bad value, a missing reason, a product the tenant lacks', async () => {
      const t = await loadTenant();
      const base = { product: 'pms' as const, type: 'percent', value: 10, effectiveFrom: '2026-11', reason: 'Acuerdo comercial' };
      await expect(grantDiscount(t, { ...base, effectiveFrom: '2026-10' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_PERIOD_CLOSED' });
      await expect(grantDiscount(t, { ...base, value: 0 }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_INVALID' });
      await expect(grantDiscount(t, { ...base, value: 101 }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_INVALID' });
      await expect(grantDiscount(t, { ...base, type: 'other' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_INVALID' });
      await expect(grantDiscount(t, { ...base, effectiveUntil: '2026-10' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_INVALID' });
      await expect(grantDiscount(t, { ...base, reason: 'corto' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_INVALID' });
      await Tenant.updateOne({ _id: tenantId }, { $set: { products: ['pms'] } });
      await expect(grantDiscount(await loadTenant(), { ...base, product: 'accounting' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_NO_PRODUCT' });
      expect((await loadTenant()).billing?.discounts ?? []).toHaveLength(0);
    });

    itDb('never overlap on the same product, but may on different ones', async () => {
      await grantDiscount(await loadTenant(), { product: 'pms', type: 'percent', value: 10, effectiveFrom: '2026-11', effectiveUntil: '2027-01', reason: 'Acuerdo comercial' }, actor, NOW);
      const next = { product: 'pms' as const, type: 'amount', value: 100, reason: 'Acuerdo comercial' };
      await expect(grantDiscount(await loadTenant(), { ...next, effectiveFrom: '2027-01' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_DISCOUNT_OVERLAP' });
      await expect(grantDiscount(await loadTenant(), { ...next, effectiveFrom: '2026-12' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_DISCOUNT_OVERLAP' });
      await expect(grantDiscount(await loadTenant(), { ...next, effectiveFrom: '2026-11', effectiveUntil: '2026-11' }, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_DISCOUNT_OVERLAP' });
      await grantDiscount(await loadTenant(), { ...next, effectiveFrom: '2027-02' }, actor, NOW);
      await grantDiscount(await loadTenant(), { ...next, product: 'accounting', effectiveFrom: '2026-11' }, actor, NOW);
      expect((await loadTenant()).billing!.discounts).toHaveLength(3);
    });

    itDb('are removed while they have not reached a charge, and stop after the last charged month once they have', async () => {
      await grantDiscount(await loadTenant(), { product: 'pms', type: 'percent', value: 10, effectiveFrom: '2026-12', reason: 'Acuerdo comercial' }, actor, NOW);
      const future = String((await loadTenant()).billing!.discounts[0]._id);
      await endDiscount(await loadTenant(), future, NOW);
      expect((await loadTenant()).billing!.discounts).toHaveLength(0);

      await Tenant.updateOne({ _id: tenantId }, { $set: { 'billing.discounts': [{ product: 'pms', type: 'percent', value: 10, effectiveFrom: '2026-08', reason: 'Acuerdo comercial' }] } });
      const running = String((await loadTenant()).billing!.discounts[0]._id);
      await endDiscount(await loadTenant(), running, NOW);
      expect((await loadTenant()).billing!.discounts[0].effectiveUntil).toBe('2026-10');
      await expect(endDiscount(await loadTenant(), running, NOW)).rejects.toMatchObject({ code: 'BILLING_STATE' });
      await expect(endDiscount(await loadTenant(), String(new mongoose.Types.ObjectId()), NOW)).rejects.toMatchObject({ code: 'BILLING_NOT_FOUND' });
    });
  });

  describe('monthly charge', () => {
    itDb('bills each product plus the e-invoicing statement, with ITBIS per line', async () => {
      await closedStatement();
      const c = await charge();
      expect(c.number).toMatch(/^COB-\d{6}$/);
      expect(c.lines.map((l) => [l.kind, l.amount])).toEqual([['subscription', 5540], ['subscription', 9370], ['fiscal_plan', 325], ['fiscal_overage', 480]]);
      expect(c).toMatchObject({ subtotal: 15715, itbis: 2828.7, total: 18543.7, balance: 18543.7, paidAmount: 0, status: 'open', period: PERIOD, tax: 'itbis18', dueDate: '2026-11-15' });
    });

    itDb('is created once per tenant and month', async () => {
      const first = await generateCharge(await loadTenant(), PERIOD, { now: NOW, notify: false });
      const second = await generateCharge(await loadTenant(), PERIOD, { now: NOW, notify: false });
      expect(first.created).toBe(true);
      expect(second).toMatchObject({ created: false, reason: 'exists' });
      expect(await BillingCharge.countDocuments({ tenantId })).toBe(1);
    });

    itDb('only for a month that has ended', async () => {
      await expect(generateCharge(await loadTenant(), '2026-11', { now: NOW })).rejects.toMatchObject({ code: 'BILLING_PERIOD_OPEN' });
    });

    itDb('charges the first month in proportion, and nothing before the tenant existed', async () => {
      // (raw update: Mongoose treats createdAt as immutable)
      await Tenant.collection.updateOne({ _id: tenantId }, { $set: { createdAt: new Date('2026-10-16T16:00:00Z') } });
      const c = await charge();
      expect(c.toObject().lines[0]).toMatchObject({ amount: round(5540 * 0.5161), proration: 0.5161 });
      expect(c.lines[0].description).toContain('proporcional 52%');
      const before = await generateCharge(await loadTenant(), '2026-09', { now: NOW, notify: false });
      expect(before).toMatchObject({ charge: null, reason: 'before_start' });
    });

    itDb('uses the contracted price, not the list', async () => {
      await resolveContracts(await loadTenant(), PERIOD);
      await setPlanPrice('pms', 'pro', 9999, actor);
      expect((await charge()).lines[0].amount).toBe(5540);
    });

    itDb('an exempt service carries no ITBIS', async () => {
      await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'billing.tax': 'exempt' } });
      const c = await charge();
      expect(c).toMatchObject({ subtotal: 14910, itbis: 0, total: 14910, tax: 'exempt' });
    });

    itDb('emails the tenant with the lines, the total, the due date and how to pay', async () => {
      await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'billing.paymentInstructions': 'Banco Popular 123456 — Pilloto SRL' } });
      const c = await charge({ notify: true });
      const mail = emails()[0];
      expect(mail.to).toBe('dueno@prueba.com');
      expect(mail.subject).toContain(c.number);
      expect(mail.html).toContain('Banco Popular 123456');
      expect(mail.html).toContain('15/11/2026');
      expect((await BillingCharge.findById(c._id))!.notifiedAt).toBeInstanceOf(Date);
    });

    itDb('the monthly run charges every tenant once, skips paused ones and can run again safely', async () => {
      const other = new mongoose.Types.ObjectId();
      await Tenant.collection.insertOne({ _id: other, name: 'Pausado', slug: 'pausado', plan: 'basic', plans: {}, products: ['pms'], ownerEmail: 'p@p.com', isActive: true, createdAt: new Date('2026-01-01'), billing: { paused: true, contracts: {}, priceChanges: [] } });
      const first = await runMonthlyBilling(NOW);
      expect(first).toMatchObject({ period: PERIOD, created: 1, failed: 0 });
      const second = await runMonthlyBilling(NOW);
      expect(second).toMatchObject({ created: 0, existing: 1 });
      expect(await BillingCharge.countDocuments({ tenantId: other })).toBe(0);
    });

    itDb('waits when the e-invoicing statement cannot be closed yet', async () => {
      await Tenant.updateOne({ _id: tenantId }, { $set: { fiscal: { organizationId: 'org-1', environment: 'ecf', certification: 'certified', isActive: true, plan: 'max', provisionedAt: new Date('2026-01-01') } } });
      fake.failNext('subscription', networkError());
      const summary = await runMonthlyBilling(NOW);
      expect(summary.failed).toBe(1);
      expect(await BillingCharge.countDocuments({ tenantId })).toBe(0);
      // Next run, BillingSoft answers: the statement is created and charged with the subscriptions.
      const retry = await runMonthlyBilling(NOW);
      expect(retry.created).toBe(1);
      const kinds = (await BillingCharge.findOne({ tenantId }))!.lines.map((l) => l.kind);
      expect(kinds).toContain('subscription');
      expect(kinds.some((k) => k.startsWith('fiscal'))).toBe(true);
    });

    itDb('can be voided while nothing was paid, and then charged again', async () => {
      const c = await charge();
      await voidCharge(c._id as any, 'Generado por error', actor, NOW);
      expect((await BillingCharge.findById(c._id))!.status).toBe('void');
      const again = await generateCharge(await loadTenant(), PERIOD, { now: NOW, notify: false });
      expect(again.created).toBe(true);
    });
  });

  describe('payments and their e-CF', () => {
    itDb('a payment of the whole charge pays it and issues a credit-fiscal e-CF itemised like the charge', async () => {
      await closedStatement();
      const c = await charge();
      const { payment, charge: after } = await pay(c);

      expect(after).toMatchObject({ status: 'paid', paidAmount: 18543.7, balance: 0 });
      expect(payment.ecfError).toBeUndefined();
      const record = (await ecfOf(payment))!;
      expect(record).toMatchObject({ tipo: 'E31', generationSource: 'platform_payment', buyerRnc: '131880681', buyerName: 'Hotel Prueba SRL', numeroFacturaInterna: c.number });
      expect(String(record.tenantId)).toBe(String(PLATFORM_ISSUER_ID));
      expect(String(record.billingPaymentId)).toBe(String(payment._id));
      expect(record.totalFactura).toBe(18543.7);
      expect((record.request as any).lines).toHaveLength(4);
      expect((record.request as any).payment).toEqual({ type: 'cash' });
      expect(fake.created()).toBe(1);
    });

    itDb('issues through Pilloto’s own Organization: no customer is named', async () => {
      const c = await charge();
      await pay(c);
      expect(fake.calls.find((call) => call.startsWith('issue'))).toContain('invoices');
      // the fake keys replays by organization id; Pilloto's is the `self` sentinel
      const issued = await ElectronicInvoice.findOne({ tenantId: PLATFORM_ISSUER_ID });
      expect(issued!.idempotencyKey).toMatch(/^platform-payment-.+-1$/);
    });

    itDb('a partial payment leaves the charge partial and issues one line for the amount received', async () => {
      const c = await charge();
      const { payment, charge: after } = await pay(c, { amount: 10000 });
      expect(after).toMatchObject({ status: 'partial', paidAmount: 10000, balance: round(c.total - 10000) });
      const record = (await ecfOf(payment))!;
      const lines = (record.request as any).lines;
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ unitPrice: '8474.58', tax: 'itbis18' });
      expect(lines[0].name).toContain(c.number);
      expect(record.totalFactura).toBe(10000);
    });

    itDb('two payments settle a charge; each has its own e-CF', async () => {
      const c = await charge();
      const first = await pay(c, { amount: 10000 });
      const second = await pay(first.charge, { amount: first.charge.balance });
      expect(second.charge.status).toBe('paid');
      expect(await ElectronicInvoice.countDocuments({ tenantId: PLATFORM_ISSUER_ID })).toBe(2);
    });

    itDb('refuses an amount above the balance, a missing reference and a future date', async () => {
      const c = await charge();
      await expect(pay(c, { amount: c.total + 1 })).rejects.toMatchObject({ code: 'BILLING_INVALID', fields: { amount: expect.any(String) } });
      await expect(pay(c, { reference: '' })).rejects.toMatchObject({ fields: { reference: expect.any(String) } });
      await expect(pay(c, { paidAt: '2027-01-01T00:00:00Z' })).rejects.toMatchObject({ fields: { paidAt: expect.any(String) } });
      await expect(pay(c, { amount: 0 })).rejects.toMatchObject({ fields: { amount: expect.any(String) } });
      expect(await BillingPayment.countDocuments({})).toBe(0);
    });

    itDb('cash needs no reference', async () => {
      const c = await charge();
      const { payment } = await pay(c, { method: 'cash', reference: '', amount: 5000 });
      expect(payment.reference).toBeUndefined();
    });

    itDb('refuses a payment on a paid or void charge', async () => {
      const c = await charge();
      await pay(c);
      await expect(pay(c, { amount: 1 })).rejects.toMatchObject({ code: 'BILLING_STATE' });
    });

    itDb('the payment is kept when Pilloto is not certified yet, with the reason; issuing works once it is', async () => {
      await seedPlatform({ organizationId: 'self', environment: 'certecf', certification: 'in_progress', isActive: true, plan: 'essential' });
      const c = await charge();
      const { payment, charge: after } = await pay(c);
      expect(after.status).toBe('paid');
      expect(payment.electronicInvoiceId).toBeUndefined();
      expect(payment.ecfError).toMatch(/certified/i);
      expect(fake.created()).toBe(0);

      await seedPlatform();
      const retried = await retryEcf(payment._id as any, actor, NOW);
      expect(retried.ecfError).toBeUndefined();
      expect(retried.electronicInvoiceId).toBeDefined();
      expect(fake.created()).toBe(1);
    });

    itDb('the payment is kept when Pilloto’s e-invoicing is not linked at all', async () => {
      await seedPlatform(null);
      const { payment } = await pay(await charge());
      expect(payment.ecfError).toMatch(/not set up/i);
    });

    itDb('the payment is kept when the tenant has no RNC, and says what to fix', async () => {
      await Tenant.updateOne({ _id: tenantId }, { $unset: { 'profile.rnc': '' } });
      const { payment } = await pay(await charge());
      expect(payment.ecfError).toMatch(/RNC/);
      expect(payment.electronicInvoiceId).toBeUndefined();
      await Tenant.updateOne({ _id: tenantId }, { $set: { 'profile.rnc': '131880681' } });
      expect((await retryEcf(payment._id as any, actor, NOW)).electronicInvoiceId).toBeDefined();
    });

    itDb('a BillingSoft refusal is kept as the reason and nothing is left half-issued', async () => {
      fake.failNext('issue', validationError('El comprador no está habilitado'));
      const { payment } = await pay(await charge());
      expect(payment.ecfError).toContain('El comprador no está habilitado');
      expect(await ElectronicInvoice.countDocuments({ tenantId: PLATFORM_ISSUER_ID })).toBe(0);
    });

    itDb('an unreachable BillingSoft queues the e-CF: the payment links to it and the sweep sends it', async () => {
      fake.failNext('issue', networkError());
      const { payment } = await pay(await charge());
      const record = (await ecfOf(payment))!;
      expect(record.estadoECF).toBe('Pendiente');
      expect(payment.ecfError).toBeUndefined();
      // The same key later: sent once, never twice.
      await sendIntent(record, await getPlatformIssuer(), false, new Date());
      await sendIntent((await ElectronicInvoice.findById(record._id))!, await getPlatformIssuer(), false, new Date()).catch(() => undefined);
      expect(fake.created()).toBe(1);
    });

    itDb('a rejected e-CF is issued again as a new document, keeping the rejected one', async () => {
      const { payment } = await pay(await charge());
      const first = (await ecfOf(payment))!;
      fake.setStatus(first.billingsoftDocumentId!, 'rejected');
      await refreshRecord(first, await getPlatformIssuer());

      const retried = await retryEcf(payment._id as any, actor, NOW);
      const second = (await ecfOf(retried))!;
      expect(String(second._id)).not.toBe(String(first._id));
      expect(retried.ecfAttempt).toBe(2);
      expect(await ElectronicInvoice.countDocuments({ tenantId: PLATFORM_ISSUER_ID })).toBe(2);
      expect(fake.created()).toBe(2);
    });

    itDb('does not issue a second e-CF for a payment that has a valid one', async () => {
      const { payment } = await pay(await charge());
      await expect(retryEcf(payment._id as any, actor, NOW)).rejects.toMatchObject({ code: 'BILLING_STATE' });
    });

    itDb('marks the e-invoicing statement paid once its charge is', async () => {
      await closedStatement();
      const c = await charge();
      await pay(c);
      expect((await FiscalStatement.findOne({ tenantId, period: PERIOD }).setOptions({}))!.status).toBe('paid');
    });
  });

  describe('e-CF receipt email', () => {
    itDb('goes to the tenant once, with the PDF, as soon as BillingSoft holds the document', async () => {
      const { payment } = await pay(await charge());
      const mails = emails().filter((m) => m._logMeta?.emailType === 'ecf_invoice');
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ to: 'info@prueba.com', attachments: [expect.objectContaining({ contentType: 'application/pdf' })] });
      expect((await BillingPayment.findById(payment._id))!.ecfEmailedAt).toBeInstanceOf(Date);
      await sendDueReceipts(NOW);
      expect(emails().filter((m) => m._logMeta?.emailType === 'ecf_invoice')).toHaveLength(1);
    });

    itDb('is sent by the job for an e-CF that was queued', async () => {
      fake.failNext('issue', networkError());
      const { payment } = await pay(await charge());
      expect(emails().filter((m) => m._logMeta?.emailType === 'ecf_invoice')).toHaveLength(0);
      await sendIntent((await ecfOf(payment))!, await getPlatformIssuer(), false, new Date());
      expect(await sendDueReceipts(NOW)).toBe(1);
    });

    itDb('is never sent for a document from DGII’s test environment', async () => {
      await seedPlatform({ organizationId: 'self', environment: 'testecf', certification: 'not_started', isActive: true, plan: 'essential' });
      process.env.FISCAL_ALLOW_UNCERTIFIED = 'true';
      try {
        const { payment } = await pay(await charge());
        expect(emails().filter((m) => m._logMeta?.emailType === 'ecf_invoice')).toHaveLength(0);
        expect((await BillingPayment.findById(payment._id))!.ecfEmailError).toMatch(/fiscal value/i);
      } finally {
        delete process.env.FISCAL_ALLOW_UNCERTIFIED;
      }
    });
  });

  describe('reversal', () => {
    itDb('cancels an accepted e-CF with a credit note and reopens the charge', async () => {
      const c = await charge();
      const { payment } = await pay(c);
      const record = (await ecfOf(payment))!;
      fake.setStatus(record.billingsoftDocumentId!, 'accepted');
      await refreshRecord(record, await getPlatformIssuer());

      const { payment: reversed, charge: after } = await reversePayment(payment._id as any, 'Pago registrado dos veces', actor, NOW);
      expect(reversed.status).toBe('reversed');
      expect(reversed.reversal).toMatchObject({ reason: 'Pago registrado dos veces', byEmail: 'ops@pilloto.com' });
      expect(after).toMatchObject({ status: 'open', paidAmount: 0, balance: c.total });
      const note = await ElectronicInvoice.findById(reversed.reversal!.creditNoteId);
      expect(note).toMatchObject({ tipo: 'E34', originalENCF: record.eNCF, codigoModificacion: '1', generationSource: 'credit_note' });
      expect(note!.totalFactura).toBe(record.totalFactura);
    });

    itDb('waits while DGII is still deciding on the e-CF', async () => {
      const { payment } = await pay(await charge());
      await expect(reversePayment(payment._id as any, 'Error de digitación', actor, NOW)).rejects.toMatchObject({ code: 'BILLING_ECF_PENDING' });
      expect((await BillingPayment.findById(payment._id))!.status).toBe('recorded');
    });

    itDb('needs no credit note when there never was an e-CF', async () => {
      await seedPlatform(null);
      const c = await charge();
      const { payment } = await pay(c);
      const { charge: after } = await reversePayment(payment._id as any, 'Transferencia no llegó', actor, NOW);
      expect(after.status).toBe('open');
      expect(await ElectronicInvoice.countDocuments({ tenantId: PLATFORM_ISSUER_ID })).toBe(0);
    });

    itDb('needs a reason, and cannot be done twice', async () => {
      await seedPlatform(null);
      const { payment } = await pay(await charge());
      await expect(reversePayment(payment._id as any, '', actor, NOW)).rejects.toMatchObject({ code: 'BILLING_INVALID' });
      await reversePayment(payment._id as any, 'Transferencia no llegó', actor, NOW);
      await expect(reversePayment(payment._id as any, 'Otra vez', actor, NOW)).rejects.toMatchObject({ code: 'BILLING_STATE' });
    });

    itDb('a charge with a live payment cannot be voided; after the reversal it can', async () => {
      await seedPlatform(null);
      const c = await charge();
      const { payment } = await pay(c, { amount: 1000 });
      await expect(voidCharge(c._id as any, 'Cobro duplicado', actor, NOW)).rejects.toMatchObject({ code: 'BILLING_STATE' });
      await reversePayment(payment._id as any, 'Transferencia no llegó', actor, NOW);
      await expect(voidCharge(c._id as any, 'Cobro duplicado', actor, NOW)).resolves.toMatchObject({ status: 'void' });
    });
  });

  describe('tenants and Pilloto’s own documents never mix', () => {
    itDb('a tenant’s queries cannot see Pilloto’s e-CF', async () => {
      await pay(await charge());
      expect(await ElectronicInvoice.countDocuments({ tenantId })).toBe(0);
      expect(await ElectronicInvoice.countDocuments({ tenantId: PLATFORM_ISSUER_ID })).toBe(1);
    });
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }

// Satisfy lint: FiscalError is used by the assertions' matchers through `code`.
void FiscalError;
