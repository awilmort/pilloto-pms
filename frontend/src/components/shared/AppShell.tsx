import React from 'react';
import {
  Badge,
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
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
import {
  KeyboardDoubleArrowLeft,
  KeyboardDoubleArrowRight,
  Logout,
  Menu,
  ExpandMore,
  UnfoldMore,
  Check,
  PersonOutline,
  MoreVert,
} from '@mui/icons-material';
import Collapse from '@mui/material/Collapse';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../common/LanguageSwitcher';
import PillotoLogo, { PillotoSymbol } from '../brand/PillotoLogo';
import { AppCode } from '../../types';
import { APP_METADATA, useAccessibleApps } from '../../lib/apps';
import { BRAND, PRODUCT_COLORS, alpha } from '../../brand';

const drawerWidth = 264;
const collapsedWidth = 76;

export interface AppShellNavItem {
  key: string;
  text: string;
  icon: React.ReactNode;
  path: string;
  /** Section heading this item starts or continues; a heading renders whenever it changes between items. */
  section?: string;
  /** Sub-items rendered as a collapsible group. */
  children?: AppShellNavItem[];
  /** Also highlighted on every path that starts with this (e.g. '/admin/settings/'). */
  activePrefix?: string;
  /** Count shown on the item (e.g. open critical alerts); hidden when 0 or unset. */
  badge?: number;
}

export type AppShellApp = AppCode | 'platform';

interface AppShellProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  /** Already permission-filtered and translated nav items for the current app. */
  navItems: AppShellNavItem[];
  app: AppShellApp;
  /** Path the brand mark navigates to (e.g. `/admin`, `/accounting`). */
  homePath: string;
  /** Path the user-menu "profile" item navigates to. */
  profilePath: string;
  /** Translated label shown next to the hamburger on mobile. */
  mobileTitle: string;
  /** Second line of the workspace card — defaults to the tenant's name. */
  workspaceLabel?: string;
  /** localStorage key for the persisted desktop sidebar open/collapsed state. */
  storageKey?: string;
}

/** Product accent for an app — PMS blue, Accounting green, Platform vermilion. */
export const appAccent = (app: AppShellApp): string =>
  app === 'platform' ? BRAND.vermilion : PRODUCT_COLORS[app];

