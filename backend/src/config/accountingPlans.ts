/**
 * Accounting plan definitions — the `accounting` product's independent pricing
 * ladder, sold and priced separately from the `pms` ladder in `plans.ts`.
 *
 * Same convention as `plans.ts`: hardcoded here, not DB-stored — to change a
 * tier, edit this file and redeploy. To assign a tenant's `accounting` plan,
 * use the superadmin → Tenants page.
 */

export type AccountingPlanSlug = 'starter' | 'pro' | 'plus';

export interface AccountingPlanFeatures {
  /** Max concurrent Warehouses. `null` = unlimited. */
  maxWarehouses: number | null;
  /** Max distinct users holding an `accounting` appRoles entry. `null` = unlimited. */
  maxUsers: number | null;
  /** Whether Payroll (not yet built) is bundled at this tier. Reserved — not enforced anywhere until it ships. */
  payrollIncluded: boolean;
}

export interface AccountingPlanConfig {
  slug: AccountingPlanSlug;
  name: string;
  /** Monthly price in USD cents. Used for billing. */
  priceUsd: number;
  /** Human-readable price string for display purposes. */
  displayPrice: string;
  features: AccountingPlanFeatures;
}

export const ACCOUNTING_PLANS: Record<AccountingPlanSlug, AccountingPlanConfig> = {
  starter: {
    slug: 'starter',
    name: 'Starter',
    priceUsd: 3900,
    displayPrice: '$39',
    features: {
      maxWarehouses: 1,
      maxUsers: 2,
      payrollIncluded: false,
    },
  },

  pro: {
    slug: 'pro',
    name: 'Pro',
    priceUsd: 8900,
    displayPrice: '$89',
    features: {
      maxWarehouses: 3,
      maxUsers: 10,
      payrollIncluded: false,
    },
  },

  plus: {
    slug: 'plus',
    name: 'Plus',
    priceUsd: 14900,
    displayPrice: '$149',
    features: {
      maxWarehouses: null,
      maxUsers: null,
      payrollIncluded: true,
    },
  },
};

/** Returns the feature set for a given accounting plan slug.
 *  Falls back to `starter` features if the slug is unknown/absent. */
export function getAccountingPlanFeatures(slug?: string): AccountingPlanFeatures {
  return ACCOUNTING_PLANS[slug as AccountingPlanSlug]?.features ?? ACCOUNTING_PLANS.starter.features;
}
