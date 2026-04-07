import React from 'react';
import {
  Box, Container, Grid, Typography, Link, Stack, Divider,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import PillotoLogo from './PillotoLogo';

const LEGAL_LINKS = [
  { key: 'legalCenter', path: '/legal' },
  { key: 'privacy', path: '/privacy' },
  { key: 'terms', path: '/terms' },
  { key: 'cookies', path: '/cookies' },
  { key: 'acceptableUse', path: '/acceptable-use' },
  { key: 'security', path: '/security' },
  { key: 'accessibility', path: '/accessibility' },
];

const MarketingFooter: React.FC = () => {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <Box component="footer" sx={{ backgroundColor: '#0F172A', pt: 6, pb: 4 }}>
      <Container maxWidth="lg">
        <Grid container spacing={4}>
          {/* Brand */}
          <Grid item xs={12} sm={6} md={3}>
            <PillotoLogo variant="on-dark" iconHeight={28} />
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mt: 2, lineHeight: 1.7 }}>
              {t('legal.footer.tagline')}
            </Typography>
          </Grid>

          {/* Product */}
          <Grid item xs={6} sm={3} md={2}>
            <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, fontWeight: 700 }}>
              {t('legal.footer.product')}
            </Typography>
            <Stack spacing={1} mt={1.5}>
              <Link href="/#features" color="inherit" underline="hover" variant="body2"
                sx={{ color: 'rgba(255,255,255,0.55)', '&:hover': { color: 'white' } }}>
                {t('marketing.nav.features')}
              </Link>
              <Link href="/#pricing" color="inherit" underline="hover" variant="body2"
                sx={{ color: 'rgba(255,255,255,0.55)', '&:hover': { color: 'white' } }}>
                {t('marketing.nav.pricing')}
              </Link>
              <Link href="/contact" color="inherit" underline="hover" variant="body2"
                sx={{ color: 'rgba(255,255,255,0.55)', '&:hover': { color: 'white' } }}>
                {t('marketing.nav.contact')}
              </Link>
            </Stack>
          </Grid>

          {/* Legal */}
          <Grid item xs={6} sm={3} md={2}>
            <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, fontWeight: 700 }}>
              {t('legal.footer.legal')}
            </Typography>
            <Stack spacing={1} mt={1.5}>
              {LEGAL_LINKS.map(link => (
                <Link key={link.key} href={link.path} color="inherit" underline="hover" variant="body2"
                  sx={{ color: 'rgba(255,255,255,0.55)', '&:hover': { color: 'white' } }}>
                  {t(`legal.nav.${link.key}`)}
                </Link>
              ))}
            </Stack>
          </Grid>

          {/* Company */}
          <Grid item xs={12} sm={6} md={3}>
            <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, fontWeight: 700 }}>
              {t('legal.footer.company')}
            </Typography>
            <Stack spacing={1} mt={1.5}>
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.55)' }}>
                {t('legal.footer.entity')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.55)' }}>
                {t('footer.address')}
              </Typography>
              <Link href="mailto:info@pilloto.com" color="inherit" underline="hover" variant="body2"
                sx={{ color: 'rgba(255,255,255,0.55)', '&:hover': { color: 'white' } }}>
                info@pilloto.com
              </Link>
              <Link href="tel:+18299679441" color="inherit" underline="hover" variant="body2"
                sx={{ color: 'rgba(255,255,255,0.55)', '&:hover': { color: 'white' } }}>
                +1 (829) 967-9441
              </Link>
            </Stack>
          </Grid>
        </Grid>

        <Divider sx={{ my: 4, borderColor: 'rgba(255,255,255,0.1)' }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>
            {t('marketing.footer.copyright', { year })}
          </Typography>
          <Stack direction="row" spacing={3}>
            <Link href="/privacy" variant="caption" underline="hover"
              sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'white' } }}>
              {t('legal.nav.privacy')}
            </Link>
            <Link href="/terms" variant="caption" underline="hover"
              sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'white' } }}>
              {t('legal.nav.terms')}
            </Link>
            <Link href="/cookies" variant="caption" underline="hover"
              sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'white' } }}>
              {t('legal.nav.cookies')}
            </Link>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
};

export default MarketingFooter;
