import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import SuppliersContent from '../../components/accounting/suppliers/SuppliersContent';

/** `/accounting/suppliers` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6.2). */
const SuppliersPage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.suppliers.title', 'Suppliers'));
  return (
    <SuppliersContent />
  );
};

export default SuppliersPage;
