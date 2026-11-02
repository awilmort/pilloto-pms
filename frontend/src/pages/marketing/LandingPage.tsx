import React, { useEffect } from 'react';
import {
  Box, Typography, Button, Container, Grid, Card, CardContent, Chip,
  List, ListItem, ListItemIcon, ListItemText, Divider, Stack,
  Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import CheckIcon from '@mui/icons-material/Check';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonthOutlined';
import HotelIcon from '@mui/icons-material/HotelOutlined';
import BarChartIcon from '@mui/icons-material/BarChartOutlined';
import GroupIcon from '@mui/icons-material/GroupOutlined';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLongOutlined';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import BeachAccessIcon from '@mui/icons-material/BeachAccessOutlined';
import CelebrationIcon from '@mui/icons-material/CelebrationOutlined';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import HubIcon from '@mui/icons-material/HubOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import CloudDoneIcon from '@mui/icons-material/CloudDoneOutlined';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import MarketingLayout from '../../components/marketing/MarketingLayout';
import PageMeta from '../../components/marketing/PageMeta';
import PillotoLogo from '../../components/brand/PillotoLogo';
import { PLANS } from '../../config/plans';
import { BRAND, PRODUCT_COLORS, alpha } from '../../brand';

const PMS = PRODUCT_COLORS.pms;
const ACC = PRODUCT_COLORS.accounting;

const PRICING_TIERS = [
  { slug: 'basic',      name: PLANS.basic.name,      price: PLANS.basic.displayPrice,      highlighted: false },
  { slug: 'pro',        name: PLANS.pro.name,        price: PLANS.pro.displayPrice,        highlighted: true  },
  { slug: 'enterprise', name: PLANS.enterprise.name, price: PLANS.enterprise.displayPrice, highlighted: false },
];

const FEATURE_KEYS = [
  { key: 'roomRate',      icon: <HotelIcon /> },
  { key: 'bookingCal',    icon: <CalendarMonthIcon /> },
  { key: 'folio',         icon: <ReceiptLongIcon /> },
  { key: 'guestProfiles', icon: <GroupIcon /> },
  { key: 'dayPass',       icon: <BeachAccessIcon /> },
  { key: 'events',        icon: <CelebrationIcon /> },
  { key: 'reporting',     icon: <BarChartIcon /> },
  { key: 'roles',         icon: <AdminPanelSettingsIcon /> },
];

const PILLARS = [
  { key: 'ecf',       icon: <VerifiedIcon /> },
  { key: 'channels',  icon: <HubIcon /> },
  { key: 'bilingual', icon: <TranslateIcon /> },
  { key: 'cloud',     icon: <CloudDoneIcon /> },
];

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
const asList = (v: unknown): string[] => (Array.isArray(v) ? v : []);

// ── Shared bits ───────────────────────────────────────────────────────────────
const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = BRAND.vermilionText }) => (
  <Typography variant="overline" sx={{ color, display: 'block', mb: 1.5, fontSize: '0.75rem' }}>
    {children}
  </Typography>
);

const SectionHeader: React.FC<{ eyebrow: string; heading: string; sub?: string; light?: boolean }> = ({ eyebrow, heading, sub, light }) => (
  <Box textAlign="center" mb={{ xs: 6, md: 8 }} sx={{ maxWidth: 720, mx: 'auto' }}>
    <Eyebrow color={light ? BRAND.vermilionOnDark : undefined}>{eyebrow}</Eyebrow>
    <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.75rem' }, color: light ? 'white' : BRAND.ink, mb: sub ? 2 : 0 }}>
      {heading}
    </Typography>
    {sub && (
      <Typography sx={{ color: light ? 'rgba(255,255,255,0.7)' : BRAND.slate, fontSize: '1.0625rem', lineHeight: 1.7 }}>
        {sub}
      </Typography>
    )}
  </Box>
);

