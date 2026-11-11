import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import InvoiceEditor from '../../components/accounting/invoices/InvoiceEditor';

/** `/accounting/invoices/new` (optionally `?duplicate=<id>`) and `/accounting/invoices/:id/edit`. */
const InvoiceEditorPage: React.FC<{ mode: 'create' | 'edit' }> = ({ mode }) => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const duplicate = search.get('duplicate') || undefined;
  return (
    <AccountingLayout title={t('accounting.invoices.title', 'Invoices')}>
      {/* keyed so moving between "new" and "edit" (or to another copy) starts from a clean form */}
      <InvoiceEditor key={`${mode}-${id ?? ''}-${duplicate ?? ''}`} mode={mode} invoiceId={id} duplicateOf={duplicate} />
    </AccountingLayout>
  );
};

export default InvoiceEditorPage;
