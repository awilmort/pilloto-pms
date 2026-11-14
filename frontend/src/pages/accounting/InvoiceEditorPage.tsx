import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import InvoiceEditor from '../../components/accounting/invoices/InvoiceEditor';

/** `/accounting/invoices/new` (optionally `?duplicate=<id>`) and `/accounting/invoices/:id/edit`. */
const InvoiceEditorPage: React.FC<{ mode: 'create' | 'edit' }> = ({ mode }) => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.invoices.title', 'Invoices'));
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const duplicate = search.get('duplicate') || undefined;
  // keyed so moving between "new" and "edit" (or to another copy) starts from a clean form
  return (
    <InvoiceEditor key={`${mode}-${id ?? ''}-${duplicate ?? ''}`} mode={mode} invoiceId={id} duplicateOf={duplicate} />
  );
};

export default InvoiceEditorPage;
