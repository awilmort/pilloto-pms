import React from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { CheckCircle, ExpandMore, OpenInNew } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { BillingIssuer } from '../../../types/billing';

type Need = 'required' | 'recommended' | 'optional';

const ENV_ROWS: { name: string; need: Need; key: string; fallback: string }[] = [
  { name: 'BILLINGSOFT_PARTNER_API_KEY', need: 'required', key: 'envKey', fallback: 'The key from step 4. Without it this page cannot link.' },
  { name: 'BILLINGSOFT_API_URL', need: 'optional', key: 'envApi', fallback: 'Where BillingSoft’s API is. Default: https://api.billingsoft.net. Change it only for a local or staging BillingSoft.' },
  { name: 'BACKEND_PUBLIC_URL', need: 'recommended', key: 'envPublic', fallback: 'Pilloto’s own public https address (the backend already uses it). BillingSoft calls it to tell Pilloto what DGII decided. Without it Pilloto asks BillingSoft every minute instead.' },
  { name: 'ECF_ENCRYPTION_KEY', need: 'recommended', key: 'envEncryption', fallback: '64 hex characters. Stores the webhook secrets safely. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' },
  { name: 'BILLINGSOFT_APP_URL', need: 'optional', key: 'envApp', fallback: 'Only for the “Open BillingSoft” links in this interface, which a person opens in a browser. Pilloto never calls it. Default: https://app.billingsoft.net.' },
];

interface StepProps { n: number; title: string; children?: React.ReactNode }
const Step: React.FC<StepProps> = ({ n, title, children }) => (
  <Stack direction="row" spacing={1.5} sx={{ py: 1 }}>
    <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: 'action.selected', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{n}</Box>
    <Box>
      <Typography variant="body2" fontWeight={600}>{title}</Typography>
      {children && <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.25 }}>{children}</Typography>}
    </Box>
  </Stack>
);

const Group: React.FC<{ title: string; done: boolean; children: React.ReactNode }> = ({ title, done, children }) => {
  const { t } = useTranslation();
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
        {done ? <Chip size="small" color="success" icon={<CheckCircle />} label={t('platformBilling.guide.done', 'Done')} /> : <Chip size="small" variant="outlined" label={t('platformBilling.guide.todo', 'To do')} />}
      </Stack>
      {children}
    </Box>
  );
};

/**
 * A one-time guide to connect Pilloto's own e-invoicing: what to do in BillingSoft, in Pilloto's
 * server settings, and what remains before it issues for real. Each part shows whether it is done,
 * from what the server already reports. Open while the setup is unfinished, closed after.
 */
