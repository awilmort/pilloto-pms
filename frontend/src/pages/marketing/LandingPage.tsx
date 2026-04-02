import React, { useState } from 'react';
import {
  Box, Typography, Button, Container, Grid, Card, CardContent,
  AppBar, Toolbar, Chip, List, ListItem, ListItemIcon, ListItemText,
  Divider, Link, Stack, IconButton, Drawer, useMediaQuery, useTheme,
  Select, MenuItem,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import MenuIcon from '@mui/icons-material/Menu';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import HotelIcon from '@mui/icons-material/Hotel';
import PillotoLogo from '../../components/marketing/PillotoLogo';
import BarChartIcon from '@mui/icons-material/BarChart';
import GroupIcon from '@mui/icons-material/Group';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import BeachAccessIcon from '@mui/icons-material/BeachAccess';
import CelebrationIcon from '@mui/icons-material/Celebration';
import { PLANS } from '../../config/plans';

// ── Constants ─────────────────────────────────────────────────────────────────
const BRAND = '#1A3C34';
const BRAND_LIGHT = '#E8F0EE';
const ACCENT = '#F4A460';

const PRICING_TIERS = [
  { slug: 'basic',      name: PLANS.basic.name,      price: PLANS.basic.displayPrice,      highlighted: false },
  { slug: 'pro',        name: PLANS.pro.name,        price: PLANS.pro.displayPrice,        highlighted: true  },
  { slug: 'enterprise', name: PLANS.enterprise.name, price: PLANS.enterprise.displayPrice, highlighted: false },
];

const FEATURE_KEYS = [
  { key: 'roomRate',      icon: <HotelIcon fontSize="large" /> },
  { key: 'bookingCal',    icon: <CalendarMonthIcon fontSize="large" /> },
  { key: 'folio',         icon: <ReceiptLongIcon fontSize="large" /> },
  { key: 'guestProfiles', icon: <GroupIcon fontSize="large" /> },
  { key: 'dayPass',       icon: <BeachAccessIcon fontSize="large" /> },
  { key: 'events',        icon: <CelebrationIcon fontSize="large" /> },
  { key: 'reporting',     icon: <BarChartIcon fontSize="large" /> },
  { key: 'roles',         icon: <AdminPanelSettingsIcon fontSize="large" /> },
];

// 'contact' is a page link, not a scroll target
const NAV = ['Features', 'Pricing', 'Contact'];

// ── NavBar ────────────────────────────────────────────────────────────────────
function NavBar() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleNavClick = (label: string) => {
    setDrawerOpen(false);
    if (label === 'Contact') { window.location.href = '/contact'; return; }
    document.getElementById(label.toLowerCase())?.scrollIntoView({ behavior: 'smooth' });
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
                {NAV.map(l => (
                  <Box key={l} py={1.5} borderBottom="1px solid #F3F4F6">
                    <Link component="button" underline="none" fontWeight={600} color="text.primary"
                      onClick={() => handleNavClick(l)}>{t(`marketing.nav.${l.toLowerCase()}`)}</Link>
                  </Box>
                ))}
                <Button fullWidth variant="contained" sx={{ mt: 3, backgroundColor: BRAND }}
                  href="https://login.pilloto.com">{t('marketing.nav.signIn')}</Button>
                <Select
                  size="small"
                  value={i18n.language.startsWith('en') ? 'en' : 'es'}
                  onChange={e => i18n.changeLanguage(e.target.value as string)}
                  fullWidth
                  sx={{ mt: 2, '& .MuiSelect-select': { py: 0.75, fontSize: '0.875rem' } }}
                >
                  <MenuItem value="en">EN</MenuItem>
                  <MenuItem value="es">ES</MenuItem>
                </Select>
              </Box>
            </Drawer>
          </>
        ) : (
          <Stack direction="row" spacing={4} alignItems="center">
            {NAV.map(l => (
              <Link key={l} component="button" underline="none" variant="body2" fontWeight={600} color="text.secondary"
                sx={{ '&:hover': { color: BRAND } }} onClick={() => handleNavClick(l)}>
                {t(`marketing.nav.${l.toLowerCase()}`)}
              </Link>
            ))}
            <Select
              size="small"
              value={i18n.language.startsWith('en') ? 'en' : 'es'}
              onChange={e => i18n.changeLanguage(e.target.value as string)}
              sx={{ minWidth: 64, '& .MuiSelect-select': { py: 0.75, fontSize: '0.875rem' } }}
            >
              <MenuItem value="en">EN</MenuItem>
              <MenuItem value="es">ES</MenuItem>
            </Select>
            <Button variant="outlined" size="small" href="https://login.pilloto.com"
              sx={{ borderColor: BRAND, color: BRAND, '&:hover': { borderColor: BRAND, backgroundColor: BRAND_LIGHT } }}>
              {t('marketing.nav.signIn')}
            </Button>
            <Button variant="contained" size="small"
              sx={{ backgroundColor: BRAND, '&:hover': { backgroundColor: '#14302A' } }}
              onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}>
              {t('marketing.nav.getStarted')}
            </Button>
          </Stack>
        )}
      </Toolbar>
    </AppBar>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function HeroSection() {
  const { t } = useTranslation();
  return (
    <Box id="hero" sx={{ backgroundColor: 'white', pt: { xs: 8, md: 12 }, pb: { xs: 8, md: 14 } }}>
      <Container maxWidth="md" sx={{ textAlign: 'center' }}>
        <Chip label={t('marketing.hero.badge')} size="small"
          sx={{ mb: 4, backgroundColor: BRAND_LIGHT, color: BRAND, fontWeight: 700 }} />
        <Typography variant="h1" sx={{ fontWeight: 900, fontSize: { xs: '2.6rem', md: '4rem' }, lineHeight: 1.1, color: '#0F172A', mb: 3 }}>
          {t('marketing.hero.headline')}{' '}
          <Box component="span" sx={{ color: BRAND }}>{t('marketing.hero.headlineAccent')}</Box>
        </Typography>
        <Typography variant="body1" sx={{ fontSize: '1.15rem', color: '#475569', maxWidth: 600, mx: 'auto', mb: 5, lineHeight: 1.8 }}>
          {t('marketing.hero.body')}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
          <Button variant="contained" size="large"
            sx={{ backgroundColor: BRAND, '&:hover': { backgroundColor: '#14302A' }, px: 4, py: 1.5, fontSize: '1rem' }}
            onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}>
            {t('marketing.hero.ctaPricing')}
          </Button>
          <Button variant="outlined" size="large" href="/contact"
            sx={{ borderColor: '#CBD5E1', color: '#334155', '&:hover': { borderColor: BRAND, color: BRAND }, px: 4, py: 1.5, fontSize: '1rem' }}>
            {t('marketing.hero.ctaDemo')}
          </Button>
        </Stack>
        <Box sx={{ mt: 10, pt: 6, borderTop: '1px solid #F1F5F9' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}
            sx={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>
            {t('marketing.hero.trustedBy')}
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────
function FeaturesSection() {
  const { t } = useTranslation();
  return (
    <Box id="features" sx={{ backgroundColor: '#F8FAFC', py: { xs: 8, md: 14 } }}>
      <Container maxWidth="lg">
        <Box textAlign="center" mb={8}>
          <Typography variant="h2" fontWeight={800} color="#0F172A" mb={2}>{t('marketing.features.heading')}</Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 500, mx: 'auto', fontSize: '1.05rem' }}>
            {t('marketing.features.subheading')}
          </Typography>
        </Box>
        <Grid container spacing={3}>
          {FEATURE_KEYS.map(f => (
            <Grid item xs={12} sm={6} md={3} key={f.key}>
              <Card elevation={0} sx={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 2,
                transition: 'box-shadow 0.2s', '&:hover': { boxShadow: '0 4px 20px rgba(0,0,0,0.08)' } }}>
                <CardContent>
                  <Box sx={{ color: BRAND, mb: 2 }}>{f.icon}</Box>
                  <Typography fontWeight={700} mb={1}>{t(`marketing.features.${f.key}_title`)}</Typography>
                  <Typography variant="body2" color="text.secondary" lineHeight={1.7}>{t(`marketing.features.${f.key}_body`)}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────────────
function PricingSection() {
  const { t } = useTranslation();
  return (
    <Box id="pricing" sx={{ backgroundColor: 'white', py: { xs: 8, md: 14 } }}>
      <Container maxWidth="lg">
        <Box textAlign="center" mb={8}>
          <Typography variant="h2" fontWeight={800} color="#0F172A" mb={2}>{t('marketing.pricing.heading')}</Typography>
          <Typography color="text.secondary" sx={{ fontSize: '1.05rem' }}>{t('marketing.pricing.subheading')}</Typography>
        </Box>
        <Grid container spacing={3} alignItems="stretch">
          {PRICING_TIERS.map(tier => {
            const features = t(`marketing.pricing.${tier.slug}_features`, { returnObjects: true }) as string[];
            return (
              <Grid item xs={12} md={4} key={tier.slug} sx={{ pt: tier.highlighted ? '28px !important' : undefined }}>
                <Card elevation={0} sx={{
                  height: '100%', display: 'flex', flexDirection: 'column',
                  border: tier.highlighted ? `2px solid ${BRAND}` : '1px solid #E5E7EB',
                  borderRadius: 3, position: 'relative', overflow: 'visible',
                  boxShadow: tier.highlighted ? '0 8px 40px rgba(26,60,52,0.12)' : 'none',
                }}>
                  {tier.highlighted && (
                    <Chip label={t('marketing.pricing.mostPopular')} size="small" sx={{
                      position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)',
                      backgroundColor: BRAND, color: 'white', fontWeight: 700,
                    }} />
                  )}
                  <CardContent sx={{ p: 4, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="overline" fontWeight={700} color={BRAND} letterSpacing={1.5}>{tier.name}</Typography>
                    <Box display="flex" alignItems="baseline" gap={0.5} mt={1} mb={1}>
                      <Typography variant="h3" fontWeight={900} color="#0F172A">{tier.price}</Typography>
                      <Typography variant="body2" color="text.secondary">{t('marketing.pricing.perMonth')}</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" mb={3} lineHeight={1.7}>
                      {t(`marketing.pricing.${tier.slug}_desc`)}
                    </Typography>
                    <Divider sx={{ mb: 3 }} />
                    <List disablePadding sx={{ flexGrow: 1, mb: 4 }}>
                      {(Array.isArray(features) ? features : []).map(f => (
                        <ListItem key={f} disablePadding sx={{ py: 0.6 }}>
                          <ListItemIcon sx={{ minWidth: 26 }}>
                            <CheckIcon fontSize="small" sx={{ color: BRAND }} />
                          </ListItemIcon>
                          <ListItemText primary={f} primaryTypographyProps={{ variant: 'body2', color: '#374151' }} />
                        </ListItem>
                      ))}
                    </List>
                    <Button fullWidth variant={tier.highlighted ? 'contained' : 'outlined'} size="large"
                      href={`/contact?plan=${tier.slug}`}
                      sx={tier.highlighted
                        ? { backgroundColor: BRAND, '&:hover': { backgroundColor: '#14302A' } }
                        : { borderColor: '#CBD5E1', color: '#334155', '&:hover': { borderColor: BRAND, color: BRAND } }}>
                      {t('marketing.pricing.ctaContactSales')}
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
        <Typography variant="body2" color="text.secondary" textAlign="center" mt={4}>
          {t('marketing.pricing.trialNotice')}
        </Typography>
      </Container>
    </Box>
  );
}

// ── CTA Banner ────────────────────────────────────────────────────────────────
function ContactSection() {
  const { t } = useTranslation();
  return (
    <Box id="contact" sx={{ backgroundColor: BRAND, py: { xs: 8, md: 12 } }}>
      <Container maxWidth="md" sx={{ textAlign: 'center' }}>
        <Typography variant="h2" color="white" fontWeight={800} mb={2}>
          {t('marketing.cta.heading')}
        </Typography>
        <Typography sx={{ color: 'rgba(255,255,255,0.75)', mb: 5, fontSize: '1.05rem' }}>
          {t('marketing.cta.body')}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
          <Button variant="contained" size="large" href="/contact"
            sx={{ backgroundColor: ACCENT, color: '#1A1A1A', fontWeight: 700, '&:hover': { backgroundColor: '#e0924a' }, px: 4 }}>
            {t('marketing.cta.contactUs')}
          </Button>
          <Button variant="outlined" size="large"
            sx={{ borderColor: 'rgba(255,255,255,0.4)', color: 'white', '&:hover': { borderColor: 'white', backgroundColor: 'rgba(255,255,255,0.08)' }, px: 4 }}
            onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}>
            {t('marketing.cta.viewPlans')}
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer() {
  const { t } = useTranslation();
  return (
    <Box component="footer" sx={{ backgroundColor: '#0F172A', py: 5 }}>
      <Container maxWidth="lg">
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" spacing={2}>
          <PillotoLogo variant="on-dark" iconHeight={28} />
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>
            {t('marketing.footer.copyright', { year: new Date().getFullYear() })}
          </Typography>
          <Link href="mailto:info@pilloto.com" variant="caption"
            sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'white' } }}>
            info@pilloto.com
          </Link>
        </Stack>
      </Container>
    </Box>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
const LandingPage: React.FC = () => (
  <Box>
    <NavBar />
    <HeroSection />
    <FeaturesSection />
    <PricingSection />
    <ContactSection />
    <Footer />
  </Box>
);

export default LandingPage;
