import React, { useEffect, useState } from 'react';
import {
  AppBar, Toolbar, Box, Link, Stack, Button, IconButton, Drawer, Divider,
  useMediaQuery, useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import PillotoLogo from '../brand/PillotoLogo';
import LanguageSwitcher from '../common/LanguageSwitcher';
import { BRAND, alpha } from '../../brand';

const NAV_ITEMS = [
  { key: 'product', scrollId: 'products' },
  { key: 'features', scrollId: 'features' },
  { key: 'pricing', scrollId: 'pricing' },
  { key: 'faq', scrollId: 'faq' },
  { key: 'contact', path: '/contact' },
];

const SIGN_IN_URL = 'https://login.pilloto.com';

const MarketingNavBar: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isLanding = location.pathname === '/';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        backgroundColor: alpha(BRAND.white, scrolled ? 0.9 : 1),
        backdropFilter: 'saturate(180%) blur(12px)',
        borderBottom: `1px solid ${scrolled ? BRAND.mist : 'transparent'}`,
        transition: 'border-color .2s, background-color .2s',
        color: BRAND.ink,
      }}
    >
      <Toolbar sx={{ maxWidth: 1200, mx: 'auto', width: '100%', px: { xs: 2, md: 4 }, minHeight: { xs: 64, md: 72 } }}>
        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
          <Link href="/" underline="none" aria-label="Pilloto">
            <PillotoLogo height={isMobile ? 24 : 28} />
          </Link>
        </Box>
        {isMobile ? (
          <>
            <IconButton onClick={() => setDrawerOpen(true)} aria-label="Menu" sx={{ color: BRAND.ink }}><MenuIcon /></IconButton>
            <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
              <Box sx={{ width: 280, p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                  <PillotoLogo height={22} />
                  <IconButton onClick={() => setDrawerOpen(false)} aria-label="Close"><CloseIcon /></IconButton>
                </Box>
                {NAV_ITEMS.map(item => (
                  <Box key={item.key} py={1.5} borderBottom={`1px solid ${BRAND.mist}`}>
                    <Link component="button" underline="none" fontWeight={600} color="text.primary" fontSize="1rem"
                      onClick={() => handleNavClick(item)}>
                      {t(`marketing.nav.${item.key}`)}
                    </Link>
                  </Box>
                ))}
                <Box sx={{ flexGrow: 1 }} />
                <Button fullWidth variant="contained" color="secondary" size="large" sx={{ mt: 3 }}
                  onClick={() => { setDrawerOpen(false); navigate('/contact'); }}>
                  {t('marketing.nav.getStarted')}
                </Button>
                <Button fullWidth variant="outlined" size="large" sx={{ mt: 1.5, color: BRAND.ink }} href={SIGN_IN_URL}>
                  {t('marketing.nav.signIn')}
                </Button>
                <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                  <LanguageSwitcher />
                </Box>
              </Box>
            </Drawer>
          </>
        ) : (
          <Stack direction="row" spacing={3.5} alignItems="center">
            {NAV_ITEMS.map(item => (
              <Link key={item.key} component="button" underline="none" variant="body2"
                fontWeight={500} sx={{ color: BRAND.slate, '&:hover': { color: BRAND.ink } }}
                onClick={() => handleNavClick(item)}>
                {t(`marketing.nav.${item.key}`)}
              </Link>
            ))}
            <Divider orientation="vertical" flexItem sx={{ my: 2.5 }} />
            <LanguageSwitcher />
            <Link href={SIGN_IN_URL} underline="none" variant="body2" fontWeight={600}
              sx={{ color: BRAND.ink, '&:hover': { color: BRAND.vermilionText } }}>
              {t('marketing.nav.signIn')}
            </Link>
            <Button variant="contained" color="primary" size="small" sx={{ px: 2.25, py: 1 }}
              onClick={() => navigate('/contact')}>
              {t('marketing.nav.getStarted')}
            </Button>
          </Stack>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default MarketingNavBar;
