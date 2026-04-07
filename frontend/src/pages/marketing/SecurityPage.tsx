import React from 'react';
import { Typography, Box, Link, Chip, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import LegalPageLayout from '../../components/marketing/LegalPageLayout';
import PageMeta from '../../components/marketing/PageMeta';

const BRAND = '#1A3C34';

const SECTIONS = [
  'overview',
  'infrastructure',
  'accessControl',
  'encryption',
  'monitoring',
  'backups',
  'incidentResponse',
  'vendorSecurity',
  'reporting',
  'contact',
];

const SecurityPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en' : 'es';

  const sections = SECTIONS.map(id => ({
    id,
    title: t(`legal.security.${id}.title`),
  }));

  return (
    <LegalPageLayout
      title={t('legal.security.pageTitle')}
      effectiveDate={t('legal.security.effectiveDate')}
      sections={sections}
    >
      <PageMeta
        title={t('legal.security.metaTitle')}
        description={t('legal.security.metaDescription')}
        path="/security"
        locale={locale}
      />

      <Typography paragraph>{t('legal.security.intro')}</Typography>

      {/* Overview */}
      <Typography variant="h4" id="overview">{t('legal.security.overview.title')}</Typography>
      <Typography paragraph>{t('legal.security.overview.body')}</Typography>

      {/* Infrastructure */}
      <Typography variant="h4" id="infrastructure">{t('legal.security.infrastructure.title')}</Typography>
      <Typography paragraph>{t('legal.security.infrastructure.body')}</Typography>
      <Box component="ul">
        {(t('legal.security.infrastructure.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* Access Control */}
      <Typography variant="h4" id="accessControl">{t('legal.security.accessControl.title')}</Typography>
      <Typography paragraph>{t('legal.security.accessControl.body')}</Typography>
      <Box component="ul">
        {(t('legal.security.accessControl.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* Encryption */}
      <Typography variant="h4" id="encryption">{t('legal.security.encryption.title')}</Typography>
      <Typography paragraph>{t('legal.security.encryption.body')}</Typography>

      {/* Monitoring */}
      <Typography variant="h4" id="monitoring">{t('legal.security.monitoring.title')}</Typography>
      <Typography paragraph>{t('legal.security.monitoring.body')}</Typography>

      {/* Backups */}
      <Typography variant="h4" id="backups">{t('legal.security.backups.title')}</Typography>
      <Typography paragraph>{t('legal.security.backups.body')}</Typography>

      {/* Incident Response */}
      <Typography variant="h4" id="incidentResponse">{t('legal.security.incidentResponse.title')}</Typography>
      <Typography paragraph>{t('legal.security.incidentResponse.body')}</Typography>

      {/* Vendor Security */}
      <Typography variant="h4" id="vendorSecurity">{t('legal.security.vendorSecurity.title')}</Typography>
      <Typography paragraph>{t('legal.security.vendorSecurity.body')}</Typography>

      {/* Responsible Disclosure */}
      <Typography variant="h4" id="reporting">{t('legal.security.reporting.title')}</Typography>
      <Typography paragraph>
        {t('legal.security.reporting.body')}{' '}
        <Link href="mailto:info@pilloto.com">info@pilloto.com</Link>.
      </Typography>

      {/* Contact */}
      <Typography variant="h4" id="contact">{t('legal.security.contact.title')}</Typography>
      <Typography paragraph>{t('legal.security.contact.body')}</Typography>

      {/* Trust Badges */}
      <Box sx={{ mt: 4, pt: 4, borderTop: '1px solid #E5E7EB' }}>
        <Typography variant="overline" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 1.5 }}>
          {t('legal.security.commitments')}
        </Typography>
        <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap" useFlexGap>
          {(t('legal.security.badges', { returnObjects: true }) as string[]).map((badge, i) => (
            <Chip key={i} label={badge} size="small"
              sx={{ backgroundColor: '#F1F5F9', color: BRAND, fontWeight: 600 }} />
          ))}
        </Stack>
      </Box>
    </LegalPageLayout>
  );
};

export default SecurityPage;
