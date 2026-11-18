/**
 * The tenant's own view of its Pilloto subscription (the "Plan y facturación" page): what it has,
 * what it pays, what it uses against its plan, and the self-service changes — upgrade at once,
 * downgrade next month (blocked while usage is above the smaller plan), add a product with a free
 * trial, cancel at the end of the month.
 */
import { includedFiscalPlan } from '../../config/fiscal';
import { BillingProduct, BILLING_PRODUCTS, ITenant, ITenantSubscription } from '../../models/Tenant';
import { ensureAccountingProvisioned } from '../../utils/provisionTenant';
import { sendEmail } from '../../utils/email';
import {
  currentUsage, isPlanOf, LimitViolation, limitOf, limitViolations, lostFeatures, planDirection, Usage,
} from '../entitlements';
import { dominicanDate, dominicanPeriod, FiscalError, fiscalState } from '../fiscal/fiscalCore';
import { getPlatformSettings } from '../fiscal/platformIssuer';
import { discountFor } from './billingContracts';
import { discountAmount, round2 } from './billingMath';
import { CatalogPlan, publicCatalog } from './planCatalog';
import {
  applyDueChanges, applyPlanChange, cancelPendingPlan, ensureSubscription, inTrial, resumeSubscription, scheduleCancellation,
  scheduleDowngrade, startSubscription, subscriptionOf,
} from './subscriptions';

export type SubscriptionStatus = 'trial' | 'active' | 'cancelling' | 'ended';

export function statusOf(sub: ITenantSubscription, today: string): SubscriptionStatus {
  if (sub.endsOn && sub.endsOn <= today) return 'ended';
  if (sub.endsOn) return 'cancelling';
  return inTrial(sub, today) ? 'trial' : 'active';
}

const isLive = (status: SubscriptionStatus) => status !== 'ended';

const PRODUCT_NAME: Record<BillingProduct, string> = { pms: 'Pilloto PMS', accounting: 'Pilloto Contabilidad' };

export interface ProductView {
  product: BillingProduct;
  plan: string;
  planName: string;
  status: SubscriptionStatus;
  startedOn: string;
  billableFrom: string;
  endsOn: string | null;
  pendingPlan: { plan: string; planName: string; effectiveOn: string } | null;
  /** The tenant's monthly price (DOP before ITBIS) and the discount in force this month. */
  price: number;
  discount: { kind: 'operator' | 'suite'; type: 'percent' | 'amount'; value: number; amount: number } | null;
  monthly: number;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
}

/** The discount on `product` this month: the operator's, or the suite discount while both products run. */
function discountNow(tenant: ITenant, product: BillingProduct, period: string, suitePercent: number, bothLive: boolean) {
  const operator = discountFor(tenant, product, period);
  if (operator) return { kind: 'operator' as const, type: operator.type, value: operator.value };
  if (product === 'accounting' && bothLive && suitePercent > 0) return { kind: 'suite' as const, type: 'percent' as const, value: suitePercent };
  return null;
}

function planEntry(catalog: { pms: CatalogPlan[]; accounting: CatalogPlan[] }, product: BillingProduct, plan: string) {
  return catalog[product].find((p) => p.slug === plan);
}

/** Everything the subscription page shows. Applies due changes first. Runs in the tenant's context (usage). */
export async function subscriptionOverview(tenant: ITenant, now = new Date()) {
  await applyDueChanges(tenant, now);
  for (const product of BILLING_PRODUCTS) if (tenant.products?.includes(product)) await ensureSubscription(tenant, product);

  const today = dominicanDate(now);
  const period = dominicanPeriod(now);
  const [catalog, settings, usage] = await Promise.all([publicCatalog(), getPlatformSettings(), currentUsage()]);
  const statuses = Object.fromEntries(
    BILLING_PRODUCTS.map((p) => [p, subscriptionOf(tenant, p) ? statusOf(subscriptionOf(tenant, p)!, today) : null]),
  ) as Record<BillingProduct, SubscriptionStatus | null>;
  const bothLive = BILLING_PRODUCTS.every((p) => statuses[p] && isLive(statuses[p]!));

  const products: ProductView[] = [];
  for (const product of BILLING_PRODUCTS) {
    const sub = subscriptionOf(tenant, product);
    if (!sub || sub.segments.length === 0) continue;
    const last = sub.segments[sub.segments.length - 1];
    const entry = planEntry(catalog, product, last.plan);
    const d = discountNow(tenant, product, period, catalog.suiteDiscountPercent, bothLive);
    const off = d ? discountAmount(last.price, { type: d.type, value: d.value }) : 0;
    products.push({
      product,
      plan: last.plan,
      planName: entry?.name ?? last.plan,
      status: statuses[product]!,
      startedOn: sub.startedOn,
      billableFrom: sub.billableFrom,
      endsOn: sub.endsOn ?? null,
      pendingPlan: sub.pendingPlan
        ? { plan: sub.pendingPlan.plan, planName: planEntry(catalog, product, sub.pendingPlan.plan)?.name ?? sub.pendingPlan.plan, effectiveOn: sub.pendingPlan.effectiveOn }
        : null,
      price: last.price,
      discount: d ? { ...d, amount: off } : null,
      monthly: round2(last.price - off),
      limits: entry?.limits ?? {},
      features: entry?.features ?? {},
    });
  }

  return {
    today,
    currency: 'DOP' as const,
    taxPercent: catalog.taxPercent,
    suiteDiscountPercent: catalog.suiteDiscountPercent,
    products,
    /** Products the tenant can add (never had, or ended). */
    available: BILLING_PRODUCTS.filter((p) => !statuses[p] || statuses[p] === 'ended'),
    usage,
    ecf: { includedPlan: includedFiscalPlan(tenant), plan: tenant.fiscal?.plan ?? null, state: fiscalState(tenant) },
    billingEmail: tenant.billing?.billingEmail || tenant.ownerEmail,
    paymentInstructions: settings.billing?.paymentInstructions ?? '',
  };
}

