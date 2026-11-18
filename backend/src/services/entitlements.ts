/**
 * What a tenant's plans let it do, in one place: module gates, numeric limits, current usage, and
 * the 403 bodies every plan denial shares so the frontend can offer the right upgrade.
 *
 * A denial body is `{ success: false, code: 'PLAN_FEATURE' | 'PLAN_LIMIT', message, plan: {...} }`
 * where `plan.requiredPlan` is the smallest plan that lifts the restriction (absent when no plan
 * does).
 */
import { NextFunction, Response } from 'express';
import {
  ACCOUNTING_PLANS,
  AccountingFeature,
  AccountingPlanSlug,
  accountingPlanRank,
  getAccountingPlanFeatures,
  getAccountingPlanLimits,
  isAccountingPlan,
  smallestAccountingPlanWith,
} from '../config/accountingPlans';
import { getPlanFeatures, getPlanLimits, isPmsPlan, PLAN_SLUGS, PlanFeatures, PlanSlug, PLANS, pmsPlanRank, smallestPlanWith } from '../config/plans';
import Room from '../models/Room';
import User from '../models/User';
import Warehouse from '../models/Warehouse';
import { BillingProduct, ITenant } from '../models/Tenant';

export type LimitKey = 'users' | 'rooms' | 'warehouses';

export interface PlanDenial {
  success: false;
  code: 'PLAN_FEATURE' | 'PLAN_LIMIT';
  message: string;
  plan: {
    product: BillingProduct;
    currentPlan?: string;
    feature?: string;
    limit?: LimitKey;
    max?: number;
    requiredPlan?: string;
  };
}

// ─── Denials ─────────────────────────────────────────────────────────────────

export function featureDenial(product: BillingProduct, feature: string, currentPlan: string | undefined, requiredPlan: string): PlanDenial {
  return {
    success: false,
    code: 'PLAN_FEATURE',
    message: 'This feature is not available on your current plan.',
    plan: { product, currentPlan, feature, requiredPlan },
  };
}

const LIMIT_NOUN: Record<LimitKey, string> = { users: 'user(s)', rooms: 'room(s)', warehouses: 'warehouse(s)' };
const PRODUCT_LABEL: Record<BillingProduct, string> = { pms: 'PMS', accounting: 'Accounting' };

/** The smallest plan of `product` whose `limit` is above `current` (undefined when none is). */
export function smallestPlanAbove(product: BillingProduct, limit: LimitKey, current: number): string | undefined {
  const slugs: string[] = product === 'pms' ? PLAN_SLUGS : Object.keys(ACCOUNTING_PLANS);
  return slugs.find((slug) => {
    const max = limitOf(product, slug, limit);
    return max === null || (typeof max === 'number' && max > current);
  });
}

export function limitDenial(product: BillingProduct, limit: LimitKey, max: number, currentPlan: string | undefined): PlanDenial {
  return {
    success: false,
    code: 'PLAN_LIMIT',
    message: `Your ${PRODUCT_LABEL[product]} plan allows up to ${max} ${LIMIT_NOUN[limit]}. Upgrade your plan to add more.`,
    plan: { product, currentPlan, limit, max, requiredPlan: smallestPlanAbove(product, limit, max) },
  };
}

// ─── Plans & limits ──────────────────────────────────────────────────────────

type TenantPlans = Pick<ITenant, 'plan' | 'plans' | 'products'>;

export const pmsPlanOf = (tenant?: Partial<TenantPlans> | null): PlanSlug => (isPmsPlan(tenant?.plan) ? tenant!.plan : 'basic');
export const accountingPlanOf = (tenant?: Partial<TenantPlans> | null): AccountingPlanSlug =>
  isAccountingPlan(tenant?.plans?.accounting) ? tenant!.plans!.accounting! : 'invoicing';

/** The limit `limit` of `plan` for `product`: a number, `null` (unlimited), or `undefined` (the product has no such limit). */
export function limitOf(product: BillingProduct, plan: string, limit: LimitKey): number | null | undefined {
  if (product === 'pms') {
    const l = getPlanLimits(plan);
    return limit === 'rooms' ? l.maxRooms : limit === 'users' ? l.maxUsers : undefined;
  }
  const l = getAccountingPlanLimits(plan);
  return limit === 'warehouses' ? l.maxWarehouses : limit === 'users' ? l.maxUsers : undefined;
}

export const hasAccountingFeature = (tenant: Partial<TenantPlans> | null | undefined, feature: AccountingFeature): boolean =>
  getAccountingPlanFeatures(accountingPlanOf(tenant))[feature];

export const hasPmsFeature = (tenant: Partial<TenantPlans> | null | undefined, feature: keyof PlanFeatures): boolean =>
  getPlanFeatures(pmsPlanOf(tenant))[feature];

/** Route gate: 403 PLAN_FEATURE unless the tenant's Accounting plan includes `feature`. */
export function requireAccountingFeature(feature: AccountingFeature) {
  return (req: any, res: Response, next: NextFunction): void => {
    if (!req.tenant) {
      res.status(403).json({ success: false, message: 'Tenant context required.' });
      return;
    }
    if (!hasAccountingFeature(req.tenant, feature)) {
      res.status(403).json(featureDenial('accounting', feature, accountingPlanOf(req.tenant), smallestAccountingPlanWith(feature)));
      return;
    }
    next();
  };
}

