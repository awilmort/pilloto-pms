/**
 * Accounting plan definitions — the `accounting` product's own ladder, sold and priced separately
 * from the `pms` ladder in `plans.ts` (see PLANS_AND_SUBSCRIPTIONS_PLAN.md).
 *
 * Same convention as `plans.ts`: the structure (modules, limits) is hardcoded here and changes with
 * a deploy. Prices are not: the console's price list (`PlanPrice`) holds them, starting from
 * `listPriceDop` below the first time it is read.
 *
 * Every tier posts to the general ledger in the background; a module flag only decides what the
 * tenant can see and do. An upgrade therefore shows complete books from the first day.
 */

export const ACCOUNTING_PLAN_SLUGS = ['invoicing', 'essentials', 'pro', 'plus'] as const;
export type AccountingPlanSlug = (typeof ACCOUNTING_PLAN_SLUGS)[number];

export interface AccountingPlanFeatures {
  /** Inventory: stock-tracked products, warehouses, inventory bill lines. */
  inventory: boolean;
  /** Chart of accounts management, journal entries, financial statements, ledger reports, payables aging, supplier statements. */
  generalLedger: boolean;
  /** Bank accounts, statement import and reconciliation. */
  bankReconciliation: boolean;
  /** Documents in a currency other than DOP. */
  multiCurrency: boolean;
}

export type AccountingFeature = keyof AccountingPlanFeatures;

export interface AccountingPlanLimits {
  /** Max distinct users holding an `accounting` appRoles entry. `null` = unlimited. */
  maxUsers: number | null;
  /** Max active warehouses (0 when the plan has no inventory). `null` = unlimited. */
  maxWarehouses: number | null;
}

export interface AccountingPlanConfig {
  slug: AccountingPlanSlug;
  name: string;
  /** Starting monthly list price, DOP before ITBIS. The console price list is authoritative. */
  listPriceDop: number;
  features: AccountingPlanFeatures;
  limits: AccountingPlanLimits;
}

export const ACCOUNTING_PLANS: Record<AccountingPlanSlug, AccountingPlanConfig> = {
  invoicing: {
    slug: 'invoicing',
    name: 'Facturación',
    listPriceDop: 1590,
    features: { inventory: false, generalLedger: false, bankReconciliation: false, multiCurrency: false },
    limits: { maxUsers: 2, maxWarehouses: 0 },
  },
  essentials: {
    slug: 'essentials',
    name: 'Esencial',
    listPriceDop: 4090,
    features: { inventory: true, generalLedger: true, bankReconciliation: true, multiCurrency: false },
    limits: { maxUsers: 3, maxWarehouses: 1 },
  },
  pro: {
    slug: 'pro',
    name: 'Pro',
    listPriceDop: 6890,
    features: { inventory: true, generalLedger: true, bankReconciliation: true, multiCurrency: true },
    limits: { maxUsers: 6, maxWarehouses: 3 },
  },
  plus: {
    slug: 'plus',
    name: 'Plus',
    listPriceDop: 10690,
    features: { inventory: true, generalLedger: true, bankReconciliation: true, multiCurrency: true },
    limits: { maxUsers: 15, maxWarehouses: null },
  },
};

export const DEFAULT_ACCOUNTING_PLAN: AccountingPlanSlug = 'invoicing';

export const isAccountingPlan = (value: unknown): value is AccountingPlanSlug =>
  typeof value === 'string' && (ACCOUNTING_PLAN_SLUGS as readonly string[]).includes(value);

const planOf = (slug?: string): AccountingPlanConfig =>
  ACCOUNTING_PLANS[isAccountingPlan(slug) ? slug : DEFAULT_ACCOUNTING_PLAN];

/** The modules a plan includes. Unknown/absent slugs get the entry plan's. */
export function getAccountingPlanFeatures(slug?: string): AccountingPlanFeatures {
  return planOf(slug).features;
}

/** The limits of a plan. Unknown/absent slugs get the entry plan's. */
export function getAccountingPlanLimits(slug?: string): AccountingPlanLimits {
  return planOf(slug).limits;
}

/** Plans from smallest to largest, for upgrade/downgrade comparisons. */
export const accountingPlanRank = (slug: AccountingPlanSlug): number => ACCOUNTING_PLAN_SLUGS.indexOf(slug);

/** The smallest plan that includes `feature` (what an upgrade prompt offers). */
export function smallestAccountingPlanWith(feature: AccountingFeature): AccountingPlanSlug {
  return ACCOUNTING_PLAN_SLUGS.find((s) => ACCOUNTING_PLANS[s].features[feature]) ?? 'plus';
}
