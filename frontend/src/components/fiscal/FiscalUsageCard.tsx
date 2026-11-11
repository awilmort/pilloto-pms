import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, CircularProgress, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { FiscalUsage } from '../../types';
import { chipTone, fiscalErrorMessage, formatDop, usageRatio, formatInt } from './fiscalUi';
import i18n from '../../i18n';

interface Props {
  /** Bump to read again (after a plan change). */
  refreshKey?: string;
}

/**
 * This month's electronic invoicing against the plan: how many documents, how many are included,
 * and what the extra ones cost so far. Issuing is never blocked by usage; beyond the allowance each
 * document is charged at the plan's rate, which is shown before it happens, not after.
 */
const FiscalUsageCard: React.FC<Props> = ({ refreshKey }) => {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<FiscalUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    fiscalService
      .getUsage()
      .then((res) => alive && setUsage(res.data.data as FiscalUsage))
      .catch((err) => alive && setError(fiscalErrorMessage(err, t)));
    return () => { alive = false; };
  }, [refreshKey, t]);

  const ratio = usage ? usageRatio(usage.transactions.used, usage.transactions.included) : 0;
  const over = usage ? usage.transactions.extra > 0 : false;
  const month = usage ? new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric', timeZone: 'America/Santo_Domingo' }).format(new Date(usage.period.start)) : '';

  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: { xs: 2, md: 3 }, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1 }}>
        <Typography variant="h6" fontWeight={700}>{t('fiscal.usage.title', 'This month')}</Typography>
        {usage && <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{month}</Typography>}
      </Stack>

      {error && <Alert severity="warning">{error}</Alert>}
      {!usage && !error && <Box sx={{ py: 2 }}><CircularProgress size={20} /></Box>}

      {usage && (
        <>
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <Typography variant="h4" fontWeight={700}>{formatInt(usage.transactions.used)}</Typography>
            <Typography variant="body1" color="text.secondary">
              {t('fiscal.usage.ofIncluded', { count: usage.transactions.included, defaultValue: 'of {{count}} included' })}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={Math.min(100, ratio * 100)}
            color={over ? 'error' : ratio >= 0.8 ? 'warning' : 'primary'}
            aria-label={t('fiscal.usage.barLabel', 'Documents used this month')}
            sx={{ height: 8, borderRadius: 4, my: 1.5 }}
          />
          {over ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {t('fiscal.usage.over', {
                extra: usage.transactions.extra, amount: formatDop(usage.overageAmount, i18n.language), unit: formatDop(usage.overageUnitPrice, i18n.language),
                defaultValue: '{{extra}} documents beyond your allowance, {{unit}} each: {{amount}} so far.',
              })}
            </Alert>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('fiscal.usage.remaining', {
                count: Math.max(0, usage.transactions.included - usage.transactions.used), unit: formatDop(usage.overageUnitPrice, i18n.language),
                defaultValue: '{{count}} left. After that, {{unit}} each.',
              })}
            </Typography>
          )}

          <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">{t('fiscal.usage.planCharge', 'Plan')}</Typography>
              <Typography variant="body2">{formatDop(usage.planCharge, i18n.language)}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">{t('fiscal.usage.overage', 'Beyond the allowance')}</Typography>
              <Typography variant="body2">{formatDop(usage.overageAmount, i18n.language)}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>{t('fiscal.usage.total', 'Total so far')}</Typography>
              <Chip size="small" {...chipTone(usage.total > 0 ? 'warning' : 'success')} label={usage.total > 0 ? formatDop(usage.total, i18n.language) : t('fiscal.usage.noCharge', 'No charge')} />
            </Stack>
          </Box>
        </>
      )}
    </Paper>
  );
};

export default FiscalUsageCard;
