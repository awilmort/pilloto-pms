import React from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AccountingLayout from '../../components/accounting/AccountingLayout';
import InvoiceDetail from '../../components/accounting/invoices/InvoiceDetail';

/** `/accounting/invoices/:id` — the invoice as a document, with its payments, e-CF and actions. */
const InvoiceDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  return (
    <AccountingLayout title={t('accounting.invoices.title', 'Invoices')}>
      <InvoiceDetail key={id} invoiceId={id!} />
    </AccountingLayout>
  );
};

export default InvoiceDetailPage;
