import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as quotes from '../../controllers/accounting/quotes.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.quotes.view', 'accounting.quotes.manage'), quotes.listQuotes);
router.get('/:id', authorizePermission('accounting', 'accounting.quotes.view', 'accounting.quotes.manage'), quotes.getQuote);
router.post('/', authorizePermission('accounting', 'accounting.quotes.manage'), quotes.createQuote);
router.put('/:id', authorizePermission('accounting', 'accounting.quotes.manage'), quotes.updateQuote);
router.post('/:id/send', authorizePermission('accounting', 'accounting.quotes.manage'), quotes.sendQuote);
router.post('/:id/accept', authorizePermission('accounting', 'accounting.quotes.manage'), quotes.acceptQuote);
router.post('/:id/reject', authorizePermission('accounting', 'accounting.quotes.manage'), quotes.rejectQuote);
router.post('/:id/convert', authorizePermission('accounting', 'accounting.quotes.manage'), quotes.convertQuote);

export default router;
