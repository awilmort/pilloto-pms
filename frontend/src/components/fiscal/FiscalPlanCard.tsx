import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fiscalService } from '../../services/api';
import type { FiscalPlanId, FiscalPlans, FiscalStatus } from '../../types';
import FiscalPlanPicker from './FiscalPlanPicker';
import { dayLabel, fiscalErrorMessage, formatDop } from './fiscalUi';
import { invalidateFiscalStatus } from './useFiscalStatus';
import i18n from '../../i18n';

interface Props {
  status: FiscalStatus;
  onChanged: (status: FiscalStatus) => void;
}

/**
 * The company's electronic invoicing plan: what it is on, what its Pilloto plan includes, and a
 * way to change. An upgrade applies at once; a downgrade waits for the 1st of next month so a
 * month's allowance always matches what was paid for — the dialog says which will happen.
 */
const FiscalPlanCard: React.FC<Props> = ({ status, onChanged }) => {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<FiscalPlans | null>(null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<FiscalPlanId>('essential');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPlans((await fiscalService.getPlans()).data.data as FiscalPlans);
    } catch (err) {
      setError(fiscalErrorMessage(err, t));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load, status.organization?.plan, status.organization?.pendingPlan?.plan]);

  const current = plans?.plans.find((p) => p.id === plans.currentPlan);
  const picked = plans?.plans.find((p) => p.id === choice);
  const direction = picked?.change ?? 0;

  const openDialog = () => {
    setChoice(plans?.currentPlan ?? 'essential');
    setError(null);
    setOpen(true);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fiscalService.changePlan(choice);
      const next = res.data.data as FiscalStatus;
      invalidateFiscalStatus(next);
      onChanged(next);
      const outcome = res.data.outcome;
      setNotice(
        outcome === 'applied' ? t('fiscal.planCard.applied', 'Plan changed. It applies from now.')
          : outcome === 'scheduled' ? t('fiscal.planCard.scheduled', 'Done. The new plan applies on the 1st of next month.')
            : outcome === 'cancelled' ? t('fiscal.planCard.cancelled', 'The scheduled change was cancelled.')
              : null,
      );
      setOpen(false);
      await load();
    } catch (err) {
      setError(fiscalErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const pending = status.organization?.pendingPlan;

  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: { xs: 2, md: 3 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mb: 1 }}>
        <Typography variant="h6" fontWeight={700}>{t('fiscal.planCard.title', 'Plan')}</Typography>
        <Button variant="outlined" size="small" onClick={openDialog} disabled={!plans}>{t('fiscal.planCard.change', 'Change plan')}</Button>
      </Stack>

      {notice && <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>{notice}</Alert>}
      {error && !open && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!plans ? (
        <Box sx={{ py: 2 }}><CircularProgress size={20} /></Box>
      ) : (
        <>
          <Typography variant="body1">
            <strong>{t(`fiscal.plan.${plans.currentPlan}`, String(plans.currentPlan))}</strong>
            {' — '}
            {t('fiscal.plan.perMonth', { count: current?.transactions ?? 0, defaultValue: '{{count}} documents per month' })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {plans.includedPlan
              ? t('fiscal.planCard.includes', { plan: t(`fiscal.plan.${plans.includedPlan}`, plans.includedPlan), defaultValue: 'Your Pilloto plan includes the {{plan}} plan.' })
              : t('fiscal.planCard.includesNone', 'Your Pilloto plan does not include electronic invoicing, so the plan is charged in full.')}
            {' '}
            {current && (current.monthlyCharge > 0
              ? t('fiscal.planCard.youPay', { amount: formatDop(current.monthlyCharge, i18n.language), defaultValue: 'You pay {{amount}} per month for it.' })
              : t('fiscal.planCard.noExtra', 'There is no extra charge.'))}
          </Typography>
          {pending && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {t('fiscal.planCard.pending', {
                plan: t(`fiscal.plan.${pending.plan}`, pending.plan),
                day: dayLabel(pending.effectiveOn, i18n.language),
                defaultValue: 'Changing to the {{plan}} plan on {{day}}.',
              })}
            </Alert>
          )}
        </>
      )}

      <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="md" fullWidth aria-labelledby="fiscal-plan-dialog-title">
        <DialogTitle id="fiscal-plan-dialog-title">{t('fiscal.planCard.dialogTitle', 'Change electronic invoicing plan')}</DialogTitle>
        <DialogContent>
          {plans && <FiscalPlanPicker plans={plans.plans} value={choice} onChange={setChoice} currentPlan={plans.currentPlan} disabled={busy} name="fiscal-plan-change" />}
          <Box sx={{ mt: 2, minHeight: 56 }} aria-live="polite">
            {direction === 1 && <Alert severity="info">{t('fiscal.planCard.upgradeNote', 'This takes effect immediately, and the difference is charged from this month.')}</Alert>}
            {direction === -1 && <Alert severity="info">{t('fiscal.planCard.downgradeNote', 'This takes effect on the 1st of next month, so this month keeps the allowance you are paying for.')}</Alert>}
            {direction === 0 && pending && <Alert severity="info">{t('fiscal.planCard.cancelNote', 'Choosing your current plan cancels the scheduled change.')}</Alert>}
          </Box>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={confirm} disabled={busy || (direction === 0 && !pending)} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {direction === 0 && pending ? t('fiscal.planCard.cancelChange', 'Cancel the change') : t('fiscal.planCard.confirm', 'Confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default FiscalPlanCard;
