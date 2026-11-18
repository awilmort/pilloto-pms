import React, { useEffect } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Card, CardContent, Chip, Container, Divider, Grid, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RemoveIcon from '@mui/icons-material/Remove';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCartOutlined';
import AccountBalanceIcon from '@mui/icons-material/AccountBalanceOutlined';
import Inventory2Icon from '@mui/icons-material/Inventory2Outlined';
import MenuBookIcon from '@mui/icons-material/MenuBookOutlined';
import CurrencyExchangeIcon from '@mui/icons-material/CurrencyExchangeOutlined';
import AssessmentIcon from '@mui/icons-material/AssessmentOutlined';
import GroupIcon from '@mui/icons-material/GroupOutlined';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import RestaurantIcon from '@mui/icons-material/RestaurantOutlined';
import CalculateIcon from '@mui/icons-material/CalculateOutlined';
import HotelIcon from '@mui/icons-material/HotelOutlined';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import MarketingLayout from '../../components/marketing/MarketingLayout';
import PageMeta from '../../components/marketing/PageMeta';
import { asList, CheckList, Eyebrow, FloatingStat, SectionHeader, WindowFrame } from '../../components/marketing/MarketingAtoms';
import { approxUsd, formatListPrice, PublicPlan, usePublicPlans } from '../../hooks/usePublicPlans';
import { BRAND, PRODUCT_COLORS, alpha } from '../../brand';

const ACC = PRODUCT_COLORS.accounting;
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

// ── Hero ──────────────────────────────────────────────────────────────────────
const LedgerMock: React.FC = () => (
  <WindowFrame title="Pilloto Contabilidad">
    <Box sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
        <Box>
          <Typography sx={{ fontSize: '0.6875rem', color: BRAND.slate, fontWeight: 600 }}>Factura de Crédito Fiscal</Typography>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: BRAND.ink }}>E310000000318</Typography>
        </Box>
        <Chip size="small" icon={<CheckCircleIcon sx={{ fontSize: '14px !important' }} />} label="DGII · Aceptado"
          sx={{ bgcolor: alpha('#16A34A', 0.1), color: '#15803D', '& .MuiChip-icon': { color: '#15803D' } }} />
      </Stack>
      {[['Servicios de mantenimiento', '12,500.00'], ['Repuestos', '3,180.00'], ['ITBIS 18%', '2,822.40']].map(([k, v]) => (
        <Stack key={k} direction="row" justifyContent="space-between" sx={{ py: 0.9, borderBottom: `1px dashed ${BRAND.mist}` }}>
          <Typography sx={{ fontSize: '0.8125rem', color: BRAND.slate }}>{k}</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: BRAND.ink, fontWeight: 600 }}>{v}</Typography>
        </Stack>
      ))}
      <Stack direction="row" justifyContent="space-between" mt={1.5}>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 800, color: BRAND.ink }}>Total</Typography>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 800, color: BRAND.ink }}>RD$ 18,502.40</Typography>
      </Stack>
      <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: alpha(ACC, 0.08) }}>
        <Typography sx={{ fontSize: '0.75rem', color: BRAND.ink, fontWeight: 600 }}>Asiento JE-000412 · Cuentas por cobrar ↔ Ingresos · ITBIS por pagar</Typography>
      </Box>
    </Box>
  </WindowFrame>
);

function HeroSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Box sx={{ bgcolor: BRAND.paper, pt: { xs: 8, md: 12 }, pb: { xs: 10, md: 14 }, overflow: 'hidden' }}>
      <Container maxWidth="lg">
        <Grid container spacing={{ xs: 6, md: 8 }} alignItems="center">
          <Grid item xs={12} md={6}>
            <Chip label={t('marketing.accounting.hero.badge', 'e-CF included in every plan')} sx={{ bgcolor: alpha(ACC, 0.12), color: ACC, fontWeight: 700, mb: 3 }} />
            <Typography variant="h1" sx={{ fontSize: { xs: '2.25rem', md: '3.25rem' }, color: BRAND.ink, mb: 2.5, lineHeight: 1.1 }}>
              {t('marketing.accounting.hero.headline', 'Electronic invoicing and accounting')}{' '}
              <Box component="span" sx={{ color: ACC }}>{t('marketing.accounting.hero.headlineAccent', 'for Dominican businesses.')}</Box>
            </Typography>
            <Typography sx={{ color: BRAND.slate, fontSize: '1.125rem', lineHeight: 1.7, mb: 4 }}>
              {t('marketing.accounting.hero.body', 'Issue your e-CF, record purchases with their withholdings, reconcile your banks and get the 606 ready for the DGII — your books kept as you work, in one place.')}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} mb={3}>
              <Button variant="contained" size="large" sx={{ bgcolor: ACC, '&:hover': { bgcolor: alpha(ACC, 0.9) } }} onClick={() => navigate('/contact?product=accounting')}>
                {t('marketing.accounting.hero.ctaPrimary', 'Start your 14-day free trial')}
              </Button>
              <Button variant="outlined" size="large" sx={{ color: BRAND.ink, bgcolor: 'white' }} onClick={() => scrollTo('pricing')}>
                {t('marketing.accounting.hero.ctaSecondary', 'See prices')}
              </Button>
            </Stack>
            <Stack direction="row" spacing={2.5} flexWrap="wrap" useFlexGap>
              {asList(t('marketing.accounting.hero.points', { returnObjects: true })).map((p) => (
                <Stack key={p} direction="row" spacing={0.75} alignItems="center">
                  <CheckCircleIcon sx={{ fontSize: 18, color: ACC }} />
                  <Typography variant="body2" sx={{ color: BRAND.ink, fontWeight: 500 }}>{p}</Typography>
                </Stack>
              ))}
            </Stack>
          </Grid>
          <Grid item xs={12} md={6}>
            <Box sx={{ position: 'relative' }}>
              <LedgerMock />
              <FloatingStat label={t('marketing.accounting.hero.mock606', 'Formato 606')} value={t('marketing.accounting.hero.mock606Value', 'Ready to upload')} accent={ACC} icon={<DescriptionIcon fontSize="small" />} sx={{ bottom: -18, left: -18 }} />
              <FloatingStat label={t('marketing.accounting.hero.mockBank', 'Bank reconciled')} value="Popular ···4321" accent={BRAND.vermilion} icon={<AccountBalanceIcon fontSize="small" />} sx={{ top: -18, right: -12 }} />
            </Box>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

// ── Who it is for ─────────────────────────────────────────────────────────────
const SEGMENTS = [
  { key: 'smb', icon: <StorefrontIcon /> },
  { key: 'hospitality', icon: <RestaurantIcon /> },
  { key: 'accountants', icon: <CalculateIcon /> },
  { key: 'hotels', icon: <HotelIcon /> },
];

