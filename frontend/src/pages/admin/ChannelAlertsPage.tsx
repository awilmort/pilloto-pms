/**
 * Channel alerts (plan 9.1–9.2): problems with the tenant's channels, each written as what
 * happened / what to do with a button to the screen that fixes it. The drawer shows the
 * context (the reservation, conflicting reservations for an overbooking, the channel's
 * message), the staff actions (in review / resolved / dismissed, with notes;
 * admin.ota.resolve) and, for Airbnb requests, the requested stay, the 24-hour countdown, the
 * availability of those nights and Accept / Decline.
 * White-label: the API never sends provider ids or raw payloads.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, Drawer, IconButton, LinearProgress, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { Close, ErrorOutline, Refresh, WarningAmber } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../components/admin/AdminLayout';
import {
  AIRBNB_DECLINE_REASONS, AirbnbDeclineReason, ChannelAlert, ChannelAlertDetail, ChannelAlertList, ChannelAlertSummary, channelAlertsService,
} from '../../services/api';
import { usePermission } from '../../lib/permissions';
import {
  alertTexts, CHANNEL_ALERT_TYPES, deadlineLeft, formatDay, formatTime, isActive, isAirbnbRequest,
} from '../../utils/channelAlerts';
import { formatMoney } from '../../utils/currency';

/** Other screens (the nav badge) refresh when alerts change here */
export const CHANNEL_ALERTS_CHANGED = 'pilloto:channel-alerts-changed';
const notifyChanged = () => window.dispatchEvent(new Event(CHANNEL_ALERTS_CHANGED));

const STATUS_FILTERS = ['active', 'open', 'acknowledged', 'resolved', 'dismissed', 'all'] as const;
const STATUS_COLOR: Record<string, 'error' | 'warning' | 'success' | 'default' | 'info'> = { open: 'error', acknowledged: 'info', resolved: 'success', dismissed: 'default' };

const SeverityIcon: React.FC<{ severity: string }> = ({ severity }) =>
  (severity === 'critical' ? <ErrorOutline color="error" /> : <WarningAmber color="warning" />);

// ─── Airbnb request ──────────────────────────────────────────────────────────