const IssuerSetupGuide: React.FC<{ issuer: BillingIssuer }> = ({ issuer }) => {
  const { t } = useTranslation();
  const ready = issuer.state === 'ready';
  const appLink = (path: string, label: string) => (
    <Link href={`${issuer.appUrl.replace(/\/$/, '')}${path}`} target="_blank" rel="noopener" underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
      {label}<OpenInNew sx={{ fontSize: 14 }} />
    </Link>
  );

  return (
    <Accordion defaultExpanded={!ready} disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', '&::before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMore />} aria-controls="issuer-guide-content" id="issuer-guide-header">
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>{t('platformBilling.guide.title', 'Setup guide: connect Pilloto to BillingSoft')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {ready ? t('platformBilling.guide.introReady', 'Everything is set up. Keep this for reference.') : t('platformBilling.guide.intro', 'Pilloto issues its own e-CF through BillingSoft, the way it does for tenants. This is a one-time setup, in three parts.')}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails id="issuer-guide-content">
        <Group title={t('platformBilling.guide.groupBillingSoft', 'A. In BillingSoft: get Pilloto’s key')} done={issuer.configured}>
          <Step n={1} title={t('platformBilling.guide.s1', 'Sign in to BillingSoft’s admin console as an operator.')}>
            {t('platformBilling.guide.s1b', 'If there is no operator yet, create the first one with the platform:bootstrap command described in BillingSoft’s README.')}
          </Step>
          <Step n={2} title={t('platformBilling.guide.s2', 'Create Pilloto’s organization: Organizaciones → Nueva organización.')}>
            {t('platformBilling.guide.s2b', 'Use Pilloto’s legal name, RNC and address (the address is printed on every e-CF). The administrator you enter is the person who will upload the certificate and complete DGII’s certification.')}
          </Step>
          <Step n={3} title={t('platformBilling.guide.s3', 'Open that organization and click “Convertir en socio” (section “Socio”).')}>
            {t('platformBilling.guide.s3b', 'This lets one key act for Pilloto and for every tenant. Until then the Integraciones page is hidden.')}
          </Step>
          <Step n={4} title={t('platformBilling.guide.s4', 'As that administrator, in the BillingSoft dashboard: Integraciones → Claves de API → Crear clave.')}>
            {t('platformBilling.guide.s4b', 'Name it (for example “Pilloto, producción”) and copy it: it is shown only once.')}{' '}
            {appLink('/integraciones', t('platformBilling.guide.openIntegrations', 'Open Integraciones'))}
          </Step>
        </Group>

        <Group title={t('platformBilling.guide.groupPilloto', 'B. In Pilloto’s server: add the key and link')} done={issuer.configured && issuer.linked}>
          <Step n={5} title={t('platformBilling.guide.s5', 'Add the variables below to the backend’s environment, then restart the backend.')}>
            {t('platformBilling.guide.s5b', 'The key is read when the backend starts. Only the first one is needed to unlock the Link button.')}
          </Step>
          <Table size="small" sx={{ my: 1 }} aria-label={t('platformBilling.guide.envTable', 'Backend variables')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('platformBilling.guide.variable', 'Variable')}</TableCell>
                <TableCell>{t('platformBilling.guide.need', 'Needed')}</TableCell>
                <TableCell>{t('platformBilling.guide.what', 'What it is for')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ENV_ROWS.map((row) => (
                <TableRow key={row.name}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{row.name}</TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Chip size="small" variant={row.need === 'required' ? 'filled' : 'outlined'} color={row.need === 'required' ? 'primary' : 'default'} label={t(`platformBilling.guide.need_${row.need}`, row.need)} />
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>{t(`platformBilling.guide.${row.key}`, row.fallback)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Step n={6} title={t('platformBilling.guide.s6', 'Come back to this page and click “Link Pilloto’s e-invoicing”.')}>
            {t('platformBilling.guide.s6b', 'Pilloto reads its state from BillingSoft and registers its webhook (if the public address is set).')}
          </Step>
        </Group>

        <Group title={t('platformBilling.guide.groupIssue', 'C. To issue for real')} done={ready}>
          <Step n={7} title={t('platformBilling.guide.s7', 'As Pilloto’s administrator in the BillingSoft dashboard, finish DGII’s requirements.')}>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              <li>{appLink('/certificado', t('platformBilling.guide.certificate', 'Certificado'))}: {t('platformBilling.guide.certificateHelp', 'upload the digital certificate (.p12).')}</li>
              <li>{appLink('/certificacion', t('platformBilling.guide.certification', 'Certificación'))}: {t('platformBilling.guide.certificationHelp', 'complete DGII’s certification.')}</li>
              <li>{appLink('/secuencias', t('platformBilling.guide.sequences', 'Secuencias'))}: {t('platformBilling.guide.sequencesHelp', 'record the e-NCF ranges for E31 and E34 (or use the form further down this page).')}</li>
            </Box>
          </Step>
          <Step n={8} title={t('platformBilling.guide.s8', 'When DGII certifies Pilloto, a BillingSoft operator moves the organization to “Producción (ecf)”.')}>
            {t('platformBilling.guide.s8b', 'It is the “Ambiente DGII” on the organization’s page in the admin console. Then press “Refresh status” here: the state turns Ready.')}
          </Step>
          <Step n={9} title={t('platformBilling.guide.s9', 'Until it is Ready, payments are still recorded; their e-CF waits.')}>
            {t('platformBilling.guide.s9b', 'You can issue it afterwards from each payment, so nothing is lost.')}
          </Step>
        </Group>
      </AccordionDetails>
    </Accordion>
  );
};

export default IssuerSetupGuide;
