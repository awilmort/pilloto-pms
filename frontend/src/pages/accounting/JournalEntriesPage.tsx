import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import JournalEntriesContent from '../../components/accounting/journalEntries/JournalEntriesContent';

/** `/accounting/journal-entries` — its own route + sidebar entry, per decision #9 (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 9.1). */
const JournalEntriesPage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.journalEntries.title', 'Journal Entries'));
  return (
    <JournalEntriesContent />
  );
};

export default JournalEntriesPage;
