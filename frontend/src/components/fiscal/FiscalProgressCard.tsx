import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { FiscalReadiness, FiscalStatus } from '../../types';
import { fiscalErrorMessage } from './fiscalUi';
import { invalidateFiscalStatus } from './useFiscalStatus';

interface Props {
  status: FiscalStatus;
  /** Where the e-NCF ranges are recorded in the host app (the Fiscal Center's sequences tab). */
  sequencesPath?: string;
  onNavigate?: (path: string) => void;
}

type RowState = 'done' | 'todo' | 'working';

interface Row {
  key: string;
  state: RowState;
  title: string;
  detail: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

const Icon: React.FC<{ state: RowState }> = ({ state }) =>
  state === 'done' ? <CheckCircleIcon color="success" /> : state === 'working' ? <HourglassTopIcon color="info" /> : <RadioButtonUncheckedIcon color="disabled" />;

/**
 * Where the company is between "account created" and "DGII certified". The steps that only the
 * company can do (the digital certificate, DGII's certification) happen in BillingSoft, so each
 * links straight there; everything Pilloto can see for itself is shown as it happens.
 */
const FiscalProgressCard: React.FC<Props> = ({ status, sequencesPath, onNavigate }) => {
  const { t } = useTranslation();
  const [readiness, setReadiness] = useState<FiscalReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const org = status.organization!;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Re-read the certification from BillingSoft, then the live checklist.
      const synced = await fiscalService.sync().catch(() => null);
      if (synced) invalidateFiscalStatus(synced.data.data as FiscalStatus);
      setReadiness((await fiscalService.getReadiness()).data.data as FiscalReadiness);
    } catch (err) {
      setError(fiscalErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const done = (step: FiscalReadiness['steps'][number]['step']) => readiness?.steps.find((s) => s.step === step)?.done ?? false;
  const certification = org.certification;
  const links = status.links;

  const rows: Row[] = [
    {
      key: 'account',
      state: 'done',
      title: t('fiscal.progress.account', 'Account created in BillingSoft'),
      detail: t('fiscal.progress.accountDetail', { email: org.adminEmail ?? '', defaultValue: 'We invited {{email}} to set a password and finish the steps below.' }),
    },
    {
      key: 'certificate',
      state: done('certificate') ? 'done' : 'todo',
      title: t('fiscal.progress.certificate', 'Digital certificate'),
      detail: readiness?.certificate === 'expiring'
        ? t('fiscal.progress.certificateExpiring', 'Uploaded, but it expires soon. Renew it in BillingSoft.')
        : readiness?.certificate === 'expired'
          ? t('fiscal.progress.certificateExpired', 'It expired. Upload a new one in BillingSoft.')
          : t('fiscal.progress.certificateDetail', 'The .p12 file from your certification authority. It is uploaded in BillingSoft, never through Pilloto.'),
      action: done('certificate') ? undefined : { label: t('fiscal.progress.openBillingSoft', 'Open BillingSoft'), href: links.certificate },
    },
    {
      key: 'certification',
      state: certification === 'certified' ? 'done' : certification === 'in_progress' ? 'working' : 'todo',
      title: t('fiscal.progress.certification', 'DGII certification'),
      detail: certification === 'certified'
        ? t('fiscal.progress.certificationDone', 'DGII certified your company. You can issue fiscal e-CF.')
        : certification === 'in_progress'
          ? t('fiscal.progress.certificationRunning', 'In progress. DGII’s tests run in BillingSoft; this updates here by itself.')
          : t('fiscal.progress.certificationTodo', 'Complete DGII’s tests in BillingSoft’s certification wizard. If you changed provider, your previous postulation must be concluded first.'),
      action: certification === 'certified' ? undefined : { label: t('fiscal.progress.openWizard', 'Open the certification wizard'), href: links.certification },
    },
    {
      key: 'sequences',
      state: done('sequences') ? 'done' : 'todo',
      title: t('fiscal.progress.sequences', 'e-NCF ranges'),
      detail: t('fiscal.progress.sequencesDetail', 'The numbers DGII authorized you to issue. Record them here once DGII grants them.'),
      action: done('sequences') || !sequencesPath ? undefined : { label: t('fiscal.progress.recordSequences', 'Record ranges'), onClick: () => onNavigate?.(sequencesPath) },
    },
    {
      key: 'directory',
      state: done('directory') ? 'done' : 'todo',
      title: t('fiscal.progress.directory', 'DGII directory'),
      detail: t('fiscal.progress.directoryDetail', 'Your reception and approval URLs registered with DGII, so suppliers can send you e-CF. If you used another provider before, update them.'),
      action: done('directory') ? undefined : { label: t('fiscal.progress.seeUrls', 'See the URLs to register'), href: links.onboarding },
    },
    {
      key: 'first',
      state: done('first_document') ? 'done' : 'todo',
      title: t('fiscal.progress.firstDocument', 'First accepted e-CF'),
      detail: t('fiscal.progress.firstDocumentDetail', 'Issue any invoice. Once DGII accepts it, setup is complete.'),
    },
  ];

  const finished = rows.filter((r) => r.state === 'done').length;

  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="h6" fontWeight={700}>{t('fiscal.progress.title', 'Getting ready to issue')}</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" label={t('fiscal.progress.count', { done: finished, total: rows.length, defaultValue: '{{done}} of {{total}}' })} />
          <Button size="small" onClick={load} disabled={loading} startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}>
            {t('fiscal.progress.check', 'Check again')}
          </Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {org.environment === 'ecf'
          ? t('fiscal.progress.productionNote', 'Your company is in production.')
          : t('fiscal.progress.testNote', 'Until DGII certifies your company, Pilloto does not issue fiscal invoices: anything issued in DGII’s test environments has no fiscal value.')}
      </Typography>
      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack component="ol" spacing={0} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {rows.map((row, i) => (
          <Box
            key={row.key}
            component="li"
            sx={{ display: 'flex', gap: 1.5, py: 1.5, borderTop: i === 0 ? 0 : '1px solid', borderColor: 'divider', alignItems: 'flex-start' }}
          >
            <Box sx={{ pt: 0.25 }} aria-hidden><Icon state={row.state} /></Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                {row.title}
                <Box component="span" sx={visuallyHidden}>{` — ${t(`fiscal.progress.state.${row.state}`, row.state)}`}</Box>
              </Typography>
              <Typography variant="body2" color="text.secondary">{row.detail}</Typography>
            </Box>
            {row.action && (
              row.action.href ? (
                <Button size="small" variant={row.state === 'todo' ? 'outlined' : 'text'} component={MuiLink} href={row.action.href} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNewIcon fontSize="small" />} sx={{ whiteSpace: 'nowrap', textDecoration: 'none' }}>
                  {row.action.label}
                </Button>
              ) : (
                <Button size="small" variant="outlined" onClick={row.action.onClick} sx={{ whiteSpace: 'nowrap' }}>{row.action.label}</Button>
              )
            )}
          </Box>
        ))}
      </Stack>
    </Paper>
  );
};

const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, p: 0, m: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

export default FiscalProgressCard;
