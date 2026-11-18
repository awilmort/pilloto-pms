/**
 * The plans Pilloto sells, as customers see them: structure from the plan configs, prices from the
 * console's price list, the e-CF each plan includes, and the suite discount. One source for the
 * marketing site's pricing tables and the tenant's subscription page.
 */
import { ACCOUNTING_PLANS, AccountingPlanSlug } from '../../config/accountingPlans';
import { ACCOUNTING_INCLUDED_FISCAL_PLAN, PMS_INCLUDED_FISCAL_PLAN } from '../../config/fiscal';
import { PLANS, PlanSlug } from '../../config/plans';
import { BillingProduct, FiscalPlan } from '../../models/Tenant';
import { getPlanCatalog } from '../fiscal/fiscalPlans';
import { getPlatformSettings } from '../fiscal/platformIssuer';
import { getCatalog } from './billingPlans';

export interface CatalogPlan {
  product: BillingProduct;
  slug: string;
  name: string;
  /** DOP per month, before ITBIS. */
  monthlyPrice: number;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  includedEcf: { plan: FiscalPlan; transactions: number | null };
}

export interface PublicCatalog {
  currency: 'DOP';
  /** ITBIS rate (percent) added to the prices, which are listed before tax. */
  taxPercent: number;
  suiteDiscountPercent: number;
  pms: CatalogPlan[];
  accounting: CatalogPlan[];
}

const TAX_PERCENT: Record<string, number> = { itbis18: 18, itbis16: 16, itbis0: 0, exempt: 0 };

/** e-CF transactions a BillingSoft plan includes; null when BillingSoft cannot be reached. */
async function fiscalTransactions(): Promise<Record<string, number> | null> {
  try {
    const catalog = await getPlanCatalog();
    return Object.fromEntries(catalog.plans.map((p) => [p.id, p.transactions]));
  } catch {
    return null;
  }
}

export async function publicCatalog(): Promise<PublicCatalog> {
  const [prices, settings, tx] = await Promise.all([getCatalog(), getPlatformSettings(), fiscalTransactions()]);
  const priceOf = (product: BillingProduct, slug: string) => prices.find((p) => p.product === product && p.plan === slug)?.monthlyPrice ?? 0;
  const ecf = (plan: FiscalPlan) => ({ plan, transactions: tx?.[plan] ?? null });

  return {
    currency: 'DOP',
    taxPercent: TAX_PERCENT[settings.billing?.tax ?? 'itbis18'] ?? 18,
    suiteDiscountPercent: settings.billing?.suiteDiscountPercent ?? 20,
    pms: (Object.keys(PLANS) as PlanSlug[]).map((slug) => ({
      product: 'pms',
      slug,
      name: PLANS[slug].name,
      monthlyPrice: priceOf('pms', slug),
      features: { ...PLANS[slug].features },
      limits: { ...PLANS[slug].limits },
      includedEcf: ecf(PMS_INCLUDED_FISCAL_PLAN[slug]),
    })),
    accounting: (Object.keys(ACCOUNTING_PLANS) as AccountingPlanSlug[]).map((slug) => ({
      product: 'accounting',
      slug,
      name: ACCOUNTING_PLANS[slug].name,
      monthlyPrice: priceOf('accounting', slug),
      features: { ...ACCOUNTING_PLANS[slug].features },
      limits: { ...ACCOUNTING_PLANS[slug].limits },
      includedEcf: ecf(ACCOUNTING_INCLUDED_FISCAL_PLAN[slug]),
    })),
  };
}
