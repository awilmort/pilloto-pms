import React from 'react';
import {
  Dashboard,
  Hotel,
  BookOnline,
  People,
  Analytics,
  Settings,
  AttachMoney,
  Business,
  PersonPin,
  AccountBalanceWallet,
  PointOfSale,
  CalendarMonth,
  SyncAlt,
  Receipt,
  Assessment,
} from '@mui/icons-material';
import { ConfirmationNumber } from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';
import AppShell, { AppShellNavItem } from '../shared/AppShell';

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: React.ReactNode;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children, title }) => {
  const { activeSections: enabledSections } = useSettings();
  const { user, permissions } = useAuth();
  const { t } = useTranslation();

  // Build menu and filter by granular permissions (admin sees all)
  const menuItems: AppShellNavItem[] = React.useMemo(() => {
    const items = [
      { text: t('admin.nav.dashboard'), icon: <Dashboard />, path: '/admin', key: 'dashboard', perm: 'admin.dashboard' },
      { text: t('admin.nav.bookingCalendar'), icon: <CalendarMonth />, path: '/admin/booking-calendar', key: 'booking-calendar', perm: 'admin.schedule' },
      { text: t('admin.nav.reservations'), icon: <BookOnline />, path: '/admin/reservations', key: 'reservations', perm: 'admin.reservations' },
      { text: t('admin.nav.schedule'), icon: <Analytics />, path: '/admin/schedule', key: 'schedule', perm: 'admin.schedule' },
      { text: t('admin.nav.accommodations'), icon: <Hotel />, path: '/admin/accommodations', key: 'accommodations', perm: 'admin.accommodations' },
      { text: t('admin.nav.wristbands'), icon: <ConfirmationNumber />, path: '/admin/wristbands', key: 'wristbands', perm: 'admin.wristbands' },
      { text: t('admin.nav.cashierClosures', 'Cashier Closures'), icon: <PointOfSale />, path: '/admin/cashier-closures', key: 'cashier-closures', perm: 'cashier' },
      { text: t('admin.nav.revenue'), icon: <AttachMoney />, path: '/admin/revenue', key: 'revenue', perm: 'admin.revenue' },
      { text: t('admin.nav.commissions'), icon: <AttachMoney />, path: '/admin/commissions', key: 'commissions', perm: 'admin.commissions' },
      { text: t('admin.nav.guests'), icon: <PersonPin />, path: '/admin/guests', key: 'guests', perm: 'admin.guests' },
      { text: t('admin.nav.companies'), icon: <Business />, path: '/admin/companies', key: 'companies', perm: 'admin.companies' },
      { text: t('admin.nav.creditAccounts'), icon: <AccountBalanceWallet />, path: '/admin/credit-accounts', key: 'credit-accounts', perm: 'admin.creditAccounts' },
      { text: t('admin.nav.users'), icon: <People />, path: '/admin/users', key: 'users', perm: 'admin.users' },
      { text: t('admin.nav.rooms'), icon: <Hotel />, path: '/admin/rooms', key: 'rooms', perm: 'admin.rooms' },
      { text: t('admin.nav.pricing'), icon: <Settings />, path: '/admin/pricing', key: 'pricing', perm: 'admin.pricing' },
      { text: t('admin.nav.otaConflicts', 'OTA Conflicts'), icon: <SyncAlt />, path: '/admin/ota-conflicts', key: 'ota-conflicts', perm: 'admin.ota.view' },
      { text: t('admin.nav.ecfInvoices'), icon: <Receipt />, path: '/admin/invoices/ecf', key: 'ecf-invoices', perm: 'admin.ecf.view' },
      { text: t('admin.nav.reports'), icon: <Assessment />, path: '/admin/reports', key: 'reports', perm: 'admin.ecf.view' },
      { text: t('admin.nav.settings'), icon: <Settings />, path: '/admin/settings', key: 'settings', perm: 'admin.settings' },
    ];
    const role = user?.role || 'customer';
    if (role === 'admin') {
      return items.filter(i => enabledSections[i.key] !== false);
    }
    const perms: string[] = permissions || [];
    if (!perms || perms.length === 0) return [];
    return items.filter(i => {
      if (enabledSections[i.key] === false) return false;
      if (i.perm === 'admin.wristbands') {
        return perms.includes('admin.wristbands.view') || perms.includes('admin.wristbands.manage') || perms.includes('admin.access');
      }
      return perms.includes(i.perm) || perms.includes('admin.access');
    });
  }, [user, permissions, t, enabledSections]);

  return (
    <AppShell
      app="pms"
      title={title}
      navItems={menuItems}
      homePath="/admin"
      profilePath="/admin/profile"
      mobileTitle={t('admin.title')}
      storageKey="adminSidebarOpen"
    >
      {children}
    </AppShell>
  );
};

export default AdminLayout;
