import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  Grid, LinearProgress, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { AddCircleOutline } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { usePageTitle } from '../../components/shared/PageTitle';
import ChargesCard from '../../components/subscription/ChargesCard';
import PlanPickerDialog from '../../components/subscription/PlanPickerDialog';
import { featureLabel, limitLines, longDate, nextMonthStart, PRODUCT_LABEL } from '../../components/subscription/subscriptionUi';
import { formatDop } from '../../components/fiscal/fiscalUi';
import { subscriptionService } from '../../services/subscriptionApi';
import type {
  SubscriptionOverview, SubscriptionProduct, SubscriptionProductView, TenantCatalog,
} from '../../types/subscription';

type ApiError = { response?: { data?: { code?: string; message?: string } } };

const STATUS_COLOR: Record<string, 'success' | 'info' | 'warning' | 'default'> = { active: 'success', trial: 'info', cancelling: 'warning', ended: 'default' };

/**
 * "Plan y facturación" — the tenant's own Pilloto subscription, in both apps (/admin/subscription
 * and /accounting/subscription): plans and prices, usage against the plan, plan changes, adding or
 * cancelling a product, the monthly charges and paying them online.
 */
const SubscriptionPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  usePageTitle(t('subscription.title', 'Plan & billing'));
  const lang = i18n.language?.startsWith('es') ? 'es' : 'en';
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const returnUrl = location.pathname.startsWith('/accounting') ? '/accounting/subscription' : '/admin/subscription';

  const [overview, setOverview] = useState<SubscriptionOverview | null>(null);
  const [catalog, setCatalog] = useState<TenantCatalog | null>(null);
  const [chargesKey, setChargesKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'info' | 'warning'; text: string } | null>(null);
  const [picker, setPicker] = useState<{ product: SubscriptionProduct; mode: 'change' | 'add' } | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<SubscriptionProduct | null>(null);
  const [email, setEmail] = useState('');

  const message = useCallback((err: unknown) => {
    const data = (err as ApiError)?.response?.data;
    if (data?.code) {
      const key = `subscription.errors.${data.code}`;
      const translated = t(key, { defaultValue: '' });
      if (translated) return translated;
    }
    return data?.message || t('subscription.errors.generic', 'Something went wrong. Try again.');
  }, [t]);

  const load = useCallback(async () => {
    try {
      const [o, c] = await Promise.all([subscriptionService.overview(), subscriptionService.catalog()]);
      setOverview(o.data.data);
      setEmail(o.data.data.billingEmail);
      setCatalog(c.data.data);
      setChargesKey((k) => k + 1);
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, [message]);

  useEffect(() => { load(); }, [load]);

  // Coming back from HandyPay's checkout page.
  useEffect(() => {
    const payment = params.get('payment');
    if (!payment) return;
    const session = params.get('session');
    setParams({}, { replace: true });
    if (payment === 'cancelled') {
      setNotice({ tone: 'info', text: t('subscription.pay.cancelled', 'The payment was cancelled. Nothing was charged.') });
      return;
    }
    if (payment === 'success' && session) {
      subscriptionService.confirm(session)
        .then((r) => {
          const outcome = r.data.data.outcome;
          if (outcome === 'recorded' || outcome === 'already_recorded') setNotice({ tone: 'success', text: t('subscription.pay.done', 'Payment received. Your electronic invoice (e-CF) is on its way to your email.') });
          else if (outcome === 'needs_review') setNotice({ tone: 'warning', text: t('subscription.pay.review', 'We received your payment and are applying it to your account. No action is needed.') });
          else setNotice({ tone: 'info', text: t('subscription.pay.pending', 'Your payment is being processed. This page updates once it is confirmed.') });
          load();
        })
        .catch(() => setNotice({ tone: 'info', text: t('subscription.pay.pending', 'Your payment is being processed. This page updates once it is confirmed.') }));
    }
  }, [params, setParams, t, load]);

  const byProduct = useMemo(() => Object.fromEntries((overview?.products ?? []).map((p) => [p.product, p])) as Partial<Record<SubscriptionProduct, SubscriptionProductView>>, [overview]);

  const choose = async (plan: string) => {
    if (!picker) return;
    setBusy(true);
    setPickerError(null);
    try {
      if (picker.mode === 'add') {
        const r = await subscriptionService.addProduct(picker.product, plan);
        setOverview(r.data.data);
        setNotice({ tone: 'success', text: t('subscription.notice.added', '{{product}} is ready. Reload the page to open it from the app switcher.', { product: PRODUCT_LABEL[picker.product] }) });
      } else {
        const r = await subscriptionService.changePlan(picker.product, plan);
        setOverview(r.data.data.overview);
        const outcome = r.data.data.outcome;
        setNotice({
          tone: 'success',
          text: outcome === 'scheduled'
            ? t('subscription.notice.scheduled', 'Your plan changes on the first day of next month.')
            : t('subscription.notice.changed', 'Your plan was changed. Reload the page to see everything it includes.'),
        });
      }
      setPicker(null);
      load();
    } catch (err) {
      setPickerError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async (fn: () => Promise<{ data: { data: SubscriptionOverview } }>, success: string) => {
    setBusy(true);
    try {
      const r = await fn();
      setOverview(r.data.data);
      setNotice({ tone: 'success', text: success });
      load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
      setCancelling(null);
    }
  };

  if (!overview && !error) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;

  const statusText = (p: SubscriptionProductView): string => {
    if (p.status === 'trial') return t('subscription.status.trial', 'Free trial until {{date}}', { date: longDate(p.billableFrom, lang) });
    if (p.status === 'cancelling') return t('subscription.status.cancelling', 'Ends on {{date}}', { date: longDate(p.endsOn!, lang) });
    if (p.status === 'ended') return t('subscription.status.ended', 'Ended');
    return t('subscription.status.active', 'Active');
  };

  const usageRows = (p: SubscriptionProductView): { label: string; used: number; max: number | null }[] => {
    if (!overview) return [];
    if (p.product === 'pms') return [
      { label: t('subscription.usage.rooms', 'Rooms'), used: overview.usage.pms.rooms, max: p.limits.maxRooms ?? null },
      { label: t('subscription.usage.users', 'Users'), used: overview.usage.pms.users, max: p.limits.maxUsers ?? null },
    ];
    return [
      { label: t('subscription.usage.users', 'Users'), used: overview.usage.accounting.users, max: p.limits.maxUsers ?? null },
      ...(p.limits.maxWarehouses ? [{ label: t('subscription.usage.warehouses', 'Warehouses'), used: overview.usage.accounting.warehouses, max: p.limits.maxWarehouses }] : []),
    ];
  };

  const pickerProduct = picker ? byProduct[picker.product] : undefined;

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity={notice.tone} sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice.text}</Alert>}

      {overview && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {overview.products.filter((p) => p.status !== 'ended').map((p) => (
              <Grid item xs={12} md={6} key={p.product}>
                <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                    <Box>
                      <Typography variant="overline" color="text.secondary">{PRODUCT_LABEL[p.product]}</Typography>
                      <Typography variant="h5" fontWeight={800}>{t('subscription.planNamed', 'Plan {{name}}', { name: p.planName })}</Typography>
                    </Box>
                    <Chip size="small" color={STATUS_COLOR[p.status]} label={statusText(p)} />
                  </Stack>

                  <Typography variant="h6" fontWeight={700}>
                    {formatDop(p.monthly)} <Typography component="span" variant="body2" color="text.secondary">{t('subscription.perMonth', '/month')} · {t('subscription.plusItbis', 'plus ITBIS')}</Typography>
                  </Typography>
                  {p.discount && (
                    <Typography variant="body2" color="success.main">
                      {p.discount.kind === 'suite'
                        ? t('subscription.discount.suite', 'Suite discount {{value}}% (you have both products): −{{amount}}', { value: p.discount.value, amount: formatDop(p.discount.amount) })
                        : t('subscription.discount.operator', 'Discount: −{{amount}}', { amount: formatDop(p.discount.amount) })}
                    </Typography>
                  )}
                  {p.pendingPlan && (
                    <Alert severity="info" sx={{ mt: 1.5 }} action={
                      <Button size="small" disabled={busy} onClick={() => run(async () => ({ data: { data: (await subscriptionService.changePlan(p.product, p.plan)).data.data.overview } }), t('subscription.notice.kept', 'You keep your current plan.'))}>
                        {t('subscription.keepPlan', 'Keep current plan')}
                      </Button>
                    }>
                      {t('subscription.pending', 'Changes to {{plan}} on {{date}}.', { plan: p.pendingPlan.planName, date: longDate(p.pendingPlan.effectiveOn, lang) })}
                    </Alert>
                  )}

                  <Stack spacing={1.25} sx={{ my: 2 }}>
                    {usageRows(p).map((u) => (
                      <Box key={u.label}>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="body2">{u.label}</Typography>
                          <Typography variant="body2" color={u.max !== null && u.used > u.max ? 'error.main' : 'text.secondary'}>
                            {u.max === null ? t('subscription.usage.ofUnlimited', '{{used}} · unlimited', { used: u.used }) : t('subscription.usage.of', '{{used}} of {{max}}', { used: u.used, max: u.max })}
                          </Typography>
                        </Stack>
                        {u.max !== null && <LinearProgress variant="determinate" value={Math.min(100, (u.used / Math.max(1, u.max)) * 100)} color={u.used >= u.max ? 'warning' : 'primary'} sx={{ height: 6, borderRadius: 3 }} />}
                      </Box>
                    ))}
                  </Stack>

                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                    {Object.entries(p.features).filter(([, on]) => on).map(([k]) => featureLabel(t, p.product, k)).join(' · ') || limitLines(t, p.product, p.limits).join(' · ')}
                  </Typography>

                  <Stack direction="row" spacing={1}>
                    {p.status !== 'cancelling' && (
                      <Button variant="contained" onClick={() => { setPickerError(null); setPicker({ product: p.product, mode: 'change' }); }}>
                        {t('subscription.changePlan', 'Change plan')}
                      </Button>
                    )}
                    {p.status === 'cancelling'
                      ? <Button variant="outlined" disabled={busy} onClick={() => run(() => subscriptionService.keepProduct(p.product), t('subscription.notice.resumed', 'Your subscription continues.'))}>{t('subscription.keepProduct', 'Keep subscription')}</Button>
                      : <Button color="inherit" onClick={() => setCancelling(p.product)}>{t('subscription.cancel', 'Cancel')}</Button>}
                  </Stack>
                </Paper>
              </Grid>
            ))}

            {overview.available.map((product) => (
              <Grid item xs={12} md={6} key={product}>
                <Paper variant="outlined" sx={{ p: 2.5, height: '100%', borderStyle: 'dashed', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Typography variant="overline" color="text.secondary">{PRODUCT_LABEL[product]}</Typography>
                  <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                    {product === 'accounting'
                      ? t('subscription.add.accountingTitle', 'Invoicing, purchases and your books, connected to your hotel')
                      : t('subscription.add.pmsTitle', 'Reservations, front desk and channels')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {overview.suiteDiscountPercent > 0
                      ? t('subscription.add.suite', 'With both products you get {{value}}% off Pilloto Contabilidad. 14 days free.', { value: overview.suiteDiscountPercent })
                      : t('subscription.add.trial', '14 days free, then the plan you choose.')}
                  </Typography>
                  <Box>
                    <Button variant="outlined" startIcon={<AddCircleOutline />} onClick={() => { setPickerError(null); setPicker({ product, mode: 'add' }); }}>
                      {t('subscription.add.cta', 'See plans')}
                    </Button>
                  </Box>
                </Paper>
              </Grid>
            ))}
          </Grid>

          <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>{t('subscription.ecf.title', 'Electronic invoicing (e-CF)')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {overview.ecf.includedPlan
                ? t('subscription.ecf.included', 'Your plan includes the BillingSoft {{plan}} plan. If you choose a larger one, you pay only the difference, on your monthly charge.', { plan: overview.ecf.includedPlan })
                : t('subscription.ecf.none', 'Your plans do not include e-CF.')}
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>{t('subscription.billingEmail.title', 'Billing email')}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
              <TextField size="small" type="email" value={email} onChange={(e) => setEmail(e.target.value)} sx={{ minWidth: 320 }}
                helperText={t('subscription.billingEmail.help', 'Charges and electronic invoices are sent here.')} />
              <Button variant="outlined" disabled={busy || email === overview.billingEmail} onClick={() => run(() => subscriptionService.setBillingEmail(email), t('subscription.notice.email', 'Billing email saved.'))}>
                {t('common.save', 'Save')}
              </Button>
            </Stack>
          </Paper>
          <ChargesCard
            returnUrl={returnUrl}
            paymentInstructions={overview.paymentInstructions}
            refreshKey={chargesKey}
            onError={setError}
            errorText={message}
          />
        </>
      )}

      {picker && catalog && overview && (
        <PlanPickerDialog
          open
          product={picker.product}
          mode={picker.mode}
          options={catalog[picker.product]}
          inTrial={pickerProduct?.status === 'trial'}
          nextMonthStart={nextMonthStart(overview.today)}
          trialAvailable={!overview.products.some((p) => p.product === picker.product)}
          busy={busy}
          error={pickerError}
          onClose={() => setPicker(null)}
          onChoose={choose}
        />
      )}

      <Dialog open={!!cancelling} onClose={() => setCancelling(null)}>
        <DialogTitle>{cancelling && t('subscription.cancelDialog.title', 'Cancel {{product}}?', { product: PRODUCT_LABEL[cancelling] })}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {cancelling && byProduct[cancelling]?.status === 'trial'
              ? t('subscription.cancelDialog.trial', 'You are in your free trial: it ends today and nothing is charged. Your data is kept.')
              : t('subscription.cancelDialog.body', 'It stays available until the end of this month and is charged until then. Your data is kept, and you can withdraw the cancellation before it takes effect.')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelling(null)}>{t('subscription.cancelDialog.keep', 'Keep it')}</Button>
          <Button color="error" disabled={busy} onClick={() => cancelling && run(() => subscriptionService.cancelProduct(cancelling), t('subscription.notice.cancelled', 'The cancellation is scheduled.'))}>
            {t('subscription.cancelDialog.confirm', 'Cancel subscription')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SubscriptionPage;
