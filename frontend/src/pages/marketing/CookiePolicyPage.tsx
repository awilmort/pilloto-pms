import React from 'react';
import { Typography, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import LegalPageLayout from '../../components/marketing/LegalPageLayout';
import PageMeta from '../../components/marketing/PageMeta';

const SECTIONS = [
  'whatAreCookies',
  'cookiesWeUse',
  'essential',
  'functional',
  'analytics',
  'thirdParty',
  'consent',
  'manageCookies',
  'doNotTrack',
  'changes',
  'contact',
];

const CookiePolicyPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en' : 'es';

  const sections = SECTIONS.map(id => ({
    id,
    title: t(`legal.cookiePolicy.${id}.title`),
  }));

  return (
    <LegalPageLayout
      title={t('legal.cookiePolicy.pageTitle')}
      effectiveDate={t('legal.cookiePolicy.effectiveDate')}
      sections={sections}
    >
      <PageMeta
        title={t('legal.cookiePolicy.metaTitle')}
        description={t('legal.cookiePolicy.metaDescription')}
        path="/cookies"
        locale={locale}
      />

      <Typography paragraph>{t('legal.cookiePolicy.intro')}</Typography>

      <Typography variant="h4" id="whatAreCookies">{t('legal.cookiePolicy.whatAreCookies.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.whatAreCookies.body')}</Typography>

      <Typography variant="h4" id="cookiesWeUse">{t('legal.cookiePolicy.cookiesWeUse.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.cookiesWeUse.body')}</Typography>

      <Typography variant="h4" id="essential">{t('legal.cookiePolicy.essential.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.essential.intro')}</Typography>
      <Box component="ul">
        {(t('legal.cookiePolicy.essential.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      <Typography variant="h4" id="functional">{t('legal.cookiePolicy.functional.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.functional.intro')}</Typography>
      <Box component="ul">
        {(t('legal.cookiePolicy.functional.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      <Typography variant="h4" id="analytics">{t('legal.cookiePolicy.analytics.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.analytics.body')}</Typography>

      <Typography variant="h4" id="thirdParty">{t('legal.cookiePolicy.thirdParty.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.thirdParty.body')}</Typography>

      <Typography variant="h4" id="consent">{t('legal.cookiePolicy.consent.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.consent.body')}</Typography>

      <Typography variant="h4" id="manageCookies">{t('legal.cookiePolicy.manageCookies.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.manageCookies.body')}</Typography>

      <Typography variant="h4" id="doNotTrack">{t('legal.cookiePolicy.doNotTrack.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.doNotTrack.body')}</Typography>

      <Typography variant="h4" id="changes">{t('legal.cookiePolicy.changes.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.changes.body')}</Typography>

      <Typography variant="h4" id="contact">{t('legal.cookiePolicy.contact.title')}</Typography>
      <Typography paragraph>{t('legal.cookiePolicy.contact.body')}</Typography>
    </LegalPageLayout>
  );
};

export default CookiePolicyPage;
