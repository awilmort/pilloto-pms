import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as dashboard from '../../controllers/accounting/dashboard.controller';

const router = express.Router();

router.use(authenticate);
router.get('/', authorizePermission('accounting', 'accounting.dashboard'), dashboard.getDashboardData);

export default router;