const CheckList: React.FC<{ items: string[]; color: string; dense?: boolean }> = ({ items, color, dense }) => (
  <List disablePadding>
    {items.map(f => (
      <ListItem key={f} disablePadding sx={{ py: dense ? 0.5 : 0.75, alignItems: 'flex-start' }}>
        <ListItemIcon sx={{ minWidth: 28, mt: '3px' }}>
          <CheckIcon sx={{ fontSize: 18, color }} />
        </ListItemIcon>
        <ListItemText primary={f} primaryTypographyProps={{ variant: 'body2', color: BRAND.ink, fontWeight: 500 }} />
      </ListItem>
    ))}
  </List>
);

/** Browser-window frame used by the product illustrations. */
const WindowFrame: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <Box sx={{
    borderRadius: 3, bgcolor: 'white', border: `1px solid ${BRAND.mist}`, overflow: 'hidden',
    boxShadow: `0 1px 2px ${alpha(BRAND.ink, 0.06)}, 0 24px 60px -12px ${alpha(BRAND.ink, 0.22)}`,
  }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 1.25, borderBottom: `1px solid ${BRAND.mist}`, bgcolor: '#FAFBFC' }}>
      {['#FF5F57', '#FEBC2E', '#28C840'].map(c => <Box key={c} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c }} />)}
      {title && <Typography sx={{ ml: 1.5, fontSize: '0.75rem', fontWeight: 600, color: BRAND.slate }}>{title}</Typography>}
    </Box>
    {children}
  </Box>
);

// ── Illustrations (pure UI mock-ups, no real data) ───────────────────────────
const CAL_ROWS: { room: string; bars: { start: number; len: number; color: string; label: string }[] }[] = [
  { room: '101', bars: [{ start: 0, len: 3, color: PMS, label: 'M. Rodríguez' }, { start: 4, len: 3, color: BRAND.vermilion, label: 'Booking.com' }] },
  { room: '102', bars: [{ start: 1, len: 4, color: ACC, label: 'Familia Pérez' }] },
  { room: '103', bars: [{ start: 0, len: 2, color: PRODUCT_COLORS.pos, label: 'Expedia' }, { start: 3, len: 4, color: PMS, label: 'J. Smith' }] },
  { room: '201', bars: [{ start: 2, len: 5, color: PRODUCT_COLORS.rrhh, label: 'Airbnb' }] },
  { room: '202', bars: [{ start: 0, len: 4, color: PMS, label: 'A. Martínez' }] },
  { room: '203', bars: [{ start: 1, len: 2, color: BRAND.vermilion, label: 'Direct' }, { start: 4, len: 2, color: ACC, label: 'Corp. Caribe' }] },
];
const DAYS = 7;

const CalendarMock: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
    <Box sx={{ display: 'grid', gridTemplateColumns: `44px repeat(${DAYS}, 1fr)`, gap: 0, fontSize: '0.6875rem', color: BRAND.slate }}>
      <Box />
      {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
        <Box key={i} sx={{ textAlign: 'center', fontWeight: 700, pb: 1, color: i === 5 || i === 6 ? BRAND.vermilionText : BRAND.slate }}>{d} {12 + i}</Box>
      ))}
    </Box>
    {CAL_ROWS.slice(0, compact ? 4 : 6).map(row => (
      <Box key={row.room} sx={{ display: 'grid', gridTemplateColumns: `44px repeat(${DAYS}, 1fr)`, alignItems: 'center', borderTop: `1px solid ${BRAND.mist}`, height: 36, position: 'relative' }}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: BRAND.ink }}>{row.room}</Typography>
        <Box sx={{ gridColumn: `2 / span ${DAYS}`, position: 'relative', height: '100%' }}>
          {row.bars.map(b => (
            <Box key={b.label} sx={{
              position: 'absolute', top: 6, bottom: 6,
              left: `calc(${(b.start / DAYS) * 100}% + 2px)`, width: `calc(${(b.len / DAYS) * 100}% - 4px)`,
              bgcolor: alpha(b.color, 0.14), borderLeft: `3px solid ${b.color}`, borderRadius: '6px',
              display: 'flex', alignItems: 'center', px: 1, overflow: 'hidden',
            }}>
              <Typography noWrap sx={{ fontSize: '0.6875rem', fontWeight: 600, color: BRAND.ink }}>{b.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    ))}
  </Box>
);

const FloatingStat: React.FC<{ label: string; value: string; accent: string; sx?: object; icon?: React.ReactNode }> = ({ label, value, accent, sx, icon }) => (
  <Box sx={{
    position: 'absolute', bgcolor: 'white', borderRadius: 2.5, px: 2, py: 1.5, display: { xs: 'none', sm: 'flex' },
    alignItems: 'center', gap: 1.5, border: `1px solid ${BRAND.mist}`,
    boxShadow: `0 12px 32px -8px ${alpha(BRAND.ink, 0.2)}`, ...sx,
  }}>
    <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: alpha(accent, 0.12), color: accent, display: 'grid', placeItems: 'center' }}>
      {icon ?? <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: accent }} />}
    </Box>
    <Box>
      <Typography sx={{ fontSize: '0.6875rem', color: BRAND.slate, fontWeight: 500 }}>{label}</Typography>
      <Typography sx={{ fontSize: '1.0625rem', color: BRAND.ink, fontWeight: 800, lineHeight: 1.2 }}>{value}</Typography>
    </Box>
  </Box>
);

