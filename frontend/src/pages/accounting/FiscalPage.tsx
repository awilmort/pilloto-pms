import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import FiscalCenter from '../../components/fiscal/FiscalCenter';

/** `/accounting/fiscal` — the company's electronic invoices, inside Accounting. The Fiscal Center is shared with PMS. */
const FiscalPage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('fiscal.center.title', 'Electronic invoices'));
  return (
    <FiscalCenter showTitle={false} />
  );
};

export default FiscalPage;
