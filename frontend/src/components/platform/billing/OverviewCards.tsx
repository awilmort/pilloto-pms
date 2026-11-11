import React from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { BillingOverview } from '../../../types/billing';
import { formatDop, periodLabel } from './billingUi';

interface Props {
  overview: BillingOverview | null;
  onNavigate: (tab: 'charges' | 'payments' | 'ecf') => void;
}

const Card: React.FC<{ label: string; value: string; hint?: string; tone?: 'error' | 'warning' | 'success' }> = ({ label, value, hint, tone }) => (
  <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2.5 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="h5" fontWeight={700} sx={{ my: 0.5, color: tone ? `${tone}.main` : undefined }}>{value}</Typography>
    {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
  </Paper>
);

/** The four numbers that say how collection is going, and the one thing that can block it. */
const OverviewCards: React.FC<Props> = ({ overview, onNavigate }) => {
  const { t, i18n } = useTranslation();
  if (!overview) return null;
  const ready = overview.issuer.state === 'ready';

  return (
    <Box sx={{ mb: 3 }}>
      {!ready && (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => onNavigate('ecf')}>{t('platformBilling.overview.fix', 'Set up')}</Button>}>
          {t('platformBilling.overview.issuerNotReady', 'Pilloto’s own e-invoicing is not ready. Payments are recorded, but their e-CF waits until it is.')}
        </Alert>
      )}
      {overview.ecf.notIssued > 0 && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => onNavigate('payments')}>{t('platformBilling.overview.review', 'Review')}</Button>}>
          {t('platformBilling.overview.notIssued', 'Payments without an e-CF: {{n}}', { n: overview.ecf.notIssued })}
        </Alert>
      )}
      {overview.ecf.needAttention > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => onNavigate('payments')}>{t('platformBilling.overview.review', 'Review')}</Button>}>
          {t('platformBilling.overview.needAttention', 'e-CF rejected or never confirmed: {{n}}', { n: overview.ecf.needAttention })}
        </Alert>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' } }}>
        <Card label={t('platformBilling.overview.outstanding', 'Owed to Pilloto')} value={formatDop(overview.outstanding.balance)} hint={t('platformBilling.overview.charges', 'Open charges: {{n}}', { n: overview.outstanding.count })} />
        <Card label={t('platformBilling.overview.overdue', 'Overdue')} value={formatDop(overview.overdue.balance)} tone={overview.overdue.count > 0 ? 'error' : undefined} hint={t('platformBilling.overview.charges', 'Open charges: {{n}}', { n: overview.overdue.count })} />
        <Card label={t('platformBilling.overview.collected', 'Collected this month')} value={formatDop(overview.collectedThisMonth.amount)} tone="success" hint={`${periodLabel(overview.period, i18n.language)} · ${t('platformBilling.overview.payments', 'Payments: {{n}}', { n: overview.collectedThisMonth.count })}`} />
        <Card label={t('platformBilling.overview.ecf', 'e-CF to review')} value={String(overview.ecf.notIssued + overview.ecf.needAttention)} tone={overview.ecf.notIssued + overview.ecf.needAttention > 0 ? 'warning' : undefined} hint={t('platformBilling.overview.ecfHint', 'Not issued, rejected or unconfirmed')} />
      </Box>
    </Box>
  );
};

export default OverviewCards;