const AppShell: React.FC<AppShellProps> = ({
  children,
  title,
  navItems,
  app,
  homePath,
  profilePath,
  mobileTitle,
  workspaceLabel,
  storageKey,
}) => {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const resolvedStorageKey = storageKey || `${app}SidebarOpen`;
  const [sidebarOpen, setSidebarOpen] = React.useState(
    () => localStorage.getItem(resolvedStorageKey) !== 'false'
  );
  // The mobile drawer is always shown expanded.
  const expanded = sidebarOpen || !isDesktop;
  const accent = appAccent(app);

  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const { tenant } = useTenant();
  const { t } = useTranslation();

  const [userMenuAnchor, setUserMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [appMenuAnchor, setAppMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [flyout, setFlyout] = React.useState<{ anchor: HTMLElement; item: AppShellNavItem } | null>(null);
  const navListRef = React.useRef<HTMLUListElement>(null);

  // Explicit open/close overrides for collapsible nav groups — a group with no
  // override yet defaults open when one of its children is the active route.
  const [groupOverrides, setGroupOverrides] = React.useState<Record<string, boolean>>({});
  const isGroupOpen = (item: AppShellNavItem): boolean => {
    if (groupOverrides[item.key] !== undefined) return groupOverrides[item.key];
    return !!item.children?.some((child) => isActive(child));
  };
  const toggleGroup = (item: AppShellNavItem) => {
    setGroupOverrides((prev) => ({ ...prev, [item.key]: !isGroupOpen(item) }));
  };

  const isActive = (item: AppShellNavItem): boolean =>
    location.pathname === item.path || (!!item.activePrefix && location.pathname.startsWith(item.activePrefix));

  React.useEffect(() => {
    const active = navListRef.current?.querySelector<HTMLElement>('.Mui-selected');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [location.pathname]);

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

  const go = (path: string) => {
    navigate(path);
    setFlyout(null);
    if (!isDesktop) setMobileOpen(false);
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
  const showAppSwitcher = app !== 'platform' && (availableApps.length > 1 || !!user?.isSuperAdmin);
  const appName = (code: AppShellApp) =>
    code === 'platform' ? t('brand.appName.platform', 'Pilloto Console') : t(`brand.appName.${code}`, APP_METADATA[code].name);
  const workspaceSubtitle = workspaceLabel ?? tenant?.name ?? '';

  const handleAppSwitch = (code: AppCode) => {
    setAppMenuAnchor(null);
    if (code !== app) navigate(APP_METADATA[code].path);
  };

  const itemSx = (active: boolean, nested = false) => ({
    mx: 1.5,
    mb: 0.25,
    borderRadius: '8px',
    minHeight: nested ? 34 : 38,
    py: 0.5,
    px: expanded ? 1.25 : 0,
    pl: expanded && nested ? 4.5 : undefined,
    justifyContent: expanded ? 'flex-start' : 'center',
    color: BRAND.slate,
    '& .MuiListItemIcon-root': { color: BRAND.slate },
    '&:hover': { bgcolor: BRAND.paper, color: BRAND.ink, '& .MuiListItemIcon-root': { color: BRAND.ink } },
    ...(active && {
      '&.Mui-selected, &.Mui-selected:hover': {
        bgcolor: alpha(accent, 0.1),
        color: BRAND.ink,
        '& .MuiListItemIcon-root': { color: accent },
      },
    }),
  });

  const itemText = (text: string, active: boolean, nested = false) => (
    <ListItemText
      primary={text}
      primaryTypographyProps={{
        fontSize: nested ? '0.8125rem' : '0.875rem',
        fontWeight: active ? 600 : 500,
        noWrap: true,
      }}
    />
  );

  const renderIcon = (item: AppShellNavItem) => (
    <ListItemIcon sx={{ minWidth: expanded ? 36 : 0, justifyContent: 'center', '& svg': { fontSize: 20 } }}>
      {item.badge ? <Badge badgeContent={item.badge} color="error" max={99}>{item.icon}</Badge> : item.icon}
    </ListItemIcon>
  );

  const navList = (
    <List ref={navListRef} disablePadding sx={{ pb: 1 }}>
      {navItems.map((item, index) => {
        const hasChildren = !!item.children?.length;
        const childActive = hasChildren && item.children!.some(isActive);
        const active = hasChildren ? childActive : isActive(item);
        const open = hasChildren && isGroupOpen(item);
        const newSection = item.section && item.section !== navItems[index - 1]?.section;

        return (
          <React.Fragment key={item.key}>
            {newSection && (
              expanded ? (
                <ListSubheader
                  disableSticky
                  sx={{
                    bgcolor: 'transparent', lineHeight: 1, px: 2.75, pt: 2.25, pb: 1,
                    fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: '#9AA1B5',
                  }}
                >
                  {item.section}
                </ListSubheader>
              ) : (
                <Divider sx={{ mx: 2.5, my: 1.25 }} />
              )
            )}
            <Tooltip title={!expanded ? item.text : ''} placement="right" arrow>
              <ListItemButton
                selected={active}
                onClick={(e) => {
                  if (hasChildren) {
                    if (!expanded) setFlyout({ anchor: e.currentTarget, item });
                    else toggleGroup(item);
                    return;
                  }
                  go(item.path);
                }}
                sx={itemSx(active)}
              >
                {renderIcon(item)}
                {expanded && itemText(item.text, active)}
                {expanded && hasChildren && (
                  <ExpandMore
                    fontSize="small"
                    sx={{ color: '#9AA1B5', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
            {hasChildren && (
              <Collapse in={expanded && open} timeout="auto" unmountOnExit>
                <Box sx={{ position: 'relative', '&::before': { content: '""', position: 'absolute', left: 33, top: 2, bottom: 6, width: '1px', bgcolor: BRAND.mist } }}>
                  <List disablePadding>
                    {item.children!.map((child) => {
                      const childIsActive = isActive(child);
                      return (
                        <ListItemButton
                          key={child.key}
                          selected={childIsActive}
                          onClick={() => go(child.path)}
                          sx={itemSx(childIsActive, true)}
                        >
                          {itemText(child.text, childIsActive, true)}
                        </ListItemButton>
                      );
                    })}
                  </List>
                </Box>
              </Collapse>
            )}
          </React.Fragment>
        );
      })}
    </List>
  );

  const drawerContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflowX: 'hidden' }}>
      {/* Brand */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', height: 68, flexShrink: 0,
          px: expanded ? 2.75 : 0, justifyContent: expanded ? 'space-between' : 'center',
        }}
      >
        <Box
          onClick={() => go(homePath)}
          sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          aria-label={appName(app)}
        >
          {expanded ? <PillotoLogo height={24} product={app} /> : <PillotoSymbol size={36} product={app} />}
        </Box>
        {!isDesktop && (
          <IconButton size="small" onClick={() => setMobileOpen(false)} aria-label="close menu" sx={{ color: BRAND.slate }}>
            <KeyboardDoubleArrowLeft fontSize="small" />
          </IconButton>
        )}
      </Box>

      {/* Workspace: property name + app switcher */}
      {(showAppSwitcher || workspaceSubtitle) && (
        <Box sx={{ px: 1.5, pb: 1.5, flexShrink: 0 }}>
          <Tooltip title={!expanded ? `${appName(app)}${workspaceSubtitle ? ` · ${workspaceSubtitle}` : ''}` : ''} placement="right" arrow>
            <ListItemButton
              onClick={showAppSwitcher ? (e) => setAppMenuAnchor(e.currentTarget) : undefined}
              disableRipple={!showAppSwitcher}
              sx={{
                borderRadius: '10px',
                border: `1px solid ${BRAND.mist}`,
                bgcolor: BRAND.paper,
                px: expanded ? 1.25 : 0,
                py: 1,
                gap: 1.25,
                justifyContent: 'center',
                cursor: showAppSwitcher ? 'pointer' : 'default',
                '&:hover': { bgcolor: showAppSwitcher ? '#EDEFF3' : BRAND.paper },
              }}
            >
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: accent, flexShrink: 0, boxShadow: `0 0 0 3px ${alpha(accent, 0.18)}` }} />
              {expanded && (
                <>
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 600, color: BRAND.ink, lineHeight: 1.3 }}>
                      {workspaceSubtitle || appName(app)}
                    </Typography>
                    <Typography noWrap sx={{ fontSize: '0.75rem', color: BRAND.slate, lineHeight: 1.3 }}>
                      {appName(app)}
                    </Typography>
                  </Box>
                  {showAppSwitcher && <UnfoldMore sx={{ fontSize: 18, color: '#9AA1B5' }} />}
                </>
              )}
            </ListItemButton>
          </Tooltip>
        </Box>
      )}

      {/* Nav items */}
      <Box
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollbarWidth: 'thin',
          scrollbarColor: `${BRAND.mist} transparent`,
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-thumb': { background: BRAND.mist, borderRadius: 3 },
        }}
      >
        {navList}
      </Box>

      {/* Footer: collapse + user */}
      <Box sx={{ flexShrink: 0, borderTop: `1px solid ${BRAND.mist}`, py: 1 }}>
        {isDesktop && (
          <Tooltip title={!expanded ? t('nav.expandSidebar', 'Expand sidebar') : ''} placement="right" arrow>
            <ListItemButton onClick={handleDrawerToggle} sx={itemSx(false)}>
              <ListItemIcon sx={{ minWidth: expanded ? 36 : 0, justifyContent: 'center', '& svg': { fontSize: 20 } }}>
                {expanded ? <KeyboardDoubleArrowLeft /> : <KeyboardDoubleArrowRight />}
              </ListItemIcon>
              {expanded && itemText(t('nav.collapseSidebar', 'Collapse sidebar'), false)}
            </ListItemButton>
          </Tooltip>
        )}
        <Tooltip title={!expanded ? `${user?.firstName ?? ''} ${user?.lastName ?? ''}` : ''} placement="right" arrow>
          <ListItemButton
            onClick={(e) => setUserMenuAnchor(e.currentTarget)}
            aria-label="account menu"
            sx={{ ...itemSx(false), minHeight: 52, gap: 1.25 }}
          >
            {user?.avatar ? (
              <Avatar src={user.avatar} alt={user.firstName} sx={{ width: 32, height: 32 }} />
            ) : (
              <Avatar sx={{ width: 32, height: 32, bgcolor: BRAND.ink, fontSize: '0.8rem', fontWeight: 700 }}>
                {user?.firstName?.[0]?.toUpperCase()}
              </Avatar>
            )}
            {expanded && (
              <>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 600, color: BRAND.ink, lineHeight: 1.3 }}>
                    {user?.firstName} {user?.lastName}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: '0.75rem', color: BRAND.slate, lineHeight: 1.3 }}>
                    {user?.email}
                  </Typography>
                </Box>
                <MoreVert sx={{ fontSize: 18, color: '#9AA1B5' }} />
              </>
            )}
          </ListItemButton>
        </Tooltip>
      </Box>
    </Box>
  );

  const paperSx = {
    boxSizing: 'border-box' as const,
    bgcolor: BRAND.white,
    borderRight: `1px solid ${BRAND.mist}`,
    overflowX: 'hidden' as const,
  };

  const drawerSx = (width: number) => ({
    width,
    flexShrink: 0,
    transition: theme.transitions.create('width', { easing: theme.transitions.easing.sharp }),
    '& .MuiDrawer-paper': {
      ...paperSx,
      width,
      transition: theme.transitions.create('width', { easing: theme.transitions.easing.sharp }),
    },
  });

  return (
    <>
      <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
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
            sx={{ '& .MuiDrawer-paper': { ...paperSx, width: drawerWidth } }}
          >
            {drawerContent}
          </Drawer>
        )}

        {/* Right panel: content */}
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box
            component="header"
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              px: { xs: 2, md: 3 }, minHeight: 68,
              position: 'sticky', top: 0, zIndex: theme.zIndex.appBar,
              bgcolor: alpha(BRAND.paper, 0.85), backdropFilter: 'blur(8px)',
            }}
          >
            {/* Mobile: hamburger + app title */}
            <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1, minWidth: 0 }}>
              <IconButton aria-label="open menu" onClick={handleDrawerToggle} edge="start">
                <Menu />
              </IconButton>
              <PillotoSymbol size={28} product={app} />
              <Typography variant="subtitle1" fontWeight={700} noWrap>
                {mobileTitle}
              </Typography>
            </Box>
            {/* Desktop: page title */}
            <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', minWidth: 0 }}>
              {title && (
                <Typography variant="h4" component="h1" sx={{ lineHeight: 1.2, color: 'text.primary' }} noWrap>
                  {title}
                </Typography>
              )}
            </Box>
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
              <LanguageSwitcher />
            </Box>
          </Box>
          <Box component="main" sx={{ flexGrow: 1, px: { xs: 2, md: 3 }, pb: 3, pt: 1 }}>
            {children}
          </Box>
        </Box>
      </Box>

      {/* Collapsed-rail flyout for nav groups */}
      <MuiMenu
        anchorEl={flyout?.anchor}
        open={!!flyout}
        onClose={() => setFlyout(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { ml: 1, minWidth: 200 } }}
      >
        {flyout && (
          <ListSubheader sx={{ lineHeight: '32px', fontSize: '0.75rem', fontWeight: 700, color: BRAND.slate }}>
            {flyout.item.text}
          </ListSubheader>
        )}
        {flyout?.item.children?.map((child) => (
          <MuiMenuItem
            key={child.key}
            selected={isActive(child)}
            onClick={() => go(child.path)}
            sx={{ fontSize: '0.875rem', borderRadius: '8px', mx: 0.5 }}
          >
            {child.text}
          </MuiMenuItem>
        ))}
      </MuiMenu>

      {showAppSwitcher && (
        <MuiMenu
          anchorEl={appMenuAnchor}
          open={Boolean(appMenuAnchor)}
          onClose={() => setAppMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          PaperProps={{ sx: { mt: 0.5, minWidth: 236 } }}
        >
          <ListSubheader sx={{ lineHeight: '32px', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9AA1B5' }}>
            {t('nav.switchApp', 'Switch app')}
          </ListSubheader>
          {availableApps.map((code) => (
            <MuiMenuItem
              key={code}
              onClick={() => handleAppSwitch(code)}
              selected={code === app}
              sx={{ borderRadius: '8px', mx: 0.5, gap: 1.5, py: 1 }}
            >
              <PillotoSymbol size={28} product={code} />
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, flexGrow: 1 }}>{appName(code)}</Typography>
              {code === app && <Check fontSize="small" sx={{ color: PRODUCT_COLORS[code] }} />}
            </MuiMenuItem>
          ))}
        </MuiMenu>
      )}

      <MuiMenu
        anchorEl={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        onClose={() => setUserMenuAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{ sx: { ml: 1, minWidth: 200 } }}
      >
        <MuiMenuItem onClick={() => { setUserMenuAnchor(null); go(profilePath); }} sx={{ fontSize: '0.875rem', borderRadius: '8px', mx: 0.5, gap: 1.25 }}>
          <PersonOutline fontSize="small" sx={{ color: BRAND.slate }} />
          {t('auth.profile')}
        </MuiMenuItem>
        <Divider />
        <MuiMenuItem onClick={() => { setUserMenuAnchor(null); handleLogout(); }} sx={{ fontSize: '0.875rem', borderRadius: '8px', mx: 0.5, gap: 1.25, color: 'error.main' }}>
          <Logout fontSize="small" />
          {t('auth.logout')}
        </MuiMenuItem>
      </MuiMenu>
    </>
  );
};

export default AppShell;
