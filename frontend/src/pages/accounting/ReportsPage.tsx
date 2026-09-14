import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import ReportsContent from '../../components/accounting/reports/ReportsContent';

/** `/accounting/reports` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 9.2). */
const ReportsPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.reports.title', 'Reports')}>
      <ReportsContent />
    </AccountingLayout>
  );
};

export default ReportsPage;
