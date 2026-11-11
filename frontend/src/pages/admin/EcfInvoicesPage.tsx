import React from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import FiscalCenter from '../../components/fiscal/FiscalCenter';

/** `/admin/invoices/ecf` — the company's electronic invoices, inside PMS. The Fiscal Center is shared with Accounting. */
const EcfInvoicesPage: React.FC = () => (
  <AdminLayout>
    <FiscalCenter />
  </AdminLayout>
);

export default EcfInvoicesPage;
