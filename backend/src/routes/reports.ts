import express, { Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { toDateStr, parseUTCDate, addDays, daysBetween } from '../utils/dateUtils';
import {
  computeOccupancy,
  groupRows,
  summarise,
  rowsToCsv,
  buildComparison,
} from '../services/reports/occupancyService';
import {
  computeNightAudit,
  computeNightAuditRange,
} from '../services/reports/nightAuditService';
import {
  computeArrivals,
  computeDepartures,
} from '../services/reports/arrivalsDeparturesService';
import { GroupBy } from '../types/reports';

const router = express.Router();

// ─── Occupancy ────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/admin/reports/occupancy
 * @desc   Occupancy metrics (ADR / RevPAR / Occupancy %) for a date range
 * @query  from        YYYY-MM-DD  (default: 30 days ago)
 * @query  to          YYYY-MM-DD  (default: today)
 * @query  groupBy     day | week | month  (default: day)
 * @query  compareTo   prev_period | prev_year  (optional)
 * @query  format      json | csv  (default: json)
 * @access Private (admin)
 */
router.get(
  '/occupancy',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        from,
        to,
        groupBy = 'day',
        compareTo,
        format = 'json',
      } = req.query as Record<string, string | undefined>;

      if (!['day', 'week', 'month'].includes(groupBy!)) {
        return res.status(400).json({ success: false, message: 'Invalid groupBy. Use day, week, or month.' });
      }

      const now = new Date();
      const fromStr = from || toDateStr(addDays(now, -29));
      const toStr = to || toDateStr(now);

      let fromDate: Date, toDate: Date;
      try {
        fromDate = parseUTCDate(fromStr);
        toDate = parseUTCDate(toStr);
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      if (fromDate > toDate) {
        return res.status(400).json({ success: false, message: '"from" must be before or equal to "to".' });
      }
      if (daysBetween(fromDate, toDate) > 730) {
        return res.status(400).json({ success: false, message: 'Date range cannot exceed 2 years.' });
      }

      let rows = await computeOccupancy(fromDate, toDate);
      rows = groupRows(rows, groupBy as GroupBy);
      const summary = summarise(rows);

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="occupancy-${fromStr}-${toStr}.csv"`);
        return res.send(rowsToCsv(rows));
      }

      const comparison =
        compareTo === 'prev_period' || compareTo === 'prev_year'
          ? await buildComparison(fromDate, toDate, compareTo, groupBy as GroupBy)
          : null;

      return res.json({
        success: true,
        data: {
          filters: { from: fromStr, to: toStr, groupBy, compareTo: compareTo || null },
          summary,
          rows,
          comparison,
        },
      });
    } catch (err: any) {
      console.error('Occupancy report error:', err);
      return res.status(500).json({ success: false, message: 'Server error', error: err?.message });
    }
  },
);

// ─── Night Audit ──────────────────────────────────────────────────────────────

/**
 * @route  GET /api/admin/reports/night-audit
 * @desc   Full Night Audit for a single date
 * @query  date  YYYY-MM-DD  (default: yesterday)
 * @access Private (admin)
 */
router.get(
  '/night-audit',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { date } = req.query as Record<string, string | undefined>;
      const now = new Date();
      const dateStr = date || toDateStr(addDays(now, -1));

      let auditDate: Date;
      try {
        auditDate = parseUTCDate(dateStr);
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      const data = await computeNightAudit(auditDate);
      return res.json({ success: true, data });
    } catch (err: any) {
      console.error('Night audit error:', err);
      return res.status(500).json({ success: false, message: 'Server error', error: err?.message });
    }
  },
);

/**
 * @route  GET /api/admin/reports/night-audit/range
 * @desc   Night Audit summary table for a date range (max 90 days)
 * @query  from  YYYY-MM-DD  (default: 7 days ago)
 * @query  to    YYYY-MM-DD  (default: yesterday)
 * @access Private (admin)
 */
router.get(
  '/night-audit/range',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { from, to } = req.query as Record<string, string | undefined>;
      const now = new Date();
      const fromStr = from || toDateStr(addDays(now, -7));
      const toStr = to || toDateStr(addDays(now, -1));

      let fromDate: Date, toDate: Date;
      try {
        fromDate = parseUTCDate(fromStr);
        toDate = parseUTCDate(toStr);
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      if (fromDate > toDate) {
        return res.status(400).json({ success: false, message: '"from" must be before or equal to "to".' });
      }
      if (daysBetween(fromDate, toDate) > 90) {
        return res.status(400).json({ success: false, message: 'Range cannot exceed 90 days.' });
      }

      const rows = await computeNightAuditRange(fromDate, toDate);
      return res.json({ success: true, data: { filters: { from: fromStr, to: toStr }, rows } });
    } catch (err: any) {
      console.error('Night audit range error:', err);
      return res.status(500).json({ success: false, message: 'Server error', error: err?.message });
    }
  },
);

// ─── Arrivals ─────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/admin/reports/arrivals
 * @desc   Arrivals list for a given date
 * @query  date  YYYY-MM-DD  (default: today)
 * @access Private (admin)
 */
router.get(
  '/arrivals',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { date } = req.query as Record<string, string | undefined>;
      const now = new Date();
      const dateStr = date || toDateStr(now);

      let arrivalDate: Date;
      try {
        arrivalDate = parseUTCDate(dateStr);
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      const rows = await computeArrivals(arrivalDate);
      return res.json({ success: true, data: { date: dateStr, rows } });
    } catch (err: any) {
      console.error('Arrivals report error:', err);
      return res.status(500).json({ success: false, message: 'Server error', error: err?.message });
    }
  },
);

// ─── Departures ───────────────────────────────────────────────────────────────

/**
 * @route  GET /api/admin/reports/departures
 * @desc   Departures list for a given date
 * @query  date  YYYY-MM-DD  (default: today)
 * @access Private (admin)
 */
router.get(
  '/departures',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { date } = req.query as Record<string, string | undefined>;
      const now = new Date();
      const dateStr = date || toDateStr(now);

      let departureDate: Date;
      try {
        departureDate = parseUTCDate(dateStr);
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      const rows = await computeDepartures(departureDate);
      return res.json({ success: true, data: { date: dateStr, rows } });
    } catch (err: any) {
      console.error('Departures report error:', err);
      return res.status(500).json({ success: false, message: 'Server error', error: err?.message });
    }
  },
);

export default router;
