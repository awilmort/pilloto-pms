/**
 * Product subscriptions (PLANS_AND_SUBSCRIPTIONS_PLAN.md phase 5): free trial, charging by the
 * day across a mid-month upgrade, downgrades and cancellations at the end of the month, operator
 * price changes as segments, and the automatic suite discount on Accounting.
 */
import mongoose from 'mongoose';

jest.mock('../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue('email-id') }));

/* eslint-disable import/first */
import BillingCharge from '../models/BillingCharge';
import PlanPrice from '../models/PlanPrice';
import PlatformSettings from '../models/PlatformSettings';
import Tenant, { ITenantSubscription } from '../models/Tenant';
import { generateCharge } from '../services/platformBilling/billingCharges';
import { grantDiscount, resolveContracts } from '../services/platformBilling/billingContracts';
import {
  applyDueChanges, applyPlanChange, billableWindow, daysBetween, resumeSubscription, scheduleCancellation, scheduleDowngrade,
  segmentsInPeriod, startSubscription, subscriptionOf, syncSubscriptions,
} from '../services/platformBilling/subscriptions';
import { connectTestDb, dropTestDb } from './helpers/testDb';
/* eslint-enable import/first */

const at = (day: string) => new Date(`${day}T15:00:00Z`); // mid-day in Santo Domingo

describe('subscription days (pure)', () => {
  const sub = (over: Partial<ITenantSubscription> = {}): ITenantSubscription => ({
    startedOn: '2026-11-10', billableFrom: '2026-11-24', segments: [{ plan: 'pro', price: 3000, source: 'catalog', from: '2026-11-10' }], ...over,
  });

  it('counts days inclusively', () => {
    expect(daysBetween('2026-11-24', '2026-11-30')).toBe(7);
    expect(daysBetween('2026-11-30', '2026-11-24')).toBe(0);
  });

  it('charges nothing while the trial covers the month, and from the trial end after it', () => {
    expect(segmentsInPeriod(sub({ billableFrom: '2026-12-02' }), '2026-11')).toEqual([]);
    expect(segmentsInPeriod(sub(), '2026-11')).toEqual([{ plan: 'pro', price: 3000, source: 'catalog', from: '2026-11-24', to: '2026-11-30', days: 7, share: 0.2333 }]);
    expect(segmentsInPeriod(sub(), '2026-12')[0]).toMatchObject({ days: 31, share: 1 });
  });

  it('splits a month at an upgrade, by the day', () => {
    const s = sub({ billableFrom: '2026-10-01', segments: [{ plan: 'invoicing', price: 1590, source: 'catalog', from: '2026-10-01' }, { plan: 'pro', price: 6890, source: 'catalog', from: '2026-11-16' }] });
    expect(segmentsInPeriod(s, '2026-11').map((x) => [x.plan, x.from, x.to, x.days])).toEqual([
      ['invoicing', '2026-11-01', '2026-11-15', 15],
      ['pro', '2026-11-16', '2026-11-30', 15],
    ]);
  });

  it('stops the day before the end', () => {
    expect(billableWindow({ billableFrom: '2026-01-01', endsOn: '2026-12-01' }, '2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(billableWindow({ billableFrom: '2026-01-01', endsOn: '2026-12-01' }, '2026-12')).toBeNull();
    expect(billableWindow({ billableFrom: '2026-01-01', endsOn: '2026-11-11' }, '2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-10' });
  });
});

describe('subscriptions (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const load = () => Tenant.findById(tenantId).then((t) => t!);

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_subscriptions');
    if (ready) await Promise.all([BillingCharge.init(), PlanPrice.init()]);
    if (!ready) console.warn('Mongo unreachable — skipping subscription DB tests');
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    if (!ready) return;
    await Promise.all([BillingCharge, PlanPrice, PlatformSettings, Tenant].map((m: any) => m.collection.deleteMany({})));
    await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'billing.tax': 'itbis18', 'billing.dueDays': 10 } }, { upsert: true });
    await Tenant.collection.insertOne({
      _id: tenantId, name: 'Ferretería Sol', slug: 'sol', plan: 'basic', plans: {}, products: [], ownerEmail: 'o@sol.com', isActive: true,
      createdAt: at('2026-10-01'), updatedAt: new Date(), profile: { legalName: 'Ferretería Sol SRL', rnc: '101010101' },
    });
  });

  itDb('a new product gets a 14-day trial and is charged from the day after it', async () => {
    await startSubscription(await load(), 'accounting', 'essentials', { now: at('2026-10-10') });
    const t = await load();
    expect(t.products).toEqual(['accounting']);
    expect(t.plans.accounting).toBe('essentials');
    expect(subscriptionOf(t, 'accounting')).toMatchObject({ startedOn: '2026-10-10', billableFrom: '2026-10-24' });
    const { charge } = await generateCharge(t, '2026-10', { now: at('2026-11-02'), notify: false });
    // 24–31 Oct = 8 of 31 days of RD$4,090
    expect(charge!.toObject().lines[0]).toMatchObject({ product: 'accounting', plan: 'essentials', amount: 1055.63, days: 8, proration: 0.2581 }); // 4,090 × 0.2581
  });

  itDb('a product that ended before gets no second trial', async () => {
    await startSubscription(await load(), 'accounting', 'invoicing', { now: at('2026-10-01') });
    await scheduleCancellation(await load(), 'accounting', { now: at('2026-10-03') }); // in trial: ends at once
    let t = await load();
    expect(t.products).toEqual([]);
    await startSubscription(t, 'accounting', 'invoicing', { now: at('2026-10-20') });
    t = await load();
    expect(subscriptionOf(t, 'accounting')).toMatchObject({ startedOn: '2026-10-20', billableFrom: '2026-10-20' });
  });

  itDb('an upgrade applies today and the month is charged on each plan by the day', async () => {
    await startSubscription(await load(), 'accounting', 'invoicing', { now: at('2026-09-01'), trialDays: 0 });
    await applyPlanChange(await load(), 'accounting', 'pro', '2026-10-16');
    const t = await load();
    expect(t.plans.accounting).toBe('pro');
    const { charge } = await generateCharge(t, '2026-10', { now: at('2026-11-02'), notify: false });
    expect(charge!.lines.map((l) => [l.plan, l.days, l.amount])).toEqual([
      ['invoicing', 15, 769.4], // 1,590 × 0.4839
      ['pro', 16, 3555.93], // 6,890 × 0.5161
    ]);
  });

  itDb('a downgrade waits for the first day of next month', async () => {
    await startSubscription(await load(), 'accounting', 'plus', { now: at('2026-09-01'), trialDays: 0 });
    await scheduleDowngrade(await load(), 'accounting', 'essentials', at('2026-10-20'));
    let t = await load();
    expect(subscriptionOf(t, 'accounting')!.pendingPlan).toEqual({ plan: 'essentials', effectiveOn: '2026-11-01' });
    expect(await applyDueChanges(t, at('2026-10-31'))).toEqual([]);
    expect(await applyDueChanges(t, at('2026-11-01'))).toEqual(['accounting:essentials']);
    t = await load();
    expect(t.plans.accounting).toBe('essentials');
    expect(subscriptionOf(t, 'accounting')!.pendingPlan).toBeUndefined();
    const oct = await generateCharge(t, '2026-10', { now: at('2026-11-02'), notify: false });
    expect(oct.charge!.lines.map((l) => [l.plan, l.amount])).toEqual([['plus', 10690]]);
  });

  itDb('a cancellation after the trial ends with the month; it can be withdrawn until then', async () => {
    await startSubscription(await load(), 'pms', 'basic', { now: at('2026-09-01'), trialDays: 0 });
    await scheduleCancellation(await load(), 'pms', { now: at('2026-10-12') });
    let t = await load();
    expect(subscriptionOf(t, 'pms')!.endsOn).toBe('2026-11-01');
    expect(t.products).toEqual(['pms']); // still available until then
    await resumeSubscription(t, 'pms', at('2026-10-20'));
    expect(subscriptionOf(await load(), 'pms')!.endsOn).toBeUndefined();
    await scheduleCancellation(await load(), 'pms', { now: at('2026-10-25') });
    await applyDueChanges(await load(), at('2026-11-01'));
    t = await load();
    expect(t.products).toEqual([]);
    // October is still charged in full; November not at all.
    expect((await generateCharge(t, '2026-10', { now: at('2026-11-02'), notify: false })).charge!.lines[0].amount).toBe(2450);
    expect((await generateCharge(t, '2026-11', { now: at('2026-12-02'), notify: false })).reason).toBe('nothing_to_charge');
  });

  itDb('the suite discount comes off Accounting while the PMS is charged the same month', async () => {
    await startSubscription(await load(), 'pms', 'pro', { now: at('2026-09-01'), trialDays: 0 });
    await startSubscription(await load(), 'accounting', 'essentials', { now: at('2026-09-01'), trialDays: 0 });
    const { charge } = await generateCharge(await load(), '2026-10', { now: at('2026-11-02'), notify: false });
    const acc = charge!.lines.find((l) => l.product === 'accounting')!;
    expect((acc as any).toObject?.() ?? acc).toMatchObject({ amount: 3272, discount: { type: 'percent', value: 20, amount: 818, kind: 'suite' } });
    expect(acc.description).toContain('descuento suite 20%');
    expect(charge!.lines.find((l) => l.product === 'pms')!.discount).toBeUndefined();
  });

  itDb('an operator discount on Accounting replaces the suite discount; 0% turns the suite off', async () => {
    await startSubscription(await load(), 'pms', 'pro', { now: at('2026-09-01'), trialDays: 0 });
    await startSubscription(await load(), 'accounting', 'essentials', { now: at('2026-09-01'), trialDays: 0 });
    await grantDiscount(await load(), { product: 'accounting', type: 'percent', value: 50, effectiveFrom: '2026-10', effectiveUntil: '2026-10', reason: 'Cliente piloto del sector' }, {}, at('2026-10-02'));
    const [, acc] = await resolveContracts(await load(), '2026-10');
    expect(acc).toMatchObject({ discount: { type: 'percent', value: 50 }, discountKind: 'operator' });
    await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'billing.suiteDiscountPercent': 0 } });
    const [, nov] = await resolveContracts(await load(), '2026-11');
    expect(nov.discount).toBeUndefined();
  });

  itDb('no suite discount when the PMS is not charged that month (still in its trial)', async () => {
    await startSubscription(await load(), 'accounting', 'essentials', { now: at('2026-09-01'), trialDays: 0 });
    await startSubscription(await load(), 'pms', 'basic', { now: at('2026-10-25') }); // trial until 7 Nov
    const contracts = await resolveContracts(await load(), '2026-10');
    expect(contracts.map((c) => c.product)).toEqual(['accounting']);
    expect(contracts[0].discount).toBeUndefined();
  });

  itDb('the console edit starts, changes and ends subscriptions', async () => {
    await Tenant.updateOne({ _id: tenantId }, { $set: { products: ['pms'], plan: 'pro' } });
    await syncSubscriptions(await load(), { now: at('2026-10-05') });
    expect(subscriptionOf(await load(), 'pms')).toMatchObject({ billableFrom: '2026-10-19', segments: [{ plan: 'pro', price: 5540 }] });
    await Tenant.updateOne({ _id: tenantId }, { $set: { plan: 'enterprise' } });
    await syncSubscriptions(await load(), { now: at('2026-10-20') });
    expect(subscriptionOf(await load(), 'pms')!.segments.map((s) => s.plan)).toEqual(['pro', 'enterprise']);
    await Tenant.updateOne({ _id: tenantId }, { $set: { products: [] } });
    await syncSubscriptions(await load(), { now: at('2026-10-25') });
    expect(subscriptionOf(await load(), 'pms')!.endsOn).toBe('2026-10-25');
  });
});
