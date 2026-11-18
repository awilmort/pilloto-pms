/**
 * Accounting plan definitions — frontend mirror of backend/src/config/accountingPlans.ts.
 * Keep the two files in sync whenever a tier's modules or limits change.
 */

export const ACCOUNTING_PLAN_SLUGS = ['invoicing', 'essentials', 'pro', 'plus'] as const;
export type AccountingPlanSlug = (typeof ACCOUNTING_PLAN_SLUGS)[number];

export interface AccountingPlanFeatures {
  inventory: boolean;
  generalLedger: boolean;
  bankReconciliation: boolean;
  multiCurrency: boolean;
}
export type AccountingFeature = keyof AccountingPlanFeatures;

export interface AccountingPlanLimits {
  maxUsers: number | null;
  maxWarehouses: number | null;
}

export interface AccountingPlanConfig {
  slug: AccountingPlanSlug;
  name: string;
  /** Starting monthly list price, DOP before ITBIS (the live price comes from GET /api/public/plans). */
  listPriceDop: number;
  features: AccountingPlanFeatures;
  limits: AccountingPlanLimits;
}

export const ACCOUNTING_PLANS: Record<AccountingPlanSlug, AccountingPlanConfig> = {
  invoicing: {
    slug: 'invoicing', name: 'Facturación', listPriceDop: 1590,
    features: { inventory: false, generalLedger: false, bankReconciliation: false, multiCurrency: false },
    limits: { maxUsers: 2, maxWarehouses: 0 },
  },
  essentials: {
    slug: 'essentials', name: 'Esencial', listPriceDop: 4090,
    features: { inventory: true, generalLedger: true, bankReconciliation: true, multiCurrency: false },
    limits: { maxUsers: 3, maxWarehouses: 1 },
  },
  pro: {
    slug: 'pro', name: 'Pro', listPriceDop: 6890,
    features: { inventory: true, generalLedger: true, bankReconciliation: true, multiCurrency: true },
    limits: { maxUsers: 6, maxWarehouses: 3 },
  },
  plus: {
    slug: 'plus', name: 'Plus', listPriceDop: 10690,
    features: { inventory: true, generalLedger: true, bankReconciliation: true, multiCurrency: true },
    limits: { maxUsers: 15, maxWarehouses: null },
  },
};

export const DEFAULT_ACCOUNTING_PLAN: AccountingPlanSlug = 'invoicing';

export const isAccountingPlan = (v: unknown): v is AccountingPlanSlug =>
  typeof v === 'string' && (ACCOUNTING_PLAN_SLUGS as readonly string[]).includes(v);

export function getAccountingPlanFeatures(slug?: string): AccountingPlanFeatures {
  return ACCOUNTING_PLANS[isAccountingPlan(slug) ? slug : DEFAULT_ACCOUNTING_PLAN].features;
}

/** The smallest plan that includes `feature`. */
export function smallestAccountingPlanWith(feature: AccountingFeature): AccountingPlanSlug {
  return ACCOUNTING_PLAN_SLUGS.find((s) => ACCOUNTING_PLANS[s].features[feature]) ?? 'plus';
}
