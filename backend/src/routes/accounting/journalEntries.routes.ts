import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as journalEntries from '../../controllers/accounting/journalEntries.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.journal.view', 'accounting.journal.manage'), journalEntries.listJournalEntries);
router.get('/:id', authorizePermission('accounting', 'accounting.journal.view', 'accounting.journal.manage'), journalEntries.getJournalEntry);
router.post('/', authorizePermission('accounting', 'accounting.journal.manage'), journalEntries.createJournalEntry);
router.post('/:id/void', authorizePermission('accounting', 'accounting.journal.manage'), journalEntries.voidJournalEntry);

export default router;
