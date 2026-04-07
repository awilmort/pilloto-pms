import React from 'react';
import {
  Box, Container, Typography, Grid, Card, CardActionArea, CardContent, Chip,
} from '@mui/material';
import ShieldIcon from '@mui/icons-material/Shield';
import GavelIcon from '@mui/icons-material/Gavel';
import CookieIcon from '@mui/icons-material/Cookie';
import BlockIcon from '@mui/icons-material/Block';
import SecurityIcon from '@mui/icons-material/Security';
import AccessibilityNewIcon from '@mui/icons-material/AccessibilityNew';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import MarketingLayout from '../../components/marketing/MarketingLayout';
import PageMeta from '../../components/marketing/PageMeta';

const BRAND = '#1A3C34';

const PAGES = [
  { key: 'privacy', icon: <ShieldIcon />, path: '/privacy' },
  { key: 'terms', icon: <GavelIcon />, path: '/terms' },
  { key: 'cookies', icon: <CookieIcon />, path: '/cookies' },
  { key: 'acceptableUse', icon: <BlockIcon />, path: '/acceptable-use' },
  { key: 'security', icon: <SecurityIcon />, path: '/security' },
  { key: 'accessibility', icon: <AccessibilityNewIcon />, path: '/accessibility' },
];

const LegalCenterPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  return (
    <MarketingLayout>
      <PageMeta
        title={t('legal.center.metaTitle')}
        description={t('legal.center.metaDescription')}
        path="/legal"
        locale={i18n.language.startsWith('en') ? 'en' : 'es'}
      />

      {/* Header */}
      <Box sx={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E5E7EB', py: { xs: 6, md: 10 } }}>
        <Container maxWidth="md" sx={{ textAlign: 'center' }}>
          <Typography variant="h2" fontWeight={800} color="#0F172A" mb={2}>
            {t('legal.center.heading')}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ fontSize: '1.1rem', lineHeight: 1.8 }}>
            {t('legal.center.subheading')}
          </Typography>
        </Container>
      </Box>

      {/* Cards */}
      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 10 } }}>
        <Grid container spacing={3}>
          {PAGES.map(page => (
            <Grid item xs={12} sm={6} md={4} key={page.key}>
              <Card
                elevation={0}
                sx={{
                  height: '100%',
                  border: '1px solid #E5E7EB',
                  borderRadius: 2,
                  transition: 'box-shadow 0.2s, border-color 0.2s',
                  '&:hover': { boxShadow: '0 4px 20px rgba(0,0,0,0.08)', borderColor: BRAND },
                }}
              >
                <CardActionArea onClick={() => navigate(page.path)} sx={{ height: '100%' }}>
                  <CardContent sx={{ p: 4 }}>
                    <Box sx={{ color: BRAND, mb: 2 }}>{page.icon}</Box>
                    <Typography variant="h6" fontWeight={700} gutterBottom>
                      {t(`legal.nav.${page.key}`)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" lineHeight={1.7}>
                      {t(`legal.center.${page.key}Desc`)}
                    </Typography>
                    <Chip
                      size="small"
                      label={t('legal.center.viewPolicy')}
                      sx={{ mt: 2, backgroundColor: '#F1F5F9', color: BRAND, fontWeight: 600 }}
                    />
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </MarketingLayout>
  );
};

export default LegalCenterPage;