/** Route gate: 403 PLAN_FEATURE unless the tenant's PMS plan includes `feature`. */
export function requirePmsFeature(feature: keyof PlanFeatures) {
  return (req: any, res: Response, next: NextFunction): void => {
    if (!req.tenant?.plan) {
      res.status(403).json({ success: false, message: 'Tenant context required.' });
      return;
    }
    if (!hasPmsFeature(req.tenant, feature)) {
      res.status(403).json(featureDenial('pms', feature, pmsPlanOf(req.tenant), smallestPlanWith(feature)));
      return;
    }
    next();
  };
}

// ─── Usage ───────────────────────────────────────────────────────────────────

export interface Usage {
  pms: { users: number; rooms: number };
  accounting: { users: number; warehouses: number };
}

/**
 * Mongo filter for the users holding a seat in `app`: an `appRoles` entry for it, or — PMS only — a
 * legacy staff `role` (anything but `customer`) without one, since `authorize()` still honours it.
 */
export function seatFilter(app: BillingProduct): Record<string, unknown> {
  const active = { isActive: { $ne: false } };
  if (app === 'accounting') return { ...active, 'appRoles.app': 'accounting' };
  return { ...active, $or: [{ 'appRoles.app': 'pms' }, { role: { $nin: ['customer', null, ''] } }] };
}

/** Whether `user` already holds a seat in `app` (assigning it again never needs a free seat). */
export function holdsSeat(user: { role?: string; appRoles?: { app: string }[] }, app: BillingProduct): boolean {
  if (user.appRoles?.some((ar) => ar.app === app)) return true;
  return app === 'pms' && !!user.role && user.role !== 'customer';
}

/** Seats held in `app`. Runs inside the tenant's request context (User is tenant-scoped). */
export const seatsIn = (app: BillingProduct): Promise<number> => User.countDocuments(seatFilter(app));

/** The 403 body when the tenant has no free seat in `app` for one more user, else null. */
export async function seatLimitDenial(tenant: Partial<TenantPlans> | null | undefined, app: BillingProduct): Promise<PlanDenial | null> {
  const plan = app === 'pms' ? pmsPlanOf(tenant) : accountingPlanOf(tenant);
  const max = limitOf(app, plan, 'users');
  if (typeof max !== 'number') return null;
  return (await seatsIn(app)) >= max ? limitDenial(app, 'users', max, plan) : null;
}

/** The 403 body when one more active room or warehouse would exceed the plan, else null. */
export async function countLimitDenial(tenant: Partial<TenantPlans> | null | undefined, what: 'rooms' | 'warehouses'): Promise<PlanDenial | null> {
  const product: BillingProduct = what === 'rooms' ? 'pms' : 'accounting';
  const plan = product === 'pms' ? pmsPlanOf(tenant) : accountingPlanOf(tenant);
  const max = limitOf(product, plan, what);
  if (typeof max !== 'number') return null;
  const used = what === 'rooms' ? await activeRooms() : await activeWarehouses();
  return used >= max ? limitDenial(product, what, max, plan) : null;
}
export const activeRooms = (): Promise<number> => Room.countDocuments({ status: 'active' });
export const activeWarehouses = (): Promise<number> => Warehouse.countDocuments({ isActive: true });

/** What the tenant uses now. Must run inside the tenant's context. */
export async function currentUsage(): Promise<Usage> {
  const [pmsUsers, rooms, accountingUsers, warehouses] = await Promise.all([seatsIn('pms'), activeRooms(), seatsIn('accounting'), activeWarehouses()]);
  return { pms: { users: pmsUsers, rooms }, accounting: { users: accountingUsers, warehouses } };
}

export interface LimitViolation {
  limit: LimitKey;
  max: number;
  current: number;
}

/** The limits of `plan` the tenant's usage would exceed (what blocks a downgrade). */
export function limitViolations(product: BillingProduct, plan: string, usage: Usage): LimitViolation[] {
  const keys: LimitKey[] = product === 'pms' ? ['rooms', 'users'] : ['users', 'warehouses'];
  const used = usage[product] as Record<string, number>;
  const out: LimitViolation[] = [];
  for (const limit of keys) {
    const max = limitOf(product, plan, limit);
    if (typeof max === 'number' && used[limit] > max) out.push({ limit, max, current: used[limit] });
  }
  return out;
}

/** Modules of the current plan that `plan` lacks (shown as a warning before a downgrade). */
export function lostFeatures(product: BillingProduct, from: string, to: string): string[] {
  if (product === 'pms') {
    const a = getPlanFeatures(from) as unknown as Record<string, boolean>;
    const b = getPlanFeatures(to) as unknown as Record<string, boolean>;
    return Object.keys(a).filter((k) => a[k] && !b[k]);
  }
  const a = getAccountingPlanFeatures(from) as unknown as Record<string, boolean>;
  const b = getAccountingPlanFeatures(to) as unknown as Record<string, boolean>;
  return Object.keys(a).filter((k) => a[k] && !b[k]);
}

/** Positive when `to` is a larger plan than `from`, negative when smaller, 0 when the same. */
export function planDirection(product: BillingProduct, from: string, to: string): number {
  if (product === 'pms') return pmsPlanRank(to as PlanSlug) - pmsPlanRank(from as PlanSlug);
  return accountingPlanRank(to as AccountingPlanSlug) - accountingPlanRank(from as AccountingPlanSlug);
}

export const isPlanOf = (product: BillingProduct, plan: unknown): plan is string =>
  product === 'pms' ? isPmsPlan(plan) : isAccountingPlan(plan);

export { PLANS, ACCOUNTING_PLANS };
