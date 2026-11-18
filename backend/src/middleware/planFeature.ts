import { PlanFeatures } from '../config/plans';
import { requirePmsFeature } from '../services/entitlements';

/**
 * Middleware factory that gates a route behind a PMS plan feature.
 *
 * Usage:
 *   router.post('/events', authenticate, requirePlanFeature('events'), handler);
 *
 * Reads the plan from `req.tenant.plan` (populated by resolveTenant) and answers 403 with the
 * shared plan-denial body (`code: 'PLAN_FEATURE'`, see services/entitlements.ts) when the plan
 * does not include the feature.
 */
export function requirePlanFeature(feature: keyof PlanFeatures) {
  return requirePmsFeature(feature);
}