const RatesMock: React.FC = () => (
  <WindowFrame title="Rates">
    <Box sx={{ p: 2 }}>
      {[{ name: 'Deluxe King', rates: [145, 145, 160, 189, 189] }, { name: 'Junior Suite', rates: [210, 210, 225, 259, 259] }, { name: 'Family Room', rates: [175, 175, 190, 219, 219] }].map(r => (
        <Box key={r.name} sx={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(5, 1fr)', alignItems: 'center', py: 1.1, borderBottom: `1px solid ${BRAND.mist}`, gap: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: BRAND.ink }} noWrap>{r.name}</Typography>
          {r.rates.map((v, i) => (
            <Box key={i} sx={{ textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, borderRadius: 1, py: 0.5, bgcolor: i >= 3 ? alpha(PMS, 0.12) : BRAND.paper, color: i >= 3 ? '#2858C4' : BRAND.ink }}>${v}</Box>
          ))}
        </Box>
      ))}
      <Stack direction="row" spacing={1} mt={2} flexWrap="wrap" useFlexGap>
        {['Booking.com', 'Expedia', 'Airbnb', 'Direct'].map(c => (
          <Chip key={c} size="small" icon={<SyncAltIcon sx={{ fontSize: '14px !important' }} />} label={c}
            sx={{ bgcolor: alpha(ACC, 0.1), color: '#0E7C70', '& .MuiChip-icon': { color: '#0E7C70' } }} />
        ))}
      </Stack>
    </Box>
  </WindowFrame>
);

const InvoiceMock: React.FC = () => (
  <WindowFrame title="e-CF">
    <Box sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
        <Box>
          <Typography sx={{ fontSize: '0.6875rem', color: BRAND.slate, fontWeight: 600 }}>Factura de Crédito Fiscal</Typography>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: BRAND.ink }}>E310000000124</Typography>
        </Box>
        <Chip size="small" icon={<CheckCircleIcon sx={{ fontSize: '14px !important' }} />} label="DGII"
          sx={{ bgcolor: alpha('#16A34A', 0.1), color: '#15803D', '& .MuiChip-icon': { color: '#15803D' } }} />
      </Stack>
      {[['Room 3 nights', '567.00'], ['Restaurant', '84.50'], ['ITBIS 18%', '117.27'], ['Service 10%', '65.15']].map(([k, v]) => (
        <Stack key={k} direction="row" justifyContent="space-between" sx={{ py: 0.9, borderBottom: `1px dashed ${BRAND.mist}` }}>
          <Typography sx={{ fontSize: '0.8125rem', color: BRAND.slate }}>{k}</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: BRAND.ink, fontWeight: 600 }}>{v}</Typography>
        </Stack>
      ))}
      <Stack direction="row" justifyContent="space-between" mt={1.5}>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 800, color: BRAND.ink }}>Total</Typography>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 800, color: BRAND.ink }}>USD 833.92</Typography>
      </Stack>
    </Box>
  </WindowFrame>
);

