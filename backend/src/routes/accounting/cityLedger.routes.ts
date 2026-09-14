import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as cityLedger from '../../controllers/accounting/cityLedger.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.cityLedger.view', 'accounting.cityLedger.authorize'), cityLedger.listPendingCityLedger);
router.get('/pending-count', authorizePermission('accounting', 'accounting.cityLedger.view', 'accounting.cityLedger.authorize'), cityLedger.getPendingCityLedgerCount);
router.post('/:id/authorize', authorizePermission('accounting', 'accounting.cityLedger.authorize'), cityLedger.authorizeCityLedgerInvoice);
router.post('/:id/decline', authorizePermission('accounting', 'accounting.cityLedger.authorize'), cityLedger.declineCityLedgerInvoice);

export default router;
