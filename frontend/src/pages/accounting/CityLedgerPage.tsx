import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import CityLedgerContent from '../../components/accounting/cityLedger/CityLedgerContent';

/** `/accounting/city-ledger` — pending-authorization queue for ad hoc unpaid checkouts
 *  transferred to AR (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 10.4). */
const CityLedgerPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.cityLedger.title', 'City Ledger')}>
      <CityLedgerContent />
    </AccountingLayout>
  );
};

export default CityLedgerPage;
