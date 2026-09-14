import React from 'react';
import { Dashboard, Settings, Inventory2, WarehouseOutlined, ReceiptLong, PeopleAlt, RequestQuote, RequestPage, Storefront, AssignmentReturn, PostAdd, MenuBook, Assessment, LocationCity } from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { hasPermission } from '../../lib/permissions';
import AppShell, { AppShellNavItem } from '../shared/AppShell';
import { ACCOUNTING_SIDEBAR_BG } from '../../accountingTheme';

interface AccountingLayoutProps {
  children: React.ReactNode;
  title?: React.ReactNode;
}

interface AccountingNavItem extends AppShellNavItem {
  /** Permission(s) required for a leaf item — any one grants it, mirroring the backend route guard's OR semantics. */
  perm?: string | string[];
  children?: AccountingNavItem[];
}

/**
 * Accounting-app counterpart of `AdminLayout` — renders through the shared
 * `AppShell` (1.2) with an accounting-scoped nav config and the emerald
 * accent from `accountingTheme.ts`, per Phase 2.1. Modules land as their own
 * collapsible sidebar groups rather than tabs — Phase 4.2.
 */
const AccountingLayout: React.FC<AccountingLayoutProps> = ({ children, title }) => {
  const { user, resolvedAppRoles } = useAuth();
  const { t } = useTranslation();

  const menuItems: AccountingNavItem[] = React.useMemo(() => [
    { text: t('accounting.nav.dashboard', 'Dashboard'), icon: <Dashboard />, path: '/accounting', key: 'dashboard', perm: 'accounting.dashboard' },
    {
      text: t('accounting.nav.inventory', 'Inventory'),
      icon: <Inventory2 />,
      path: '/accounting/products',
      key: 'inventory',
      children: [
        { text: t('accounting.nav.products', 'Products'), icon: <Inventory2 fontSize="small" />, path: '/accounting/products', key: 'inventory-products', perm: ['accounting.inventory.view', 'accounting.inventory.manage'] },
        { text: t('accounting.nav.warehouses', 'Warehouses'), icon: <WarehouseOutlined fontSize="small" />, path: '/accounting/warehouses', key: 'inventory-warehouses', perm: ['accounting.inventory.view', 'accounting.inventory.manage'] },
      ],
    },
    {
      text: t('accounting.nav.invoicing', 'Invoices'),
      icon: <ReceiptLong />,
      path: '/accounting/invoices',
      key: 'invoicing',
      children: [
        { text: t('accounting.nav.invoices', 'Invoices'), icon: <ReceiptLong fontSize="small" />, path: '/accounting/invoices', key: 'invoicing-invoices', perm: ['accounting.invoices.view', 'accounting.invoices.manage'] },
        { text: t('accounting.nav.creditNotes', 'Credit Notes'), icon: <AssignmentReturn fontSize="small" />, path: '/accounting/credit-notes', key: 'invoicing-credit-notes', perm: ['accounting.creditNotes.view', 'accounting.creditNotes.manage'] },
        { text: t('accounting.nav.debitNotes', 'Debit Notes'), icon: <PostAdd fontSize="small" />, path: '/accounting/debit-notes', key: 'invoicing-debit-notes', perm: ['accounting.debitNotes.view', 'accounting.debitNotes.manage'] },
        { text: t('accounting.nav.quotes', 'Quotes'), icon: <RequestQuote fontSize="small" />, path: '/accounting/quotes', key: 'invoicing-quotes', perm: ['accounting.quotes.view', 'accounting.quotes.manage'] },
        { text: t('accounting.nav.customers', 'Customers'), icon: <PeopleAlt fontSize="small" />, path: '/accounting/customers', key: 'invoicing-customers', perm: 'accounting.customers.manage' },
        { text: t('accounting.nav.cityLedger', 'City Ledger'), icon: <LocationCity fontSize="small" />, path: '/accounting/city-ledger', key: 'invoicing-city-ledger', perm: ['accounting.cityLedger.view', 'accounting.cityLedger.authorize'] },
      ],
    },
    {
      text: t('accounting.nav.purchasing', 'Bills'),
      icon: <RequestPage />,
      path: '/accounting/bills',
      key: 'purchasing',
      children: [
        { text: t('accounting.nav.bills', 'Bills'), icon: <RequestPage fontSize="small" />, path: '/accounting/bills', key: 'purchasing-bills', perm: ['accounting.bills.view', 'accounting.bills.manage'] },
        { text: t('accounting.nav.suppliers', 'Suppliers'), icon: <Storefront fontSize="small" />, path: '/accounting/suppliers', key: 'purchasing-suppliers', perm: 'accounting.suppliers.manage' },
      ],
    },
    {
      text: t('accounting.nav.accounting', 'Accounting'),
      icon: <MenuBook />,
      path: '/accounting/journal-entries',
      key: 'accounting',
      children: [
        { text: t('accounting.nav.journalEntries', 'Journal Entries'), icon: <MenuBook fontSize="small" />, path: '/accounting/journal-entries', key: 'accounting-journal-entries', perm: ['accounting.journal.view', 'accounting.journal.manage'] },
        { text: t('accounting.nav.reports', 'Reports'), icon: <Assessment fontSize="small" />, path: '/accounting/reports', key: 'accounting-reports', perm: 'accounting.reports.view' },
      ],
    },
    { text: t('accounting.nav.settings', 'Settings'), icon: <Settings />, path: '/accounting/settings', key: 'settings', perm: 'accounting.settings.manage' },
  ], [t]);

  const visibleItems: AppShellNavItem[] = React.useMemo(() => {
    const isAllowed = (perm?: string | string[]) => !perm || !!user?.isSuperAdmin || hasPermission(resolvedAppRoles, 'accounting', perm);
    return menuItems.reduce<AppShellNavItem[]>((acc, item) => {
      if (item.children?.length) {
        const visibleChildren = item.children.filter((child) => isAllowed(child.perm));
        if (visibleChildren.length > 0) acc.push({ ...item, children: visibleChildren });
        return acc;
      }
      if (isAllowed(item.perm)) acc.push(item);
      return acc;
    }, []);
  }, [menuItems, user, resolvedAppRoles]);

  return (
    <AppShell
      app="accounting"
      title={title}
      navItems={visibleItems}
      homePath="/accounting"
      profilePath="/accounting/profile"
      mobileTitle={t('accounting.title', 'Pilloto Accounting')}
      brandName="Pilloto"
      sidebarBg={ACCOUNTING_SIDEBAR_BG}
      storageKey="accountingSidebarOpen"
    >
      {children}
    </AppShell>
  );
};

export default AccountingLayout;
