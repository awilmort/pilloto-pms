import React from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  IconButton,
  useTheme,
  useMediaQuery,
  Tooltip,
} from '@mui/material';
import {
  Dashboard,
  Hotel,
  BookOnline,
  People,
  Analytics,
  Settings,
  Menu,
  Logout,
  AttachMoney,
  ChevronLeft,
  ChevronRight,
  Business,
  PersonPin,
  AccountBalanceWallet,
  PointOfSale,
  CalendarMonth,
  SyncAlt,
} from '@mui/icons-material';
import { ConfirmationNumber } from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Header from '../layout/Header';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';

const drawerWidth = 240;
const collapsedWidth = 72;

interface AdminLayoutProps {
  children: React.ReactNode;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(
    () => localStorage.getItem('adminSidebarOpen') !== 'false'
  );
  const { activeSections: enabledSections } = useSettings();

  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const { t } = useTranslation();

  // Persist sidebar state so navigation doesn't reset it
  const handleDrawerToggle = () => {
    if (isDesktop) {
      setSidebarOpen(prev => {
        const next = !prev;
        localStorage.setItem('adminSidebarOpen', String(next));
        return next;
      });
    } else {
      setMobileOpen(prev => !prev);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Build menu and filter by granular permissions (admin sees all)
  const menuItems = React.useMemo(() => {
    const items = [
      { text: t('admin.nav.dashboard'), icon: <Dashboard />, path: '/admin', key: 'dashboard', perm: 'admin.dashboard' },
      { text: t('admin.nav.revenue'), icon: <AttachMoney />, path: '/admin/revenue', key: 'revenue', perm: 'admin.revenue' },
      { text: t('admin.nav.commissions'), icon: <AttachMoney />, path: '/admin/commissions', key: 'commissions', perm: 'admin.commissions' },
      { text: t('admin.nav.schedule'), icon: <Analytics />, path: '/admin/schedule', key: 'schedule', perm: 'admin.schedule' },
      { text: t('admin.nav.bookingCalendar'), icon: <CalendarMonth />, path: '/admin/booking-calendar', key: 'booking-calendar', perm: 'admin.schedule' },
      { text: t('admin.nav.accommodations'), icon: <Hotel />, path: '/admin/accommodations', key: 'accommodations', perm: 'admin.accommodations' },
      { text: t('admin.nav.rooms'), icon: <Hotel />, path: '/admin/rooms', key: 'rooms', perm: 'admin.rooms' },
      { text: t('admin.nav.wristbands'), icon: <ConfirmationNumber />, path: '/admin/wristbands', key: 'wristbands', perm: 'admin.wristbands' },
      { text: t('admin.nav.pricing'), icon: <Settings />, path: '/admin/pricing', key: 'pricing', perm: 'admin.pricing' },
      { text: t('admin.nav.reservations'), icon: <BookOnline />, path: '/admin/reservations', key: 'reservations', perm: 'admin.reservations' },
      { text: t('admin.nav.users'), icon: <People />, path: '/admin/users', key: 'users', perm: 'admin.users' },
      { text: t('admin.nav.companies'), icon: <Business />, path: '/admin/companies', key: 'companies', perm: 'admin.companies' },
      { text: t('admin.nav.guests'), icon: <PersonPin />, path: '/admin/guests', key: 'guests', perm: 'admin.guests' },
      { text: t('admin.nav.creditAccounts'), icon: <AccountBalanceWallet />, path: '/admin/credit-accounts', key: 'credit-accounts', perm: 'admin.creditAccounts' },
      { text: t('admin.nav.cashierClosures', 'Cashier Closures'), icon: <PointOfSale />, path: '/admin/cashier-closures', key: 'cashier-closures', perm: 'cashier' },
      { text: t('admin.nav.otaConflicts', 'OTA Conflicts'), icon: <SyncAlt />, path: '/admin/ota-conflicts', key: 'ota-conflicts', perm: 'admin.ota.view' },
      { text: t('admin.nav.settings'), icon: <Settings />, path: '/admin/settings', key: 'settings', perm: 'admin.settings' },
    ];
    const role = user?.role || 'customer';
    if (role === 'admin') {
      return items.filter(i => enabledSections[i.key] !== false);
    }
    const perms: string[] = (user as any)?.permissions || [];
    if (!perms || perms.length === 0) return [];
    return items.filter(i => {
      if (enabledSections[i.key] === false) return false;
      if (i.perm === 'admin.wristbands') {
        return perms.includes('admin.wristbands.view') || perms.includes('admin.wristbands.manage') || perms.includes('admin.access');
      }
      return perms.includes(i.perm) || perms.includes('admin.access');
    });
  }, [user, t, enabledSections]);

  const drawerContent = (
    <Box sx={{ color: '#E2E8F0', height: '100%', display: 'flex', flexDirection: 'column', overflowX: 'hidden' }}>
      {/* Logo + Toggle */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          height: 64,
          flexShrink: 0,
          position: 'relative',
          pl: sidebarOpen ? 2 : 0,
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          justifyContent: sidebarOpen ? 'flex-start' : 'center',
        }}
      >
        {/* Pilloto brand */}
        <Box
          onClick={() => navigate('/admin')}
          sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', overflow: 'hidden' }}
        >
          {/* Icon mark — fixed 40px box keeps it aligned with nav icons */}
          <Box sx={{ width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="26" height="35" viewBox="0 0 52 70" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="2" width="44" height="66" rx="3" fill="rgba(255,255,255,0.04)" stroke="#606060" strokeWidth="1.5"/>
              <rect x="10" y="11" width="12" height="10" rx="1.5" fill="#CCCCCC"/>
              <rect x="30" y="11" width="12" height="10" rx="1.5" fill="#CCCCCC"/>
              <rect x="10" y="27" width="12" height="10" rx="1.5" fill="#787878"/>
              <rect x="30" y="27" width="12" height="10" rx="1.5" fill="#CCCCCC"/>
              <rect x="10" y="43" width="12" height="10" rx="1.5" fill="#CCCCCC"/>
            </svg>
          </Box>
          {sidebarOpen && (
            <Typography sx={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontWeight: 700,
              fontSize: 24,
              color: '#F0F0F0',
              letterSpacing: '-0.5px',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              ml: 1,
            }}>
              Pilloto
            </Typography>
          )}
        </Box>
        {/* Arrow absolutely positioned so it never shifts the P */}
        {isDesktop && (
          <IconButton
            onClick={handleDrawerToggle}
            size="small"
            sx={{ color: '#A0AEC0', position: 'absolute', right: 2 }}
          >
            {sidebarOpen ? <ChevronLeft /> : <ChevronRight />}
          </IconButton>
        )}
      </Box>

      <Divider sx={{ display: 'none' }} />

      {/* Nav items */}
      <List sx={{ flexGrow: 1, py: 0.5 }}>
        {menuItems.map((item) => (
          <ListItem key={item.key} disablePadding>
            <Tooltip title={!sidebarOpen ? item.text : ''} placement="right">
              <ListItemButton
                selected={location.pathname === item.path}
                onClick={() => {
                  navigate(item.path);
                  if (!isDesktop) setMobileOpen(false);
                }}
                sx={{
                  color: '#E2E8F0',
                  justifyContent: sidebarOpen ? 'flex-start' : 'center',
                  px: sidebarOpen ? 2 : 0,
                  minHeight: 44,
                  '&.Mui-selected': {
                    bgcolor: 'rgba(255,255,255,0.15)',
                    color: '#fff',
                    '& .MuiListItemIcon-root': { color: '#fff' },
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.22)' },
                  },
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
                }}
              >
                <ListItemIcon sx={{ color: '#A0AEC0', minWidth: sidebarOpen ? 40 : 72, justifyContent: 'center' }}>
                  {item.icon}
                </ListItemIcon>
                {sidebarOpen && <ListItemText primary={item.text} />}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}
      </List>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)' }} />

      {/* Logout */}
      <List sx={{ py: 0.5 }}>
        <ListItem disablePadding>
          <Tooltip title={!sidebarOpen ? t('auth.logout') : ''} placement="right">
            <ListItemButton
              onClick={handleLogout}
              sx={{
                color: '#E2E8F0',
                justifyContent: sidebarOpen ? 'flex-start' : 'center',
                px: sidebarOpen ? 2 : 0,
                minHeight: 44,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
              }}
            >
              <ListItemIcon sx={{ color: '#A0AEC0', minWidth: sidebarOpen ? 40 : 72, justifyContent: 'center' }}>
                <Logout />
              </ListItemIcon>
              {sidebarOpen && <ListItemText primary={t('auth.logout')} />}
            </ListItemButton>
          </Tooltip>
        </ListItem>
      </List>
    </Box>
  );

  const drawerSx = (width: number) => ({
    width,
    flexShrink: 0,
    transition: theme.transitions.create('width', { easing: theme.transitions.easing.sharp }),
    '& .MuiDrawer-paper': {
      width,
      boxSizing: 'border-box',
      bgcolor: '#2D3748',
      color: '#E2E8F0',
      overflowX: 'hidden',
      transition: theme.transitions.create('width', { easing: theme.transitions.easing.sharp }),
      borderRight: 'none',
    },
  });

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Desktop: permanent sidebar that collapses to icon-only */}
      {isDesktop && (
        <Drawer variant="permanent" sx={drawerSx(sidebarOpen ? drawerWidth : collapsedWidth)}>
          {drawerContent}
        </Drawer>
      )}

      {/* Mobile: temporary sidebar (full open/close) */}
      {!isDesktop && (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              bgcolor: '#2D3748',
              color: '#E2E8F0',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* Right panel: header + content */}
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header />
        <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
          {/* Mobile hamburger at top of content */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', mb: 2 }}>
            <IconButton aria-label="open menu" onClick={handleDrawerToggle}>
              <Menu />
            </IconButton>
            <Typography variant="h6" sx={{ ml: 1 }}>
              {t('admin.title')}
            </Typography>
          </Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
};

export default AdminLayout;
