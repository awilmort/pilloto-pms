/**
 * Product subscriptions: when each product started, its free trial, its plan/price timeline, a
 * downgrade or cancellation waiting for the next month — and the days of a month each plan is
 * charged for.
 *
 * Days are Dominican calendar dates (`YYYY-MM-DD`). Rules (PLANS_AND_SUBSCRIPTIONS_PLAN.md §8):
 *  - a new product gets a 14-day free trial; charging starts the day after;
 *  - an upgrade applies at once: the month is charged by the day on each plan;
 *  - a downgrade and a cancellation apply on the first day of next month (a cancellation during
 *    the trial ends the product at once, with nothing to pay);
 *  - an operator's price change starts a new segment on the first day of its month.
 */
import Tenant, { BillingProduct, ISubscriptionSegment, ITenant, ITenantSubscription } from '../../models/Tenant';
import { dominicanDate, FiscalError, firstDayOfNextMonth, periodBounds } from '../fiscal/fiscalCore';
import { addDays, round2 } from './billingMath';
import { listPrice } from './billingPlans';

export const TRIAL_DAYS = 14;

// ─── Pure date pieces ────────────────────────────────────────────────────────

const dayMs = 86_400_000;
const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Days from `from` to `to`, both inclusive (0 when `to` is before `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((toUtc(to) - toUtc(from)) / dayMs) + 1);
}

const maxDay = (a: string, b: string) => (a > b ? a : b);
const minDay = (a: string, b: string) => (a < b ? a : b);

/** The days of `period` the subscription is charged for (null when none): after the trial, before the end. */
export function billableWindow(sub: Pick<ITenantSubscription, 'billableFrom' | 'endsOn'>, period: string): { from: string; to: string } | null {
  const bounds = periodBounds(period);
  const from = maxDay(bounds.from, sub.billableFrom);
  const to = sub.endsOn ? minDay(bounds.to, addDays(sub.endsOn, -1)) : bounds.to;
  return from <= to ? { from, to } : null;
}

export interface PeriodSegment {
  plan: string;
  price: number;
  source: ISubscriptionSegment['source'];
  from: string;
  to: string;
  days: number;
  /** Share of the month (days ÷ days in the month), 4 decimals. 1 for a whole month. */
  share: number;
}

/** The plan segments charged in `period`, each with its days and share of the month. */
export function segmentsInPeriod(sub: ITenantSubscription, period: string): PeriodSegment[] {
  const window = billableWindow(sub, period);
  if (!window || sub.segments.length === 0) return [];
  const monthDays = daysBetween(periodBounds(period).from, periodBounds(period).to);
  const out: PeriodSegment[] = [];
  sub.segments.forEach((seg, i) => {
    const next = sub.segments[i + 1];
    const segTo = next ? addDays(next.from, -1) : window.to;
    const from = maxDay(seg.from, window.from);
    const to = minDay(segTo, window.to);
    if (from > to) return;
    const days = daysBetween(from, to);
    out.push({ plan: seg.plan, price: seg.price, source: seg.source, from, to, days, share: Math.round((days / monthDays) * 10_000) / 10_000 });
  });
  return out;
}

/** The segment in force on `day` (the last one that started on or before it). */
export function segmentOn(sub: ITenantSubscription, day: string): ISubscriptionSegment | undefined {
  return [...sub.segments].reverse().find((s) => s.from <= day);
}

export const inTrial = (sub: Pick<ITenantSubscription, 'billableFrom'>, today: string): boolean => today < sub.billableFrom;

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * The tenant's subscription to `product` as a plain object (a copy: Mongoose subdocuments cannot be
 * spread into an update), or undefined.
 */
export function subscriptionOf(tenant: Pick<ITenant, 'billing'>, product: BillingProduct): ITenantSubscription | undefined {
  const raw: any = tenant.billing?.subscriptions?.[product];
  if (!raw) return undefined;
  return JSON.parse(JSON.stringify(typeof raw.toObject === 'function' ? raw.toObject() : raw));
}

const planField = (product: BillingProduct) => (product === 'pms' ? 'plan' : 'plans.accounting');
const currentPlan = (tenant: Pick<ITenant, 'plan' | 'plans'>, product: BillingProduct) => (product === 'pms' ? tenant.plan : tenant.plans?.accounting);

/**
 * The tenant's subscription to `product`, created from what it already has when there is none yet
 * (a tenant set up before subscriptions existed: no trial, started when the tenant was created).
 * Persists what it creates. Undefined when the tenant does not have the product.
 */
export async function ensureSubscription(tenant: ITenant, product: BillingProduct): Promise<ITenantSubscription | undefined> {
  const existing = subscriptionOf(tenant, product);
  if (existing) return existing;
  if (!tenant.products?.includes(product)) return undefined;
  const plan = currentPlan(tenant, product);
  if (!plan) return undefined;
  const startedOn = dominicanDate(tenant.createdAt ?? new Date());
  const contract = tenant.billing?.contracts?.[product];
  const price = contract && contract.plan === plan ? contract.price : await listPrice(product, plan);
  const sub: ITenantSubscription = {
    startedOn,
    billableFrom: startedOn,
    segments: [{ plan, price, source: contract?.plan === plan ? contract.source : 'catalog', from: startedOn }],
  };
  await saveSubscription(tenant, product, sub);
  return sub;
}

/** Writes the whole subscription (fields left out of `sub`, like a cleared `pendingPlan`, are removed). */
async function saveSubscription(tenant: ITenant, product: BillingProduct, sub: ITenantSubscription, extra: Record<string, unknown> = {}) {
  const last = sub.segments[sub.segments.length - 1];
  const set: Record<string, unknown> = {
    [`billing.subscriptions.${product}`]: sub,
    ...(last ? { [`billing.contracts.${product}`]: { plan: last.plan, price: last.price, since: last.from.slice(0, 7), source: last.source } } : {}),
    ...extra,
  };
  await Tenant.updateOne({ _id: tenant._id }, { $set: set });
  // Keep the in-memory document coherent for the caller.
  tenant.billing = tenant.billing ?? ({ contracts: {}, priceChanges: [], discounts: [] } as any);
  tenant.billing!.subscriptions = { ...(tenant.billing!.subscriptions ?? {}), [product]: sub };
  if (last) tenant.billing!.contracts = { ...(tenant.billing!.contracts ?? {}), [product]: { plan: last.plan, price: last.price, since: last.from.slice(0, 7), source: last.source } };
}

// ─── Changes ─────────────────────────────────────────────────────────────────

export interface StartOptions {
  now?: Date;
  /** Days of free trial (default 14; 0 for none). */
  trialDays?: number;
}

/**
 * Starts (or restarts) a product: adds it to the tenant's products, sets the plan and opens a
 * subscription at the list price with a free trial. A product that ended earlier gets no new trial.
 */
export async function startSubscription(tenant: ITenant, product: BillingProduct, plan: string, options: StartOptions = {}): Promise<ITenantSubscription> {
  const today = dominicanDate(options.now ?? new Date());
  const previous = subscriptionOf(tenant, product);
  if (previous && !previous.endsOn) throw new FiscalError(409, 'BILLING_STATE', `The tenant already has ${product}`);
  const trial = previous ? 0 : options.trialDays ?? TRIAL_DAYS;
  const sub: ITenantSubscription = {
    startedOn: today,
    billableFrom: addDays(today, trial),
    segments: [{ plan, price: await listPrice(product, plan), source: 'catalog', from: today }],
  };
  const products = Array.from(new Set([...(tenant.products ?? []), product]));
  await saveSubscription(tenant, product, sub, { products, [planField(product)]: plan });
  tenant.products = products as any;
  if (product === 'pms') tenant.plan = plan as any;
  else tenant.plans = { ...(tenant.plans ?? {}), accounting: plan as any };
  return sub;
}

/** Moves the product to `plan` from `day` (an upgrade today, or a due downgrade) at the list price. */
export async function applyPlanChange(tenant: ITenant, product: BillingProduct, plan: string, day: string): Promise<ITenantSubscription> {
  const sub = await ensureSubscription(tenant, product);
  if (!sub) throw new FiscalError(409, 'BILLING_NO_PRODUCT', `The tenant does not have ${product}`);
  const price = await listPrice(product, plan);
  // A change on the day a segment started replaces it (two changes the same day keep the last).
  const kept = sub.segments.filter((s) => s.from < day);
  const next: ITenantSubscription = { ...sub, segments: [...kept, { plan, price, source: 'catalog', from: day }] };
  delete next.pendingPlan;
  await saveSubscription(tenant, product, next, { [planField(product)]: plan });
  if (product === 'pms') tenant.plan = plan as any;
  else tenant.plans = { ...(tenant.plans ?? {}), accounting: plan as any };
  return next;
}

/** A downgrade that applies on the first day of next month. Replaces any earlier pending one. */
export async function scheduleDowngrade(tenant: ITenant, product: BillingProduct, plan: string, now = new Date()): Promise<ITenantSubscription> {
  const sub = await ensureSubscription(tenant, product);
  if (!sub) throw new FiscalError(409, 'BILLING_NO_PRODUCT', `The tenant does not have ${product}`);
  const next = { ...sub, pendingPlan: { plan, effectiveOn: firstDayOfNextMonth(now) } };
  await saveSubscription(tenant, product, next);
  return next;
}

export async function cancelPendingPlan(tenant: ITenant, product: BillingProduct): Promise<ITenantSubscription | undefined> {
  const sub = subscriptionOf(tenant, product);
  if (!sub?.pendingPlan) return sub;
  const next = { ...sub };
  delete next.pendingPlan;
  await saveSubscription(tenant, product, next, {});
  return next;
}

/**
 * Ends a product: on the first day of next month, or at once while it is in its free trial (nothing
 * is charged then). `immediate` (operators) ends it today. The product leaves `products` when the
 * end arrives (see applyDueChanges); its data stays.
 */
export async function scheduleCancellation(tenant: ITenant, product: BillingProduct, options: { now?: Date; immediate?: boolean } = {}): Promise<ITenantSubscription> {
  const now = options.now ?? new Date();
  const today = dominicanDate(now);
  const sub = await ensureSubscription(tenant, product);
  if (!sub) throw new FiscalError(409, 'BILLING_NO_PRODUCT', `The tenant does not have ${product}`);
  const endsOn = options.immediate || inTrial(sub, today) ? today : firstDayOfNextMonth(now);
  const next: ITenantSubscription = { ...sub, endsOn };
  delete next.pendingPlan;
  await saveSubscription(tenant, product, next, {});
  if (endsOn <= today) await applyDueChanges(tenant, now);
  return next;
}

/** Withdraws a cancellation that has not taken effect yet. */
export async function resumeSubscription(tenant: ITenant, product: BillingProduct, now = new Date()): Promise<ITenantSubscription> {
  const sub = subscriptionOf(tenant, product);
  if (!sub?.endsOn || sub.endsOn <= dominicanDate(now)) throw new FiscalError(409, 'BILLING_STATE', 'There is no pending cancellation to withdraw');
  const next = { ...sub };
  delete next.endsOn;
  await saveSubscription(tenant, product, next, {});
  return next;
}

/** An operator's price for the product from the first day of `period` (a new segment, same plan). */
export async function applyPriceOverride(tenant: ITenant, product: BillingProduct, price: number, period: string): Promise<void> {
  const sub = await ensureSubscription(tenant, product);
  if (!sub) return;
  const day = `${period}-01`;
  const plan = (segmentOn(sub, day) ?? sub.segments[sub.segments.length - 1]).plan;
  const later = sub.segments.filter((s) => s.from > day).map((s) => ({ ...s, price, source: 'override' as const }));
  const kept = sub.segments.filter((s) => s.from < day);
  await saveSubscription(tenant, product, { ...sub, segments: [...kept, { plan, price: round2(price), source: 'override', from: day }, ...later] });
}

/**
 * Applies what is due on `now`: pending downgrades whose day has come, and cancellations that took
 * effect (the product leaves `products`). Idempotent. Returns what it changed.
 */
export async function applyDueChanges(tenant: ITenant, now = new Date()): Promise<string[]> {
  const today = dominicanDate(now);
  const changed: string[] = [];
  for (const product of ['pms', 'accounting'] as BillingProduct[]) {
    const sub = subscriptionOf(tenant, product);
    if (!sub) continue;
    if (sub.endsOn && sub.endsOn <= today) {
      if (tenant.products?.includes(product)) {
        const products = tenant.products.filter((p) => p !== product);
        await Tenant.updateOne({ _id: tenant._id }, { $set: { products } });
        tenant.products = products;
        changed.push(`${product}:ended`);
      }
      continue;
    }
    if (sub.pendingPlan && sub.pendingPlan.effectiveOn <= today) {
      await applyPlanChange(tenant, product, sub.pendingPlan.plan, sub.pendingPlan.effectiveOn);
      changed.push(`${product}:${sub.pendingPlan.plan}`);
    }
  }
  return changed;
}

/** Applies due changes for every tenant that has one waiting (the daily billing job). */
export async function applyAllDueChanges(now = new Date()): Promise<number> {
  const today = dominicanDate(now);
  const tenants = await Tenant.find({
    $or: [
      { 'billing.subscriptions.pms.pendingPlan.effectiveOn': { $lte: today } },
      { 'billing.subscriptions.accounting.pendingPlan.effectiveOn': { $lte: today } },
      { 'billing.subscriptions.pms.endsOn': { $lte: today }, products: 'pms' },
      { 'billing.subscriptions.accounting.endsOn': { $lte: today }, products: 'accounting' },
    ],
  });
  let n = 0;
  for (const tenant of tenants) {
    try {
      n += (await applyDueChanges(tenant, now)).length;
    } catch (err: any) {
      console.warn(`[Billing] Could not apply due subscription changes for ${tenant._id}: ${err?.message}`);
    }
  }
  return n;
}

/**
 * Brings the subscriptions in line with the tenant's products and plans after a platform operator
 * edited them directly: a new product starts (with a trial unless it had one before), a removed one
 * ends today, a changed plan applies today.
 */
export async function syncSubscriptions(tenant: ITenant, options: StartOptions = {}): Promise<void> {
  const now = options.now ?? new Date();
  const today = dominicanDate(now);
  for (const product of ['pms', 'accounting'] as BillingProduct[]) {
    const has = tenant.products?.includes(product);
    const plan = currentPlan(tenant, product);
    const sub = subscriptionOf(tenant, product);
    const active = !!sub && (!sub.endsOn || sub.endsOn > today);
    if (has && !active && plan) await startSubscription(tenant, product, plan, options);
    else if (!has && active) await scheduleCancellation(tenant, product, { now, immediate: true });
    else if (has && active && plan && segmentOn(sub!, today)?.plan !== plan) await applyPlanChange(tenant, product, plan, today);
  }
}
