import React from 'react';
import { DashboardOutlined, SettingsOutlined, Inventory2Outlined, WarehouseOutlined, ReceiptLongOutlined, PeopleAltOutlined, RequestQuoteOutlined, RequestPageOutlined, StorefrontOutlined, AssignmentReturnOutlined, PostAddOutlined, MenuBookOutlined, AssessmentOutlined, LocationCityOutlined } from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { hasPermission } from '../../lib/permissions';
import AppShell, { AppShellNavItem } from '../shared/AppShell';

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
 * `AppShell` (1.2) with an accounting-scoped nav config; the shell carries the
 * Accounting product accent (green). Modules are sidebar sections rather than
 * tabs — Phase 4.2.
 */
const AccountingLayout: React.FC<AccountingLayoutProps> = ({ children, title }) => {
  const { user, resolvedAppRoles } = useAuth();
  const { t } = useTranslation();

  const menuItems: AccountingNavItem[] = React.useMemo(() => {
    const sales = t('accounting.nav.sections.sales', 'Sales');
    const purchases = t('accounting.nav.sections.purchases', 'Purchases');
    const inventory = t('accounting.nav.inventory', 'Inventory');
    const ledger = t('accounting.nav.accounting', 'Accounting');
    return [
      { text: t('accounting.nav.dashboard', 'Dashboard'), icon: <DashboardOutlined />, path: '/accounting', key: 'dashboard', perm: 'accounting.dashboard' },
      { section: sales, text: t('accounting.nav.invoices', 'Invoices'), icon: <ReceiptLongOutlined />, path: '/accounting/invoices', key: 'invoicing-invoices', perm: ['accounting.invoices.view', 'accounting.invoices.manage'] },
      { section: sales, text: t('accounting.nav.creditNotes', 'Credit Notes'), icon: <AssignmentReturnOutlined />, path: '/accounting/credit-notes', key: 'invoicing-credit-notes', perm: ['accounting.creditNotes.view', 'accounting.creditNotes.manage'] },
      { section: sales, text: t('accounting.nav.debitNotes', 'Debit Notes'), icon: <PostAddOutlined />, path: '/accounting/debit-notes', key: 'invoicing-debit-notes', perm: ['accounting.debitNotes.view', 'accounting.debitNotes.manage'] },
      { section: sales, text: t('accounting.nav.quotes', 'Quotes'), icon: <RequestQuoteOutlined />, path: '/accounting/quotes', key: 'invoicing-quotes', perm: ['accounting.quotes.view', 'accounting.quotes.manage'] },
      { section: sales, text: t('accounting.nav.customers', 'Customers'), icon: <PeopleAltOutlined />, path: '/accounting/customers', key: 'invoicing-customers', perm: 'accounting.customers.manage' },
      { section: sales, text: t('accounting.nav.cityLedger', 'City Ledger'), icon: <LocationCityOutlined />, path: '/accounting/city-ledger', key: 'invoicing-city-ledger', perm: ['accounting.cityLedger.view', 'accounting.cityLedger.authorize'] },
      { section: purchases, text: t('accounting.nav.bills', 'Bills'), icon: <RequestPageOutlined />, path: '/accounting/bills', key: 'purchasing-bills', perm: ['accounting.bills.view', 'accounting.bills.manage'] },
      { section: purchases, text: t('accounting.nav.suppliers', 'Suppliers'), icon: <StorefrontOutlined />, path: '/accounting/suppliers', key: 'purchasing-suppliers', perm: 'accounting.suppliers.manage' },
      { section: inventory, text: t('accounting.nav.products', 'Products'), icon: <Inventory2Outlined />, path: '/accounting/products', key: 'inventory-products', perm: ['accounting.inventory.view', 'accounting.inventory.manage'] },
      { section: inventory, text: t('accounting.nav.warehouses', 'Warehouses'), icon: <WarehouseOutlined />, path: '/accounting/warehouses', key: 'inventory-warehouses', perm: ['accounting.inventory.view', 'accounting.inventory.manage'] },
      { section: ledger, text: t('accounting.nav.journalEntries', 'Journal Entries'), icon: <MenuBookOutlined />, path: '/accounting/journal-entries', key: 'accounting-journal-entries', perm: ['accounting.journal.view', 'accounting.journal.manage'] },
      { section: ledger, text: t('accounting.nav.reports', 'Reports'), icon: <AssessmentOutlined />, path: '/accounting/reports', key: 'accounting-reports', perm: 'accounting.reports.view' },
      { section: ledger, text: t('accounting.nav.settings', 'Settings'), icon: <SettingsOutlined />, path: '/accounting/settings', key: 'settings', perm: 'accounting.settings.manage' },
    ];
  }, [t]);

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
      mobileTitle={t('brand.appName.accounting', 'Pilloto Accounting')}
      storageKey="accountingSidebarOpen"
    >
      {children}
    </AppShell>
  );
};

export default AccountingLayout;
