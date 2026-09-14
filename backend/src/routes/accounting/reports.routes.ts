import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as reports from '../../controllers/accounting/reports.controller';

const router = express.Router();

router.use(authenticate);
router.use(authorizePermission('accounting', 'accounting.reports.view'));

router.get('/trial-balance', reports.getTrialBalanceReport);
router.get('/profit-and-loss', reports.getProfitAndLossReport);
router.get('/balance-sheet', reports.getBalanceSheetReport);
router.get('/ap-aging', reports.getApAgingReport);
router.get('/ar-aging', reports.getArAgingReport);
router.get('/general-ledger', reports.getGeneralLedgerReport);
router.get('/supplier-statement/:id', reports.getSupplierStatementReport);
router.get('/customer-statement/:id', reports.getCustomerStatementReport);

export default router;
