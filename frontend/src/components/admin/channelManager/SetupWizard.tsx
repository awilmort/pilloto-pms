/**
 * Setup wizard "Activar Channel Manager" (CHANNEX_ARCHITECTURE.md §8.3; plan Phase 5.3).
 * Eight steps, progress saved per step (`ChannelOnboarding`, kind setup) so it can be left and
 * resumed. Nothing is configured twice: prices, rooms and bookings come from what Pilloto
 * already has; the wizard confirms them and asks the few questions that remain.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, FormControlLabel, LinearProgress, Paper, Radio, RadioGroup,
  Step, StepButton, Stepper, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { CheckCircle, ErrorOutline } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import {
  channelManagerService, restrictionRulesService, ChannelManagerStatus, ChannelManagerSettings, ReadinessCheck,
  RateCalendarView, RestrictionRuleRecord, EnableResponse,
} from '../../../services/api';
import { getCurrencyConfig } from '../../../utils/currency';
import PropertyProfileSummary from '../PropertyProfileSummary';
import ReadinessList from './ReadinessList';
import ChannelGlossary from './ChannelGlossary';
import { BookingRuleDialog, RuleForm, presetForm, Preset } from '../pricing/BookingRulesTab';
import { todayLocal } from '../../../utils/rateCalendar';

const STEPS = ['intro', 'property', 'rooms', 'prices', 'rules', 'bookings', 'activate', 'next'] as const;

interface Props {
  status: ChannelManagerStatus;
  canManage: boolean;
  /** Reload status (after activation the Channel Manager home takes over) */
  onChanged: () => void;
  /** Go to the home with the connect-a-channel wizard open */
  onConnectChannel?: () => void;
}

