import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import ProductsContent from '../../components/accounting/inventory/ProductsContent';

/**
 * `/accounting/products` — its own route (not a tab under `/accounting/inventory`), each
 * Inventory sub-module gets a real URL and its own sidebar entry under a collapsible
 * "Inventory" group (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 4.2).
 */
const InventoryProductsPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.inventory.title', 'Products')}>
      <ProductsContent />
    </AccountingLayout>
  );
};

export default InventoryProductsPage;
