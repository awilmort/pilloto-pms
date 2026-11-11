/**
 * BillingSoft plans as Pilloto sells them: prices from BillingSoft's catalog, the plan a Pilloto
 * plan includes, what a tenant pays on top, and the overage on extra transactions.
 *
 * Prices are never written down in Pilloto — `GET /v1/plans` is read (and cached for a few
 * minutes) so a price change at BillingSoft reaches the statements without a deploy.
 */
import { fiscalPlanRank, includedFiscalPlan, isFiscalPlan } from '../../config/fiscal';
import { FiscalPlan, ITenant } from '../../models/Tenant';
import { getBillingSoftClient } from './fiscalClient';
import { FiscalError, round2 } from './fiscalCore';
import { BsPlanTerms, BsPlans } from './billingsoftTypes';

const CATALOG_TTL_MS = 10 * 60 * 1000;
let catalogCache: { at: number; plans: BsPlans } | null = null;

export async function getPlanCatalog(now: number = Date.now()): Promise<BsPlans> {
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.plans;
  const plans = await getBillingSoftClient().plans();
  catalogCache = { at: now, plans };
  return plans;
}

/** Test seam. */
export const resetPlanCatalogCache = (): void => {
  catalogCache = null;
};

export function termsOf(catalog: BsPlans, plan: FiscalPlan): BsPlanTerms {
  const terms = catalog.plans.find((p) => p.id === plan);
  if (!terms) throw new FiscalError(502, 'BILLINGSOFT_ERROR', `BillingSoft has no plan "${plan}"`);
  return terms;
}

// ─── What a plan costs the tenant ────────────────────────────────────────────

export interface PlanCharge {
  plan: FiscalPlan;
  includedPlan: FiscalPlan | null;
  /** Full monthly price of the plan. */
  planPrice: number;
  /** Monthly price of the plan the tenant's Pilloto plan includes (0 when none). */
  includedPlanPrice: number;
  /** What the tenant pays for the plan: its price less what is included, never below zero. */
  planCharge: number;
  /** Transactions the plan includes each month. */
  transactions: number;
  overageUnitPrice: number;
}

export function planCharge(catalog: BsPlans, plan: FiscalPlan, includedPlan: FiscalPlan | null): PlanCharge {
  const terms = termsOf(catalog, plan);
  const includedTerms = includedPlan ? termsOf(catalog, includedPlan) : null;
  const planPrice = terms.price.monthly;
  const includedPlanPrice = includedTerms ? includedTerms.price.monthly : 0;
  return {
    plan,
    includedPlan,
    planPrice,
    includedPlanPrice,
    planCharge: round2(Math.max(0, planPrice - includedPlanPrice)),
    transactions: terms.transactions,
    overageUnitPrice: terms.overageUnitPrice,
  };
}

export interface StatementFigures extends PlanCharge {
  used: number;
  extra: number;
  overageAmount: number;
  total: number;
}

/** The month's charges: the plan on top of what is included, plus each transaction beyond the plan's. */
export function statementFigures(charge: PlanCharge, used: number): StatementFigures {
  const extra = Math.max(0, used - charge.transactions);
  const overageAmount = round2(extra * charge.overageUnitPrice);
  return { ...charge, used, extra, overageAmount, total: round2(charge.planCharge + overageAmount) };
}

// ─── Choosing a plan ─────────────────────────────────────────────────────────

/** The plans a tenant may be on: its included plan or larger (it cannot go below what it pays for). */
export function selectablePlans(tenant: Pick<ITenant, 'products' | 'plan' | 'plans'>, catalog: BsPlans): FiscalPlan[] {
  const included = includedFiscalPlan(tenant);
  return catalog.plans
    .map((p) => p.id as FiscalPlan)
    .filter((id) => isFiscalPlan(id) && (!included || fiscalPlanRank(id) >= fiscalPlanRank(included)));
}

export type PlanChangeKind = 'none' | 'upgrade' | 'downgrade';

export function planChangeKind(from: FiscalPlan, to: FiscalPlan): PlanChangeKind {
  if (from === to) return 'none';
  return fiscalPlanRank(to) > fiscalPlanRank(from) ? 'upgrade' : 'downgrade';
}
