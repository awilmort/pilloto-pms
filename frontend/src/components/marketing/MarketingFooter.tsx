import React from 'react';
import {
  Box, Container, Grid, Typography, Link, Stack, Divider,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import PillotoLogo from '../brand/PillotoLogo';
import { BRAND, PRODUCT_COLORS } from '../../brand';

const LEGAL_LINKS = [
  { key: 'legalCenter', path: '/legal' },
  { key: 'privacy', path: '/privacy' },
  { key: 'terms', path: '/terms' },
  { key: 'cookies', path: '/cookies' },
  { key: 'acceptableUse', path: '/acceptable-use' },
  { key: 'security', path: '/security' },
  { key: 'accessibility', path: '/accessibility' },
];

const muted = 'rgba(255,255,255,0.62)';
const faint = 'rgba(255,255,255,0.4)';
const linkSx = { color: muted, '&:hover': { color: 'white' } };

const ColumnTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="overline" sx={{ color: faint, display: 'block' }}>
    {children}
  </Typography>
);

const MarketingFooter: React.FC = () => {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <Box component="footer" sx={{ backgroundColor: BRAND.ink, pt: { xs: 7, md: 9 }, pb: 4 }}>
      <Container maxWidth="lg">
        <Grid container spacing={5}>
          {/* Brand */}
          <Grid item xs={12} md={4}>
            <PillotoLogo height={30} tone="reversed" />
            <Typography variant="body2" sx={{ color: muted, mt: 2.5, lineHeight: 1.7, maxWidth: 300 }}>
              {t('legal.footer.tagline')}
            </Typography>
          </Grid>

          {/* Products */}
          <Grid item xs={6} sm={3} md={2}>
            <ColumnTitle>{t('legal.footer.products')}</ColumnTitle>
            <Stack spacing={1.25} mt={1.5}>
              {(['pms', 'accounting'] as const).map(code => (
                <Link key={code} href="/#products" underline="none" variant="body2"
                  sx={{ ...linkSx, display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: PRODUCT_COLORS[code] }} />
                  {t(`brand.appName.${code}`)}
                </Link>
              ))}
              <Link href="/#features" underline="none" variant="body2" sx={linkSx}>{t('marketing.nav.features')}</Link>
              <Link href="/#pricing" underline="none" variant="body2" sx={linkSx}>{t('marketing.nav.pricing')}</Link>
              <Link href="/#faq" underline="none" variant="body2" sx={linkSx}>{t('marketing.nav.faq')}</Link>
            </Stack>
          </Grid>

          {/* Legal */}
          <Grid item xs={6} sm={3} md={2}>
            <ColumnTitle>{t('legal.footer.legal')}</ColumnTitle>
            <Stack spacing={1.25} mt={1.5}>
              {LEGAL_LINKS.map(link => (
                <Link key={link.key} href={link.path} underline="none" variant="body2" sx={linkSx}>
                  {t(`legal.nav.${link.key}`)}
                </Link>
              ))}
            </Stack>
          </Grid>

          {/* Company */}
          <Grid item xs={12} sm={6} md={4}>
            <ColumnTitle>{t('legal.footer.company')}</ColumnTitle>
            <Stack spacing={1.25} mt={1.5}>
              <Typography variant="body2" sx={{ color: muted }}>{t('legal.footer.entity')}</Typography>
              <Typography variant="body2" sx={{ color: muted }}>{t('footer.address')}</Typography>
              <Link href="mailto:info@pilloto.com" underline="none" variant="body2" sx={linkSx}>info@pilloto.com</Link>
              <Link href="tel:+18299679441" underline="none" variant="body2" sx={linkSx}>+1 (829) 967-9441</Link>
              <Link href="/contact" underline="none" variant="body2" sx={{ ...linkSx, color: BRAND.vermilionOnDark, fontWeight: 600 }}>
                {t('marketing.nav.getStarted')} →
              </Link>
            </Stack>
          </Grid>
        </Grid>

        <Divider sx={{ my: 5, borderColor: 'rgba(255,255,255,0.1)' }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" spacing={1.5}>
          <Typography variant="caption" sx={{ color: faint }}>
            {t('marketing.footer.copyright', { year })}
          </Typography>
          <Stack direction="row" spacing={3}>
            {['privacy', 'terms', 'cookies'].map(key => (
              <Link key={key} href={`/${key}`} variant="caption" underline="none" sx={{ color: faint, '&:hover': { color: 'white' } }}>
                {t(`legal.nav.${key}`)}
              </Link>
            ))}
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
};

export default MarketingFooter;