export interface CatalogOption extends CatalogPlan {
  current: boolean;
  /** >0 upgrade, <0 downgrade, 0 the current plan (null when the tenant does not have the product). */
  direction: number | null;
  /** What the tenant would pay per month on this plan (its discount applied). */
  tenantPrice: number;
  /** Usage above this plan's limits (a downgrade is blocked until it is resolved). */
  violations: LimitViolation[];
  /** Modules of the current plan this one lacks. */
  lostFeatures: string[];
}

/** The plan list with, for each plan, what changing to it would mean for this tenant. */
export async function tenantCatalog(tenant: ITenant, now = new Date(), usage?: Usage) {
  const today = dominicanDate(now);
  const period = dominicanPeriod(now);
  const [catalog, u] = await Promise.all([publicCatalog(), usage ? Promise.resolve(usage) : currentUsage()]);
  const live = (p: BillingProduct) => {
    const s = subscriptionOf(tenant, p);
    return !!s && isLive(statusOf(s, today));
  };
  const bothAfter = (p: BillingProduct) => live(p === 'pms' ? 'accounting' : 'pms'); // the other product runs
  const shape = (product: BillingProduct): CatalogOption[] => {
    const sub = subscriptionOf(tenant, product);
    const current = sub && isLive(statusOf(sub, today)) ? sub.segments[sub.segments.length - 1]?.plan : undefined;
    return catalog[product].map((p) => {
      const d = discountNow(tenant, product, period, catalog.suiteDiscountPercent, bothAfter(product));
      const off = d ? discountAmount(p.monthlyPrice, { type: d.type, value: d.value }) : 0;
      return {
        ...p,
        current: p.slug === current,
        direction: current ? planDirection(product, current, p.slug) : null,
        tenantPrice: round2(p.monthlyPrice - off),
        violations: limitViolations(product, p.slug, u),
        lostFeatures: current ? lostFeatures(product, current, p.slug) : [],
      };
    });
  };
  return { currency: catalog.currency, taxPercent: catalog.taxPercent, suiteDiscountPercent: catalog.suiteDiscountPercent, pms: shape('pms'), accounting: shape('accounting') };
}

// ─── Changes ─────────────────────────────────────────────────────────────────

export interface Actor {
  email?: string;
}

async function notifyOps(tenant: ITenant, what: string, actor: Actor): Promise<void> {
  const settings = await getPlatformSettings();
  const to = settings.billing?.notifyEmail;
  if (!to) return;
  try {
    await sendEmail({
      to,
      subject: `[Pilloto] ${tenant.name}: ${what}`,
      html: `<p><strong>${tenant.name}</strong> (${tenant.slug}) — ${what}.</p><p>Por: ${actor.email ?? 'desconocido'}</p>`,
      _logMeta: { emailType: 'subscription_change', referenceId: String(tenant._id) },
    });
  } catch (err: any) {
    console.warn(`[Billing] Could not notify the subscription change of ${tenant._id}: ${err?.message}`);
  }
}

function liveSubscription(tenant: ITenant, product: BillingProduct, today: string): ITenantSubscription {
  const sub = subscriptionOf(tenant, product);
  if (!sub || statusOf(sub, today) === 'ended') {
    throw new FiscalError(409, 'BILLING_NO_PRODUCT', `You do not have ${PRODUCT_NAME[product]}`);
  }
  return sub;
}

export type ChangeOutcome = 'upgraded' | 'changed' | 'scheduled' | 'unscheduled';

/**
 * Changes the plan of `product`. An upgrade — or any change during the free trial — applies today;
 * a downgrade waits for the first day of next month and is refused while usage is above the smaller
 * plan's limits (`PLAN_DOWNGRADE_BLOCKED`, with the violations). Choosing the current plan again
 * withdraws a pending downgrade.
 */
