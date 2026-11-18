import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import { requireAccountingFeature } from '../../services/entitlements';
import * as accounts from '../../controllers/accounting/accounts.controller';

const router = express.Router();

router.use(authenticate);

// Reading the chart is open to every plan and to whoever codes documents to accounts (expense bills,
// journal entries, reports); changing it is the general-ledger module.
const READ = ['accounting.accounts.manage', 'accounting.bills.view', 'accounting.bills.manage', 'accounting.journal.view', 'accounting.journal.manage', 'accounting.reports.view'];
router.get('/', authorizePermission('accounting', ...READ), accounts.listAccounts);
router.get('/:id', authorizePermission('accounting', ...READ), accounts.getAccount);
router.post('/', requireAccountingFeature('generalLedger'), authorizePermission('accounting', 'accounting.accounts.manage'), accounts.createAccount);
router.put('/:id', requireAccountingFeature('generalLedger'), authorizePermission('accounting', 'accounting.accounts.manage'), accounts.updateAccount);
router.delete('/:id', requireAccountingFeature('generalLedger'), authorizePermission('accounting', 'accounting.accounts.manage'), accounts.deleteAccount);

export default router;
