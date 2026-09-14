import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import BillsContent from '../../components/accounting/bills/BillsContent';

/** `/accounting/bills` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 6.2). */
const BillsPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.bills.title', 'Bills')}>
      <BillsContent />
    </AccountingLayout>
  );
};

export default BillsPage;
