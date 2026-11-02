/**
 * Connect-a-channel wizard (CHANNEX_ARCHITECTURE.md §8.4; plan Phase 8.2), one per OTA:
 * before you start · authorize in the OTA · connect and map · activate and verify · done.
 * The OTA's instructions are data (`utils/channelGuides`); progress is saved on every step
 * (`ChannelOnboarding`, kind channel) so it can be closed at any point and resumed from the
 * channel card. In platform-only mode the connect step says Pilloto connects the channel.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActions, CardContent, Checkbox, Chip, CircularProgress, Dialog, DialogContent, DialogTitle,
  FormControlLabel, Grid, IconButton, Link, Paper, Step, StepButton, Stepper, Typography,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import {
  channelManagerService, ChannelStatusView, ChannelWizardProgress, ChannelWizardStatus,
} from '../../../services/api';
import {
  CONNECTIVITY_PROVIDER, guideFor, Lang, localized, Localized, nextStep, stepsFor,
} from '../../../utils/channelGuides';
import { getCurrencyConfig } from '../../../utils/currency';
import ChannelConnectFrame from './ChannelConnectFrame';
import { useFrameLabels, useTenantSession } from './ConnectChannelsDialog';
import ChannelStateChip from './ChannelStateChip';

interface Props {
  open: boolean;
  /** Start (or resume) this OTA; otherwise the OTA cards are shown first */
  otaCode?: string | null;
  offered: string[];
  platformOnly: boolean;
  /** OTA codes that already have an active channel */
  connectedCodes: string[];
  canManage: boolean;
  onClose: () => void;
}

const POLL_MS = 10_000;

