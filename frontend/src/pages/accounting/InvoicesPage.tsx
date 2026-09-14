import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import InvoicesContent from '../../components/accounting/invoices/InvoicesContent';

/** `/accounting/invoices` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.2). */
const InvoicesPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.invoices.title', 'Invoices')}>
      <InvoicesContent />
    </AccountingLayout>
  );
};

export default InvoicesPage;