const ResortMock: React.FC = () => (
  <Grid container spacing={2}>
    {[
      { title: 'Day Pass', meta: '42 / 60', color: PRODUCT_COLORS.pos, pct: 70 },
      { title: 'Pasatarde', meta: '18 / 40', color: PRODUCT_COLORS.rrhh, pct: 45 },
      { title: 'Wedding · Salón Mar', meta: '120 pax', color: BRAND.vermilion, pct: 100 },
      { title: 'Wristbands', meta: '231', color: PMS, pct: 82 },
    ].map(c => (
      <Grid item xs={6} key={c.title}>
        <Box sx={{ bgcolor: 'white', borderRadius: 3, p: 2, border: `1px solid ${BRAND.mist}`, boxShadow: `0 12px 32px -12px ${alpha(BRAND.ink, 0.18)}` }}>
          <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: alpha(c.color, 0.14), mb: 1.5, display: 'grid', placeItems: 'center' }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: c.color }} />
          </Box>
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: BRAND.ink }} noWrap>{c.title}</Typography>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: BRAND.ink, my: 0.5 }}>{c.meta}</Typography>
          <Box sx={{ height: 6, borderRadius: 3, bgcolor: BRAND.paper, overflow: 'hidden' }}>
            <Box sx={{ width: `${c.pct}%`, height: '100%', bgcolor: c.color, borderRadius: 3 }} />
          </Box>
        </Box>
      </Grid>
    ))}
  </Grid>
);

// ── Hero ──────────────────────────────────────────────────────────────────────
function HeroSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Box id="hero" sx={{
      position: 'relative', overflow: 'hidden', pt: { xs: 6, md: 10 }, pb: { xs: 8, md: 12 },
      background: `radial-gradient(1200px 500px at 85% -10%, ${alpha(PMS, 0.1)}, transparent 60%), radial-gradient(900px 500px at -10% 30%, ${alpha(BRAND.vermilion, 0.07)}, transparent 60%), white`,
    }}>
      <Container maxWidth="lg">
        <Grid container spacing={{ xs: 6, md: 8 }} alignItems="center">
          <Grid item xs={12} md={6}>
            <Chip
              label={t('marketing.hero.badge')}
              icon={<Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: BRAND.vermilion, ml: '10px !important' }} />}
              sx={{ mb: 3, bgcolor: alpha(BRAND.vermilion, 0.08), color: BRAND.vermilionText, fontWeight: 700, height: 30 }}
            />
            <Typography variant="h1" sx={{ fontSize: { xs: '2.375rem', sm: '3rem', md: '3.5rem' }, color: BRAND.ink, mb: 3 }}>
              {t('marketing.hero.headline')}{' '}
              <Box component="span" sx={{ color: BRAND.vermilion }}>{t('marketing.hero.headlineAccent')}</Box>
            </Typography>
            <Typography sx={{ fontSize: { xs: '1.0625rem', md: '1.1875rem' }, color: BRAND.slate, mb: 4.5, lineHeight: 1.7, maxWidth: 560 }}>
              {t('marketing.hero.body')}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} mb={4}>
              <Button variant="contained" color="secondary" size="large" endIcon={<ArrowForwardIcon />}
                onClick={() => navigate('/contact')}>
                {t('marketing.hero.ctaPrimary')}
              </Button>
              <Button variant="outlined" size="large" sx={{ color: BRAND.ink, bgcolor: 'white' }} onClick={() => scrollTo('pricing')}>
                {t('marketing.hero.ctaSecondary')}
              </Button>
            </Stack>
            <Stack direction="row" flexWrap="wrap" useFlexGap columnGap={3} rowGap={1}>
              {asList(t('marketing.hero.points', { returnObjects: true })).map(p => (
                <Stack key={p} direction="row" spacing={1} alignItems="center">
                  <CheckCircleIcon sx={{ fontSize: 18, color: ACC }} />
                  <Typography variant="body2" sx={{ color: BRAND.slate, fontWeight: 500 }}>{p}</Typography>
                </Stack>
              ))}
            </Stack>
          </Grid>
          <Grid item xs={12} md={6}>
            <Box sx={{ position: 'relative', px: { sm: 3 }, py: { sm: 4 } }}>
              <WindowFrame title={t('marketing.hero.mockCalendar')}>
                <CalendarMock />
              </WindowFrame>
              <FloatingStat label={t('marketing.hero.mockOccupancy')} value="86%" accent={PMS} sx={{ bottom: -12, left: -16 }} />
              <FloatingStat label={t('marketing.hero.mockEcf')} value="E31 · E32" accent={ACC}
                icon={<VerifiedIcon sx={{ fontSize: 20 }} />} sx={{ top: -6, right: -12 }} />
            </Box>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

