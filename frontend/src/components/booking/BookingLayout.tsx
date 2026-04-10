/**
 * BookingLayout — shared layout for all public booking pages.
 *
 * Airbnb-inspired design: clean, minimalist, warm.
 * White header, light-gray muted footer.
 */

import React from 'react';
import {
  Box, Container, Typography, Link, Stack, AppBar, Toolbar,
  useTheme, useMediaQuery, Divider, IconButton, Menu, MenuItem,
} from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import { useTranslation } from 'react-i18next';
import { useBooking } from '../../contexts/BookingContext';
import { resolveMediaUrl } from '../../services/api';

const FONT = '"Inter", "Plus Jakarta Sans", "Helvetica", sans-serif';
const TEXT_PRIMARY = '#222222';
const TEXT_SECONDARY = '#717171';
const BORDER = '#EBEBEB';
const FOOTER_BG = '#F7F7F7';

interface BookingLayoutProps {
  children: React.ReactNode;
}

const BookingLayout: React.FC<BookingLayoutProps> = ({ children }) => {
  const { config } = useBooking();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [langAnchor, setLangAnchor] = React.useState<null | HTMLElement>(null);
  const langOpen = Boolean(langAnchor);

  const handleLangChange = (lang: string) => {
    i18n.changeLanguage(lang);
    setLangAnchor(null);
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#FFFFFF' }}>
      {/* ── Header ── Sticky white bar */}
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: 'white',
          borderBottom: `1px solid ${BORDER}`,
          transition: 'box-shadow 0.2s ease-out',
          '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
        }}
      >
        <Toolbar
          sx={{
            maxWidth: 1200,
            mx: 'auto',
            width: '100%',
            px: { xs: 2, md: 4 },
            minHeight: { xs: 56, sm: 64 },
          }}
        >
          {/* Left: Logo + tenant name */}
          <Link
            href="/booking"
            underline="none"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              transition: 'opacity 0.2s ease-out',
              '&:hover': { opacity: 0.8 },
            }}
          >
            {config?.logoUrl && (
              <Box
                component="img"
                src={resolveMediaUrl(config.logoUrl)}
                alt={config.tenantName}
                sx={{ height: 36, maxWidth: 110, objectFit: 'contain' }}
              />
            )}
            <Typography
              variant="h6"
              sx={{
                color: TEXT_PRIMARY,
                fontWeight: 700,
                fontSize: { xs: '1rem', sm: '1.15rem' },
                fontFamily: FONT,
              }}
            >
              {config?.tenantName || t('bookingEngine.layout.booking')}
            </Typography>
          </Link>

          <Box sx={{ flexGrow: 1 }} />

          {/* Right: Phone + Language selector */}
          <Stack direction="row" alignItems="center" spacing={1}>
            {config?.contactPhone && !isMobile && (
              <Typography
                variant="body2"
                sx={{ color: TEXT_SECONDARY, fontFamily: FONT, fontSize: '0.875rem' }}
              >
                {config.contactPhone}
              </Typography>
            )}

            <IconButton
              size="small"
              onClick={e => setLangAnchor(e.currentTarget)}
              sx={{
                color: TEXT_PRIMARY,
                border: `1px solid ${BORDER}`,
                borderRadius: '9999px',
                px: 1.5,
                py: 0.5,
                transition: 'all 0.2s ease-out',
                '&:hover': { bgcolor: '#F7F7F7', borderColor: TEXT_PRIMARY },
              }}
            >
              <LanguageIcon sx={{ fontSize: 18, mr: 0.5 }} />
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase' }}>
                {i18n.language?.substring(0, 2) || 'es'}
              </Typography>
            </IconButton>
            <Menu
              anchorEl={langAnchor}
              open={langOpen}
              onClose={() => setLangAnchor(null)}
              PaperProps={{
                sx: {
                  borderRadius: '12px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  mt: 1,
                  minWidth: 140,
                },
              }}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <MenuItem
                onClick={() => handleLangChange('es')}
                selected={i18n.language === 'es'}
                sx={{ fontFamily: FONT, fontSize: '0.9rem', borderRadius: '8px', mx: 0.5 }}
              >
                {t('common.spanish')}
              </MenuItem>
              <MenuItem
                onClick={() => handleLangChange('en')}
                selected={i18n.language === 'en'}
                sx={{ fontFamily: FONT, fontSize: '0.9rem', borderRadius: '8px', mx: 0.5 }}
              >
                {t('common.english')}
              </MenuItem>
            </Menu>
          </Stack>
        </Toolbar>
      </AppBar>

      {/* ── Main content ── */}
      <Box component="main" sx={{ flex: 1 }}>
        {children}
      </Box>

      {/* ── Footer ── Light gray, muted, never distracting */}
      <Box
        component="footer"
        sx={{ bgcolor: FOOTER_BG, borderTop: `1px solid ${BORDER}`, py: { xs: 3, md: 4 }, mt: 'auto' }}
      >
        <Container maxWidth="lg">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'center', sm: 'flex-start' }}
            spacing={2}
          >
            {/* Contact info */}
            <Box>
              <Typography variant="body2" fontWeight={600} sx={{ fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}>
                {config?.tenantName}
              </Typography>
              {config?.contactAddress && (
                <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, display: 'block' }}>
                  {config.contactAddress}
                </Typography>
              )}
              {config?.contactEmail && (
                <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, display: 'block' }}>
                  {config.contactEmail}
                </Typography>
              )}
              {config?.contactPhone && (
                <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, display: 'block' }}>
                  {config.contactPhone}
                </Typography>
              )}
            </Box>

            {/* Legal links */}
            <Stack direction="row" spacing={3} alignItems="center">
              <Link
                href="/booking/privacy"
                underline="hover"
                sx={{ color: TEXT_SECONDARY, fontSize: '0.8rem', fontFamily: FONT, '&:hover': { color: TEXT_PRIMARY } }}
              >
                {t('bookingEngine.layout.privacyPolicy')}
              </Link>
              <Link
                href="/booking/terms"
                underline="hover"
                sx={{ color: TEXT_SECONDARY, fontSize: '0.8rem', fontFamily: FONT, '&:hover': { color: TEXT_PRIMARY } }}
              >
                {t('bookingEngine.layout.termsOfService')}
              </Link>
            </Stack>
          </Stack>

          <Divider sx={{ borderColor: BORDER, my: 2 }} />

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems="center"
            spacing={1}
          >
            <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>
              © {new Date().getFullYear()} {config?.tenantName}. {t('bookingEngine.layout.allRightsReserved')}
            </Typography>
            <Typography variant="caption" sx={{ color: '#B0B0B0', fontFamily: FONT }}>
              {t('bookingEngine.layout.poweredBy')}{' '}
              <Link
                href="https://pilloto.com"
                target="_blank"
                rel="noopener"
                sx={{ color: '#B0B0B0', '&:hover': { color: TEXT_PRIMARY } }}
              >
                Pilloto
              </Link>
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
};

export default BookingLayout;
