import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import { requireAccountingFeature } from '../../services/entitlements';
import * as reports from '../../controllers/accounting/reports.controller';

const router = express.Router();

router.use(authenticate);
router.use(authorizePermission('accounting', 'accounting.reports.view'));

const ledger = requireAccountingFeature('generalLedger');

// Receivables reports are part of every plan; the ledger-based ones are the general-ledger module.
router.get('/trial-balance', ledger, reports.getTrialBalanceReport);
router.get('/profit-and-loss', ledger, reports.getProfitAndLossReport);
router.get('/balance-sheet', ledger, reports.getBalanceSheetReport);
router.get('/ap-aging', ledger, reports.getApAgingReport);
router.get('/ar-aging', reports.getArAgingReport);
router.get('/general-ledger', ledger, reports.getGeneralLedgerReport);
router.get('/supplier-statement/:id', ledger, reports.getSupplierStatementReport);
router.get('/customer-statement/:id', reports.getCustomerStatementReport);

// DGII monthly figures: every plan (they come from bills and e-CF, not the ledger).
router.get('/dgii-606', reports.getDgii606Report);
router.get('/dgii-606/txt', reports.getDgii606Txt);
router.get('/itbis-summary', reports.getItbisSummaryReport);

export default router;
