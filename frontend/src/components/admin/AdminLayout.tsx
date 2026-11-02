import React from 'react';
import {
  DashboardOutlined,
  CalendarMonthOutlined,
  BookOnlineOutlined,
  ViewTimelineOutlined,
  PersonOutline,
  ConfirmationNumberOutlined,
  PointOfSaleOutlined,
  ApartmentOutlined,
  BedOutlined,
  SellOutlined,
  NotificationsActiveOutlined,
  TrendingUpOutlined,
  HandshakeOutlined,
  BusinessOutlined,
  AccountBalanceWalletOutlined,
  ReceiptOutlined,
  AssessmentOutlined,
  GroupOutlined,
  SettingsOutlined,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';
import AppShell, { AppShellNavItem } from '../shared/AppShell';
import { usePlanFeature } from '../../contexts/TenantContext';
import { channelAlertsService } from '../../services/api';
import { usePermission } from '../../lib/permissions';

/** Fired by the Channel Alerts page when alerts change, so the badge refreshes at once */
const CHANNEL_ALERTS_CHANGED = 'pilloto:channel-alerts-changed';
const BADGE_POLL_MS = 60_000;

/** Open critical channel alerts (nav badge); polled while the user can see channel alerts. */
function useChannelAlertBadge(enabled: boolean): number {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let alive = true;
    const load = () => channelAlertsService.summary()
      .then((r) => { if (alive) setCount(r.data.data?.openCritical ?? 0); })
      .catch(() => undefined);
    load();
    const timer = setInterval(load, BADGE_POLL_MS);
    window.addEventListener(CHANNEL_ALERTS_CHANGED, load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener(CHANNEL_ALERTS_CHANGED, load); };
  }, [enabled]);
  return count;
}


interface AdminLayoutProps {
  children: React.ReactNode;
  title?: React.ReactNode;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children, title }) => {
  const { activeSections: enabledSections } = useSettings();
  const { user, permissions } = useAuth();
  const { t } = useTranslation();
  const hasChannelManager = usePlanFeature('channelManager');
  const canViewAlerts = usePermission('admin.ota.view');
  const alertBadge = useChannelAlertBadge(hasChannelManager && canViewAlerts);

  // Build menu and filter by granular permissions (admin sees all)
  const menuItems: AppShellNavItem[] = React.useMemo(() => {
    const sec = {
      frontDesk: t('admin.nav.sections.frontDesk', 'Front desk'),
      property: t('admin.nav.sections.property', 'Property'),
      distribution: t('admin.nav.sections.distribution', 'Distribution'),
      finance: t('admin.nav.sections.finance', 'Finance'),
      administration: t('admin.nav.sections.administration', 'Administration'),
    };
    const items = [
      { text: t('admin.nav.dashboard'), icon: <DashboardOutlined />, path: '/admin', key: 'dashboard', perm: 'admin.dashboard' },
      { section: sec.frontDesk, text: t('admin.nav.bookingCalendar'), icon: <CalendarMonthOutlined />, path: '/admin/booking-calendar', key: 'booking-calendar', perm: 'admin.schedule' },
      { section: sec.frontDesk, text: t('admin.nav.reservations'), icon: <BookOnlineOutlined />, path: '/admin/reservations', key: 'reservations', perm: 'admin.reservations' },
      { section: sec.frontDesk, text: t('admin.nav.schedule'), icon: <ViewTimelineOutlined />, path: '/admin/schedule', key: 'schedule', perm: 'admin.schedule' },
      { section: sec.frontDesk, text: t('admin.nav.guests'), icon: <PersonOutline />, path: '/admin/guests', key: 'guests', perm: 'admin.guests' },
      { section: sec.frontDesk, text: t('admin.nav.wristbands'), icon: <ConfirmationNumberOutlined />, path: '/admin/wristbands', key: 'wristbands', perm: 'admin.wristbands' },
      { section: sec.frontDesk, text: t('admin.nav.cashierClosures', 'Cashier Closures'), icon: <PointOfSaleOutlined />, path: '/admin/cashier-closures', key: 'cashier-closures', perm: 'cashier' },
      { section: sec.property, text: t('admin.nav.accommodations'), icon: <ApartmentOutlined />, path: '/admin/accommodations', key: 'accommodations', perm: 'admin.accommodations' },
      { section: sec.property, text: t('admin.nav.rooms'), icon: <BedOutlined />, path: '/admin/rooms', key: 'rooms', perm: 'admin.rooms' },
      { section: sec.property, text: t('admin.nav.pricing'), icon: <SellOutlined />, path: '/admin/pricing', key: 'pricing', perm: 'admin.pricing' },
      ...(hasChannelManager ? [{ section: sec.distribution, text: t('admin.nav.channelAlerts'), icon: <NotificationsActiveOutlined />, path: '/admin/channel-alerts', key: 'channel-alerts', perm: 'admin.ota.view', badge: alertBadge }] : []),
      { section: sec.finance, text: t('admin.nav.revenue'), icon: <TrendingUpOutlined />, path: '/admin/revenue', key: 'revenue', perm: 'admin.revenue' },
      { section: sec.finance, text: t('admin.nav.ecfInvoices'), icon: <ReceiptOutlined />, path: '/admin/invoices/ecf', key: 'ecf-invoices', perm: 'admin.ecf.view' },
      { section: sec.finance, text: t('admin.nav.companies'), icon: <BusinessOutlined />, path: '/admin/companies', key: 'companies', perm: 'admin.companies' },
      { section: sec.finance, text: t('admin.nav.creditAccounts'), icon: <AccountBalanceWalletOutlined />, path: '/admin/credit-accounts', key: 'credit-accounts', perm: 'admin.creditAccounts' },
      { section: sec.finance, text: t('admin.nav.commissions'), icon: <HandshakeOutlined />, path: '/admin/commissions', key: 'commissions', perm: 'admin.commissions' },
      { section: sec.finance, text: t('admin.nav.reports'), icon: <AssessmentOutlined />, path: '/admin/reports', key: 'reports', perm: 'admin.ecf.view' },
      { section: sec.administration, text: t('admin.nav.users'), icon: <GroupOutlined />, path: '/admin/users', key: 'users', perm: 'admin.users' },
      // One entry; the settings pages have their own navigation inside (components/admin/settings/SettingsNav.tsx)
      { section: sec.administration, text: t('admin.nav.settings'), icon: <SettingsOutlined />, path: '/admin/settings', activePrefix: '/admin/settings/', key: 'settings', perm: 'admin.settings' },
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
  }, [user, permissions, t, enabledSections, hasChannelManager, alertBadge]);

  return (
    <AppShell
      app="pms"
      title={title}
      navItems={menuItems}
      homePath="/admin"
      profilePath="/admin/profile"
      mobileTitle={t('brand.appName.pms', 'Pilloto PMS')}
      storageKey="adminSidebarOpen"
    >
      {children}
    </AppShell>
  );
};

export default AdminLayout;
