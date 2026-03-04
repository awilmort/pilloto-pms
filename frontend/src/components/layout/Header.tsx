import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Avatar,
  Divider,
} from '@mui/material';
import {
  AccountCircle,
  Dashboard,
  ExitToApp,
  BookOnline,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import LanguageSwitcher from '../common/LanguageSwitcher';
import { useTranslation } from 'react-i18next';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, permissions } = useAuth();
  const { t } = useTranslation();

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    handleUserMenuClose();
    await logout();
    navigate('/login');
  };

  const navigateTo = (path: string) => {
    navigate(path);
    handleUserMenuClose();
  };

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        bgcolor: '#fff',
        color: 'text.primary',
        borderBottom: '1px solid rgba(0,0,0,0.10)',
      }}
    >
      <Toolbar sx={{ justifyContent: 'flex-end', py: 1 }}>

          {/* User Menu */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Language Switcher */}
            <LanguageSwitcher />
            {isAuthenticated ? (
              <>
                <IconButton
                  size="large"
                  aria-label="account of current user"
                  aria-controls="user-menu"
                  aria-haspopup="true"
                  onClick={handleUserMenuOpen}
                  color="inherit"
                >
                  {user?.avatar ? (
                    <Avatar src={user.avatar} alt={user.firstName} sx={{ width: 32, height: 32 }} />
                  ) : (
                    <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main' }}>
                      {user?.firstName?.[0]?.toUpperCase()}
                    </Avatar>
                  )}
                </IconButton>
                <Menu
                  id="user-menu"
                  anchorEl={anchorEl}
                  anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                  }}
                  keepMounted
                  transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                  open={Boolean(anchorEl)}
                  onClose={handleUserMenuClose}
                >
                  <MenuItem onClick={handleUserMenuClose} disabled>
                    <Typography variant="body2" color="text.secondary">
                      {t('auth.welcome', { name: user?.firstName })}
                    </Typography>
                  </MenuItem>
                  <Divider />
                  <MenuItem onClick={() => navigateTo('/profile')}>
                    <AccountCircle sx={{ mr: 1 }} />
                    {t('auth.profile')}
                  </MenuItem>
                  <MenuItem onClick={() => navigateTo('/reservations')}>
                    <BookOnline sx={{ mr: 1 }} />
                    {t('auth.myReservations')}
                  </MenuItem>
                  {(user && (user.role === 'admin' || Array.isArray(permissions))) && (
                    <MenuItem onClick={() => {
                      const perms = permissions || [];
                      if (user.role === 'admin' || perms.includes('admin.dashboard') || perms.includes('admin.access')) {
                        navigateTo('/admin');
                        return;
                      }
                      const permToPath: { key: string; path: string }[] = [
                        { key: 'admin.schedule', path: '/admin/schedule' },
                        { key: 'admin.accommodations', path: '/admin/accommodations' },
                        { key: 'admin.reservations', path: '/admin/reservations' },
                        { key: 'admin.rooms', path: '/admin/rooms' },
                        { key: 'admin.media', path: '/admin/media' },
                        { key: 'admin.users', path: '/admin/users' },
                        { key: 'admin.roles', path: '/admin/roles' },
                        { key: 'admin.eventTypes', path: '/admin/event-types' },
                        { key: 'admin.pricing', path: '/admin/pricing' },
                        { key: 'admin.analytics', path: '/admin/analytics' },
                        { key: 'admin.settings', path: '/admin/settings' },
                      ];
                      const first = permToPath.find(p => perms.includes(p.key));
                      navigateTo(first ? first.path : '/login');
                    }}>
                      <Dashboard sx={{ mr: 1 }} />
                      {t('auth.adminDashboard')}
                    </MenuItem>
                  )}
                  <Divider />
                  <MenuItem onClick={handleLogout}>
                    <ExitToApp sx={{ mr: 1 }} />
                    {t('auth.logout')}
                  </MenuItem>
                </Menu>
              </>
            ) : (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  color="inherit"
                  onClick={() => navigateTo('/login')}
                  sx={{
                    borderRadius: 2,
                    px: 2,
                    py: 1,
                    '&:hover': {
                      backgroundColor: 'rgba(0, 0, 0, 0.06)',
                    },
                  }}
                >
                  {t('auth.login')}
                </Button>
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={() => navigateTo('/register')}
                  sx={{
                    borderRadius: 2,
                    px: 2,
                    py: 1,
                    fontWeight: 600,
                  }}
                >
                  {t('auth.signup')}
                </Button>
              </Box>
            )}

            {/* Mobile Menu */}
          </Box>
        </Toolbar>
    </AppBar>
  );
};

export default Header;
