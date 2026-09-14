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
  Avatar,
  Menu as MuiMenu,
  MenuItem as MuiMenuItem,
} from '@mui/material';
import { ChevronLeft, ChevronRight, Logout, Menu, ExpandMore, ExpandLess, CheckCircle, Apps } from '@mui/icons-material';
import Collapse from '@mui/material/Collapse';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../common/LanguageSwitcher';
import { AppCode } from '../../types';
import { APP_METADATA, useAccessibleApps } from '../../lib/apps';

const drawerWidth = 240;
const collapsedWidth = 72;

export interface AppShellNavItem {
  key: string;
  text: string;
  icon: React.ReactNode;
  path: string;
  /** Sub-items rendered as a collapsible group. */
  children?: AppShellNavItem[];
}

interface AppShellProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  /** Already permission-filtered and translated nav items for the current app. */
  navItems: AppShellNavItem[];
  app: AppCode;
  /** Path the brand mark navigates to (e.g. `/admin`, `/accounting`). */
  homePath: string;
  /** Path the user-menu "profile" item navigates to. */
  profilePath: string;
  /** Translated label shown next to the hamburger on mobile. */
  mobileTitle: string;
  brandName?: string;
  /** Drawer background color — lets each app carry its own accent. */
  sidebarBg?: string;
  /** localStorage key for the persisted desktop sidebar open/collapsed state. */
  storageKey?: string;
}

