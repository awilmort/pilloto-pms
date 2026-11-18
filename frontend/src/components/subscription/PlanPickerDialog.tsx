import React, { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Paper, Stack, Typography,
} from '@mui/material';
import { CheckCircleOutline } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { CatalogOption, SubscriptionProduct } from '../../types/subscription';
import { formatDop } from '../fiscal/fiscalUi';
import { featureLabel, limitLines, PRODUCT_LABEL } from './subscriptionUi';

interface Props {
  open: boolean;
  product: SubscriptionProduct;
  /** `add`: the tenant does not have the product (a free trial starts). */
  mode: 'change' | 'add';
  options: CatalogOption[];
  /** During the free trial every change applies at once. */
  inTrial: boolean;
  /** First day of next month, `YYYY-MM-DD` (when a downgrade applies). */
  nextMonthStart: string;
  /** Whether this product never had a trial (adding it starts one). */
  trialAvailable: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onChoose: (plan: string) => void;
}

/** Plan cards for one product: price for this tenant, what is included, and what a change would do. */
const PlanPickerDialog: React.FC<Props> = ({ open, product, mode, options, inTrial, nextMonthStart, trialAvailable, busy, error, onClose, onChoose }) => {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState<string | null>(null);
  const lang = i18n.language?.startsWith('es') ? 'es' : 'en';
  const monthDay = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${nextMonthStart}T00:00:00Z`));

  const actionLabel = (o: CatalogOption): string => {
    if (mode === 'add') return trialAvailable ? t('subscription.picker.startTrial', 'Start 14-day free trial') : t('subscription.picker.add', 'Add this plan');
    if ((o.direction ?? 0) > 0) return t('subscription.picker.upgrade', 'Upgrade now');
    if (inTrial) return t('subscription.picker.switchNow', 'Switch now');
    return t('subscription.picker.downgrade', 'Switch on {{date}}', { date: monthDay });
  };

  const confirmText = (o: CatalogOption): string => {
    if (mode === 'add') return trialAvailable
      ? t('subscription.picker.confirmTrial', 'Nothing is charged during the 14-day trial. After it, {{price}} per month plus ITBIS.', { price: formatDop(o.tenantPrice) })
      : t('subscription.picker.confirmAdd', 'You will be charged {{price}} per month plus ITBIS, by the day from today.', { price: formatDop(o.tenantPrice) });
    if ((o.direction ?? 0) > 0) return t('subscription.picker.confirmUpgrade', 'The new plan applies today. This month is charged by the day on each plan.');
    if (inTrial) return t('subscription.picker.confirmTrialSwitch', 'You are in your free trial: the change applies today.');
    return t('subscription.picker.confirmDowngrade', 'You keep your current plan until {{date}}; the new one is charged from then.', { date: monthDay });
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : () => { setPending(null); onClose(); }} maxWidth="lg" fullWidth>
      <DialogTitle>
        {mode === 'add'
          ? t('subscription.picker.titleAdd', 'Add {{product}}', { product: PRODUCT_LABEL[product] })
          : t('subscription.picker.titleChange', 'Change your {{product}} plan', { product: PRODUCT_LABEL[product] })}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2}>
          {options.map((o) => {
            const blocked = mode === 'change' && (o.direction ?? 0) < 0 && o.violations.length > 0;
            const features = Object.entries(o.features).filter(([, on]) => on).map(([k]) => featureLabel(t, product, k));
            return (
              <Grid item xs={12} sm={6} md={product === 'accounting' ? 3 : 4} key={o.slug}>
                <Paper
                  variant="outlined"
                  sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', borderColor: o.current ? 'primary.main' : 'divider', borderWidth: o.current ? 2 : 1 }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="h6" fontWeight={700}>{o.name}</Typography>
                    {o.current && <Chip size="small" color="primary" label={t('subscription.picker.current', 'Current plan')} />}
                  </Stack>
                  <Box sx={{ mb: 1.5 }}>
                    <Typography variant="h5" fontWeight={800} component="span">{formatDop(o.tenantPrice)}</Typography>
                    <Typography variant="body2" color="text.secondary" component="span"> {t('subscription.perMonth', '/month')}</Typography>
                    {o.tenantPrice < o.monthlyPrice && (
                      <Typography variant="caption" display="block" color="text.secondary" sx={{ textDecoration: 'line-through' }}>{formatDop(o.monthlyPrice)}</Typography>
                    )}
                    <Typography variant="caption" display="block" color="text.secondary">{t('subscription.plusItbis', 'plus ITBIS')}</Typography>
                  </Box>
                  <Stack spacing={0.5} sx={{ mb: 1.5, flexGrow: 1 }}>
                    {[...limitLines(t, product, o.limits), t('subscription.ecfIncluded', '{{count}} e-CF per month included', { count: o.includedEcf.transactions ?? 0 }), ...features].map((line) => (
                      <Stack key={line} direction="row" spacing={0.75} alignItems="flex-start">
                        <CheckCircleOutline sx={{ fontSize: 16, mt: '2px', color: 'success.main' }} />
                        <Typography variant="body2">{line}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                  {blocked && (
                    <Alert severity="error" sx={{ mb: 1 }}>
                      {o.violations.map((v) => t(`subscription.violation.${v.limit}`, 'You use {{current}}; this plan allows {{max}}.', { current: v.current, max: v.max })).join(' ')}
                    </Alert>
                  )}
                  {!blocked && o.lostFeatures.length > 0 && (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      {t('subscription.picker.loses', 'You lose: {{list}}', { list: o.lostFeatures.map((f) => featureLabel(t, product, f)).join(', ') })}
                    </Alert>
                  )}
                  {!o.current && (pending === o.slug ? (
                    <Box>
                      <Typography variant="body2" sx={{ mb: 1 }}>{confirmText(o)}</Typography>
                      <Stack direction="row" spacing={1}>
                        <Button variant="contained" disabled={busy} onClick={() => onChoose(o.slug)} startIcon={busy ? <CircularProgress size={14} /> : undefined}>
                          {t('subscription.picker.confirm', 'Confirm')}
                        </Button>
                        <Button disabled={busy} onClick={() => setPending(null)}>{t('common.cancel', 'Cancel')}</Button>
                      </Stack>
                    </Box>
                  ) : (
                    <Button variant={(o.direction ?? 1) > 0 ? 'contained' : 'outlined'} disabled={blocked || busy} onClick={() => setPending(o.slug)}>
                      {actionLabel(o)}
                    </Button>
                  ))}
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { setPending(null); onClose(); }} disabled={busy}>{t('common.close', 'Close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default PlanPickerDialog;
