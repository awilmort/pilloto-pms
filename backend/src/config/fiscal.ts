/**
 * Electronic invoicing (e-CF) configuration: where BillingSoft is, Pilloto's partner credential,
 * and which BillingSoft plan each Pilloto plan includes.
 *
 * Pilloto is a *partner* Organization in BillingSoft: one API key acts for every tenant by naming
 * the tenant's Organization in a header, so no tenant holds a credential of its own. Prices are not
 * written here — BillingSoft publishes them (`GET /v1/plans`) and Pilloto reads them.
 */
import { FISCAL_PLANS, FiscalPlan, ITenant } from '../models/Tenant';
import { PlanSlug } from './plans';
import { AccountingPlanSlug } from './accountingPlans';

export interface FiscalConfig {
  /** BillingSoft API origin, without a trailing slash. */
  apiUrl: string;
  /** Pilloto's partner API key (secret). Empty when e-CF is not configured on this server. */
  partnerApiKey: string;
  /** BillingSoft's dashboard, where customers upload the certificate and run DGII's certification. */
  appUrl: string;
  /** Public origin of this backend, for the webhook URL registered with BillingSoft. */
  backendPublicUrl: string;
  /** Development/QA only: issue even when DGII has not certified the tenant (documents have no fiscal value). */
  allowUncertified: boolean;
}

export function getFiscalConfig(env: NodeJS.ProcessEnv = process.env): FiscalConfig {
  const trim = (v?: string) => (v ?? '').trim().replace(/\/+$/, '');
  return {
    apiUrl: trim(env.BILLINGSOFT_API_URL) || 'https://api.billingsoft.net',
    partnerApiKey: (env.BILLINGSOFT_PARTNER_API_KEY ?? '').trim(),
    appUrl: trim(env.BILLINGSOFT_APP_URL) || 'https://app.billingsoft.net',
    backendPublicUrl: trim(env.BACKEND_PUBLIC_URL),
    // Never in production, whatever the variable says.
    allowUncertified: env.NODE_ENV !== 'production' && env.FISCAL_ALLOW_UNCERTIFIED === 'true',
  };
}

export const isFiscalConfigured = (cfg: FiscalConfig = getFiscalConfig()): boolean => cfg.partnerApiKey.length > 0;

/** BillingSoft plans from smallest to largest. */
const PLAN_RANK: Record<FiscalPlan, number> = { essential: 1, pro: 2, max: 3 };
export const fiscalPlanRank = (plan: FiscalPlan): number => PLAN_RANK[plan];
export const isFiscalPlan = (value: unknown): value is FiscalPlan =>
  typeof value === 'string' && (FISCAL_PLANS as readonly string[]).includes(value);

/** The BillingSoft plan each Pilloto PMS plan includes. Basic includes none. */
export const PMS_INCLUDED_FISCAL_PLAN: Partial<Record<PlanSlug, FiscalPlan>> = {
  pro: 'essential',
  enterprise: 'pro',
};

/** The BillingSoft plan each Pilloto Accounting plan includes. Starter includes none. */
export const ACCOUNTING_INCLUDED_FISCAL_PLAN: Partial<Record<AccountingPlanSlug, FiscalPlan>> = {
  pro: 'essential',
  plus: 'pro',
};

/**
 * The BillingSoft plan the tenant's Pilloto plans include: the larger of what its PMS and Accounting
 * plans each include, or `null` when neither includes one (the tenant then pays the full price of
 * the plan it chooses).
 */
export function includedFiscalPlan(
  tenant: Pick<ITenant, 'products' | 'plan' | 'plans'>,
): FiscalPlan | null {
  const candidates: FiscalPlan[] = [];
  if (tenant.products?.includes('pms')) {
    const p = PMS_INCLUDED_FISCAL_PLAN[tenant.plan as PlanSlug];
    if (p) candidates.push(p);
  }
  if (tenant.products?.includes('accounting')) {
    const a = ACCOUNTING_INCLUDED_FISCAL_PLAN[tenant.plans?.accounting as AccountingPlanSlug];
    if (a) candidates.push(a);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((best, p) => (fiscalPlanRank(p) > fiscalPlanRank(best) ? p : best));
}
