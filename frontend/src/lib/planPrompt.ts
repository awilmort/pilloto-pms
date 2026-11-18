/**
 * Plan prompts: a refused action (`PLAN_FEATURE` / `PLAN_LIMIT` from the API, see backend
 * services/entitlements.ts) or a locked nav item asks the shell to explain which plan unlocks it.
 * A window event keeps callers (the axios interceptor, layouts) free of React context.
 */
export interface PlanDenialDetail {
  code: 'PLAN_FEATURE' | 'PLAN_LIMIT';
  message?: string;
  plan: {
    product: 'pms' | 'accounting';
    currentPlan?: string;
    feature?: string;
    limit?: 'users' | 'rooms' | 'warehouses';
    max?: number;
    requiredPlan?: string;
  };
}

export const PLAN_PROMPT_EVENT = 'pilloto:plan-required';

export function showPlanPrompt(detail: PlanDenialDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PlanDenialDetail>(PLAN_PROMPT_EVENT, { detail }));
}

/** True for an API body that is a plan denial. */
export const isPlanDenial = (body: any): body is PlanDenialDetail =>
  !!body && (body.code === 'PLAN_FEATURE' || body.code === 'PLAN_LIMIT') && !!body.plan?.product;
