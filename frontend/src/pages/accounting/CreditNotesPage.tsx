import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import CreditNotesContent from '../../components/accounting/creditNotes/CreditNotesContent';

/** `/accounting/credit-notes` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8.2). */
const CreditNotesPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <AccountingLayout title={t('accounting.creditNotes.title', 'Credit Notes')}>
      <CreditNotesContent />
    </AccountingLayout>
  );
};

export default CreditNotesPage;
