import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { getPlanFeatures, PlanFeatures } from '../config/plans';

/**
 * Middleware factory that gates a route behind a plan feature.
 *
 * Usage:
 *   router.post('/events', authenticate, requirePlanFeature('events'), handler);
 *
 * Reads the plan from `req.tenant.plan` (already populated by resolveTenant).
 * Returns 403 if the tenant's plan does not include the requested feature.
 */
export function requirePlanFeature(feature: keyof PlanFeatures) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const plan: string | undefined = req.tenant?.plan;
    if (!plan) {
      res.status(403).json({ success: false, message: 'Tenant context required.' });
      return;
    }
    const features = getPlanFeatures(plan);
    if (!features[feature]) {
      res.status(403).json({
        success: false,
        message: 'This feature is not available on your current plan.',
      });
      return;
    }
    next();
  };
}
