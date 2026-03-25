import express, { Response } from 'express';
import ChargeRuleExecution from '../models/ChargeRuleExecution';
import AuditRun from '../models/AuditRun';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { runAudit, runAuditForTenant } from '../utils/chargeWorker';

const router = express.Router();

// @route   POST /api/audit/run
// @desc    Manually trigger the night audit (supports ?dryRun=true for preview)
// @access  Admin
router.post('/run', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = (req as any).tenantId as string | undefined;
    const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
    const options = { triggeredBy: 'manual' as const, dryRun };
    const summaries = tenantId
      ? [await runAuditForTenant(tenantId, options)]
      : await runAudit(options);
    res.json({ success: true, data: summaries, dryRun });
  } catch (err: any) {
    console.error('Manual audit run error:', err);
    res.status(500).json({ success: false, message: 'Audit run failed', error: err?.message });
  }
});

// @route   GET /api/audit/executions
// @desc    Get audit execution log with pagination
// @access  Admin
router.get('/executions', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { status, reservationId, chargeRuleId, page = 1, limit = 50 } = req.query;
    const filter: any = {};
    if (status) filter.status = status;
    if (reservationId) filter.reservationId = reservationId;
    if (chargeRuleId) filter.chargeRuleId = chargeRuleId;

    const pageNumber = parseInt(String(page));
    const limitNumber = Math.min(parseInt(String(limit)), 200);
    const skip = (pageNumber - 1) * limitNumber;

    const [executions, total] = await Promise.all([
      ChargeRuleExecution.find(filter)
        .populate('chargeRuleId', 'name trigger')
        .populate('reservationId', 'reservationCode type checkInDate checkOutDate')
        .populate('chargeId', 'amount description')
        .sort({ executedAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      ChargeRuleExecution.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: executions,
      pagination: { total, page: pageNumber, limit: limitNumber, pages: Math.ceil(total / limitNumber) },
    });
  } catch (err) {
    console.error('Get audit executions error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/audit/runs
// @desc    Get AuditRun history (run-level records with lock/status info)
// @access  Admin
router.get('/runs', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = (req as any).tenantId as string | undefined;
    const { status, dryRun, page = 1, limit = 50 } = req.query;
    const filter: any = {};
    if (tenantId) filter.tenantId = tenantId;
    if (status) filter.status = status;
    if (dryRun !== undefined) filter.dryRun = dryRun === 'true';

    const pageNumber = parseInt(String(page));
    const limitNumber = Math.min(parseInt(String(limit)), 200);
    const skip = (pageNumber - 1) * limitNumber;

    const [runs, total] = await Promise.all([
      AuditRun.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limitNumber).lean(),
      AuditRun.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: runs,
      pagination: { total, page: pageNumber, limit: limitNumber, pages: Math.ceil(total / limitNumber) },
    });
  } catch (err) {
    console.error('Get audit runs error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
