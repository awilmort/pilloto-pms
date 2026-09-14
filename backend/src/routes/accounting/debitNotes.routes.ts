import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as debitNotes from '../../controllers/accounting/debitNotes.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.debitNotes.view', 'accounting.debitNotes.manage'), debitNotes.listDebitNotes);
router.get('/:id', authorizePermission('accounting', 'accounting.debitNotes.view', 'accounting.debitNotes.manage'), debitNotes.getDebitNote);
router.post('/', authorizePermission('accounting', 'accounting.debitNotes.manage'), debitNotes.createDebitNote);
router.put('/:id', authorizePermission('accounting', 'accounting.debitNotes.manage'), debitNotes.updateDebitNote);
router.post('/:id/issue', authorizePermission('accounting', 'accounting.debitNotes.manage'), debitNotes.issueDebitNote);
router.post('/:id/payments', authorizePermission('accounting', 'accounting.debitNotes.manage'), debitNotes.recordPayment);
router.post('/:id/void', authorizePermission('accounting', 'accounting.debitNotes.void'), debitNotes.voidDebitNote);

export default router;
