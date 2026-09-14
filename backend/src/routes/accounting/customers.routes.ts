import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as customers from '../../controllers/accounting/customers.controller';

const router = express.Router();

router.use(authenticate);
router.use(authorizePermission('accounting', 'accounting.customers.manage'));

router.get('/', customers.listCustomers);
router.get('/:id', customers.getCustomer);
router.post('/', customers.createCustomer);
router.put('/:id', customers.updateCustomer);
router.delete('/:id', customers.archiveCustomer);

export default router;
