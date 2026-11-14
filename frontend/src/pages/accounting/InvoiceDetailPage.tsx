import React from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../components/shared/PageTitle';
import InvoiceDetail from '../../components/accounting/invoices/InvoiceDetail';

/** `/accounting/invoices/:id` — the invoice as a document, with its payments, e-CF and actions. */
const InvoiceDetailPage: React.FC = () => {
  const { t } = useTranslation();
  usePageTitle(t('accounting.invoices.title', 'Invoices'));
  const { id } = useParams<{ id: string }>();
  return (
    <InvoiceDetail key={id} invoiceId={id!} />
  );
};

export default InvoiceDetailPage;
