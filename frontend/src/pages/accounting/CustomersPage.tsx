import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import CustomersContent from '../../components/accounting/customers/CustomersContent';

/** `/accounting/customers` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.2). */
const CustomersPage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.customers.title', 'Customers'));
  return (
    <CustomersContent />
  );
};

export default CustomersPage;