const ConnectChannelWizard: React.FC<Props> = ({ open, otaCode, offered, platformOnly, connectedCodes, canManage, onClose }) => {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language?.startsWith('en') ? 'en' : 'es';
  const [code, setCode] = useState<string | null>(otaCode ?? null);
  const [progress, setProgress] = useState<ChannelWizardProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<{ roomType: string; plans: string[] }[] | null>(null);
  const labels = useFrameLabels();
  const createSession = useTenantSession(code ?? undefined);

  useEffect(() => { if (open) { setCode(otaCode ?? null); setError(null); } }, [open, otaCode]);

  const guide = code ? guideFor(code) : null;
  const vars = useMemo(() => ({ name: guide?.name ?? '', currency: getCurrencyConfig().code, provider: CONNECTIVITY_PROVIDER }), [guide]);
  const L = (l: Localized) => localized(l, lang, vars);
  const tt = useCallback((key: string, opts: Record<string, unknown> = {}) => t(`admin.channelManager.connect.${key}`, { name: vars.name, ...opts }), [t, vars.name]);

  // Resume where this OTA's wizard was left
  useEffect(() => {
    if (!open || !code) { setProgress(null); return; }
    let cancelled = false;
    channelManagerService.getChannelOnboarding(code)
      .then((r) => { if (!cancelled) setProgress(r.data.data ?? null); })
      .catch(() => { if (!cancelled) setError(tt('loadFailed')); });
    return () => { cancelled = true; };
  }, [open, code, tt]);

  const savedStep = progress?.step ?? 1;
  // A saved step this OTA does not show (e.g. "authorize" for Airbnb) opens the next one
  const step = guide && !stepsFor(guide).some((s) => s.number === savedStep) ? nextStep(guide, savedStep, 1) : savedStep;
  const answers = progress?.answers ?? {};

  // Activate and verify: the channel's live state, every few seconds
  useEffect(() => {
    if (!open || !code || step !== 4) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const r = await channelManagerService.getChannelOnboarding(code, true);
        if (!stopped) setProgress((p) => (p ? { ...p, channel: r.data.data?.channel ?? null } : r.data.data ?? null));
      } catch { /* keep the last state */ }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [open, code, step]);

  // Connect and map: the Pilloto names to look for while mapping
  useEffect(() => {
    if (!open || step !== 3 || names) return;
    channelManagerService.preview(1)
      .then((r) => setNames((r.data.data?.roomTypes ?? []).filter((rt) => rt.isActive && rt.sellOnChannels)
        .map((rt) => ({ roomType: rt.name, plans: rt.ratePlans.filter((p) => p.isActive && p.sellOnChannels).map((p) => p.name) }))))
      .catch(() => setNames([]));
  }, [open, step, names]);

  const save = async (patch: { step?: number; answers?: Record<string, any>; status?: ChannelWizardStatus }) => {
    if (!code) return;
    setProgress((p) => (p ? { ...p, ...patch, answers: patch.answers ?? p.answers, started: true } : p));
    if (!canManage) return;
    try {
      const r = await channelManagerService.saveChannelOnboarding(code, patch);
      setProgress((p) => ({ ...r.data.data!, channel: r.data.data?.channel ?? p?.channel ?? null }));
    } catch (e: any) {
      setError(e?.response?.data?.message ?? tt('saveFailed'));
    }
  };
  const setAnswer = (key: string, value: unknown) => save({ answers: { ...answers, [key]: value } });
  const go = (n: number) => save(n === 5 ? { step: n, status: 'completed' } : { step: n });

  const steps = guide ? stepsFor(guide) : [];
  const activeIndex = steps.findIndex((s) => s.number === step);
  const checklist: Record<string, boolean> = answers.checklist ?? {};
  const channel = progress?.channel as ChannelStatusView | null | undefined;
  const canContinue = !guide ? false
    : step === 1 ? guide.checklist.every((c) => checklist[c.id])
    : step === 2 ? Boolean(answers.authorized)
    : step === 4 ? Boolean(channel?.active)
    : true;

  const list = (items: Localized[], ordered = false) => {
    const Tag = ordered ? 'ol' : 'ul';
    return <Tag style={{ marginTop: 4, paddingLeft: 22 }}>{items.map((s, i) => <li key={i}><Typography variant="body2" sx={{ mb: 0.5 }}>{L(s)}</Typography></li>)}</Tag>;
  };
  const screenshots = (paths?: string[]) => (paths?.length ? (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', my: 1 }}>
      {paths.map((src) => <Box key={src} component="img" src={src} alt="" sx={{ maxWidth: '100%', maxHeight: 280, border: 1, borderColor: 'divider', borderRadius: 1 }} />)}
    </Box>
  ) : null);

  // ── OTA cards ──
  const picker = (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('admin.channelManager.connect.pickIntro')}</Typography>
      {offered.length === 0 && <Alert severity="info">{t('admin.channelManager.connect.noneOffered')}</Alert>}
      <Grid container spacing={2}>
        {offered.map((c) => {
          const g = guideFor(c);
          const connected = connectedCodes.includes(c);
          return (
            <Grid item xs={12} sm={6} md={4} key={c}>
              <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>{g.name}</Typography>
                    {connected && <Chip size="small" color="success" label={t('admin.channelManager.connect.alreadyConnected')} />}
                  </Box>
                  <Typography variant="body2" color="text.secondary">{localized(g.summary, lang, { name: g.name })}</Typography>
                </CardContent>
                <CardActions>
                  <Button onClick={() => setCode(c)}>{t('admin.channelManager.connect.choose', { name: g.name })}</Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );

  // ── Steps ──
  const body = guide && progress && (
    <Box>
      <Stepper nonLinear activeStep={activeIndex} alternativeLabel sx={{ mb: 3 }}>
        {steps.map((s) => (
          <Step key={s.key} completed={s.number < step}>
            <StepButton onClick={() => go(s.number)} disabled={s.number > step}>{tt(`steps.${s.key}`)}</StepButton>
          </Step>
        ))}
      </Stepper>
      {!canManage && <Alert severity="info" sx={{ mb: 2 }}>{tt('readOnly')}</Alert>}

      <Paper variant="outlined" sx={{ p: 3 }}>
        {step === 1 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{tt('before.intro')}</Typography>
            {guide.checklist.map((c) => (
              <FormControlLabel key={c.id} sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}
                control={<Checkbox checked={Boolean(checklist[c.id])} disabled={!canManage} sx={{ pt: 0.25 }}
                  onChange={(e) => setAnswer('checklist', { ...checklist, [c.id]: e.target.checked })} />}
                label={<Typography variant="body2">{L(c.text)}</Typography>} />
            ))}
            {!canContinue && <Typography variant="caption" color="text.secondary">{tt('before.allNeeded')}</Typography>}
          </Box>
        )}

        {step === 2 && guide.authorize && (
          <Box>
            <Typography variant="body2" color="text.secondary">{tt('authorize.intro')}</Typography>
            {list(guide.authorize.steps, true)}
            {screenshots(guide.screenshots?.authorize)}
            {guide.authorize.propertyId && <Alert severity="info" sx={{ my: 2 }}>{L(guide.authorize.propertyId)}</Alert>}
            <FormControlLabel control={<Checkbox checked={Boolean(answers.authorized)} disabled={!canManage} onChange={(e) => setAnswer('authorized', e.target.checked)} />}
              label={tt('authorize.done')} />
          </Box>
        )}

        {step === 3 && (
          platformOnly ? <Alert severity="info">{tt('connect.platformOnly')}</Alert> : (
            <Grid container spacing={2}>
              <Grid item xs={12} md={8}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{tt('connect.intro')}</Typography>
                <ChannelConnectFrame key={code} createSession={createSession} labels={labels} allowNewWindow={Boolean(guide.openInNewWindow)} height="62vh" />
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="subtitle2" fontWeight={700}>{tt('connect.stepsTitle')}</Typography>
                {list(guide.connect, true)}
                {screenshots(guide.screenshots?.connect)}
                <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2 }}>{tt('connect.rulesTitle')}</Typography>
                <ul style={{ marginTop: 4, paddingLeft: 22 }}>
                  {(['every', 'oneToOne', 'pricesInPilloto'] as const).map((k) => <li key={k}><Typography variant="body2" sx={{ mb: 0.5 }}>{tt(`connect.rules.${k}`)}</Typography></li>)}
                </ul>
                {guide.tips && list(guide.tips)}
                <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2 }}>{tt('connect.namesTitle')}</Typography>
                {names === null ? <CircularProgress size={16} /> : names.length === 0 ? <Typography variant="body2" color="text.secondary">{tt('connect.noNames')}</Typography> : (
                  <ul style={{ marginTop: 4, paddingLeft: 22 }}>
                    {names.map((n) => <li key={n.roomType}><Typography variant="body2"><strong>{n.roomType}</strong>{n.plans.length ? ` — ${n.plans.join(', ')}` : ''}</Typography></li>)}
                  </ul>
                )}
                {guide.docsUrl && <Link href={guide.docsUrl} target="_blank" rel="noopener noreferrer" variant="body2">{tt('connect.docs')}</Link>}
              </Grid>
            </Grid>
          )
        )}

        {step === 4 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tt('verify.intro')}</Typography>
            {!channel && <Alert severity="info" icon={<CircularProgress size={18} />}>{tt(platformOnly ? 'verify.noChannelPlatform' : 'verify.noChannel')}</Alert>}
            {channel && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
                  <ChannelStateChip state={channel.state} />
                  <Typography variant="body1">{t(`admin.channelManager.channels.stateText.${channel.state}`, { name: channel.otaName })}</Typography>
                </Box>
                {(channel.problems ?? []).filter((p) => p.count > 0).length > 0 && (
                  <ul style={{ marginTop: 0, paddingLeft: 22 }}>
                    {channel.problems!.map((p) => <li key={p.kind}><Typography variant="body2">{tt(`verify.problems.${p.kind}`, { count: p.count })}</Typography></li>)}
                  </ul>
                )}
                {(channel.state === 'ready_to_activate' || channel.state === 'needs_mapping') && !platformOnly && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{tt(channel.state === 'needs_mapping' ? 'verify.mapHint' : 'verify.activateHint')}</Typography>
                )}
                {!channel.active && guide.approvalWait && progress.status !== 'waiting_ota' && canManage && channel.state !== 'removed' && (
                  <Button variant="outlined" size="small" onClick={() => save({ status: 'waiting_ota' })}>{tt('verify.waitingButton')}</Button>
                )}
                {!channel.active && progress.status === 'waiting_ota' && <Alert severity="info" sx={{ mt: 1 }}>{tt('verify.waitingSaved')}</Alert>}
                {channel.active && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    <Typography variant="body2" fontWeight={700}>{tt('verify.active')}</Typography>
                    <Typography variant="body2">
                      {channel.fullSync
                        ? tt(channel.fullSync.status === 'error' ? 'verify.fullSyncError' : 'verify.fullSyncOk', { time: new Date(channel.fullSync.sentAt).toLocaleString(lang === 'es' ? 'es-DO' : 'en-US') })
                        : tt('verify.fullSyncPending')}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>{tt('verify.spotCheck')}</Typography>
                    {guide.afterActivation && list(guide.afterActivation)}
                  </Alert>
                )}
                {channel.stale && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{tt('verify.stale')}</Typography>}
              </Box>
            )}
          </Box>
        )}

        {step === 5 && (
          <Box>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>{tt('done.title')}</Typography>
            <Typography variant="body2" color="text.secondary">{tt('done.text')}</Typography>
            <ul style={{ marginTop: 8, paddingLeft: 22 }}>
              {(['prices', 'alerts', 'cards'] as const).map((k) => <li key={k}><Typography variant="body2">{tt(`done.items.${k}`)}</Typography></li>)}
            </ul>
          </Box>
        )}
      </Paper>

      {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
        <Button disabled={step <= 1} onClick={() => go(nextStep(guide, step, -1))}>{tt('back')}</Button>
        {step < 5
          ? <Button variant="contained" disabled={!canContinue || !canManage} onClick={() => go(nextStep(guide, step, 1))}>{tt('next')}</Button>
          : <Button variant="contained" onClick={onClose}>{tt('done.finish')}</Button>}
      </Box>
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xl" PaperProps={{ sx: { minHeight: '85vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>{guide ? tt('title') : t('admin.channelManager.connect.pickTitle')}</Box>
        {guide && !otaCode && step === 1 && <Button size="small" onClick={() => setCode(null)}>{t('admin.channelManager.connect.otherChannel')}</Button>}
        <IconButton aria-label={t('admin.channelManager.connect.close')} onClick={onClose}><Close /></IconButton>
      </DialogTitle>
      <DialogContent>
        {!guide ? picker : progress ? body : (error ? <Alert severity="error">{error}</Alert> : <CircularProgress />)}
      </DialogContent>
    </Dialog>
  );
};

export default ConnectChannelWizard;
