import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import WarehousesContent from '../../components/accounting/inventory/WarehousesContent';

/** `/accounting/warehouses` — own route/sidebar entry, sibling to Products (see InventoryProductsPage.tsx). */
const InventoryWarehousesPage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.warehouses.title', 'Warehouses'));
  return (
    <WarehousesContent />
  );
};

export default InventoryWarehousesPage;
