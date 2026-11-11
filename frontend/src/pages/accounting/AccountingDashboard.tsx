import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import AccountingDashboardContent from '../../components/accounting/dashboard/AccountingDashboardContent';

/** `/accounting` — the Accounting landing dashboard (see AccountingDashboardContent). */
const AccountingDashboard: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.dashboard.title', 'Accounting Dashboard')}>
      <AccountingDashboardContent />
    </AccountingLayout>
  );
};

export default AccountingDashboard;
