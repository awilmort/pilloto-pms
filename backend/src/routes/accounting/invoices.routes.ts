import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as invoices from '../../controllers/accounting/invoices.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.invoices.view', 'accounting.invoices.manage'), invoices.listInvoices);
router.get('/:id', authorizePermission('accounting', 'accounting.invoices.view', 'accounting.invoices.manage'), invoices.getInvoice);
router.post('/', authorizePermission('accounting', 'accounting.invoices.manage'), invoices.createInvoice);
router.put('/:id', authorizePermission('accounting', 'accounting.invoices.manage'), invoices.updateInvoice);
router.post('/:id/send', authorizePermission('accounting', 'accounting.invoices.manage'), invoices.sendInvoice);
router.post('/:id/payments', authorizePermission('accounting', 'accounting.invoices.manage'), invoices.recordPayment);
router.post('/:id/void', authorizePermission('accounting', 'accounting.invoices.void'), invoices.voidInvoice);

export default router;
