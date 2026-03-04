import React from 'react';
import {
  Box,
  Container,
  Grid,
  Typography,
  Link,
  IconButton,
  Divider,
} from '@mui/material';
import {
  Facebook,
  Twitter,
  Instagram,
  Email,
  Phone,
  LocationOn,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const { t } = useTranslation();

  return (
    <Box
      component="footer"
      sx={{
        bgcolor: 'primary.dark',
        color: 'white',
        pt: 6,
        pb: 3,
        mt: 'auto',
      }}
    >
      <Container maxWidth="lg">
        <Grid container spacing={4}>
          {/* Brand & Description */}
          <Grid item xs={12} md={4}>
            <Typography variant="h5" gutterBottom sx={{ fontWeight: 700 }}>
              Pilloto
            </Typography>
            <Typography variant="body2" sx={{ mb: 2, opacity: 0.9 }}>
              {t('footer.description')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <IconButton
                color="inherit"
                aria-label="Facebook"
                sx={{ '&:hover': { color: 'secondary.main' } }}
              >
                <Facebook />
              </IconButton>
              <IconButton
                color="inherit"
                aria-label="Twitter"
                sx={{ '&:hover': { color: 'secondary.main' } }}
              >
                <Twitter />
              </IconButton>
              <IconButton
                color="inherit"
                aria-label="Instagram"
                sx={{ '&:hover': { color: 'secondary.main' } }}
              >
                <Instagram />
              </IconButton>
            </Box>
          </Grid>

          {/* Quick Links */}
          <Grid item xs={12} sm={6} md={2}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              {t('footer.quickLinks')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Link
                href="/admin"
                color="inherit"
                underline="hover"
                sx={{ opacity: 0.9, '&:hover': { opacity: 1, color: 'secondary.main' } }}
              >
                {t('nav.home')}
              </Link>
              <Link
                href="/rooms"
                color="inherit"
                underline="hover"
                sx={{ opacity: 0.9, '&:hover': { opacity: 1, color: 'secondary.main' } }}
              >
                {t('footer.roomsAndSuites')}
              </Link>

            </Box>
          </Grid>

          {/* Services */}
          <Grid item xs={12} sm={6} md={3}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              {t('footer.ourServices')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {t('footer.services.luxuryAccommodations')}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {t('footer.services.aquaPark')}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {t('footer.services.spaWellness')}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {t('footer.services.fineDining')}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {t('footer.services.conferenceFacilities')}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {t('footer.services.eventPlanning')}
              </Typography>
            </Box>
          </Grid>

          {/* Contact Info */}
          <Grid item xs={12} md={3}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              {t('footer.contactInformation')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LocationOn sx={{ fontSize: 20 }} />
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {t('footer.address')}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Phone sx={{ fontSize: 20 }} />
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {t('footer.phone')}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Email sx={{ fontSize: 20 }} />
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {t('footer.email')}
                </Typography>
              </Box>
            </Box>
          </Grid>
        </Grid>

        <Divider sx={{ my: 4, bgcolor: 'rgba(255, 255, 255, 0.2)' }} />

        {/* Copyright */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {t('footer.copyright', { year: currentYear })}
          </Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Link
              href="/privacy"
              color="inherit"
              underline="hover"
              variant="body2"
              sx={{ opacity: 0.8, '&:hover': { opacity: 1 } }}
            >
              {t('footer.privacyPolicy')}
            </Link>
            <Link
              href="/terms"
              color="inherit"
              underline="hover"
              variant="body2"
              sx={{ opacity: 0.8, '&:hover': { opacity: 1 } }}
            >
              {t('footer.termsOfService')}
            </Link>
          </Box>
        </Box>
      </Container>
    </Box>
  );
};

export default Footer;
