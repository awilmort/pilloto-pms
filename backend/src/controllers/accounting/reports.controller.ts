import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as reports from '../../services/accounting/reports.service';

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
