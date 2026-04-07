import React from 'react';
import { Typography, Link, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import LegalPageLayout from '../../components/marketing/LegalPageLayout';
import PageMeta from '../../components/marketing/PageMeta';

const SECTIONS = [
  'controller',
  'dataCollected',
  'sources',
  'purposes',
  'legalBases',
  'sharing',
  'internationalTransfers',
  'retention',
  'security',
  'rights',
  'drRights',
  'gdprRights',
  'usRights',
  'children',
  'cookieReference',
  'processorRole',
  'changes',
  'contact',
];

const PrivacyPolicyPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en' : 'es';

  const sections = SECTIONS.map(id => ({
    id,
    title: t(`legal.privacy.${id}.title`),
  }));

  return (
    <LegalPageLayout
      title={t('legal.privacy.pageTitle')}
      effectiveDate={t('legal.privacy.effectiveDate')}
      sections={sections}
    >
      <PageMeta
        title={t('legal.privacy.metaTitle')}
        description={t('legal.privacy.metaDescription')}
        path="/privacy"
        locale={locale}
      />

      {/* Intro */}
      <Typography paragraph>{t('legal.privacy.intro')}</Typography>

      {/* 1. Controller */}
      <Typography variant="h4" id="controller">{t('legal.privacy.controller.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.controller.body')}</Typography>

      {/* 2. Data Collected */}
      <Typography variant="h4" id="dataCollected">{t('legal.privacy.dataCollected.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.dataCollected.intro')}</Typography>
      <Box component="ul">
        {(t('legal.privacy.dataCollected.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* 3. Sources */}
      <Typography variant="h4" id="sources">{t('legal.privacy.sources.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.sources.body')}</Typography>

      {/* 4. Purposes */}
      <Typography variant="h4" id="purposes">{t('legal.privacy.purposes.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.purposes.intro')}</Typography>
      <Box component="ul">
        {(t('legal.privacy.purposes.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* 5. Legal Bases */}
      <Typography variant="h4" id="legalBases">{t('legal.privacy.legalBases.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.legalBases.body')}</Typography>

      {/* 6. Sharing */}
      <Typography variant="h4" id="sharing">{t('legal.privacy.sharing.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.sharing.intro')}</Typography>
      <Box component="ul">
        {(t('legal.privacy.sharing.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>
      <Typography paragraph>{t('legal.privacy.sharing.noSale')}</Typography>

      {/* 7. International Transfers */}
      <Typography variant="h4" id="internationalTransfers">{t('legal.privacy.internationalTransfers.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.internationalTransfers.body')}</Typography>

      {/* 8. Retention */}
      <Typography variant="h4" id="retention">{t('legal.privacy.retention.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.retention.body')}</Typography>

      {/* 9. Security */}
      <Typography variant="h4" id="security">{t('legal.privacy.security.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.security.body')}</Typography>

      {/* 10. Your Rights */}
      <Typography variant="h4" id="rights">{t('legal.privacy.rights.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.rights.intro')}</Typography>

      {/* 11. DR Rights */}
      <Typography variant="h4" id="drRights">{t('legal.privacy.drRights.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.drRights.body')}</Typography>
      <Box component="ul">
        {(t('legal.privacy.drRights.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* 12. GDPR Rights */}
      <Typography variant="h4" id="gdprRights">{t('legal.privacy.gdprRights.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.gdprRights.body')}</Typography>
      <Box component="ul">
        {(t('legal.privacy.gdprRights.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* 13. US Rights */}
      <Typography variant="h4" id="usRights">{t('legal.privacy.usRights.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.usRights.body')}</Typography>

      {/* 14. Children */}
      <Typography variant="h4" id="children">{t('legal.privacy.children.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.children.body')}</Typography>

      {/* 15. Cookie Reference */}
      <Typography variant="h4" id="cookieReference">{t('legal.privacy.cookieReference.title')}</Typography>
      <Typography paragraph>
        {t('legal.privacy.cookieReference.body')}{' '}
        <Link href="/cookies">{t('legal.nav.cookies')}</Link>.
      </Typography>

      {/* 16. Processor Role */}
      <Typography variant="h4" id="processorRole">{t('legal.privacy.processorRole.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.processorRole.body')}</Typography>

      {/* 17. Changes */}
      <Typography variant="h4" id="changes">{t('legal.privacy.changes.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.changes.body')}</Typography>

      {/* 18. Contact */}
      <Typography variant="h4" id="contact">{t('legal.privacy.contact.title')}</Typography>
      <Typography paragraph>{t('legal.privacy.contact.body')}</Typography>
      <Typography paragraph>
        {t('legal.privacy.contact.email')}: <Link href="mailto:info@pilloto.com">info@pilloto.com</Link>
      </Typography>
    </LegalPageLayout>
  );
};

export default PrivacyPolicyPage;
