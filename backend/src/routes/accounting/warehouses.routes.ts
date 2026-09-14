import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as warehouses from '../../controllers/accounting/warehouses.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.inventory.view', 'accounting.inventory.manage'), warehouses.listWarehouses);
router.get('/:id', authorizePermission('accounting', 'accounting.inventory.view', 'accounting.inventory.manage'), warehouses.getWarehouse);
router.get('/:id/stock', authorizePermission('accounting', 'accounting.inventory.view', 'accounting.inventory.manage'), warehouses.getWarehouseStock);
router.post('/', authorizePermission('accounting', 'accounting.inventory.manage'), warehouses.createWarehouse);
router.put('/:id', authorizePermission('accounting', 'accounting.inventory.manage'), warehouses.updateWarehouse);
router.delete('/:id', authorizePermission('accounting', 'accounting.inventory.manage'), warehouses.deleteWarehouse);

export default router;
