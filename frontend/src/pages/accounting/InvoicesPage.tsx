import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import InvoicesContent from '../../components/accounting/invoices/InvoicesContent';

/** `/accounting/invoices` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 5.2). */
const InvoicesPage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.invoices.title', 'Invoices'));
  return (
    <InvoicesContent />
  );
};

export default InvoicesPage;