function SegmentsSection() {
  const { t } = useTranslation();
  return (
    <Box id="features" sx={{ bgcolor: 'white', py: { xs: 10, md: 14 }, scrollMarginTop: 72 }}>
      <Container maxWidth="lg">
        <SectionHeader eyebrow={t('marketing.accounting.segments.eyebrow', 'Who it is for')} heading={t('marketing.accounting.segments.heading', 'Built for how Dominican businesses work')} />
        <Grid container spacing={3}>
          {SEGMENTS.map((s) => (
            <Grid item xs={12} sm={6} md={3} key={s.key}>
              <Card elevation={0} sx={{ height: '100%', borderRadius: 4 }}>
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: alpha(ACC, 0.12), color: ACC, display: 'grid', placeItems: 'center', mb: 2 }}>{s.icon}</Box>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: BRAND.ink, mb: 1 }}>{t(`marketing.accounting.segments.${s.key}.title`)}</Typography>
                  <Typography variant="body2" sx={{ color: BRAND.slate, lineHeight: 1.7 }}>{t(`marketing.accounting.segments.${s.key}.body`)}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

// ── Modules ───────────────────────────────────────────────────────────────────
const MODULES = [
  { key: 'ecf', icon: <VerifiedIcon /> },
  { key: 'purchases', icon: <ShoppingCartIcon /> },
  { key: 'banks', icon: <AccountBalanceIcon /> },
  { key: 'inventory', icon: <Inventory2Icon /> },
  { key: 'ledger', icon: <MenuBookIcon /> },
  { key: 'currencies', icon: <CurrencyExchangeIcon /> },
  { key: 'reports', icon: <AssessmentIcon /> },
  { key: 'team', icon: <GroupIcon /> },
];

function ModulesSection() {
  const { t } = useTranslation();
  return (
    <Box sx={{ bgcolor: BRAND.paper, py: { xs: 10, md: 14 } }}>
      <Container maxWidth="lg">
        <SectionHeader eyebrow={t('marketing.accounting.modules.eyebrow', 'Everything in one place')} heading={t('marketing.accounting.modules.heading', 'From the invoice to the financial statements')} sub={t('marketing.accounting.modules.subheading', 'Every document posts to your books as you work. No re-typing, no month-end surprises.')} />
        <Grid container spacing={3}>
          {MODULES.map((m) => (
            <Grid item xs={12} sm={6} md={3} key={m.key}>
              <Box sx={{ p: 3, height: '100%', borderRadius: 4, bgcolor: 'white', border: `1px solid ${BRAND.mist}` }}>
                <Box sx={{ color: ACC, mb: 1.5 }}>{m.icon}</Box>
                <Typography sx={{ fontWeight: 700, color: BRAND.ink, mb: 0.75 }}>{t(`marketing.accounting.modules.${m.key}.title`)}</Typography>
                <Typography variant="body2" sx={{ color: BRAND.slate, lineHeight: 1.7 }}>{t(`marketing.accounting.modules.${m.key}.body`)}</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

// ── DGII compliance + comparison with the free tool ───────────────────────────
function ComplianceSection() {
  const { t } = useTranslation();
  const rows = ['invoices', 'accounting', 'purchases', 'banks', 'inventory', 'users'] as const;
  return (
    <Box sx={{ bgcolor: BRAND.ink, py: { xs: 10, md: 14 } }}>
      <Container maxWidth="lg">
        <Grid container spacing={{ xs: 6, md: 8 }} alignItems="center">
          <Grid item xs={12} md={5}>
            <Eyebrow color={BRAND.vermilionOnDark}>{t('marketing.accounting.compliance.eyebrow', 'Made for the DGII')}</Eyebrow>
            <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.5rem' }, color: 'white', mb: 2 }}>
              {t('marketing.accounting.compliance.heading', 'Outgrowing the DGII free invoicing tool?')}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.72)', lineHeight: 1.7, mb: 3 }}>
              {t('marketing.accounting.compliance.body', 'The free tool covers issuing up to 150 invoices a month. When you need your books, your purchases and your banks too, Pilloto takes over — through a DGII-authorised e-CF provider.')}
            </Typography>
            <Box sx={{ '& .MuiTypography-root': { color: 'white' } }}>
              <CheckList color={BRAND.vermilionOnDark} items={asList(t('marketing.accounting.compliance.points', { returnObjects: true }))} />
            </Box>
          </Grid>
          <Grid item xs={12} md={7}>
            <Card elevation={0} sx={{ borderRadius: 4, overflow: 'hidden' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell />
                    <TableCell sx={{ fontWeight: 700 }}>{t('marketing.accounting.compliance.free', 'DGII free tool')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: ACC }}>Pilloto Contabilidad</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r}>
                      <TableCell sx={{ fontWeight: 600 }}>{t(`marketing.accounting.compliance.rows.${r}.label`)}</TableCell>
                      <TableCell sx={{ color: BRAND.slate }}>{t(`marketing.accounting.compliance.rows.${r}.free`, '') || <RemoveIcon fontSize="small" sx={{ color: BRAND.slate }} />}</TableCell>
                      <TableCell>{t(`marketing.accounting.compliance.rows.${r}.pilloto`)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────────────
function tierLines(t: (k: string, a?: any, b?: any) => any, plan: PublicPlan): string[] {
  const lines: string[] = [];
  const users = plan.limits.maxUsers;
  lines.push(users === null ? t('marketing.accounting.pricing.usersUnlimited', 'Unlimited users') : t('marketing.accounting.pricing.users', '{{count}} users', { count: users }));
  if (plan.includedEcf.transactions) lines.push(t('marketing.accounting.pricing.ecf', '{{count}} e-CF a month included', { count: plan.includedEcf.transactions.toLocaleString('en-US') }));
  else lines.push(t('marketing.accounting.pricing.ecfIncluded', 'Electronic invoicing (e-CF) included'));
  lines.push(...asList(t(`marketing.accounting.pricing.${plan.slug}_features`, { returnObjects: true })));
  return lines;
}

function PricingSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const plans = usePublicPlans();
  return (
    <Box id="pricing" sx={{ bgcolor: 'white', py: { xs: 10, md: 14 }, scrollMarginTop: 72 }}>
      <Container maxWidth="lg">
        <SectionHeader eyebrow={t('marketing.pricing.eyebrow', 'Pricing')} heading={t('marketing.accounting.pricing.heading', 'A plan for each stage of your business')} sub={t('marketing.accounting.pricing.subheading', 'Prices in pesos, before ITBIS. 14 days free, no card. Change or cancel from the app.')} />
        <Grid container spacing={2.5} alignItems="stretch">
          {plans.accounting.map((plan) => {
            const highlighted = plan.slug === 'essentials';
            return (
              <Grid item xs={12} sm={6} md={3} key={plan.slug}>
                <Card elevation={0} sx={{
                  height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 4, position: 'relative', overflow: 'visible',
                  ...(highlighted && { borderColor: ACC, borderWidth: 2, boxShadow: `0 24px 60px -20px ${alpha(ACC, 0.45)}` }),
                }}>
                  {highlighted && <Chip label={t('marketing.pricing.mostPopular', 'Most popular')} size="small" sx={{ position: 'absolute', top: -13, left: 24, bgcolor: ACC, color: 'white', fontWeight: 700 }} />}
                  <CardContent sx={{ p: 3, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="overline" sx={{ color: BRAND.slate }}>{plan.name}</Typography>
                    <Box display="flex" alignItems="baseline" gap={0.5} mt={0.5}>
                      <Typography sx={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.03em', color: BRAND.ink }}>{formatListPrice(plan.monthlyPrice)}</Typography>
                      <Typography variant="body2" sx={{ color: BRAND.slate }}>{t('marketing.pricing.perMonth', '/mo')}</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: BRAND.slate, mb: 1.5 }}>{t('marketing.pricing.plusItbis', '+ ITBIS')} · {approxUsd(plan.monthlyPrice)}</Typography>
                    <Typography variant="body2" sx={{ color: BRAND.slate, mb: 2, lineHeight: 1.6, minHeight: { md: 66 } }}>{t(`marketing.accounting.pricing.${plan.slug}_desc`)}</Typography>
                    <Divider sx={{ mb: 2 }} />
                    <Box sx={{ flexGrow: 1, mb: 3 }}><CheckList dense color={ACC} items={tierLines(t as any, plan)} /></Box>
                    <Button fullWidth variant={highlighted ? 'contained' : 'outlined'} sx={highlighted ? { bgcolor: ACC, '&:hover': { bgcolor: alpha(ACC, 0.9) } } : { color: BRAND.ink }}
                      onClick={() => navigate(`/contact?product=accounting&plan=${plan.slug}`)}>
                      {t('marketing.accounting.pricing.cta', 'Try it free')}
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
        <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
          {t('marketing.accounting.pricing.note', 'Need more e-CF? Choose a larger electronic-invoicing plan and pay only the difference. Payroll and point of sale are not included.')}
        </Typography>
      </Container>
    </Box>
  );
}

// ── Hotel suite ───────────────────────────────────────────────────────────────
function HotelSuiteSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const plans = usePublicPlans();
  return (
    <Box sx={{ bgcolor: BRAND.paper, py: { xs: 8, md: 10 } }}>
      <Container maxWidth="md">
        <Card elevation={0} sx={{ borderRadius: 4, p: { xs: 3, md: 5 }, textAlign: 'center' }}>
          <HotelIcon sx={{ color: PRODUCT_COLORS.pms, fontSize: 36, mb: 1 }} />
          <Typography variant="h4" sx={{ fontWeight: 800, color: BRAND.ink, mb: 1.5 }}>
            {t('marketing.accounting.suite.heading', 'Run a hotel or a resort?')}
          </Typography>
          <Typography sx={{ color: BRAND.slate, lineHeight: 1.7, mb: 3 }}>
            {t('marketing.accounting.suite.body', 'With Pilloto PMS, folios, payments and company accounts flow into your books by themselves — and you get {{discount}}% off Pilloto Contabilidad.', { discount: plans.suiteDiscountPercent })}
          </Typography>
          <Button endIcon={<ArrowForwardIcon />} variant="outlined" sx={{ color: BRAND.ink }} onClick={() => navigate('/')}>
            {t('marketing.accounting.suite.cta', 'Discover Pilloto PMS')}
          </Button>
        </Card>
      </Container>
    </Box>
  );
}

// ── FAQ + CTA ─────────────────────────────────────────────────────────────────
function FaqSection() {
  const { t } = useTranslation();
  const items = t('marketing.accounting.faq.items', { returnObjects: true }) as { q: string; a: string }[];
  return (
    <Box id="faq" sx={{ bgcolor: 'white', py: { xs: 10, md: 14 }, scrollMarginTop: 72 }}>
      <Container maxWidth="md">
        <SectionHeader eyebrow={t('marketing.faq.eyebrow', 'FAQ')} heading={t('marketing.accounting.faq.heading', 'Questions we hear often')} />
        {Array.isArray(items) && items.map((it) => (
          <Accordion key={it.q} elevation={0} disableGutters sx={{ border: `1px solid ${BRAND.mist}`, borderRadius: '12px !important', mb: 1.5, '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography fontWeight={600}>{it.q}</Typography></AccordionSummary>
            <AccordionDetails><Typography variant="body2" sx={{ color: BRAND.slate, lineHeight: 1.7 }}>{it.a}</Typography></AccordionDetails>
          </Accordion>
        ))}
      </Container>
    </Box>
  );
}

function CtaSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Box sx={{ bgcolor: ACC, py: { xs: 8, md: 10 } }}>
      <Container maxWidth="md" sx={{ textAlign: 'center' }}>
        <Typography variant="h3" sx={{ color: 'white', fontWeight: 800, mb: 2 }}>{t('marketing.accounting.cta.heading', 'Your books, in order from this month.')}</Typography>
        <Typography sx={{ color: 'rgba(255,255,255,0.85)', mb: 4 }}>{t('marketing.accounting.cta.body', 'We help you move from your current tool and set up your e-CF certification.')}</Typography>
        <Button variant="contained" size="large" sx={{ bgcolor: 'white', color: ACC, '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' } }} onClick={() => navigate('/contact?product=accounting')}>
          {t('marketing.accounting.hero.ctaPrimary', 'Start your 14-day free trial')}
        </Button>
      </Container>
    </Box>
  );
}

/** `/contabilidad` — Pilloto Contabilidad as a product of its own, for any Dominican business. */
const AccountingLandingPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) setTimeout(() => scrollTo(hash.slice(1)), 50);
  }, [hash]);
  return (
    <MarketingLayout>
      <PageMeta
        title={t('marketing.accounting.meta.title', 'Pilloto Contabilidad — e-CF invoicing and accounting for Dominican businesses')}
        description={t('marketing.accounting.meta.description', 'Electronic invoicing (e-CF) included, purchases with withholdings and the 606, bank reconciliation, inventory and financial statements. Plans from RD$1,590 a month.')}
        path="/contabilidad"
        locale={i18n.language.startsWith('en') ? 'en' : 'es'}
      />
      <HeroSection />
      <SegmentsSection />
      <ModulesSection />
      <ComplianceSection />
      <PricingSection />
      <HotelSuiteSection />
      <FaqSection />
      <CtaSection />
    </MarketingLayout>
  );
};

export default AccountingLandingPage;
