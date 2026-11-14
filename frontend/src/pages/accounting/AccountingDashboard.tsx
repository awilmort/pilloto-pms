import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import AccountingDashboardContent from '../../components/accounting/dashboard/AccountingDashboardContent';

/** `/accounting` — the Accounting landing dashboard (see AccountingDashboardContent). */
const AccountingDashboard: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.dashboard.title', 'Accounting Dashboard'));
  return (
    <AccountingDashboardContent />
  );
};

export default AccountingDashboard;
