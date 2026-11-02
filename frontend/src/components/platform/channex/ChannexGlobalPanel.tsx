/**
 * Platform console → Channel Manager, global section (plan 9.3): configuration and health,
 * this instance's worker status, the kill switch, webhook setup (signing key with a show-once
 * secret, global webhook, test delivery, latest received events) and platform alerts (bad API
 * key, bookings for properties no tenant owns). Superadmin only; English.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, IconButton,
  Paper, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { ContentCopy, Refresh } from '@mui/icons-material';
import { platformChannexService, PlatformAlertRow, PlatformChannexOverview, PlatformWebhookStatus } from '../../../services/api';

const time = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
    <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-all' }}>{children}</Typography>
  </>
);

const yesNo = (ok: boolean, yes = 'yes', no = 'no') => <Chip size="small" color={ok ? 'success' : 'warning'} label={ok ? yes : no} />;

const ChannexGlobalPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const [overview, setOverview] = useState<PlatformChannexOverview | null>(null);
  const [webhook, setWebhook] = useState<PlatformWebhookStatus | null>(null);
  const [alerts, setAlerts] = useState<PlatformAlertRow[]>([]);
  const [message, setMessage] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [keyDialog, setKeyDialog] = useState(false);
  const [billingAccountId, setBillingAccountId] = useState('');
  const [secret, setSecret] = useState<{ secret: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [o, w, a] = await Promise.allSettled([platformChannexService.overview(), platformChannexService.webhook(), platformChannexService.platformAlerts()]);
    if (o.status === 'fulfilled') setOverview(o.value.data.data ?? null);
    if (w.status === 'fulfilled') setWebhook(w.value.data.data ?? null);
    if (a.status === 'fulfilled') setAlerts(a.value.data.data ?? []);
  }, []);
  useEffect(() => { load(); const timer = setInterval(load, 15_000); return () => clearInterval(timer); }, [load]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ severity: 'success', text });
      await load();
      onChanged?.();
    } catch (e: any) {
      setMessage({ severity: 'error', text: e?.response?.data?.message ?? 'Action failed.' });
    } finally {
      setBusy(null);
    }
  };

  const setKillSwitch = (enabled: boolean) => run('switch', async () => {
    await platformChannexService.saveSettings({ globalEnabled: enabled });
    setConfirmOff(false);
    return enabled ? 'Pushes, booking polls and nightly syncs are running again.' : 'Kill switch on: no pushes, booking polls or nightly syncs until you turn it back on. Changes keep queueing.';
  });

  const createKey = () => run('key', async () => {
    const r = await platformChannexService.createSigningKey(billingAccountId.trim());
    setKeyDialog(false);
    setBillingAccountId('');
    if (r.data.data) setSecret({ secret: r.data.data.secret, message: r.data.data.message });
  });

  const w = overview?.workers;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>Platform</Typography>
        <Button size="small" variant="outlined" disabled={busy === 'health'}
          onClick={() => run('health', async () => { const r = await platformChannexService.health(); setHealth(r.data.data); })}
          startIcon={busy === 'health' ? <CircularProgress size={14} /> : undefined}>Health check</Button>
        <Tooltip title="Refresh"><IconButton size="small" onClick={load}><Refresh /></IconButton></Tooltip>
      </Box>
      {message && <Alert severity={message.severity} sx={{ mb: 1.5 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
      {health && (
        <Alert severity={health.ok ? 'success' : 'error'} sx={{ mb: 1.5 }} onClose={() => setHealth(null)}>
          {health.ok ? `Channex ${health.environment} reachable (${health.latencyMs} ms).` : `Channex check failed (${health.error?.kind ?? "unknown"}): ${health.error?.message ?? ""}`}
        </Alert>
      )}

      {overview && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
          <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '170px 1fr', rowGap: 0.5, m: 0 }}>
            <Field label="Environment"><Chip size="small" label={overview.environment} color={overview.environment === 'production' ? 'primary' : 'default'} /></Field>
            <Field label="Base URL">{overview.baseUrl}</Field>
            <Field label="API key">{yesNo(overview.configured, 'configured', 'missing')}</Field>
            <Field label="Webhook URL">{overview.webhookUrl ?? '— (CHANNEX_WEBHOOK_URL unset)'}</Field>
            <Field label="Webhook secret">{yesNo(overview.webhookSecretConfigured, 'configured', 'missing')}</Field>
          </Box>
          <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '170px 1fr', rowGap: 0.5, m: 0 }}>
            <Field label="Workers (this instance)">
              {w?.running ? <Chip size="small" color="success" label="running" />
                : <Chip size="small" color="warning" label={w?.notRunningReason === 'disabled_by_env' ? 'off (CHANNEX_WORKERS_DISABLED)' : w?.notRunningReason === 'not_configured' ? 'off (no API key)' : 'not started'} />}
            </Field>
            <Field label="Last ARI tick">{time(w?.lastTickAt)}{w?.lastTickError ? ` — ${w.lastTickError}` : ''}</Field>
            <Field label="Last booking feed poll">{time(w?.lastFeedPollAt)}{w?.lastFeedError ? ` — ${w.lastFeedError}` : ''}</Field>
            <Field label="Last alert digest run">{time(w?.lastDigestAt)}</Field>
            <Field label="Last webhook received">{time(overview.webhook.lastWebhookAt)}</Field>
          </Box>
        </Box>
      )}

      {overview && (
        <Box sx={{ mb: 2 }}>
          <FormControlLabel
            control={<Switch checked={overview.globalEnabled} disabled={busy === 'switch'} onChange={(e) => (e.target.checked ? setKillSwitch(true) : setConfirmOff(true))} color="success" />}
            label={overview.globalEnabled ? 'Channex pushes running (kill switch off)' : 'KILL SWITCH ON — nothing is pushed or polled'} />
          <Typography variant="caption" color="text.secondary" display="block">
            Stops every ARI push, booking feed poll and nightly full sync on every instance within 30 s. Webhooks are still stored; changes keep queueing and go out when it is turned back on. Alert emails keep running.
          </Typography>
        </Box>
      )}

      <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 1, mb: 1 }}>Webhook</Typography>
      {webhook && (
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '170px 1fr', rowGap: 0.5, m: 0, mb: 1 }}>
          <Field label="Signing key id">{webhook.signingKeyId ?? '—'}</Field>
          <Field label="Global webhook id">{webhook.webhookId ?? '—'}</Field>
          <Field label="Event mask"><Typography component="span" variant="caption" sx={{ fontFamily: 'monospace' }}>{webhook.eventMask}</Typography></Field>
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        <Button size="small" variant="outlined" disabled={Boolean(busy)} onClick={() => setKeyDialog(true)}>Create signing key</Button>
        <Button size="small" variant="outlined" disabled={Boolean(busy)} startIcon={busy === 'webhook' ? <CircularProgress size={14} /> : undefined}
          onClick={() => run('webhook', async () => { const r = await platformChannexService.upsertWebhook(); return `Global webhook ${r.data.data?.created ? 'created' : 'updated'} (${r.data.data?.webhookId}) → ${r.data.data?.callbackUrl}`; })}>
          Create/Update global webhook
        </Button>
        <Button size="small" variant="outlined" disabled={Boolean(busy) || !webhook?.webhookId} startIcon={busy === 'test' ? <CircularProgress size={14} /> : undefined}
          onClick={() => run('test', async () => { const r = await platformChannexService.testWebhook(); return `Test sent. Channex reported: ${JSON.stringify(r.data.data?.result ?? {}).slice(0, 300)}`; })}>
          Test webhook
        </Button>
      </Box>
      <Box sx={{ overflowX: 'auto', mb: 2, maxHeight: 280 }}>
        <Table size="small" stickyHeader>
          <TableHead><TableRow>{['Received', 'Event', 'Channex property', 'Tenant', 'Key', 'Processed', 'Error'].map((c) => <TableCell key={c}>{c}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {(webhook?.recentEvents ?? []).map((e) => (
              <TableRow key={e._id}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(e.receivedAt)}</TableCell>
                <TableCell>{e.event}</TableCell>
                <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{e.channexPropertyId ?? '—'}</Typography></TableCell>
                <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{e.tenantId ?? '—'}</Typography></TableCell>
                <TableCell>{e.signatureKeyLabel ?? '—'}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(e.processedAt)}</TableCell>
                <TableCell sx={{ color: 'error.main', maxWidth: 260, wordBreak: 'break-word' }}>{e.error ?? ''}</TableCell>
              </TableRow>
            ))}
            {webhook && webhook.recentEvents.length === 0 && <TableRow><TableCell colSpan={7}>No webhook received yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Platform alerts</Typography>
      {alerts.length === 0 ? <Typography variant="body2" color="text.secondary">None open.</Typography> : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow>{['Last seen', 'Type', 'Key', 'Title', 'Details', ''].map((c) => <TableCell key={c}>{c}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {alerts.map((a) => (
                <TableRow key={a._id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(a.lastSeenAt ?? a.updatedAt)}{a.occurrences && a.occurrences > 1 ? ` (×${a.occurrences})` : ''}</TableCell>
                  <TableCell><Chip size="small" color="error" label={a.type} /></TableCell>
                  <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{a.dedupeKey}</Typography></TableCell>
                  <TableCell>{a.title}</TableCell>
                  <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{JSON.stringify(a.details ?? {}).slice(0, 300)}</Typography></TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" onClick={() => run(`a-${a._id}`, async () => { await platformChannexService.platformAlertAction(a._id, 'resolve'); })}>Resolve</Button>
                    <Button size="small" color="inherit" onClick={() => run(`a-${a._id}`, async () => { await platformChannexService.platformAlertAction(a._id, 'dismiss'); })}>Dismiss</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <Dialog open={confirmOff} onClose={() => setConfirmOff(false)}>
        <DialogTitle>Turn the kill switch on?</DialogTitle>
        <DialogContent><DialogContentText>
          Every tenant stops sending prices and availability to their OTAs, and new OTA bookings are only received through webhooks (not acknowledged until it is back on). Use it for a Channex incident or a bad deploy.
        </DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOff(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => setKillSwitch(false)}>Stop everything</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={keyDialog} onClose={() => setKeyDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create signing key</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Channex creates a key that signs every webhook. Its secret is shown once, here; Pilloto stores only the key id. Channex needs the id of the billing account that owns the key (ask Channex support if you cannot find it in their UI).
          </DialogContentText>
          <TextField fullWidth label="Channex billing account id (UUID)" value={billingAccountId} onChange={(e) => setBillingAccountId(e.target.value)}
            error={Boolean(billingAccountId) && !UUID_RE.test(billingAccountId.trim())} helperText={billingAccountId && !UUID_RE.test(billingAccountId.trim()) ? 'Must be a UUID.' : ' '} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKeyDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={!UUID_RE.test(billingAccountId.trim()) || busy === 'key'} onClick={createKey}>Create</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(secret)} onClose={() => undefined} fullWidth maxWidth="sm">
        <DialogTitle>Signing key secret — shown once</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>{secret?.message}</Alert>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', p: 1.5, borderRadius: 1 }}>
            <Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}>{secret?.secret}</Typography>
            <Tooltip title={copied ? 'Copied' : 'Copy'}>
              <IconButton onClick={async () => { try { await navigator.clipboard.writeText(secret?.secret ?? ''); setCopied(true); } catch { /* no clipboard */ } }}><ContentCopy /></IconButton>
            </Tooltip>
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>backend/.env → <code>CHANNEX_WEBHOOK_SECRET=…</code>, then restart the backend and press Create/Update global webhook.</Typography>
        </DialogContent>
        <DialogActions><Button variant="contained" onClick={() => { setSecret(null); setCopied(false); }}>I stored it</Button></DialogActions>
      </Dialog>
    </Paper>
  );
};

export default ChannexGlobalPanel;
