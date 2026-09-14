import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import WarehousesContent from '../../components/accounting/inventory/WarehousesContent';

/** `/accounting/warehouses` — own route/sidebar entry, sibling to Products (see InventoryProductsPage.tsx). */
const InventoryWarehousesPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.warehouses.title', 'Warehouses')}>
      <WarehousesContent />
    </AccountingLayout>
  );
};

export default InventoryWarehousesPage;
