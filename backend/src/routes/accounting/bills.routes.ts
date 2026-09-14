import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as bills from '../../controllers/accounting/bills.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.bills.view', 'accounting.bills.manage'), bills.listBills);
router.get('/:id', authorizePermission('accounting', 'accounting.bills.view', 'accounting.bills.manage'), bills.getBill);
router.post('/', authorizePermission('accounting', 'accounting.bills.manage'), bills.createBill);
router.put('/:id', authorizePermission('accounting', 'accounting.bills.manage'), bills.updateBill);
router.post('/:id/receive', authorizePermission('accounting', 'accounting.bills.manage'), bills.receiveBill);
router.post('/:id/payments', authorizePermission('accounting', 'accounting.bills.manage'), bills.recordBillPayment);
router.post('/:id/void', authorizePermission('accounting', 'accounting.bills.void'), bills.voidBill);

export default router;
