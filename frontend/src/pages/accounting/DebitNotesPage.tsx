import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import DebitNotesContent from '../../components/accounting/debitNotes/DebitNotesContent';

/** `/accounting/debit-notes` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 8.4). */
const DebitNotesPage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.debitNotes.title', 'Debit Notes'));
  return (
    <DebitNotesContent />
  );
};

export default DebitNotesPage;
