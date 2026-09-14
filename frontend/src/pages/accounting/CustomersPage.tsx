import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import CustomersContent from '../../components/accounting/customers/CustomersContent';

/** `/accounting/customers` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.2). */
const CustomersPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.customers.title', 'Customers')}>
      <CustomersContent />
    </AccountingLayout>
  );
};

export default CustomersPage;
