import React from 'react';
import { Typography, Box, Link } from '@mui/material';
import { useTranslation } from 'react-i18next';
import LegalPageLayout from '../../components/marketing/LegalPageLayout';
import PageMeta from '../../components/marketing/PageMeta';

const SECTIONS = [
  'overview',
  'emailRules',
  'platformRules',
  'dataRules',
  'enforcement',
  'reporting',
  'contact',
];

const AcceptableUsePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en' : 'es';

  const sections = SECTIONS.map(id => ({
    id,
    title: t(`legal.aup.${id}.title`),
  }));

  return (
    <LegalPageLayout
      title={t('legal.aup.pageTitle')}
      effectiveDate={t('legal.aup.effectiveDate')}
      sections={sections}
    >
      <PageMeta
        title={t('legal.aup.metaTitle')}
        description={t('legal.aup.metaDescription')}
        path="/acceptable-use"
        locale={locale}
      />

      <Typography paragraph>{t('legal.aup.intro')}</Typography>

      {/* Overview */}
      <Typography variant="h4" id="overview">{t('legal.aup.overview.title')}</Typography>
      <Typography paragraph>{t('legal.aup.overview.body')}</Typography>

      {/* Email Rules */}
      <Typography variant="h4" id="emailRules">{t('legal.aup.emailRules.title')}</Typography>
      <Typography paragraph>{t('legal.aup.emailRules.intro')}</Typography>
      <Box component="ul">
        {(t('legal.aup.emailRules.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* Platform Rules */}
      <Typography variant="h4" id="platformRules">{t('legal.aup.platformRules.title')}</Typography>
      <Typography paragraph>{t('legal.aup.platformRules.intro')}</Typography>
      <Box component="ul">
        {(t('legal.aup.platformRules.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* Data Rules */}
      <Typography variant="h4" id="dataRules">{t('legal.aup.dataRules.title')}</Typography>
      <Typography paragraph>{t('legal.aup.dataRules.intro')}</Typography>
      <Box component="ul">
        {(t('legal.aup.dataRules.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* Enforcement */}
      <Typography variant="h4" id="enforcement">{t('legal.aup.enforcement.title')}</Typography>
      <Typography paragraph>{t('legal.aup.enforcement.body')}</Typography>
      <Box component="ul">
        {(t('legal.aup.enforcement.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* Reporting */}
      <Typography variant="h4" id="reporting">{t('legal.aup.reporting.title')}</Typography>
      <Typography paragraph>
        {t('legal.aup.reporting.body')}{' '}
        <Link href="mailto:info@pilloto.com">info@pilloto.com</Link>.
      </Typography>

      {/* Contact */}
      <Typography variant="h4" id="contact">{t('legal.aup.contact.title')}</Typography>
      <Typography paragraph>{t('legal.aup.contact.body')}</Typography>
    </LegalPageLayout>
  );
};

export default AcceptableUsePage;
