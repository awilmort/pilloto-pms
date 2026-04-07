import React from 'react';
import { Typography, Link, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import LegalPageLayout from '../../components/marketing/LegalPageLayout';
import PageMeta from '../../components/marketing/PageMeta';

const SECTIONS = [
  'scope',
  'eligibility',
  'accountResponsibilities',
  'serviceDescription',
  'billing',
  'customerObligations',
  'prohibitedUses',
  'suspensionTermination',
  'ip',
  'disclaimers',
  'liability',
  'indemnification',
  'governingLaw',
  'changes',
  'contact',
];

const TermsOfServicePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en' : 'es';

  const sections = SECTIONS.map(id => ({
    id,
    title: t(`legal.terms.${id}.title`),
  }));

  return (
    <LegalPageLayout
      title={t('legal.terms.pageTitle')}
      effectiveDate={t('legal.terms.effectiveDate')}
      sections={sections}
    >
      <PageMeta
        title={t('legal.terms.metaTitle')}
        description={t('legal.terms.metaDescription')}
        path="/terms"
        locale={locale}
      />

      <Typography paragraph>{t('legal.terms.intro')}</Typography>

      {/* 1. Scope */}
      <Typography variant="h4" id="scope">{t('legal.terms.scope.title')}</Typography>
      <Typography paragraph>{t('legal.terms.scope.body')}</Typography>

      {/* 2. Eligibility */}
      <Typography variant="h4" id="eligibility">{t('legal.terms.eligibility.title')}</Typography>
      <Typography paragraph>{t('legal.terms.eligibility.body')}</Typography>

      {/* 3. Account Responsibilities */}
      <Typography variant="h4" id="accountResponsibilities">{t('legal.terms.accountResponsibilities.title')}</Typography>
      <Typography paragraph>{t('legal.terms.accountResponsibilities.body')}</Typography>
      <Box component="ul">
        {(t('legal.terms.accountResponsibilities.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* 4. Service Description */}
      <Typography variant="h4" id="serviceDescription">{t('legal.terms.serviceDescription.title')}</Typography>
      <Typography paragraph>{t('legal.terms.serviceDescription.body')}</Typography>

      {/* 5. Billing */}
      <Typography variant="h4" id="billing">{t('legal.terms.billing.title')}</Typography>
      <Typography paragraph>{t('legal.terms.billing.body')}</Typography>

      {/* 6. Customer Obligations */}
      <Typography variant="h4" id="customerObligations">{t('legal.terms.customerObligations.title')}</Typography>
      <Typography paragraph>{t('legal.terms.customerObligations.intro')}</Typography>
      <Box component="ul">
        {(t('legal.terms.customerObligations.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>

      {/* 7. Prohibited Uses */}
      <Typography variant="h4" id="prohibitedUses">{t('legal.terms.prohibitedUses.title')}</Typography>
      <Typography paragraph>{t('legal.terms.prohibitedUses.intro')}</Typography>
      <Box component="ul">
        {(t('legal.terms.prohibitedUses.items', { returnObjects: true }) as string[]).map((item, i) => (
          <li key={i}><Typography variant="body2">{item}</Typography></li>
        ))}
      </Box>
      <Typography paragraph>
        {t('legal.terms.prohibitedUses.reference')}{' '}
        <Link href="/acceptable-use">{t('legal.nav.acceptableUse')}</Link>.
      </Typography>

      {/* 8. Suspension / Termination */}
      <Typography variant="h4" id="suspensionTermination">{t('legal.terms.suspensionTermination.title')}</Typography>
      <Typography paragraph>{t('legal.terms.suspensionTermination.body')}</Typography>

      {/* 9. IP */}
      <Typography variant="h4" id="ip">{t('legal.terms.ip.title')}</Typography>
      <Typography paragraph>{t('legal.terms.ip.body')}</Typography>

      {/* 10. Disclaimers */}
      <Typography variant="h4" id="disclaimers">{t('legal.terms.disclaimers.title')}</Typography>
      <Typography paragraph>{t('legal.terms.disclaimers.body')}</Typography>

      {/* 11. Liability */}
      <Typography variant="h4" id="liability">{t('legal.terms.liability.title')}</Typography>
      <Typography paragraph>{t('legal.terms.liability.body')}</Typography>

      {/* 12. Indemnification */}
      <Typography variant="h4" id="indemnification">{t('legal.terms.indemnification.title')}</Typography>
      <Typography paragraph>{t('legal.terms.indemnification.body')}</Typography>

      {/* 13. Governing Law */}
      <Typography variant="h4" id="governingLaw">{t('legal.terms.governingLaw.title')}</Typography>
      <Typography paragraph>{t('legal.terms.governingLaw.body')}</Typography>

      {/* 14. Changes */}
      <Typography variant="h4" id="changes">{t('legal.terms.changes.title')}</Typography>
      <Typography paragraph>{t('legal.terms.changes.body')}</Typography>

      {/* 15. Contact */}
      <Typography variant="h4" id="contact">{t('legal.terms.contact.title')}</Typography>
      <Typography paragraph>{t('legal.terms.contact.body')}</Typography>
      <Typography paragraph>
        <Link href="mailto:info@pilloto.com">info@pilloto.com</Link>
      </Typography>
    </LegalPageLayout>
  );
};

export default TermsOfServicePage;
