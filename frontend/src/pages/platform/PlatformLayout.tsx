import React from 'react';
import { Box } from '@mui/material';
import { ApartmentOutlined, HubOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import AppShell, { AppShellNavItem } from '../../components/shared/AppShell';

interface PlatformLayoutProps {
  children: React.ReactNode;
}

/** Super-admin console (admin.pilloto.com) — same shell as the tenant apps, with the brand accent. */
const PlatformLayout: React.FC<PlatformLayoutProps> = ({ children }) => {
  const { t } = useTranslation();

  const navItems: AppShellNavItem[] = React.useMemo(() => {
    const workspace = t('platform.nav.sections.workspace', 'Platform');
    return [
      { section: workspace, text: t('platform.nav.tenants', 'Tenants'), icon: <ApartmentOutlined />, path: '/platform/tenants', key: 'tenants' },
      { section: workspace, text: t('platform.nav.channelManager', 'Channel Manager'), icon: <HubOutlined />, path: '/platform/channel-manager', key: 'channel-manager' },
    ];
  }, [t]);

  return (
    <AppShell
      app="platform"
      navItems={navItems}
      homePath="/platform/tenants"
      profilePath="/platform/profile"
      mobileTitle={t('brand.appName.platform', 'Pilloto Console')}
      workspaceLabel={t('platform.superAdmin', 'Super admin')}
      storageKey="platformSidebarOpen"
    >
      <Box sx={{ maxWidth: 1200, mx: 'auto', py: 1 }}>{children}</Box>
    </AppShell>
  );
};

export default PlatformLayout;