const AppShell: React.FC<AppShellProps> = ({
  children,
  title,
  navItems,
  app,
  homePath,
  profilePath,
  mobileTitle,
  brandName = 'Pilloto',
  sidebarBg = '#2D3748',
  storageKey,
}) => {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const resolvedStorageKey = storageKey || `${app}SidebarOpen`;
  const [sidebarOpen, setSidebarOpen] = React.useState(
    () => localStorage.getItem(resolvedStorageKey) !== 'false'
  );

  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const { t } = useTranslation();

  const [userMenuAnchor, setUserMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [appMenuAnchor, setAppMenuAnchor] = React.useState<null | HTMLElement>(null);
  const navListRef = React.useRef<HTMLUListElement>(null);

  // Explicit open/close overrides for collapsible nav groups — a group with no
  // override yet defaults open when one of its children is the active route.
  const [groupOverrides, setGroupOverrides] = React.useState<Record<string, boolean>>({});
  const isGroupOpen = (item: AppShellNavItem): boolean => {
    if (groupOverrides[item.key] !== undefined) return groupOverrides[item.key];
    return !!item.children?.some((child) => location.pathname === child.path);
  };
  const toggleGroup = (item: AppShellNavItem) => {
    setGroupOverrides((prev) => ({ ...prev, [item.key]: !isGroupOpen(item) }));
  };

  React.useEffect(() => {
    const active = navListRef.current?.querySelector<HTMLElement>('.Mui-selected');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [location.pathname]);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  // Persist sidebar state so navigation doesn't reset it
  const handleDrawerToggle = () => {
    if (isDesktop) {
      setSidebarOpen(prev => {
        const next = !prev;
        localStorage.setItem(resolvedStorageKey, String(next));
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

  // Apps both the tenant's products and the user's appRoles allow — gates the switcher.
  const availableApps = useAccessibleApps();
  const showAppSwitcher = availableApps.length > 1 || !!user?.isSuperAdmin;

  const handleAppMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAppMenuAnchor(event.currentTarget);
  };
  const handleAppMenuClose = () => setAppMenuAnchor(null);
  const handleAppSwitch = (code: AppCode) => {
    handleAppMenuClose();
    if (code !== app) navigate(APP_METADATA[code].path);
  };

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
          onClick={() => navigate(homePath)}
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
              {brandName}
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
      <List
        ref={navListRef}
        sx={{
          flexGrow: 1,
          py: 0.5,
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.18) transparent',
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.18)', borderRadius: 3 },
          '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.32)' },
        }}
      >
        {navItems.map((item) => {
          const hasChildren = !!item.children?.length;
          const childActive = hasChildren && item.children!.some((child) => location.pathname === child.path);
          const open = hasChildren && isGroupOpen(item);

          return (
            <React.Fragment key={item.key}>
              <ListItem disablePadding>
                <Tooltip title={!sidebarOpen ? item.text : ''} placement="right">
                  <ListItemButton
                    selected={hasChildren ? childActive : location.pathname === item.path}
                    onClick={() => {
                      if (hasChildren) {
                        if (!sidebarOpen) {
                          // Collapsed rail: expand the drawer so the group's children become visible.
                          setSidebarOpen(true);
                          localStorage.setItem(resolvedStorageKey, 'true');
                        }
                        toggleGroup(item);
                        return;
                      }
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
                    {sidebarOpen && hasChildren && (open ? <ExpandLess fontSize="small" sx={{ color: '#A0AEC0' }} /> : <ExpandMore fontSize="small" sx={{ color: '#A0AEC0' }} />)}
                  </ListItemButton>
                </Tooltip>
              </ListItem>
              {hasChildren && (
                <Collapse in={sidebarOpen && open} timeout="auto" unmountOnExit>
                  <List disablePadding>
                    {item.children!.map((child) => (
                      <ListItem key={child.key} disablePadding>
                        <ListItemButton
                          selected={location.pathname === child.path}
                          onClick={() => {
                            navigate(child.path);
                            if (!isDesktop) setMobileOpen(false);
                          }}
                          sx={{
                            color: '#E2E8F0',
                            pl: 4,
                            minHeight: 40,
                            '&.Mui-selected': {
                              bgcolor: 'rgba(255,255,255,0.15)',
                              color: '#fff',
                              '& .MuiListItemIcon-root': { color: '#fff' },
                              '&:hover': { bgcolor: 'rgba(255,255,255,0.22)' },
                            },
                            '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
                          }}
                        >
                          <ListItemIcon sx={{ color: '#A0AEC0', minWidth: 32, justifyContent: 'center' }}>
                            {child.icon}
                          </ListItemIcon>
                          <ListItemText primary={child.text} primaryTypographyProps={{ fontSize: '0.875rem' }} />
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </Collapse>
              )}
            </React.Fragment>
          );
        })}
      </List>

      {/* App switcher */}
      {showAppSwitcher && (
        <>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)' }} />
          <List sx={{ py: 0.5 }}>
            <ListItem disablePadding>
              <Tooltip title={!sidebarOpen ? APP_METADATA[app].name : ''} placement="right">
                <ListItemButton
                  onClick={handleAppMenuOpen}
                  sx={{
                    color: '#E2E8F0',
                    justifyContent: sidebarOpen ? 'flex-start' : 'center',
                    px: sidebarOpen ? 2 : 0,
                    minHeight: 44,
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
                  }}
                >
                  <ListItemIcon sx={{ color: '#A0AEC0', minWidth: sidebarOpen ? 40 : 72, justifyContent: 'center' }}>
                    <Apps />
                  </ListItemIcon>
                  {sidebarOpen && (
                    <>
                      <ListItemText
                        primary={APP_METADATA[app].name}
                        primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: 600 }}
                      />
                      <ExpandMore fontSize="small" sx={{ color: '#A0AEC0', flexShrink: 0 }} />
                    </>
                  )}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          </List>
        </>
      )}

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
      bgcolor: sidebarBg,
      color: '#E2E8F0',
      overflowX: 'hidden',
      transition: theme.transitions.create('width', { easing: theme.transitions.easing.sharp }),
      borderRight: 'none',
    },
  });

  return (
    <>
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
                bgcolor: sidebarBg,
                color: '#E2E8F0',
              },
            }}
          >
            {drawerContent}
          </Drawer>
        )}

        {/* Right panel: content */}
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Top bar: page title (desktop) | hamburger (mobile) + pill */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, pt: 1.5, pb: 0 }}>
            {/* Mobile: hamburger + app title */}
            <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center' }}>
              <IconButton aria-label="open menu" onClick={handleDrawerToggle}>
                <Menu />
              </IconButton>
              <Typography variant="h6" sx={{ ml: 1 }}>
                {mobileTitle}
              </Typography>
            </Box>
            {/* Desktop: page title */}
            <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
              {title && (
                <Typography variant="h3" component="h1" fontWeight={700} sx={{ lineHeight: 1, color: 'text.primary' }}>
                  {title}
                </Typography>
              )}
            </Box>
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', borderRadius: '40px', px: 1.5, py: 0.75, boxShadow: '0 1px 8px rgba(0,0,0,0.10)', border: '1px solid rgba(0,0,0,0.06)' }}>
              <LanguageSwitcher />
              <IconButton
                size="small"
                onClick={handleUserMenuOpen}
                aria-label="account menu"
                sx={{ p: 0.5 }}
              >
                {user?.avatar ? (
                  <Avatar src={user.avatar} alt={user.firstName} sx={{ width: 30, height: 30 }} />
                ) : (
                  <Avatar sx={{ width: 30, height: 30, bgcolor: 'secondary.main', fontSize: '0.8rem', fontWeight: 700 }}>
                    {user?.firstName?.[0]?.toUpperCase()}
                  </Avatar>
                )}
              </IconButton>
            </Box>
          </Box>
          <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
            {children}
          </Box>
        </Box>
      </Box>

      {showAppSwitcher && (
        <MuiMenu
          anchorEl={appMenuAnchor}
          open={Boolean(appMenuAnchor)}
          onClose={handleAppMenuClose}
          anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          PaperProps={{ sx: { borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', mb: 1, minWidth: 200 } }}
        >
          {availableApps.map((code) => (
            <MuiMenuItem
              key={code}
              onClick={() => handleAppSwitch(code)}
              selected={code === app}
              sx={{ fontSize: '0.9rem', borderRadius: '8px', mx: 0.5, display: 'flex', justifyContent: 'space-between', gap: 1 }}
            >
              {APP_METADATA[code].name}
              {code === app && <CheckCircle fontSize="small" color="success" />}
            </MuiMenuItem>
          ))}
        </MuiMenu>
      )}

      <MuiMenu
        anchorEl={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        onClose={handleUserMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            mt: 1,
            minWidth: 160,
          },
        }}
      >
        <MuiMenuItem disabled sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
          {user?.firstName} {user?.lastName}
        </MuiMenuItem>
        <Divider />
        <MuiMenuItem onClick={() => { handleUserMenuClose(); navigate(profilePath); }} sx={{ fontSize: '0.9rem', borderRadius: '8px', mx: 0.5 }}>
          {t('auth.profile')}
        </MuiMenuItem>
        <Divider />
        <MuiMenuItem onClick={() => { handleUserMenuClose(); handleLogout(); }} sx={{ fontSize: '0.9rem', borderRadius: '8px', mx: 0.5 }}>
          {t('auth.logout')}
        </MuiMenuItem>
      </MuiMenu>
    </>
  );
};

export default AppShell;
