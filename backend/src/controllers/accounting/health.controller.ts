import { Request, Response } from 'express';

/**
 * GET /api/accounting/health
 *
 * Placeholder proving the `/api/accounting` mount point is wired correctly
 * (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 2.2). Unauthenticated —
 * mirrors the top-level `/health`/`/api/health` checks in `index.ts`, which
 * are plain liveness probes, not tenant- or permission-scoped endpoints.
 */
export function getHealth(_req: Request, res: Response) {
  res.status(200).json({
    success: true,
    message: 'Accounting API is healthy',
    timestamp: new Date().toISOString(),
  });
}