const AirbnbRequestPanel: React.FC<{ alert: ChannelAlertDetail; canResolve: boolean; onAnswered: (a: ChannelAlertDetail) => void }> = ({ alert, canResolve, onAnswered }) => {
  const { t, i18n } = useTranslation();
  const p = alert.params;
  const [now, setNow] = useState(Date.now());
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<AirbnbDeclineReason>('dates_not_available');
  const [messageToGuest, setMessageToGuest] = useState('');
  const [messageToAirbnb, setMessageToAirbnb] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const left = deadlineLeft(alert.dueAt, now);
  const open = isActive(alert);
  const isInquiry = alert.type === 'airbnb_inquiry';

  const answer = async (decision: 'accept' | 'decline') => {
    setBusy(true);
    setError(null);
    try {
      const r = await channelAlertsService.airbnbAnswer(alert._id, decision === 'decline' && !isInquiry
        ? { decision, reason, messageToGuest: messageToGuest || undefined, messageToAirbnb: messageToAirbnb || undefined }
        : { decision });
      if (r.data.data) onAnswered({ ...r.data.data.alert, availability: alert.availability });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t('admin.channelAlerts.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const decision = p.decision as { decision?: string; alreadyResolved?: boolean; resolution?: string } | undefined;

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} gutterBottom>{t('admin.channelAlerts.airbnb.requestedStay')}</Typography>
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'minmax(110px, auto) 1fr', rowGap: 0.5, columnGap: 2, m: 0, mb: 1.5 }}>
        {p.guestName && <><Typography component="dt" variant="body2" color="text.secondary">{t('admin.channelAlerts.aGuest')}</Typography><Typography component="dd" variant="body2" sx={{ m: 0 }}>{p.guestName}</Typography></>}
        {p.checkIn && <><Typography component="dt" variant="body2" color="text.secondary">{t('admin.channelAlerts.diff.checkIn')}</Typography><Typography component="dd" variant="body2" sx={{ m: 0 }}>{formatDay(p.checkIn, i18n.language)}</Typography></>}
        {p.checkOut && <><Typography component="dt" variant="body2" color="text.secondary">{t('admin.channelAlerts.diff.checkOut')}</Typography><Typography component="dd" variant="body2" sx={{ m: 0 }}>{formatDay(p.checkOut, i18n.language)}{p.nights ? ` (${p.nights})` : ''}</Typography></>}
        {p.adults && <><Typography component="dt" variant="body2" color="text.secondary">{t('admin.channelAlerts.diff.guests')}</Typography><Typography component="dd" variant="body2" sx={{ m: 0 }}>{p.children ? t('admin.channelAlerts.airbnb.guests', { adults: p.adults, children: p.children }) : t('admin.channelAlerts.airbnb.guestsAdults', { adults: p.adults })}</Typography></>}
        {p.payout && <><Typography component="dt" variant="body2" color="text.secondary">{t('admin.channelAlerts.airbnb.payout')}</Typography><Typography component="dd" variant="body2" sx={{ m: 0 }}>{p.currency ? `${p.currency} ${Number(p.payout).toFixed(2)}` : formatMoney(Number(p.payout))}</Typography></>}
      </Box>
      {p.message && <Alert severity="info" icon={false} sx={{ mb: 1.5 }}><Typography variant="caption" fontWeight={700} display="block">{t('admin.channelAlerts.airbnb.message')}</Typography>{p.message}</Alert>}
      {open && left && (
        <Alert severity={left.expired ? 'error' : left.hours < 4 ? 'warning' : 'info'} sx={{ mb: 1.5 }}>
          {left.expired ? t('admin.channelAlerts.airbnb.expired') : t('admin.channelAlerts.airbnb.timeLeft', { hours: left.hours, minutes: left.minutes })}
          {alert.dueAt && !left.expired && <Typography variant="caption" display="block">{t('admin.channelAlerts.airbnb.deadline', { time: formatTime(alert.dueAt, i18n.language) })}</Typography>}
        </Alert>
      )}

      <Typography variant="subtitle2" fontWeight={700} gutterBottom>{t('admin.channelAlerts.airbnb.availability')}</Typography>
      {alert.availability ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            {alert.availability.requestedRoomType ? t('admin.channelAlerts.airbnb.availabilityRequested') : t('admin.channelAlerts.airbnb.availabilityAll')}
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow>
                <TableCell />
                {alert.availability.nights.map((n) => <TableCell key={n} align="center" sx={{ whiteSpace: 'nowrap' }}>{formatDay(n, i18n.language).replace(/,?( de)? \d{4}$/, '')}</TableCell>)}
              </TableRow></TableHead>
              <TableBody>
                {alert.availability.roomTypes.map((rt) => (
                  <TableRow key={rt.roomTypeId}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {rt.name} <Chip size="small" sx={{ ml: 0.5 }} color={rt.bookable ? 'success' : 'error'} label={rt.bookable ? t('admin.channelAlerts.airbnb.bookable') : t('admin.channelAlerts.airbnb.notBookable')} />
                    </TableCell>
                    {rt.nights.map((n) => <TableCell key={n.date} align="center" sx={{ color: n.available > 0 ? undefined : 'error.main', fontWeight: n.available > 0 ? 400 : 700 }}>{n.available}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>
      ) : <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('admin.channelAlerts.airbnb.noAvailability')}</Typography>}

      {decision?.decision && (
        <Alert severity={decision.decision === 'accept' ? 'success' : 'info'} sx={{ mb: 1.5 }}>
          {decision.alreadyResolved
            ? t('admin.channelAlerts.airbnb.answered.alreadyAnswered', { resolution: decision.resolution ?? '' })
            : t(`admin.channelAlerts.airbnb.answered.${decision.decision}`)}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      {open && canResolve && !declining && (
        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="success" disabled={busy} onClick={() => answer('accept')} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}>
            {t(`admin.channelAlerts.airbnb.accept.${alert.type}`)}
          </Button>
          <Button variant="outlined" color="error" disabled={busy} onClick={() => setDeclining(true)}>{t(`admin.channelAlerts.airbnb.decline.${alert.type}`)}</Button>
        </Stack>
      )}
      {open && canResolve && declining && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          {isInquiry ? (
            <Typography variant="body2" sx={{ mb: 1.5 }}>{t('admin.channelAlerts.airbnb.inquiryDeclineHint')}</Typography>
          ) : (
            <Stack spacing={1.5} sx={{ mb: 1.5 }}>
              {alert.type === 'airbnb_reservation_request' && (
                <>
                  <TextField select size="small" label={t('admin.channelAlerts.airbnb.declineReason')} value={reason} onChange={(e) => setReason(e.target.value as AirbnbDeclineReason)}>
                    {AIRBNB_DECLINE_REASONS.map((r) => <MenuItem key={r} value={r}>{t(`admin.channelAlerts.airbnb.reasons.${r}`)}</MenuItem>)}
                  </TextField>
                  <TextField size="small" multiline minRows={2} label={t('admin.channelAlerts.airbnb.messageToGuest')} value={messageToGuest} onChange={(e) => setMessageToGuest(e.target.value.slice(0, 1000))} />
                  <TextField size="small" multiline minRows={2} label={t('admin.channelAlerts.airbnb.messageToAirbnb')} value={messageToAirbnb} onChange={(e) => setMessageToAirbnb(e.target.value.slice(0, 1000))} />
                </>
              )}
            </Stack>
          )}
          <Stack direction="row" spacing={1}>
            <Button variant="contained" color="error" disabled={busy} onClick={() => answer('decline')} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}>
              {t('admin.channelAlerts.airbnb.confirmDecline')}
            </Button>
            <Button disabled={busy} onClick={() => setDeclining(false)}>{t('admin.channelAlerts.close')}</Button>
          </Stack>
        </Paper>
      )}
    </Box>
  );
};

// ─── Detail drawer ───────────────────────────────────────────────────────────

const AlertDrawer: React.FC<{ id: string | null; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const canResolve = usePermission('admin.ota.resolve');
  const [alert, setAlert] = useState<ChannelAlertDetail | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAlert(null);
    setError(null);
    if (!id) return;
    channelAlertsService.get(id).then((r) => { setAlert(r.data.data ?? null); setNotes(r.data.data?.notes ?? ''); }).catch(() => setError(t('admin.channelAlerts.loadFailed')));
  }, [id, t]);

  const act = async (action: 'acknowledge' | 'resolve' | 'dismiss') => {
    if (!alert) return;
    setBusy(action);
    setError(null);
    try {
      const r = await channelAlertsService.act(alert._id, action, notes.trim() || undefined);
      setAlert((prev) => (r.data.data ? { ...r.data.data, availability: prev?.availability } : prev));
      onChanged();
      notifyChanged();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t('admin.channelAlerts.actionFailed'));
    } finally {
      setBusy(null);
    }
  };

  const texts = alert ? alertTexts(alert, t, i18n.language) : null;
  const p = alert?.params ?? {};
  const go = (path?: string) => { if (path) { onClose(); navigate(path); } };

  return (
    <Drawer anchor="right" open={Boolean(id)} onClose={onClose} PaperProps={{ sx: { width: mobile ? '100%' : 520, p: 2.5 } }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
        {alert && <SeverityIcon severity={alert.severity} />}
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1, lineHeight: 1.3 }}>{texts?.title ?? ''}</Typography>
        <IconButton onClick={onClose} aria-label={t('admin.channelAlerts.close')}><Close /></IconButton>
      </Box>
      {!alert && !error && <LinearProgress />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {alert && texts && (
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip size="small" color={STATUS_COLOR[alert.status]} label={t(`admin.channelAlerts.status.${alert.status}`)} />
            <Chip size="small" variant="outlined" label={t(`admin.channelAlerts.severity.${alert.severity}`)} />
            {alert.occurrences > 1 && <Chip size="small" variant="outlined" label={t('admin.channelAlerts.occurrences', { count: alert.occurrences })} />}
            {alert.autoResolved && <Chip size="small" variant="outlined" color="success" label={t('admin.channelAlerts.autoResolved')} />}
          </Box>
          <Box>
            <Typography variant="subtitle2" fontWeight={700}>{t('admin.channelAlerts.whatHappened')}</Typography>
            <Typography variant="body2">{texts.what}</Typography>
            <Typography variant="caption" color="text.secondary">{formatTime(alert.createdAt, i18n.language)}{alert.lastSeenAt && alert.occurrences > 1 ? ` · ${t('admin.channelAlerts.lastSeen', { time: formatTime(alert.lastSeenAt, i18n.language) })}` : ''}</Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" fontWeight={700}>{t('admin.channelAlerts.whatToDo')}</Typography>
            <Typography variant="body2">{texts.todo}</Typography>
          </Box>
          {alert.action.path && (
            <Box><Button variant="contained" onClick={() => go(alert.action.path)}>{t(`admin.channelAlerts.actions.${alert.action.kind}`)}</Button></Box>
          )}

          {Array.isArray(p.messages) && p.messages.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>{t('admin.channelAlerts.channelMessages')}</Typography>
              {p.messages.map((m: string) => <Typography key={m} variant="body2" sx={{ fontFamily: 'monospace', bgcolor: 'action.hover', p: 1, borderRadius: 1, mt: 0.5, wordBreak: 'break-word' }}>{m}</Typography>)}
            </Box>
          )}
          {Array.isArray(p.diff) && p.diff.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>{t('admin.channelAlerts.details')}</Typography>
              <Table size="small"><TableBody>
                {p.diff.map((d: any) => (
                  <TableRow key={d.field}>
                    <TableCell>{t(`admin.channelAlerts.diff.${d.field}`, { defaultValue: String(d.field) })}</TableCell>
                    <TableCell>{String(d.from ?? '—')}</TableCell>
                    <TableCell>→ {String(d.to ?? '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            </Box>
          )}
          {alert.type === 'overbooking' && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>{t('admin.channelAlerts.competing')}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                {alert.reservationId && (
                  <Paper variant="outlined" sx={{ p: 1.5, borderColor: 'error.main' }}>
                    <Typography variant="caption" color="error">{t('admin.channelAlerts.thisReservation')}</Typography>
                    <Typography variant="body2" fontWeight={700}>{p.reservationCode} {p.otaName ? `· ${p.otaName}` : ''}</Typography>
                    <Typography variant="body2">{p.guestName}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block">{formatDay(p.checkIn, i18n.language)} → {formatDay(p.checkOut, i18n.language)}</Typography>
                    <Button size="small" onClick={() => go(`/admin/reservations?id=${alert.reservationId}`)}>{t('admin.channelAlerts.openReservation')}</Button>
                  </Paper>
                )}
                {(p.competingReservations ?? []).map((c: any) => (
                  <Paper key={c.reservationId} variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="body2" fontWeight={700}>{c.reservationCode} {c.otaName ? `· ${c.otaName}` : ''}</Typography>
                    <Typography variant="body2">{c.guestName}</Typography>
                    <Button size="small" onClick={() => go(`/admin/reservations?id=${c.reservationId}`)}>{t('admin.channelAlerts.openReservation')}</Button>
                  </Paper>
                ))}
              </Box>
            </Box>
          )}
          {isAirbnbRequest(alert) && <AirbnbRequestPanel alert={alert} canResolve={canResolve} onAnswered={(a) => { setAlert(a); onChanged(); notifyChanged(); }} />}

          <Divider />
          {alert.resolvedAt && alert.resolvedByName && <Typography variant="caption" color="text.secondary">{t('admin.channelAlerts.resolvedBy', { name: alert.resolvedByName, time: formatTime(alert.resolvedAt, i18n.language) })}</Typography>}
          {alert.acknowledgedAt && alert.acknowledgedByName && alert.status === 'acknowledged' && <Typography variant="caption" color="text.secondary">{t('admin.channelAlerts.acknowledgedBy', { name: alert.acknowledgedByName, time: formatTime(alert.acknowledgedAt, i18n.language) })}</Typography>}
          {canResolve ? (
            <>
              <TextField label={t('admin.channelAlerts.notes')} placeholder={t('admin.channelAlerts.notesPlaceholder')} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
                multiline minRows={2} size="small" disabled={!isActive(alert)} />
              {isActive(alert) && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {alert.status === 'open' && <Button variant="outlined" disabled={Boolean(busy)} onClick={() => act('acknowledge')}>{t('admin.channelAlerts.buttons.acknowledge')}</Button>}
                  {!isAirbnbRequest(alert) && <Button variant="contained" color="success" disabled={Boolean(busy)} onClick={() => act('resolve')}>{t('admin.channelAlerts.buttons.resolve')}</Button>}
                  <Button color="inherit" disabled={Boolean(busy)} onClick={() => act('dismiss')}>{t('admin.channelAlerts.buttons.dismiss')}</Button>
                </Stack>
              )}
            </>
          ) : (alert.notes ? <Typography variant="body2"><b>{t('admin.channelAlerts.notes')}:</b> {alert.notes}</Typography> : isActive(alert) && <Typography variant="caption" color="text.secondary">{t('admin.channelAlerts.noResolvePermission')}</Typography>)}
        </Stack>
      )}
    </Drawer>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

const ChannelAlertsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>('active');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ChannelAlertList | null>(null);
  const [summary, setSummary] = useState<ChannelAlertSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'noPlan' | 'error'>('loading');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([
        channelAlertsService.list({ status, severity: severity || undefined, type: type || undefined, page, limit: 25 }),
        channelAlertsService.summary(),
      ]);
      setData(list.data.data ?? null);
      setSummary(sum.data.data ?? null);
      setState('ready');
    } catch (e: any) {
      setState(e?.response?.status === 403 ? 'noPlan' : 'error');
    }
  }, [status, severity, type, page]);
  useEffect(() => { load(); const timer = setInterval(load, 60_000); return () => clearInterval(timer); }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const primary = (a: ChannelAlert) => {
    if (a.action.kind === 'airbnb_request' || !a.action.path) setSelected(a._id);
    else navigate(a.action.path);
  };

  return (
    <AdminLayout title={t('admin.channelAlerts.title')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>{t('admin.channelAlerts.title')}</Typography>
        <Tooltip title={t('admin.channelAlerts.refresh')}><IconButton onClick={load}><Refresh /></IconButton></Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('admin.channelAlerts.subtitle')}</Typography>

      {state === 'noPlan' && <Alert severity="info">{t('admin.channelAlerts.noPlan')}</Alert>}
      {state === 'error' && <Alert severity="error" sx={{ mb: 2 }}>{t('admin.channelAlerts.loadFailed')}</Alert>}
      {state !== 'noPlan' && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
            <TextField select size="small" label={t('admin.channelAlerts.filters.status')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 150 }}>
              {STATUS_FILTERS.map((s) => <MenuItem key={s} value={s}>{t(`admin.channelAlerts.filters.statuses.${s}`)}</MenuItem>)}
            </TextField>
            <TextField select size="small" label={t('admin.channelAlerts.filters.severity')} value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} sx={{ minWidth: 140 }}>
              <MenuItem value="">{t('admin.channelAlerts.filters.anySeverity')}</MenuItem>
              <MenuItem value="critical">{t('admin.channelAlerts.severity.critical')}</MenuItem>
              <MenuItem value="warning">{t('admin.channelAlerts.severity.warning')}</MenuItem>
            </TextField>
            <TextField select size="small" label={t('admin.channelAlerts.filters.type')} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} sx={{ minWidth: 220, flex: { xs: 1, sm: 'none' } }}>
              <MenuItem value="">{t('admin.channelAlerts.filters.anyType')}</MenuItem>
              {CHANNEL_ALERT_TYPES.map((k) => <MenuItem key={k} value={k}>{t(`admin.channelAlerts.types.${k}.title`)}</MenuItem>)}
            </TextField>
          </Box>
          {summary && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {t('admin.channelAlerts.summary', { critical: summary.activeCritical, open: summary.open, acknowledged: summary.acknowledged })}
            </Typography>
          )}
          {state === 'loading' && <LinearProgress />}
          {data && data.alerts.length === 0 && (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">{status === 'active' && !severity && !type ? t('admin.channelAlerts.emptyActive') : t('admin.channelAlerts.empty')}</Typography>
            </Paper>
          )}
          <Stack spacing={1}>
            {(data?.alerts ?? []).map((a) => {
              const texts = alertTexts(a, t, i18n.language);
              return (
                <Paper key={a._id} variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start', cursor: 'pointer', borderLeft: 4, borderLeftColor: a.severity === 'critical' ? 'error.main' : 'warning.main', '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={() => setSelected(a._id)}>
                  <Box sx={{ pt: 0.25 }}><SeverityIcon severity={a.severity} /></Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="subtitle2" fontWeight={700}>{texts.title}</Typography>
                      <Chip size="small" color={STATUS_COLOR[a.status]} label={t(`admin.channelAlerts.status.${a.status}`)} />
                      {a.occurrences > 1 && <Typography variant="caption" color="text.secondary">×{a.occurrences}</Typography>}
                    </Box>
                    <Typography variant="body2" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{texts.what}</Typography>
                    <Typography variant="caption" color="text.secondary">{formatTime(a.lastSeenAt ?? a.createdAt, i18n.language)}</Typography>
                  </Box>
                  {isActive(a) && a.action.kind !== 'none' && (
                    <Button size="small" variant={a.severity === 'critical' ? 'contained' : 'outlined'} sx={{ flexShrink: 0, display: { xs: 'none', sm: 'inline-flex' } }}
                      onClick={(e) => { e.stopPropagation(); primary(a); }}>
                      {t(`admin.channelAlerts.actions.${a.action.kind}`)}
                    </Button>
                  )}
                </Paper>
              );
            })}
          </Stack>
          {pages > 1 && (
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
              <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
              <Typography variant="caption" sx={{ alignSelf: 'center' }}>{page} / {pages}</Typography>
              <Button size="small" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</Button>
            </Box>
          )}
        </>
      )}
      <AlertDrawer id={selected} onClose={() => setSelected(null)} onChanged={load} />
    </AdminLayout>
  );
};

export default ChannelAlertsPage;
