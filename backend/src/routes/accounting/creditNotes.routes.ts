import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as creditNotes from '../../controllers/accounting/creditNotes.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.creditNotes.view', 'accounting.creditNotes.manage'), creditNotes.listCreditNotes);
router.get('/:id', authorizePermission('accounting', 'accounting.creditNotes.view', 'accounting.creditNotes.manage'), creditNotes.getCreditNote);
router.post('/', authorizePermission('accounting', 'accounting.creditNotes.manage'), creditNotes.createCreditNote);
router.put('/:id', authorizePermission('accounting', 'accounting.creditNotes.manage'), creditNotes.updateCreditNote);
router.post('/:id/issue', authorizePermission('accounting', 'accounting.creditNotes.manage'), creditNotes.issueCreditNote);
router.post('/:id/apply', authorizePermission('accounting', 'accounting.creditNotes.manage'), creditNotes.applyCreditNote);
router.post('/:id/refund', authorizePermission('accounting', 'accounting.creditNotes.manage'), creditNotes.refundCreditNote);
router.post('/:id/void', authorizePermission('accounting', 'accounting.creditNotes.void'), creditNotes.voidCreditNote);

export default router;