export async function changePlan(tenant: ITenant, product: BillingProduct, plan: unknown, actor: Actor, now = new Date()): Promise<{ outcome: ChangeOutcome; violations?: LimitViolation[] }> {
  if (!BILLING_PRODUCTS.includes(product)) throw new FiscalError(400, 'BILLING_INVALID', 'Unknown product');
  if (!isPlanOf(product, plan)) throw new FiscalError(400, 'BILLING_INVALID', 'Unknown plan', { plan: 'Plan inválido' });
  await ensureSubscription(tenant, product);
  const today = dominicanDate(now);
  const sub = liveSubscription(tenant, product, today);
  if (sub.endsOn) throw new FiscalError(409, 'BILLING_STATE', 'This product is being cancelled. Keep it first to change its plan.');
  const current = sub.segments[sub.segments.length - 1].plan;

  if (plan === current) {
    if (!sub.pendingPlan) throw new FiscalError(409, 'BILLING_STATE', 'You are already on this plan');
    await cancelPendingPlan(tenant, product);
    await notifyOps(tenant, `retiró el cambio de plan pendiente de ${PRODUCT_NAME[product]}`, actor);
    return { outcome: 'unscheduled' };
  }

  const direction = planDirection(product, current, plan);
  if (direction < 0) {
    const violations = limitViolations(product, plan, await currentUsage());
    if (violations.length > 0) {
      const err = new FiscalError(409, 'PLAN_DOWNGRADE_BLOCKED', 'Your current usage is above the limits of that plan.');
      (err as any).violations = violations;
      throw err;
    }
  }
  if (direction > 0 || inTrial(sub, today)) {
    await applyPlanChange(tenant, product, plan, today);
    await notifyOps(tenant, `cambió ${PRODUCT_NAME[product]} del plan ${current} al ${plan} (desde hoy)`, actor);
    return { outcome: direction > 0 ? 'upgraded' : 'changed' };
  }
  await scheduleDowngrade(tenant, product, plan, now);
  await notifyOps(tenant, `programó ${PRODUCT_NAME[product]} del plan ${current} al ${plan} (próximo mes)`, actor);
  return { outcome: 'scheduled' };
}

/** Adds a product the tenant does not have (or had and ended), with a free trial if it never had one. */
export async function addProduct(tenant: ITenant, product: BillingProduct, plan: unknown, actor: Actor, now = new Date()): Promise<void> {
  if (!BILLING_PRODUCTS.includes(product)) throw new FiscalError(400, 'BILLING_INVALID', 'Unknown product');
  if (!isPlanOf(product, plan)) throw new FiscalError(400, 'BILLING_INVALID', 'Unknown plan', { plan: 'Plan inválido' });
  const today = dominicanDate(now);
  const sub = subscriptionOf(tenant, product);
  if ((sub && statusOf(sub, today) !== 'ended') || (!sub && tenant.products?.includes(product))) {
    throw new FiscalError(409, 'BILLING_STATE', `You already have ${PRODUCT_NAME[product]}`);
  }
  await startSubscription(tenant, product, plan, { now });
  if (product === 'accounting') await ensureAccountingProvisioned(String(tenant._id));
  await notifyOps(tenant, `agregó ${PRODUCT_NAME[product]} (plan ${plan})`, actor);
}

/** Cancels a product at the end of the month (at once during its trial). The last product cannot be cancelled here. */
export async function cancelProduct(tenant: ITenant, product: BillingProduct, actor: Actor, now = new Date()): Promise<ITenantSubscription> {
  const today = dominicanDate(now);
  await ensureSubscription(tenant, product);
  const sub = liveSubscription(tenant, product, today);
  if (sub.endsOn) throw new FiscalError(409, 'BILLING_STATE', 'This product is already being cancelled');
  const others = BILLING_PRODUCTS.filter((p) => p !== product).filter((p) => {
    const s = subscriptionOf(tenant, p);
    return s && !s.endsOn && statusOf(s, today) !== 'ended';
  });
  if (others.length === 0) {
    throw new FiscalError(409, 'BILLING_LAST_PRODUCT', 'This is your only product. Contact Pilloto to close your account.');
  }
  const next = await scheduleCancellation(tenant, product, { now });
  await notifyOps(tenant, `canceló ${PRODUCT_NAME[product]} (efectivo ${next.endsOn})`, actor);
  return next;
}

export async function keepProduct(tenant: ITenant, product: BillingProduct, actor: Actor, now = new Date()): Promise<void> {
  await resumeSubscription(tenant, product, now);
  await notifyOps(tenant, `retiró la cancelación de ${PRODUCT_NAME[product]}`, actor);
}

/** Limits of `plan` as a list (for messages). */
export const limitsOf = (product: BillingProduct, plan: string) =>
  (['users', 'rooms', 'warehouses'] as const).map((k) => ({ limit: k, max: limitOf(product, plan, k) })).filter((l) => l.max !== undefined);
