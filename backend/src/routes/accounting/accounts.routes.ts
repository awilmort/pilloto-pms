import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as accounts from '../../controllers/accounting/accounts.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.accounts.manage'), accounts.listAccounts);
router.get('/:id', authorizePermission('accounting', 'accounting.accounts.manage'), accounts.getAccount);
router.post('/', authorizePermission('accounting', 'accounting.accounts.manage'), accounts.createAccount);
router.put('/:id', authorizePermission('accounting', 'accounting.accounts.manage'), accounts.updateAccount);
router.delete('/:id', authorizePermission('accounting', 'accounting.accounts.manage'), accounts.deleteAccount);

export default router;
