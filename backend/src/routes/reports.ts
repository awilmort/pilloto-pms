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
import {
  computeManagerFlash,
  computeForecast,
  computeSegmentation,
  computeBookingInsights,
  SegmentBy,
} from '../services/reports/managementService';
import { todayInTz } from '../services/channex/dates';
import { GroupBy } from '../types/reports';

const router = express.Router();

/** The property's local date (tenant time zone, UTC when unset or invalid) */
function localToday(req: AuthRequest): string {
  const tz = (req.tenant as any)?.settings?.timezone;
  try { return todayInTz(tz || 'UTC'); } catch { return todayInTz('UTC'); }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validated `from` / `to` query (defaults supplied by the caller), or an error message */
function rangeQuery(req: AuthRequest, defFrom: string, defTo: string, maxDays: number): { from: string; to: string } | { error: string } {
  const from = (req.query.from as string) || defFrom;
  const to = (req.query.to as string) || defTo;
  const valid = (d: string) => { try { return DATE_RE.test(d) && parseUTCDate(d).toISOString().slice(0, 10) === d; } catch { return false; } };
  if (!valid(from) || !valid(to)) return { error: 'Invalid date format. Use YYYY-MM-DD.' };
  if (from > to) return { error: '"from" must be before or equal to "to".' };
  if (daysBetween(parseUTCDate(from), parseUTCDate(to)) > maxDays) return { error: `Date range cannot exceed ${maxDays} days.` };
  return { from, to };
}

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

      const today = localToday(req);
      let rows = await computeOccupancy(fromDate, toDate, today);
      rows = groupRows(rows, groupBy as GroupBy);
      const summary = summarise(rows);

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="occupancy-${fromStr}-${toStr}.csv"`);
        return res.send(rowsToCsv(rows));
      }

      const comparison =
        compareTo === 'prev_period' || compareTo === 'prev_year'
          ? await buildComparison(fromDate, toDate, compareTo, groupBy as GroupBy, today)
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

// ─── Management analytics ─────────────────────────────────────────────────────

/**
 * @route  GET /api/admin/reports/manager-flash
 * @desc   Day / MTD / YTD KPIs vs same dates last year, the day's operations, 30-day outlook
 * @query  date  YYYY-MM-DD  (default: today, property time)
 * @access Private (admin)
 */
router.get('/manager-flash', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const today = localToday(req);
    const date = (req.query.date as string) || today;
    if (!DATE_RE.test(date)) return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    return res.json({ success: true, data: await computeManagerFlash(date, today) });
  } catch (err: any) {
    console.error('Manager flash error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err?.message });
  }
});

/**
 * @route  GET /api/admin/reports/forecast
 * @desc   On-the-books occupancy & revenue per night, 7-day pickup, pace vs same time last year
 * @query  from, to  YYYY-MM-DD  (default: today → +89 days; max 366 days)
 * @access Private (admin)
 */
router.get('/forecast', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const today = localToday(req);
    const range = rangeQuery(req, today, toDateStr(addDays(parseUTCDate(today), 89)), 366);
    if ('error' in range) return res.status(400).json({ success: false, message: range.error });
    return res.json({ success: true, data: { filters: range, ...(await computeForecast(range.from, range.to, today)) } });
  } catch (err: any) {
    console.error('Forecast report error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err?.message });
  }
});

/**
 * @route  GET /api/admin/reports/segmentation
 * @desc   Room nights, revenue, ADR, commission, LOS, lead time, cancellations by segment
 * @query  from, to  YYYY-MM-DD  (default: last 30 days; max 2 years)
 * @query  by        source | roomType | ratePlan  (default: source)
 * @access Private (admin)
 */
router.get('/segmentation', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const today = localToday(req);
    const by = ((req.query.by as string) || 'source') as SegmentBy;
    if (!['source', 'roomType', 'ratePlan'].includes(by)) {
      return res.status(400).json({ success: false, message: 'Invalid "by". Use source, roomType or ratePlan.' });
    }
    const range = rangeQuery(req, toDateStr(addDays(parseUTCDate(today), -29)), today, 731);
    if ('error' in range) return res.status(400).json({ success: false, message: range.error });
    return res.json({ success: true, data: { filters: { ...range, by }, ...(await computeSegmentation(range.from, range.to, by, today)) } });
  } catch (err: any) {
    console.error('Segmentation report error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err?.message });
  }
});

/**
 * @route  GET /api/admin/reports/booking-insights
 * @desc   Lead time, length of stay, day-of-week demand, cancellations, no-shows, repeat guests
 *         for stays arriving in the range
 * @query  from, to  YYYY-MM-DD  (default: last 90 days; max 2 years)
 * @access Private (admin)
 */
router.get('/booking-insights', authenticate, authorize('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const today = localToday(req);
    const range = rangeQuery(req, toDateStr(addDays(parseUTCDate(today), -89)), today, 731);
    if ('error' in range) return res.status(400).json({ success: false, message: range.error });
    return res.json({ success: true, data: { filters: range, ...(await computeBookingInsights(range.from, range.to, today)) } });
  } catch (err: any) {
    console.error('Booking insights error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err?.message });
  }
});

export default router;
