import express from 'express';
import { authenticate, authorizePermission } from '../../middleware/auth';
import * as products from '../../controllers/accounting/products.controller';

const router = express.Router();

router.use(authenticate);

router.get('/', authorizePermission('accounting', 'accounting.inventory.view', 'accounting.inventory.manage'), products.listProducts);
router.get('/:id', authorizePermission('accounting', 'accounting.inventory.view', 'accounting.inventory.manage'), products.getProduct);
router.get('/:id/transactions', authorizePermission('accounting', 'accounting.inventory.view', 'accounting.inventory.manage'), products.getProductTransactions);
router.get('/:id/stock', authorizePermission('accounting', 'accounting.inventory.view', 'accounting.inventory.manage'), products.getProductStockByWarehouse);
router.post('/', authorizePermission('accounting', 'accounting.inventory.manage'), products.createProduct);
router.put('/:id', authorizePermission('accounting', 'accounting.inventory.manage'), products.updateProduct);
router.delete('/:id', authorizePermission('accounting', 'accounting.inventory.manage'), products.deleteProduct);
router.post('/:id/purchase', authorizePermission('accounting', 'accounting.inventory.manage'), products.purchaseProduct);
router.post('/:id/adjust', authorizePermission('accounting', 'accounting.inventory.manage'), products.adjustProduct);

export default router;
