import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as reports from '../../services/accounting/reports.service';
import * as dgii from '../../services/accounting/dgii.service';

/**
 * Financial reports (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 9.2).
 * Every handler here just parses query params and hands off to
 * `reports.service.ts` — all computation lives there so it stays reusable
 * (e.g. by a future export/print path) rather than duplicated per route.
 */

const parseDate = (s: unknown): Date | undefined => {
  if (typeof s !== 'string' || !s.trim()) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export const getTrialBalanceReport = async (req: AuthRequest, res: Response) => {
  try {
    const asOf = parseDate(req.query.asOf) || new Date();
    const data = await reports.getTrialBalance(asOf);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Trial balance report error:', error);
    res.status(500).json({ success: false, message: 'Server error while generating trial balance' });
  }
};

export const getProfitAndLossReport = async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const to = parseDate(req.query.to) || now;
    const from = parseDate(req.query.from) || reports.dateHelpers.startOfYear(now);
    const data = await reports.getProfitAndLoss(from, to);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Profit and loss report error:', error);
    res.status(500).json({ success: false, message: 'Server error while generating profit & loss statement' });
  }
};

export const getBalanceSheetReport = async (req: AuthRequest, res: Response) => {
  try {
    const asOf = parseDate(req.query.asOf) || new Date();
    const data = await reports.getBalanceSheet(asOf);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Balance sheet report error:', error);
    res.status(500).json({ success: false, message: 'Server error while generating balance sheet' });
  }
};

export const getApAgingReport = async (req: AuthRequest, res: Response) => {
  try {
    const asOf = parseDate(req.query.asOf) || new Date();
    const data = await reports.getApAging(asOf);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('AP aging report error:', error);
    res.status(500).json({ success: false, message: 'Server error while generating AP aging report' });
  }
};

export const getArAgingReport = async (req: AuthRequest, res: Response) => {
  try {
    const asOf = parseDate(req.query.asOf) || new Date();
    const data = await reports.getArAging(asOf);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('AR aging report error:', error);
    res.status(500).json({ success: false, message: 'Server error while generating AR aging report' });
  }
};

export const getSupplierStatementReport = async (req: AuthRequest, res: Response) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const data = await reports.getSupplierStatement(req.params.id, from, to);
    if (!data) return res.status(404).json({ success: false, message: 'Supplier not found' });
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
    console.error('Supplier statement report error:', error);
    res.status(500).json({ success: false, message: 'Server error while generating supplier statement' });
  }
};

export const getCustomerStatementReport = async (req: AuthRequest, res: Response) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const data = await reports.getCustomerStatement(req.params.id, from, to);
    if (!data) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    console.error('Customer statement report error:', error);
    res.status(500).json({ success: false, message: 'Server error while generating customer statement' });
  }
};

export const getGeneralLedgerReport = async (req: AuthRequest, res: Response) => {
  try {
    const accountId = req.query.accountId as string | undefined;
    if (!accountId) return res.status(400).json({ success: false, message: 'accountId is required' });
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const data = await reports.getGeneralLedger(accountId, from, to);
    if (!data) return res.status(404).json({ success: false, message: 'Account not found' });
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid account ID' });
    console.error('General ledger report error:', error);
    res.status(500).json({ success: false, message: 'Server error while generating general ledger report' });
  }
};

// ─── DGII (every plan) ───────────────────────────────────────────────────────

const periodParam = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);

/** GET /reports/dgii-606?period=YYYY-MM — the month's purchases as the 606 reports them, with issues. */
export const getDgii606Report = async (req: AuthRequest, res: Response) => {
  const period = periodParam(req.query.period);
  if (!period) return res.status(400).json({ success: false, message: 'period must be YYYY-MM' });
  try {
    const rnc = (req.tenant as any)?.profile?.rnc ?? null;
    res.status(200).json({ success: true, data: await dgii.build606(period, rnc) });
  } catch (error) {
    console.error('606 report error:', error);
    res.status(500).json({ success: false, message: 'Server error while building the 606' });
  }
};

/**
 * GET /reports/dgii-606/txt?period=YYYY-MM — the file to upload. Refused while any row has an
 * error (missing/invalid RNC or NCF): the DGII would reject the whole file.
 */
export const getDgii606Txt = async (req: AuthRequest, res: Response) => {
  const period = periodParam(req.query.period);
  if (!period) return res.status(400).json({ success: false, message: 'period must be YYYY-MM' });
  try {
    const rnc = String((req.tenant as any)?.profile?.rnc ?? '').replace(/\D/g, '');
    if (!rnc) return res.status(409).json({ success: false, code: 'DGII_NO_RNC', message: 'Set your RNC in the company profile first' });
    const report = await dgii.build606(period, rnc);
    const errors = report.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) return res.status(409).json({ success: false, code: 'DGII_606_ISSUES', message: 'Some bills are missing data the 606 needs', issues: errors });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="DGII_F_606_${rnc}_${period.replace('-', '')}.TXT"`);
    res.send(dgii.render606Txt(rnc, period, report.rows));
  } catch (error) {
    console.error('606 TXT error:', error);
    res.status(500).json({ success: false, message: 'Server error while building the 606' });
  }
};

/** GET /reports/itbis-summary?period=YYYY-MM — the figures the IT-1 is filled from. */
export const getItbisSummaryReport = async (req: AuthRequest, res: Response) => {
  const period = periodParam(req.query.period);
  if (!period) return res.status(400).json({ success: false, message: 'period must be YYYY-MM' });
  try {
    res.status(200).json({ success: true, data: await dgii.itbisSummary(period, req.tenantId) });
  } catch (error) {
    console.error('ITBIS summary error:', error);
    res.status(500).json({ success: false, message: 'Server error while building the ITBIS summary' });
  }
};
