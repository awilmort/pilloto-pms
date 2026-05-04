import React from 'react';
import {
  Box, AppBar, Toolbar, Typography, Container,
  IconButton, Menu, MenuItem, Avatar, Divider, Tooltip,
} from '@mui/material';
import {
  AccountCircle,
  Business,
  SyncAlt,
  ExitToApp,
  Person,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface PlatformLayoutProps {
  children: React.ReactNode;
}

const PlatformLayout: React.FC<PlatformLayoutProps> = ({ children }) => {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const navigateTo = (path: string) => {
    handleMenuClose();
    navigate(path);
  };

  const handleLogout = async () => {
    handleMenuClose();
    await logout();
    navigate('/login');
  };

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '';

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <AppBar position="static" elevation={1} sx={{ bgcolor: '#1A2535' }}>
        <Toolbar>
          {/* Brand */}
          <Box
            onClick={() => navigate('/platform/tenants')}
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mr: 'auto', gap: 1.25 }}
          >
            <svg width="24" height="32" viewBox="0 0 52 70" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="4" y="2" width="44" height="66" rx="3" fill="rgba(255,255,255,0.06)" stroke="#888888" strokeWidth="1.5" />
              <rect x="10" y="11" width="12" height="10" rx="1.5" fill="#CCCCCC" />
              <rect x="30" y="11" width="12" height="10" rx="1.5" fill="#CCCCCC" />
              <rect x="10" y="27" width="12" height="10" rx="1.5" fill="#555555" />
              <rect x="30" y="27" width="12" height="10" rx="1.5" fill="#CCCCCC" />
              <rect x="10" y="43" width="12" height="10" rx="1.5" fill="#CCCCCC" />
            </svg>
            <Typography
              sx={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontWeight: 700,
                fontSize: 22,
                color: '#F0F0F0',
                letterSpacing: '-0.5px',
                lineHeight: 1,
              }}
            >
              Pilloto
            </Typography>
            <Typography
              sx={{
                fontSize: 11,
                fontWeight: 600,
                color: '#94A3B8',
                textTransform: 'uppercase',
                letterSpacing: 1.5,
                ml: 0.5,
                mt: 0.25,
              }}
            >
              Platform
            </Typography>
          </Box>

          {/* User icon + dropdown */}
          <Tooltip title="Account">
            <IconButton
              size="large"
              aria-label="account menu"
              aria-controls="platform-user-menu"
              aria-haspopup="true"
              onClick={handleMenuOpen}
              color="inherit"
            >
              {initials ? (
                <Avatar sx={{ width: 32, height: 32, bgcolor: '#2563EB', fontSize: 13, fontWeight: 700 }}>
                  {initials}
                </Avatar>
              ) : (
                <AccountCircle />
              )}
            </IconButton>
          </Tooltip>

          <Menu
            id="platform-user-menu"
            anchorEl={anchorEl}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            keepMounted
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
            slotProps={{ paper: { sx: { minWidth: 200, mt: 0.5 } } }}
          >
            {/* Identity header */}
            <MenuItem disabled sx={{ opacity: 1 }}>
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  {user?.firstName} {user?.lastName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Super Admin
                </Typography>
              </Box>
            </MenuItem>

            <Divider />

            <MenuItem onClick={() => navigateTo('/platform/tenants')}>
              <Business sx={{ mr: 1.5, fontSize: 20, color: 'text.secondary' }} />
              Tenants
            </MenuItem>

            <MenuItem onClick={() => navigateTo('/platform/ota')}>
              <SyncAlt sx={{ mr: 1.5, fontSize: 20, color: 'text.secondary' }} />
              OTA Sync
            </MenuItem>

            <MenuItem onClick={() => navigateTo('/platform/profile')}>
              <Person sx={{ mr: 1.5, fontSize: 20, color: 'text.secondary' }} />
              Profile
            </MenuItem>

            <Divider />

            <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
              <ExitToApp sx={{ mr: 1.5, fontSize: 20 }} />
              Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {children}
      </Container>
    </Box>
  );
};

export default PlatformLayout;
