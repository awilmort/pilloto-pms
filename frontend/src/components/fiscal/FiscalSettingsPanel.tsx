import React from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Skeleton, Stack, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import FiscalActivationCard from './FiscalActivationCard';
import FiscalPlanCard from './FiscalPlanCard';
import FiscalProgressCard from './FiscalProgressCard';
import FiscalStatementsCard from './FiscalStatementsCard';
import FiscalUsageCard from './FiscalUsageCard';
import { chipTone, fiscalErrorMessage, formatTaxId, STATE_TONE } from './fiscalUi';
import { invalidateFiscalStatus, useFiscalStatus } from './useFiscalStatus';

interface Props {
  /** Where the host app records e-NCF ranges (its Fiscal Center, sequences tab). */
  sequencesPath?: string;
  /** Where the host app lists its e-CF documents. */
  documentsPath?: string;
  onNavigate?: (path: string) => void;
}

/**
 * The one place a company sets up electronic invoicing — mounted in PMS Settings and in Accounting
 * Settings alike. It is the same company capability in both, so configuring it in one is configuring
 * it in the other: this panel only ever reads and writes the company's own state.
 */
const FiscalSettingsPanel: React.FC<Props> = ({ sequencesPath, documentsPath, onNavigate }) => {
  const { t } = useTranslation();
  const { status, loading, error, refresh } = useFiscalStatus();
  const [syncing, setSyncing] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  const sync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      invalidateFiscalStatus((await fiscalService.sync()).data.data);
    } catch (err) {
      setSyncError(fiscalErrorMessage(err, t));
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !status) {
    return (
      <Stack spacing={2} aria-busy="true" aria-label={t('common.loading', 'Loading')}>
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={260} />
      </Stack>
    );
  }

  if (!status) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => refresh(true)}>{t('fiscal.retry', 'Retry')}</Button>}>
        {fiscalErrorMessage(error, t)}
      </Alert>
    );
  }

  const org = status.organization;

  return (
    <Stack spacing={3}>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: { xs: 2, md: 3 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5}>
          <Box>
            <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Typography variant="h5" fontWeight={700}>{t('fiscal.title', 'Electronic invoicing')}</Typography>
              <Chip {...chipTone(STATE_TONE[status.state])} label={t(`fiscal.state.${status.state}`, status.state)} size="small" />
              {org && org.environment !== 'ecf' && status.state !== 'inactive' && (
                <Chip size="small" variant="outlined" label={t(`fiscal.environment.${org.environment}`, org.environment)} />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {org?.rnc
                ? t('fiscal.subtitleCompany', { rnc: formatTaxId(org.rnc), defaultValue: 'RNC {{rnc}} · One setup for Pilloto PMS and Pilloto Accounting.' })
                : t('fiscal.subtitle', 'One setup for Pilloto PMS and Pilloto Accounting.')}
            </Typography>
          </Box>
          {org && (
            <Stack direction="row" spacing={1}>
              {documentsPath && onNavigate && (
                <Button variant="outlined" size="small" onClick={() => onNavigate(documentsPath)}>{t('fiscal.viewDocuments', 'View documents')}</Button>
              )}
              <Button size="small" onClick={sync} disabled={syncing} startIcon={syncing ? <CircularProgress size={14} /> : <RefreshIcon />}>
                {t('fiscal.refresh', 'Refresh')}
              </Button>
            </Stack>
          )}
        </Stack>
        {syncError && <Alert severity="warning" sx={{ mt: 2 }}>{syncError}</Alert>}
        {status.state === 'ready' && status.allowUncertified === false && (
          <Alert severity="success" sx={{ mt: 2 }}>{t('fiscal.readyNote', 'DGII certified your company. Invoices issued from PMS or Accounting are fiscal e-CF.')}</Alert>
        )}
        {status.state === 'suspended' && (
          <Alert severity="error" sx={{ mt: 2 }}>{t('fiscal.suspendedNote', 'Electronic invoicing is suspended for your company, so nothing can be issued. Contact support to resume it.')}</Alert>
        )}
        {status.allowUncertified && status.state !== 'ready' && status.state !== 'inactive' && (
          <Alert severity="warning" sx={{ mt: 2 }}>{t('fiscal.testModeNote', 'This server lets you issue before DGII certifies the company (development only). Those documents have no fiscal value.')}</Alert>
        )}
      </Paper>

      {status.state === 'inactive' && <FiscalActivationCard status={status} onActivated={() => undefined} />}

      {org && status.state !== 'ready' && status.state !== 'suspended' && (
        <FiscalProgressCard status={status} sequencesPath={sequencesPath} onNavigate={onNavigate} />
      )}

      {org && (
        <>
          <FiscalPlanCard status={status} onChanged={() => undefined} />
          {/* One column: the settings pages are narrow, and a squeezed usage card or an overflowing table helps nobody. */}
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', xl: 'minmax(0, 1fr) minmax(0, 2fr)' } }}>
            <FiscalUsageCard refreshKey={org.plan} />
            <FiscalStatementsCard refreshKey={org.plan} />
          </Box>
        </>
      )}
    </Stack>
  );
};

export default FiscalSettingsPanel;
