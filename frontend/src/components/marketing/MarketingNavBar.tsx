import React, { useState } from 'react';
import {
  AppBar, Toolbar, Box, Link, Stack, Button, IconButton, Drawer,
  useMediaQuery, useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import PillotoLogo from './PillotoLogo';
import LanguageSwitcher from '../common/LanguageSwitcher';

const BRAND = '#1A3C34';
const BRAND_LIGHT = '#E8F0EE';

const NAV_ITEMS = [
  { key: 'features', scrollId: 'features' },
  { key: 'pricing', scrollId: 'pricing' },
  { key: 'contact', path: '/contact' },
];

const MarketingNavBar: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isLanding = location.pathname === '/';

  const handleNavClick = (item: typeof NAV_ITEMS[0]) => {
    setDrawerOpen(false);
    if (item.path) {
      navigate(item.path);
      return;
    }
    if (isLanding) {
      document.getElementById(item.scrollId!)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate(`/#${item.scrollId}`);
    }
  };

  return (
    <AppBar position="sticky" elevation={0}
      sx={{ backgroundColor: 'white', borderBottom: '1px solid #E5E7EB' }}>
      <Toolbar sx={{ maxWidth: 1200, mx: 'auto', width: '100%', px: { xs: 2, md: 4 }, minHeight: 64 }}>
        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
          <Link href="/" underline="none"><PillotoLogo iconHeight={34} /></Link>
        </Box>
        {isMobile ? (
          <>
            <IconButton onClick={() => setDrawerOpen(true)} aria-label="Menu"><MenuIcon /></IconButton>
            <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
              <Box sx={{ width: 240, p: 3 }}>
                <IconButton onClick={() => setDrawerOpen(false)} sx={{ mb: 2 }}><CloseIcon /></IconButton>
                {NAV_ITEMS.map(item => (
                  <Box key={item.key} py={1.5} borderBottom="1px solid #F3F4F6">
                    <Link component="button" underline="none" fontWeight={600} color="text.primary"
                      onClick={() => handleNavClick(item)}>
                      {t(`marketing.nav.${item.key}`)}
                    </Link>
                  </Box>
                ))}
                <Button fullWidth variant="contained" sx={{ mt: 3, backgroundColor: BRAND }}
                  href="https://login.pilloto.com">{t('marketing.nav.signIn')}</Button>
                <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                  <LanguageSwitcher />
                </Box>
              </Box>
            </Drawer>
          </>
        ) : (
          <Stack direction="row" spacing={4} alignItems="center">
            {NAV_ITEMS.map(item => (
              <Link key={item.key} component="button" underline="none" variant="body2"
                fontWeight={600} color="text.secondary"
                sx={{ '&:hover': { color: BRAND } }}
                onClick={() => handleNavClick(item)}>
                {t(`marketing.nav.${item.key}`)}
              </Link>
            ))}
            <LanguageSwitcher />
            <Button variant="outlined" size="small" href="https://login.pilloto.com"
              sx={{ borderColor: BRAND, color: BRAND, '&:hover': { borderColor: BRAND, backgroundColor: BRAND_LIGHT } }}>
              {t('marketing.nav.signIn')}
            </Button>
            <Button variant="contained" size="small"
              sx={{ backgroundColor: BRAND, '&:hover': { backgroundColor: '#14302A' } }}
              onClick={() => {
                if (isLanding) {
                  document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
                } else {
                  navigate('/#pricing');
                }
              }}>
              {t('marketing.nav.getStarted')}
            </Button>
          </Stack>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default MarketingNavBar;
