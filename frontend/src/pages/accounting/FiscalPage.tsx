import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import FiscalCenter from '../../components/fiscal/FiscalCenter';

/** `/accounting/fiscal` — the company's electronic invoices, inside Accounting. The Fiscal Center is shared with PMS. */
const FiscalPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('fiscal.center.title', 'Electronic invoices')}>
      <FiscalCenter showTitle={false} />
    </AccountingLayout>
  );
};

export default FiscalPage;
