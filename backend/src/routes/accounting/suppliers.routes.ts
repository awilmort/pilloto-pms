import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as suppliers from '../../controllers/accounting/suppliers.controller';

const router = express.Router();

router.use(authenticate);
router.use(authorizePermission('accounting', 'accounting.suppliers.manage'));

router.get('/', suppliers.listSuppliers);
router.get('/:id', suppliers.getSupplier);
router.post('/', suppliers.createSupplier);
router.put('/:id', suppliers.updateSupplier);
router.delete('/:id', suppliers.archiveSupplier);

export default router;