const SetupWizard: React.FC<Props> = ({ status, canManage, onChanged, onConnectChannel }) => {
  const { t, i18n } = useTranslation();
  const lang: 'es' | 'en' = i18n.language?.startsWith('es') ? 'es' : 'en';
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [settings, setSettings] = useState<ChannelManagerSettings>(status.settings);
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [preview, setPreview] = useState<RateCalendarView | null>(null);
  const [rules, setRules] = useState<RestrictionRuleRecord[]>([]);
  const [ruleForm, setRuleForm] = useState<RuleForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [activation, setActivation] = useState<{ ok: boolean; message?: string; data?: EnableResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = step === 6 ? 60 : 30;

  // Resume where the user left off
  useEffect(() => {
    channelManagerService.getOnboarding()
      .then((res) => { setStep(Math.min(7, res.data.data?.step ?? 1)); setAnswers(res.data.data?.answers ?? {}); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [r, p, ru] = await Promise.all([
        channelManagerService.readiness(), channelManagerService.preview(days), restrictionRulesService.list({ origin: 'manual' }),
      ]);
      setChecks(r.data.data ?? []);
      setPreview(p.data.data ?? null);
      setRules(ru.data.data ?? []);
      setError(null);
    } catch {
      setError(t('admin.channelManager.wizard.loadFailed'));
    }
  }, [days, t]);
  // Data is re-read whenever the user arrives at a step, so fixes made elsewhere show up
  useEffect(() => { if (!loading && step >= 2) refresh(); }, [loading, step, refresh]);

  const go = async (next: number, patch: Record<string, any> = {}) => {
    const merged = { ...answers, ...patch };
    setAnswers(merged);
    setStep(next);
    channelManagerService.saveOnboarding({ step: next, answers: merged }).catch(() => undefined);
  };

  const blocking = checks.some((c) => c.status === 'error');
  const { symbol } = getCurrencyConfig();
  // What the channels receive: active and "Vender en canales" on
  const onChannels = (e: { isActive: boolean; sellOnChannels: boolean }) => e.isActive && e.sellOnChannels;
  const channelTypes = (preview?.roomTypes ?? []).filter(onChannels);
  const plansCount = channelTypes.reduce((n, rt) => n + rt.ratePlans.filter(onChannels).length, 0);
  const notOnChannels = (preview?.roomTypes ?? []).filter((rt) => rt.isActive && !rt.sellOnChannels).map((rt) => rt.name);
  const planOptions = useMemo(() => (preview?.roomTypes ?? []).flatMap((rt) => rt.ratePlans.map((p) => ({ _id: p._id, name: p.name, roomTypeName: rt.name }))), [preview]);

  const activate = async () => {
    setActivating(true);
    setActivation(null);
    try {
      const res = await channelManagerService.enable();
      setActivation({ ok: true, data: res.data.data });
      if (res.data.data?.sync.ok) await go(8);
    } catch (e: any) {
      setActivation({ ok: false, message: e?.response?.data?.message ?? t('admin.channelManager.wizard.activate.failed') });
    } finally {
      setActivating(false);
    }
  };

  if (loading) return <LinearProgress />;
  const money = (n: number) => `${symbol}${new Intl.NumberFormat(lang === 'es' ? 'es-DO' : 'en-US', { maximumFractionDigits: 2 }).format(n)}`;
  const body = (key: string, opts?: Record<string, unknown>) => <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t(`admin.channelManager.wizard.${key}`, opts)}</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>{t('admin.channelManager.wizard.title')}</Typography>
        <ChannelGlossary />
      </Box>
      <Stepper nonLinear activeStep={step - 1} alternativeLabel sx={{ mb: 3 }}>
        {STEPS.map((s, i) => (
          <Step key={s} completed={i + 1 < step}>
            <StepButton onClick={() => go(i + 1 > 7 ? 7 : i + 1)} disabled={i + 1 === 8 && !activation?.ok}>{t(`admin.channelManager.wizard.steps.${s}`)}</StepButton>
          </Step>
        ))}
      </Stepper>
      {!canManage && <Alert severity="info" sx={{ mb: 2 }}>{t('admin.channelManager.wizard.readOnly')}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!status.configured && <Alert severity="warning" sx={{ mb: 2 }}>{t('admin.channelManager.notConfigured')}</Alert>}

      <Paper variant="outlined" sx={{ p: 3 }}>
        {/* 1 — Introduction */}
        {step === 1 && (
          <Box>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>{t('admin.channelManager.wizard.intro.heading')}</Typography>
            {body('intro.what')}
            <Typography variant="subtitle2" fontWeight={700}>{t('admin.channelManager.wizard.intro.changesTitle')}</Typography>
            <ul style={{ marginTop: 4 }}>
              {(['prices', 'bookings', 'alerts'] as const).map((k) => <li key={k}><Typography variant="body2">{t(`admin.channelManager.wizard.intro.changes.${k}`)}</Typography></li>)}
            </ul>
            <Typography variant="subtitle2" fontWeight={700}>{t('admin.channelManager.wizard.intro.otasTitle')}</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', my: 1 }}>
              {['Booking.com', 'Expedia', 'Airbnb', 'VRBO', 'Despegar', 'Agoda', 'Trip.com'].map((o) => <Chip key={o} label={o} size="small" />)}
            </Box>
            <Alert severity="info" sx={{ mt: 2 }}>{t('admin.channelManager.wizard.intro.plan')}</Alert>
          </Box>
        )}

        {/* 2 — Property: the property profile, read-only here */}
        {step === 2 && (
          <Box>
            {body('property.intro')}
            <PropertyProfileSummary fields={['name', 'currency', 'timezone', 'email', 'phone', 'address', 'city', 'state', 'country', 'zipCode']} />
            <Box sx={{ mt: 2 }}>
              <ReadinessList checks={checks} only={['currency', 'timezone', 'contact']} />
              {checks.length > 0 && !checks.some((c) => ['currency', 'timezone', 'contact'].includes(c.id) && c.status !== 'ok') && (
                <Alert severity="success">{t('admin.channelManager.wizard.property.allGood')}</Alert>
              )}
            </Box>
          </Box>
        )}

        {/* 3 — Rooms */}
        {step === 3 && (
          <Box>
            {body('rooms.intro')}
            <Table size="small" sx={{ mb: 2, maxWidth: 640 }}>
              <TableHead><TableRow>
                <TableCell>{t('admin.channelManager.wizard.rooms.roomType')}</TableCell>
                <TableCell align="right">{t('admin.channelManager.wizard.rooms.rooms')}</TableCell>
                <TableCell align="right">{t('admin.channelManager.wizard.rooms.capacity')}</TableCell>
                <TableCell align="right">{t('admin.channelManager.wizard.rooms.rates')}</TableCell>
              </TableRow></TableHead>
              <TableBody>
                {channelTypes.map((rt) => (
                  <TableRow key={rt._id}>
                    <TableCell>{rt.name}</TableCell>
                    <TableCell align="right">{rt.availability[preview!.dates[0]]?.total ?? 0}</TableCell>
                    <TableCell align="right">{rt.capacity}</TableCell>
                    <TableCell align="right">{rt.ratePlans.filter(onChannels).length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {notOnChannels.length > 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>{t('admin.channelManager.wizard.rooms.notOnChannels', { names: notOnChannels.join(', ') })}</Alert>
            )}
            <ReadinessList checks={checks} only={['roomTypes', 'rooms', 'ratePlans', 'limits', 'roomTypesWithoutRooms', 'unattributableReservations']} />
            {!checks.some((c) => ['roomTypes', 'rooms', 'ratePlans', 'limits', 'roomTypesWithoutRooms', 'unattributableReservations'].includes(c.id) && c.status !== 'ok') && checks.length > 0 && (
              <Alert severity="success">{t('admin.channelManager.wizard.rooms.allGood')}</Alert>
            )}
          </Box>
        )}

        {/* 4 — Prices */}
        {step === 4 && (
          <Box>
            {body('prices.intro')}
            <Typography variant="subtitle2" fontWeight={700}>{t('admin.channelManager.wizard.prices.taxQuestion')}</Typography>
            <RadioGroup row value={settings.ratesIncludeTaxes ? 'yes' : 'no'} sx={{ mb: 0.5 }}
              onChange={async (e) => {
                if (!canManage) return;
                const res = await channelManagerService.saveSettings({ ratesIncludeTaxes: e.target.value === 'yes' });
                setSettings(res.data.data!);
                refresh();
              }}>
              <FormControlLabel value="no" control={<Radio size="small" />} label={t('admin.channelManager.wizard.prices.taxNo')} />
              <FormControlLabel value="yes" control={<Radio size="small" />} label={t('admin.channelManager.wizard.prices.taxYes')} />
            </RadioGroup>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>{t('admin.channelManager.wizard.prices.taxHint')}</Typography>
            <ReadinessList checks={checks} only={['noPriceNights']} />
            <Box sx={{ overflowX: 'auto', mt: 1 }}>
              <Table size="small">
                <TableHead><TableRow>
                  <TableCell>{t('admin.channelManager.wizard.prices.plan')}</TableCell>
                  {(preview?.dates ?? []).slice(0, 7).map((d) => <TableCell key={d} align="right">{d.slice(5)}</TableCell>)}
                  <TableCell align="right">{t('admin.channelManager.wizard.prices.range')}</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {channelTypes.flatMap((rt) => rt.ratePlans.filter(onChannels).map((p) => {
                    const all = (preview?.dates ?? []).map((d) => p.days[d]);
                    const prices = all.map((x) => x?.price.full ?? 0);
                    return (
                      <TableRow key={p._id}>
                        <TableCell>{rt.name} · {p.name}</TableCell>
                        {all.slice(0, 7).map((x, i) => (
                          <TableCell key={i} align="right" sx={x?.forcedStopSell ? { color: 'error.main' } : undefined}>
                            <Tooltip title={x?.forcedStopSell ? t(`admin.pricing.calendar.forced.${x.forcedStopSell}`) : ''}><span>{x ? money(x.price.full) : '—'}</span></Tooltip>
                          </TableCell>
                        ))}
                        <TableCell align="right">{prices.length ? `${money(Math.min(...prices))} – ${money(Math.max(...prices))}` : '—'}</TableCell>
                      </TableRow>
                    );
                  }))}
                </TableBody>
              </Table>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{t('admin.channelManager.wizard.prices.fullOccupancy')}</Typography>
          </Box>
        )}

        {/* 5 — Booking rules (optional) */}
        {step === 5 && (
          <Box>
            {body('rules.intro')}
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
              {(['weekendMin', 'closeDates', 'noArrivals'] as Preset[]).map((p) => (
                <Button key={p} variant="outlined" disabled={!canManage}
                  onClick={() => setRuleForm(presetForm(p, t(`admin.pricing.bookingRules.presets.${p}.name`), todayLocal()))}>
                  {t(`admin.pricing.bookingRules.presets.${p}.title`)}
                </Button>
              ))}
            </Box>
            {rules.length === 0 ? <Typography variant="body2" color="text.secondary">{t('admin.channelManager.wizard.rules.none')}</Typography>
              : rules.map((r) => <Typography key={r._id} variant="body2" sx={{ py: 0.25 }}>• {r.summary[lang]}</Typography>)}
            {ruleForm && (
              <BookingRuleDialog form={ruleForm} lang={lang} roomTypes={(preview?.roomTypes ?? []).map((rt) => ({ _id: rt._id, name: rt.name }))} ratePlans={planOptions}
                onClose={() => setRuleForm(null)} onSaved={() => { setRuleForm(null); refresh(); }} />
            )}
          </Box>
        )}

        {/* 6 — Existing bookings */}
        {step === 6 && (
          <Box>
            {body('bookings.intro')}
            {channelTypes.filter((rt) => rt.ratePlans.some(onChannels)).map((rt) => (
              <Box key={rt._id} sx={{ mb: 1.5 }}>
                <Typography variant="body2" fontWeight={600}>{rt.name}</Typography>
                <Box sx={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                  {(preview?.dates ?? []).map((d) => {
                    const a = rt.availability[d];
                    return (
                      <Tooltip key={d} title={`${d}: ${a?.available ?? 0} / ${a?.total ?? 0}`}>
                        <Box sx={{ width: 22, height: 22, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0.5, color: '#fff', bgcolor: !a?.available ? 'error.main' : a.available < a.total ? 'warning.main' : 'success.main' }}>
                          {a?.available ?? 0}
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
              </Box>
            ))}
            <FormControlLabel sx={{ mt: 2 }} control={<Checkbox checked={!!answers.bookingsConfirmed} disabled={!canManage}
              onChange={(e) => { const a = { ...answers, bookingsConfirmed: e.target.checked }; setAnswers(a); channelManagerService.saveOnboarding({ answers: a }).catch(() => undefined); }} />}
              label={t('admin.channelManager.wizard.bookings.confirm')} />
          </Box>
        )}

        {/* 7 — Activate */}
        {step === 7 && (
          <Box>
            {body('activate.intro')}
            <Typography variant="body2" sx={{ mb: 2 }}>{t('admin.channelManager.wizard.activate.summary', { rooms: channelTypes.length, plans: plansCount, name: settings.name })}</Typography>
            <ReadinessList checks={checks} showOk />
            {!answers.bookingsConfirmed && <Alert severity="warning" sx={{ mt: 2 }}>{t('admin.channelManager.wizard.activate.bookingsNotConfirmed')}</Alert>}
            <Box sx={{ mt: 3 }}>
              <Button variant="contained" size="large" onClick={activate} disabled={!canManage || blocking || activating || !status.configured}
                startIcon={activating ? <CircularProgress size={16} color="inherit" /> : undefined}>
                {t('admin.channelManager.wizard.activate.button')}
              </Button>
              {blocking && <Typography variant="caption" color="error" sx={{ ml: 2 }}>{t('admin.channelManager.wizard.activate.blocked')}</Typography>}
            </Box>
            {activating && <Typography variant="body2" sx={{ mt: 2 }}>{t('admin.channelManager.wizard.activate.working')}</Typography>}
            {activation && !activation.ok && <Alert severity="error" sx={{ mt: 2 }}>{activation.message}</Alert>}
            {activation?.data && (
              <Box sx={{ mt: 2 }}>
                <ActivationProgress data={activation.data} />
                {!activation.data.sync.ok && <Alert severity="warning" sx={{ mt: 1 }}>{t('admin.channelManager.wizard.activate.partial')}</Alert>}
              </Box>
            )}
          </Box>
        )}

        {/* 8 — Next step */}
        {step === 8 && (
          <Box>
            <Alert severity="success" sx={{ mb: 2 }}>{t('admin.channelManager.wizard.next.done')}</Alert>
            {activation?.data && <ActivationProgress data={activation.data} />}
            {body('next.connect')}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={() => (onConnectChannel ? onConnectChannel() : onChanged())}>{t('admin.channelManager.wizard.next.connectButton')}</Button>
              <Button onClick={onChanged}>{t('admin.channelManager.wizard.next.home')}</Button>
            </Box>
          </Box>
        )}
      </Paper>

      {step < 8 && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
          <Button disabled={step === 1} onClick={() => go(step - 1)}>{t('common.back')}</Button>
          {step !== 7 && <Button variant="contained" onClick={() => go(step + 1)}>
            {step === 5 && rules.length === 0 ? t('admin.channelManager.wizard.rules.skip') : t('common.continue')}
          </Button>}
        </Box>
      )}
    </Box>
  );
};

/** The activation steps as a live checklist built from the activation result. */
const ActivationProgress: React.FC<{ data: EnableResponse }> = ({ data }) => {
  const { t } = useTranslation();
  // The go-live full sync goes through the worker a few seconds after activation: poll until both calls are logged
  const [fullSyncSent, setFullSyncSent] = useState(false);
  useEffect(() => {
    if (!data.sync.ok) return undefined;
    let tries = 0;
    const check = async () => {
      try {
        const logs = (await channelManagerService.syncActivity(1, 20)).data.data?.logs ?? [];
        const sent = (kind: string) => logs.some((l) => l.trigger === 'full_sync' && l.kind === kind && l.status !== 'error');
        if (sent('availability') && sent('restrictions')) { setFullSyncSent(true); return true; }
      } catch { /* try again */ }
      return false;
    };
    const timer = setInterval(async () => { if ((await check()) || ++tries >= 30) clearInterval(timer); }, 2000);
    return () => clearInterval(timer);
  }, [data]);
  const failed = (k: 'room_type' | 'rate_plan') => data.sync.results.some((r) => r.kind === k && r.action === 'failed');
  const count = (k: 'room_type' | 'rate_plan') => data.sync.results.filter((r) => r.kind === k && ['created', 'updated', 'unchanged'].includes(r.action)).length;
  const row = (ok: boolean, text: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {ok ? <CheckCircle fontSize="small" color="success" /> : <ErrorOutline fontSize="small" color="error" />}<Typography variant="body2">{text}</Typography>
    </Box>
  );
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
      {row(true, t('admin.channelManager.wizard.activate.propertyDone'))}
      {row(!failed('room_type'), t('admin.channelManager.wizard.activate.roomTypesDone', { count: count('room_type') }))}
      {row(!failed('rate_plan'), t('admin.channelManager.wizard.activate.ratePlansDone', { count: count('rate_plan') }))}
      {data.sync.ok && row(fullSyncSent, t(fullSyncSent ? 'admin.channelManager.wizard.activate.fullSyncDone' : 'admin.channelManager.wizard.activate.fullSyncPending'))}
      {data.sync.results.filter((r) => r.action === 'failed').map((r) => <Typography key={r.localId} variant="caption" color="error">{t('admin.channelManager.wizard.activate.itemFailed', { name: r.name })}</Typography>)}
    </Box>
  );
};

export default SetupWizard;