// ── Pillars ───────────────────────────────────────────────────────────────────
function PillarsSection() {
  const { t } = useTranslation();
  return (
    <Box sx={{ borderTop: `1px solid ${BRAND.mist}`, borderBottom: `1px solid ${BRAND.mist}`, bgcolor: 'white' }}>
      <Container maxWidth="lg">
        <Grid container>
          {PILLARS.map((p, i) => (
            <Grid item xs={12} sm={6} md={3} key={p.key}
              sx={{ py: { xs: 3, md: 4.5 }, px: { xs: 0, sm: 3 }, borderLeft: { md: i ? `1px solid ${BRAND.mist}` : 'none' } }}>
              <Stack direction="row" spacing={1.75} alignItems="flex-start">
                <Box sx={{ color: BRAND.vermilion, mt: 0.25 }}>{p.icon}</Box>
                <Box>
                  <Typography sx={{ fontWeight: 700, color: BRAND.ink, mb: 0.5 }}>{t(`marketing.pillars.${p.key}_title`)}</Typography>
                  <Typography variant="body2" sx={{ color: BRAND.slate }}>{t(`marketing.pillars.${p.key}_body`)}</Typography>
                </Box>
              </Stack>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

// ── Products ──────────────────────────────────────────────────────────────────
function ProductsSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const products = [
    { code: 'pms' as const, color: PMS },
    { code: 'accounting' as const, color: ACC },
  ];
  return (
    <Box id="products" sx={{ bgcolor: BRAND.paper, py: { xs: 10, md: 14 }, scrollMarginTop: 72 }}>
      <Container maxWidth="lg">
        <SectionHeader eyebrow={t('marketing.products.eyebrow')} heading={t('marketing.products.heading')} sub={t('marketing.products.subheading')} />
        <Grid container spacing={3}>
          {products.map(p => (
            <Grid item xs={12} md={6} key={p.code}>
              <Card elevation={0} sx={{ height: '100%', position: 'relative', overflow: 'hidden', borderRadius: 4 }}>
                <Box sx={{ height: 4, bgcolor: p.color }} />
                <CardContent sx={{ p: { xs: 3, md: 4.5 } }}>
                  <PillotoLogo height={30} product={p.code} />
                  <Typography variant="h5" sx={{ mt: 2.5, mb: 3, color: BRAND.ink, fontWeight: 700 }}>
                    {t(`marketing.products.${p.code}_tagline`)}
                  </Typography>
                  <Grid container columnSpacing={2}>
                    {asList(t(`marketing.products.${p.code}_points`, { returnObjects: true })).map(item => (
                      <Grid item xs={12} sm={6} key={item}>
                        <CheckList items={[item]} color={p.color} dense />
                      </Grid>
                    ))}
                  </Grid>
                  <Button endIcon={<ArrowForwardIcon />} sx={{ mt: 3, px: 0, color: BRAND.ink, '&:hover': { bgcolor: 'transparent', color: p.color } }}
                    onClick={() => navigate('/contact')}>
                    {t('marketing.products.learnMore')}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
        <Box sx={{
          mt: 3, borderRadius: 4, p: { xs: 3, md: 4 }, bgcolor: BRAND.ink, color: 'white',
          display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { md: 'center' }, gap: { xs: 2, md: 4 },
        }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
            <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: PMS }} />
            <SyncAltIcon sx={{ color: 'rgba(255,255,255,0.5)' }} />
            <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: ACC }} />
          </Stack>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: '1.125rem', mb: 0.5 }}>{t('marketing.products.together_title')}</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.72)', lineHeight: 1.7 }}>{t('marketing.products.together_body')}</Typography>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}

// ── Deep dives ────────────────────────────────────────────────────────────────
function DeepDiveSection() {
  const { t } = useTranslation();
  const rows = [
    { key: 'frontDesk', color: PMS, visual: <WindowFrame title={t('marketing.hero.mockCalendar')}><CalendarMock compact /></WindowFrame> },
    { key: 'revenue', color: PMS, visual: <RatesMock /> },
    { key: 'billing', color: ACC, visual: <InvoiceMock /> },
    { key: 'resort', color: BRAND.vermilion, visual: <ResortMock /> },
  ];
  return (
    <Box id="features" sx={{ bgcolor: 'white', py: { xs: 10, md: 14 }, scrollMarginTop: 72 }}>
      <Container maxWidth="lg">
        <SectionHeader eyebrow={t('marketing.deepDive.eyebrow')} heading={t('marketing.deepDive.heading')} />
        {/* Plain Box wrapper: Stack's child-margin reset would cancel the Grid container's negative margins. */}
        <Box sx={{ display: 'grid', rowGap: { xs: 10, md: 14 } }}>
          {rows.map((r, i) => (
            <Grid container spacing={{ xs: 5, md: 10 }} alignItems="center" key={r.key} direction={i % 2 ? 'row-reverse' : 'row'}>
              <Grid item xs={12} md={6}>
                <Eyebrow color={r.color === ACC ? '#0E7C70' : r.color === PMS ? '#2858C4' : BRAND.vermilionText}>
                  {t(`marketing.deepDive.${r.key}_label`)}
                </Eyebrow>
                <Typography variant="h3" sx={{ fontSize: { xs: '1.75rem', md: '2.125rem' }, color: BRAND.ink, mb: 2 }}>
                  {t(`marketing.deepDive.${r.key}_title`)}
                </Typography>
                <Typography sx={{ color: BRAND.slate, fontSize: '1.0625rem', lineHeight: 1.7, mb: 3 }}>
                  {t(`marketing.deepDive.${r.key}_body`)}
                </Typography>
                <CheckList items={asList(t(`marketing.deepDive.${r.key}_points`, { returnObjects: true }))} color={r.color} />
              </Grid>
              <Grid item xs={12} md={6}>
                <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 5, bgcolor: alpha(r.color, 0.06) }}>
                  {r.visual}
                </Box>
              </Grid>
            </Grid>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

// ── Feature grid ──────────────────────────────────────────────────────────────
function FeaturesGridSection() {
  const { t } = useTranslation();
  return (
    <Box sx={{ bgcolor: BRAND.paper, py: { xs: 10, md: 14 } }}>
      <Container maxWidth="lg">
        <SectionHeader eyebrow={t('marketing.features.eyebrow')} heading={t('marketing.features.heading')} sub={t('marketing.features.subheading')} />
        <Grid container spacing={2.5}>
          {FEATURE_KEYS.map(f => (
            <Grid item xs={12} sm={6} md={3} key={f.key}>
              <Card elevation={0} sx={{ height: '100%', transition: 'transform .2s, box-shadow .2s', '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 12px 32px -12px ${alpha(BRAND.ink, 0.18)}` } }}>
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ width: 44, height: 44, borderRadius: 2.5, bgcolor: alpha(BRAND.ink, 0.05), color: BRAND.ink, display: 'grid', placeItems: 'center', mb: 2 }}>
                    {f.icon}
                  </Box>
                  <Typography fontWeight={700} mb={1} color={BRAND.ink}>{t(`marketing.features.${f.key}_title`)}</Typography>
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

// ── Onboarding ────────────────────────────────────────────────────────────────
function OnboardingSection() {
  const { t } = useTranslation();
  return (
    <Box sx={{ bgcolor: BRAND.ink, py: { xs: 10, md: 14 }, position: 'relative', overflow: 'hidden' }}>
      <Container maxWidth="lg" sx={{ position: 'relative' }}>
        <SectionHeader light eyebrow={t('marketing.onboarding.eyebrow')} heading={t('marketing.onboarding.heading')} sub={t('marketing.onboarding.subheading')} />
        <Grid container spacing={3}>
          {[1, 2, 3].map(n => (
            <Grid item xs={12} md={4} key={n}>
              <Box sx={{ height: '100%', p: 4, borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)', bgcolor: 'rgba(255,255,255,0.03)' }}>
                <Typography sx={{ fontSize: '2.5rem', fontWeight: 800, color: BRAND.vermilionOnDark, lineHeight: 1, mb: 2.5 }}>
                  0{n}
                </Typography>
                <Typography sx={{ fontWeight: 700, color: 'white', fontSize: '1.125rem', mb: 1 }}>{t(`marketing.onboarding.step${n}_title`)}</Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.68)', lineHeight: 1.7 }}>{t(`marketing.onboarding.step${n}_body`)}</Typography>
              </Box>
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
  const navigate = useNavigate();
  return (
    <Box id="pricing" sx={{ bgcolor: 'white', py: { xs: 10, md: 14 }, scrollMarginTop: 72 }}>
      <Container maxWidth="lg">
        <SectionHeader eyebrow={t('marketing.pricing.eyebrow')} heading={t('marketing.pricing.heading')} sub={t('marketing.pricing.subheading')} />
        <Grid container spacing={3} alignItems="stretch">
          {PRICING_TIERS.map(tier => {
            const features = asList(t(`marketing.pricing.${tier.slug}_features`, { returnObjects: true }));
            return (
              <Grid item xs={12} md={4} key={tier.slug}>
                <Card elevation={0} sx={{
                  height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 4, position: 'relative', overflow: 'visible',
                  ...(tier.highlighted && { bgcolor: BRAND.ink, borderColor: BRAND.ink, boxShadow: `0 24px 60px -16px ${alpha(BRAND.ink, 0.45)}` }),
                }}>
                  {tier.highlighted && (
                    <Chip label={t('marketing.pricing.mostPopular')} size="small" sx={{
                      position: 'absolute', top: -13, left: 32, bgcolor: BRAND.vermilion, color: 'white', fontWeight: 700,
                    }} />
                  )}
                  <CardContent sx={{ p: 4, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="overline" sx={{ color: tier.highlighted ? BRAND.vermilionOnDark : BRAND.slate }}>{tier.name}</Typography>
                    <Box display="flex" alignItems="baseline" gap={0.5} mt={1} mb={1.5}>
                      <Typography sx={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.03em', color: tier.highlighted ? 'white' : BRAND.ink }}>{tier.price}</Typography>
                      <Typography variant="body2" sx={{ color: tier.highlighted ? 'rgba(255,255,255,0.6)' : BRAND.slate }}>{t('marketing.pricing.perMonth')}</Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: tier.highlighted ? 'rgba(255,255,255,0.72)' : BRAND.slate, mb: 3, lineHeight: 1.7, minHeight: { md: 48 } }}>
                      {t(`marketing.pricing.${tier.slug}_desc`)}
                    </Typography>
                    <Divider sx={{ mb: 2.5, borderColor: tier.highlighted ? 'rgba(255,255,255,0.12)' : BRAND.mist }} />
                    <List disablePadding sx={{ flexGrow: 1, mb: 4 }}>
                      {features.map(f => (
                        <ListItem key={f} disablePadding sx={{ py: 0.6 }}>
                          <ListItemIcon sx={{ minWidth: 28 }}>
                            <CheckIcon sx={{ fontSize: 18, color: tier.highlighted ? BRAND.vermilionOnDark : ACC }} />
                          </ListItemIcon>
                          <ListItemText primary={f} primaryTypographyProps={{ variant: 'body2', color: tier.highlighted ? 'white' : BRAND.ink }} />
                        </ListItem>
                      ))}
                    </List>
                    <Button fullWidth size="large"
                      variant={tier.highlighted ? 'contained' : 'outlined'}
                      color={tier.highlighted ? 'secondary' : 'primary'}
                      onClick={() => navigate(`/contact?plan=${tier.slug}`)}>
                      {t('marketing.pricing.ctaContactSales')}
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
        <Stack alignItems="center" spacing={2} mt={5}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.5, borderRadius: 3, bgcolor: alpha(ACC, 0.08), border: `1px solid ${alpha(ACC, 0.25)}` }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: ACC, flexShrink: 0 }} />
            <Typography variant="body2" sx={{ color: BRAND.ink, fontWeight: 500 }}>{t('marketing.pricing.accountingAddon')}</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {t('marketing.pricing.trialNotice')}
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}

// ── FAQ ───────────────────────────────────────────────────────────────────────
function FaqSection() {
  const { t } = useTranslation();
  const items = t('marketing.faq.items', { returnObjects: true }) as { q: string; a: string }[];
  return (
    <Box id="faq" sx={{ bgcolor: BRAND.paper, py: { xs: 10, md: 14 }, scrollMarginTop: 72 }}>
      <Container maxWidth="md">
        <SectionHeader eyebrow={t('marketing.faq.eyebrow')} heading={t('marketing.faq.heading')} />
        <Stack spacing={1.5}>
          {(Array.isArray(items) ? items : []).map((item, i) => (
            <Accordion key={item.q} defaultExpanded={i === 0} disableGutters elevation={0}
              sx={{ borderRadius: '12px !important', border: `1px solid ${BRAND.mist}`, '&::before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 3, py: 0.5 }}>
                <Typography sx={{ fontWeight: 600, color: BRAND.ink }}>{item.q}</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 3, pt: 0, pb: 2.5 }}>
                <Typography sx={{ color: BRAND.slate, lineHeight: 1.7 }}>{item.a}</Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </Stack>
      </Container>
    </Box>
  );
}

// ── CTA ───────────────────────────────────────────────────────────────────────
function CtaSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Box sx={{ bgcolor: 'white', py: { xs: 8, md: 12 } }}>
      <Container maxWidth="lg">
        <Box sx={{
          borderRadius: 5, px: { xs: 3, md: 8 }, py: { xs: 6, md: 8 }, textAlign: 'center', position: 'relative', overflow: 'hidden',
          background: `radial-gradient(600px 300px at 90% 0%, ${alpha(BRAND.vermilion, 0.35)}, transparent 70%), radial-gradient(500px 300px at 0% 100%, ${alpha(PMS, 0.3)}, transparent 70%), ${BRAND.ink}`,
        }}>
          <Typography variant="h2" sx={{ color: 'white', fontSize: { xs: '1.875rem', md: '2.5rem' }, mb: 2, maxWidth: 680, mx: 'auto' }}>
            {t('marketing.cta.heading')}
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.75)', mb: 5, fontSize: '1.0625rem', maxWidth: 560, mx: 'auto', lineHeight: 1.7 }}>
            {t('marketing.cta.body')}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="center">
            <Button variant="contained" color="secondary" size="large" endIcon={<ArrowForwardIcon />} onClick={() => navigate('/contact')}>
              {t('marketing.cta.contactUs')}
            </Button>
            <Button variant="outlined" size="large" onClick={() => scrollTo('pricing')}
              sx={{ borderColor: 'rgba(255,255,255,0.35)', color: 'white', '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.06)' } }}>
              {t('marketing.cta.viewPlans')}
            </Button>
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
const LandingPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { hash } = useLocation();

  // Arriving from another page via "/#pricing" etc.
  useEffect(() => {
    if (hash) setTimeout(() => scrollTo(hash.slice(1)), 50);
  }, [hash]);

  return (
    <MarketingLayout>
      <PageMeta
        title={t('marketing.meta.title')}
        description={t('marketing.meta.description')}
        path="/"
        locale={i18n.language.startsWith('en') ? 'en' : 'es'}
      />
      <HeroSection />
      <PillarsSection />
      <ProductsSection />
      <DeepDiveSection />
      <FeaturesGridSection />
      <OnboardingSection />
      <PricingSection />
      <FaqSection />
      <CtaSection />
    </MarketingLayout>
  );
};

export default LandingPage;
