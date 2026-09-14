import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import SuppliersContent from '../../components/accounting/suppliers/SuppliersContent';

/** `/accounting/suppliers` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6.2). */
const SuppliersPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.suppliers.title', 'Suppliers')}>
      <SuppliersContent />
    </AccountingLayout>
  );
};

export default SuppliersPage;
