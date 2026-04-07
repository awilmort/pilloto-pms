import React from 'react';
import { Typography, Box, Link } from '@mui/material';
import { useTranslation } from 'react-i18next';
import LegalPageLayout from '../../components/marketing/LegalPageLayout';
import PageMeta from '../../components/marketing/PageMeta';

const SECTIONS = [
  'commitment',
  'standards',
  'measures',
  'knownLimitations',
  'feedback',
  'contact',
];

const AccessibilityPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en' : 'es';

  const sections = SECTIONS.map(id => ({
    id,
    title: t(`legal.accessibility.${id}.title`),
  }));

  return (
    <LegalPageLayout
      title={t('legal.accessibility.pageTitle')}
      effectiveDate={t('legal.accessibility.effectiveDate')}
      sections={sections}
    >
      <PageMeta
        title={t('legal.accessibility.metaTitle')}
        description={t('legal.accessibility.metaDescription')}
        path="/accessibility"
        locale={locale}
      />

      <Typography paragraph>{t('legal.accessibility.intro')}</Typography>

      {/* Commitment */}
      <Typography variant="h4" id="commitment">{t('legal.accessibility.commitment.title')}</Typography>
      <Typography paragraph>{t('legal.accessibility.commitment.body')}</Typography>

      {/* Standards */}
      <Typography variant="h4" id="standards">{t('legal.accessibility.standards.title')}</Typography>
      <Typography paragraph>{t('legal.accessibility.standards.body')}</Typography>

      {/* Measures */}
      <Typography variant="h4" id="measures">{t('legal.accessibility.measures.title')}</Typography>
      <Typography paragraph>{t('legal.accessibility.measures.intro')}</Typography>
      <Box component="ul">
        {(t('legal.accessibility.measures.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* Known Limitations */}
      <Typography variant="h4" id="knownLimitations">{t('legal.accessibility.knownLimitations.title')}</Typography>
      <Typography paragraph>{t('legal.accessibility.knownLimitations.body')}</Typography>

      {/* Feedback */}
      <Typography variant="h4" id="feedback">{t('legal.accessibility.feedback.title')}</Typography>
      <Typography paragraph>
        {t('legal.accessibility.feedback.body')}{' '}
        <Link href="mailto:info@pilloto.com">info@pilloto.com</Link>.
      </Typography>

      {/* Contact */}
      <Typography variant="h4" id="contact">{t('legal.accessibility.contact.title')}</Typography>
      <Typography paragraph>{t('legal.accessibility.contact.body')}</Typography>
    </LegalPageLayout>
  );
};

export default AccessibilityPage;
