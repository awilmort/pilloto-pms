/**
 * Platform console → Channel Manager (Channex): the technical view tenants never see.
 * Every tenant with its Channex property; per tenant, the full sync log with task ids (copy
 * button — the certification form and Channex support ask for them), raw errors, the
 * room type / rate plan mappings with Channex ids, and Full sync / Resync actions.
 * Also (plan 8.1): the OTAs offered to tenants in "Conectar un canal" (any Channex channel code;
 * the ones without a guide get the generic one), who connects OTAs (platform default + per-tenant switch, "platform only" if
 * the iframe isolation check fails), each tenant's channels with their Channex ids, and the
 * channel screen opened by a superadmin on the tenant's behalf.
 * Plan 9.3: the global section (health, worker status, kill switch, webhook setup, platform
 * alerts — ChannexGlobalPanel), per-tenant channels/pending/alerts in the table, and per tenant
 * enable, pause/resume pushes, its alerts with raw details and the repair screen (ChannexRepairPanel).
 * Superadmin only; English like the rest of the platform console.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem,
  Paper, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { ContentCopy, Refresh } from '@mui/icons-material';
import {
  platformChannexService, PlatformChannexTenantRow, PlatformChannexStatus, ChannelMappingRow, SyncActivity, SyncLogDetailRow,
  PlatformChannelList, ChannelConnectionSetting, PlatformChannexSettings, PlatformAlertRow,
} from '../../services/api';
import ChannexGlobalPanel from '../../components/platform/channex/ChannexGlobalPanel';
import ChannexRepairPanel from '../../components/platform/channex/ChannexRepairPanel';
import { channelCatalog } from '../../utils/channelGuides';
import PlatformLayout from './PlatformLayout';
import ChannelConnectFrame, { ChannelConnectFrameLabels } from '../../components/admin/channelManager/ChannelConnectFrame';

const STATE_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = { active: 'success', provisioning: 'warning', error: 'error', disabled: 'default' };
const time = (d?: string) => (d ? new Date(d).toLocaleString() : '—');

const CopyId: React.FC<{ id?: string | null; short?: boolean }> = ({ id, short }) => {
  const [copied, setCopied] = useState(false);
  if (!id) return <>—</>;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <Typography component="span" variant="caption" sx={{ fontFamily: 'monospace' }}>{short ? `${id.slice(0, 8)}…` : id}</Typography>
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton size="small" onClick={async () => { try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } }}>
          <ContentCopy sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

const FRAME_LABELS: ChannelConnectFrameLabels = {
  title: 'Channex channels', loading: 'Opening the Channex channel screen…', failed: 'Could not open the Channex channel screen.', retry: 'Retry',
  newWindow: 'Open in new window', newWindowHint: 'For OTA logins that refuse to load in a frame (e.g. Airbnb OAuth).',
  newWindowBlocked: 'The browser blocked the pop-up.', openedNewWindow: 'Opened in a new window.',
};

const CONNECTION_LABEL: Record<ChannelConnectionSetting, string> = {
  default: 'Platform default', tenant: 'Tenant connects channels', platform_only: 'Platform only (superadmin connects)',
};

/** Channels of one tenant: who connects them, the list with Channex ids, and the channel screen as superadmin */
const TenantChannels: React.FC<{ tenantId: string; active: boolean }> = ({ tenantId, active }) => {
  const [data, setData] = useState<PlatformChannelList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<{ otaCode?: string } | null>(null);

  const load = useCallback(async () => {
    try { setData((await platformChannexService.channels(tenantId)).data.data ?? null); setError(null); } catch (e: any) { setError(e?.response?.data?.message ?? 'Failed to load channels.'); }
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  const setConnection = async (setting: ChannelConnectionSetting) => {
    try {
      const r = await platformChannexService.setChannelConnection(tenantId, setting);
      setData((d) => (d ? { ...d, connection: r.data.data! } : d));
    } catch (e: any) { setError(e?.response?.data?.message ?? 'Failed to save.'); }
  };
  const otaCode = frame?.otaCode;
  const createSession = useCallback(async () => (await platformChannexService.iframeSession(tenantId, { otaCode, language: 'en' })).data.data!.url, [tenantId, otaCode]);

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>Channels</Typography>
        {data && (
          <TextField select size="small" label="Who connects OTAs" value={data.connection.setting} onChange={(e) => setConnection(e.target.value as ChannelConnectionSetting)} sx={{ minWidth: 280 }}
            helperText={`Effective: ${data.connection.mode === 'platform_only' ? 'platform only' : 'tenant'} (platform default: ${data.connection.platformDefault === 'platform_only' ? 'platform only' : 'tenant'})`}>
            {(Object.keys(CONNECTION_LABEL) as ChannelConnectionSetting[]).map((k) => <MenuItem key={k} value={k}>{CONNECTION_LABEL[k]}</MenuItem>)}
          </TextField>
        )}
        <Button variant="outlined" size="small" disabled={!active} onClick={() => setFrame({})}>Open channels screen</Button>
        {data && data.offered.length > 0 && (
          <TextField select size="small" label="…for one OTA" value="" onChange={(e) => setFrame({ otaCode: e.target.value })} sx={{ minWidth: 140 }} disabled={!active}>
            {data.offered.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
        )}
      </Box>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {data?.stale && <Alert severity="warning" sx={{ mb: 1 }}>Channex could not be reached; showing the cached list.</Alert>}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>
            {['Channel', 'Adapter', 'Channex channel id', 'State', 'Alerts', 'Last event', 'Wizard'].map((c) => <TableCell key={c}>{c}</TableCell>)}
          </TableRow></TableHead>
          <TableBody>
            {(data?.channels ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.title}</TableCell>
                <TableCell>{c.adapter ?? '—'}{c.otaCode ? ` (${c.otaCode})` : ''}</TableCell>
                <TableCell><CopyId id={c.channexChannelId} /></TableCell>
                <TableCell><Chip size="small" label={c.state} color={c.state === 'active' ? 'success' : c.state === 'attention' ? 'error' : 'default'} /></TableCell>
                <TableCell>{c.alerts.critical || c.alerts.warning ? `${c.alerts.critical} critical · ${c.alerts.warning} warning` : '—'}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.lastEvent ? `${c.lastEvent} · ${time(c.lastEventAt)}` : '—'}</TableCell>
                <TableCell>{c.onboarding ? `step ${c.onboarding.step} (${c.onboarding.status})` : '—'}</TableCell>
              </TableRow>
            ))}
            {(data?.onboardings ?? []).map((o) => (
              <TableRow key={`o-${o.otaCode}`}>
                <TableCell colSpan={6}><Typography variant="caption" color="text.secondary">{o.otaCode}: wizard started, no channel yet</Typography></TableCell>
                <TableCell>{`step ${o.step} (${o.status})`}</TableCell>
              </TableRow>
            ))}
            {data && data.channels.length === 0 && data.onboardings.length === 0 && <TableRow><TableCell colSpan={7}>No channels.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>
      <Dialog open={Boolean(frame)} onClose={() => { setFrame(null); load(); }} fullWidth maxWidth="xl" PaperProps={{ sx: { height: '95vh' } }}>
        <DialogTitle>Channex channels{otaCode ? ` — ${otaCode}` : ''} (as superadmin)</DialogTitle>
        <DialogContent>
          {frame && <ChannelConnectFrame createSession={createSession} labels={FRAME_LABELS} allowNewWindow height="calc(95vh - 170px)" />}
        </DialogContent>
        <DialogActions><Button variant="contained" onClick={() => { setFrame(null); load(); }}>Done</Button></DialogActions>
      </Dialog>
    </Box>
  );
};

/** The tenant's channel alerts as stored (raw details, Channex ids) */
const TenantAlerts: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState<PlatformAlertRow[]>([]);
  useEffect(() => {
    platformChannexService.tenantAlerts(tenantId, status).then((r) => setRows(r.data.data ?? [])).catch(() => setRows([]));
  }, [tenantId, status]);
  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>Alerts</Typography>
        <TextField select size="small" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 140 }}>
          {['active', 'resolved', 'dismissed', 'all'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
      </Box>
      <Box sx={{ overflowX: 'auto', maxHeight: 320 }}>
        <Table size="small" stickyHeader>
          <TableHead><TableRow>{['Last seen', 'Type', 'Severity', 'Status', 'Key', 'Title', 'Details'].map((c) => <TableCell key={c}>{c}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a._id}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(a.lastSeenAt ?? a.updatedAt)}{a.occurrences && a.occurrences > 1 ? ` ×${a.occurrences}` : ''}</TableCell>
                <TableCell>{a.type}</TableCell>
                <TableCell><Chip size="small" color={a.severity === 'critical' ? 'error' : 'warning'} label={a.severity} /></TableCell>
                <TableCell>{a.status}</TableCell>
                <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{a.dedupeKey}</Typography></TableCell>
                <TableCell>{a.title}</TableCell>
                <TableCell sx={{ maxWidth: 360 }}>
                  <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(a.details ?? {}, null, 2).slice(0, 3000)}</pre>}>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{JSON.stringify(a.details ?? {}).slice(0, 160)}</Typography>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={7}>No alerts.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
};

const TenantDetail: React.FC<{ tenant: PlatformChannexTenantRow; onChanged: () => void }> = ({ tenant, onChanged }) => {
  const [status, setStatus] = useState<PlatformChannexStatus | null>(null);
  const [activity, setActivity] = useState<SyncActivity<SyncLogDetailRow> | null>(null);
  const [mappings, setMappings] = useState<ChannelMappingRow[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<'full' | 'resync' | 'enable' | 'pause' | 'resume' | null>(null);
  const [message, setMessage] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [s, a, m] = await Promise.allSettled([
      platformChannexService.status(tenant._id), platformChannexService.syncActivity(tenant._id, page), platformChannexService.mappings(tenant._id),
    ]);
    if (s.status === 'fulfilled') setStatus(s.value.data.data ?? null);
    if (a.status === 'fulfilled') setActivity(a.value.data.data ?? null);
    if (m.status === 'fulfilled') setMappings(m.value.data.data ?? []);
  }, [tenant._id, page]);
  useEffect(() => { load(); const timer = setInterval(load, 10_000); return () => clearInterval(timer); }, [load]);

  const act = async (kind: 'full' | 'resync' | 'enable' | 'pause' | 'resume') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'enable') {
        const r = await platformChannexService.enable(tenant._id);
        setMessage({ severity: 'success', text: `Channel manager ${r.data.data?.status ?? 'enabled'}.` });
      } else if (kind === 'pause') {
        await platformChannexService.pause(tenant._id);
        setMessage({ severity: 'info', text: 'Pushes paused for this tenant. Changes keep queueing in the outbox.' });
      } else if (kind === 'resume') {
        const r = await platformChannexService.resume(tenant._id);
        setMessage({ severity: 'success', text: `Pushes resumed; ${r.data.data?.pending ?? 0} pending change(s) go out on the next tick.` });
      } else if (kind === 'full') {
        const r = await platformChannexService.fullSync(tenant._id);
        setMessage({ severity: 'success', text: `Full sync queued (${r.data.data?.queued ?? 0} outbox rows). The two calls appear below within ~10 s.` });
      } else {
        const r = await platformChannexService.resync(tenant._id);
        setMappings(r.data.data?.mappings ?? []);
        setMessage({ severity: r.data.data?.sync.ok ? 'success' : 'error', text: r.data.data?.sync.ok ? `Structure in sync (${r.data.data.sync.calls} Channex write calls).` : 'Resync finished with errors — see the mappings table.' });
      }
      await load();
      onChanged();
    } catch (e: any) {
      setMessage({ severity: 'error', text: e?.response?.data?.message ?? 'Action failed.' });
    } finally {
      setBusy(null);
    }
  };

  const pages = activity ? Math.max(1, Math.ceil(activity.total / activity.limit)) : 1;
  const active = status?.property?.status === 'active';

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>{tenant.name} <Typography component="span" color="text.secondary">[{tenant.slug}]</Typography></Typography>
        <Tooltip title="Refresh"><IconButton onClick={load}><Refresh /></IconButton></Tooltip>
        {status && status.property?.status !== 'active' && (
          <Button variant="outlined" size="small" color="success" disabled={!status.configured || !!busy} onClick={() => act('enable')}
            startIcon={busy === 'enable' ? <CircularProgress size={14} /> : undefined}>Enable / provision</Button>
        )}
        {status?.property && (tenant.property?.pushesPaused
          ? <Button variant="contained" size="small" color="success" disabled={!!busy} onClick={() => act('resume')}>Resume pushes</Button>
          : <Button variant="outlined" size="small" color="warning" disabled={!!busy} onClick={() => act('pause')}>Pause pushes</Button>)}
        <Button variant="outlined" size="small" disabled={!status?.property?.channexPropertyId || !!busy} onClick={() => act('resync')}
          startIcon={busy === 'resync' ? <CircularProgress size={14} /> : undefined}>Resync structure</Button>
        <Button variant="contained" size="small" disabled={!active || !!busy} onClick={() => act('full')}
          startIcon={busy === 'full' ? <CircularProgress size={14} color="inherit" /> : undefined}>Full sync</Button>
      </Box>
      {message && <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      {status && (
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '180px 1fr', rowGap: 0.5, m: 0, mb: 2 }}>
          <Typography component="dt" variant="body2" color="text.secondary">Environment</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}><Chip size="small" label={status.environment} color={status.environment === 'production' ? 'primary' : 'default'} /></Typography>
          <Typography component="dt" variant="body2" color="text.secondary">Status</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>{status.property ? <Chip size="small" color={STATE_COLOR[status.property.status]} label={status.property.status} /> : 'not provisioned'}{status.enabled ? '' : ' (tenant switch off)'}</Typography>
          <Typography component="dt" variant="body2" color="text.secondary">Channex property id</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}><CopyId id={status.property?.channexPropertyId} /></Typography>
          <Typography component="dt" variant="body2" color="text.secondary">Channex group id</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}><CopyId id={status.property?.channexGroupId} /></Typography>
          <Typography component="dt" variant="body2" color="text.secondary">Last full sync</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>{time(status.property?.lastFullSyncAt)}</Typography>
          <Typography component="dt" variant="body2" color="text.secondary">Outbox pending</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>{activity?.pending ?? '—'}{activity?.pausedUntil ? ` · paused until ${time(activity.pausedUntil)}` : ''}</Typography>
        </Box>
      )}
      {tenant.property?.pushesPaused && <Alert severity="warning" sx={{ mb: 2 }}>Pushes are paused by a superadmin: nothing reaches this tenant's channels until resumed.</Alert>}
      {status?.property?.lastError && <Alert severity="error" sx={{ mb: 2, wordBreak: 'break-word' }}>{status.property.lastError}</Alert>}
      {status && status.prerequisites.some((p) => !p.ok) && (
        <Alert severity="warning" sx={{ mb: 2 }}>Prerequisites failing: {status.prerequisites.filter((p) => !p.ok).map((p) => p.message).join(' ')}</Alert>
      )}

      <TenantChannels tenantId={tenant._id} active={active} />

      <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 1, mb: 1 }}>Sync log</Typography>
      <Box sx={{ overflowX: 'auto', mb: 1 }}>
        <Table size="small">
          <TableHead><TableRow>
            {['Time', 'Trigger', 'Kind', 'Dates', 'Values', 'Task ids', 'HTTP', 'Status'].map((c) => <TableCell key={c}>{c}</TableCell>)}
          </TableRow></TableHead>
          <TableBody>
            {(activity?.logs ?? []).map((r) => (
              <TableRow key={r._id}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(r.createdAt)}</TableCell>
                <TableCell>{r.trigger}</TableCell>
                <TableCell>{r.kind}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.dateFrom ? (r.dateFrom === r.dateTo ? r.dateFrom : `${r.dateFrom} → ${r.dateTo}`) : '—'}</TableCell>
                <TableCell>{r.valuesCount}</TableCell>
                <TableCell>{r.taskIds.length ? r.taskIds.map((id) => <Box key={id}><CopyId id={id} short /></Box>) : '—'}</TableCell>
                <TableCell>{r.httpStatus ?? '—'}</TableCell>
                <TableCell>
                  <Tooltip title={r.error ?? (r.warnings?.length ? JSON.stringify(r.warnings).slice(0, 800) : '')}>
                    <Chip size="small" color={r.status === 'ok' ? 'success' : r.status === 'warning' ? 'warning' : 'error'} label={r.status} />
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {activity && activity.logs.length === 0 && <TableRow><TableCell colSpan={8}>No calls yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>
      {pages > 1 && (
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mb: 2 }}>
          <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Typography variant="caption" sx={{ alignSelf: 'center' }}>{page} / {pages}</Typography>
          <Button size="small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </Box>
      )}

      <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 2, mb: 1 }}>Mappings</Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>
            {['Kind', 'Pilloto', 'Channex id', 'Status', 'Last synced', 'Error'].map((c) => <TableCell key={c}>{c}</TableCell>)}
          </TableRow></TableHead>
          <TableBody>
            {mappings.map((m) => (
              <TableRow key={`${m.kind}-${m.localId}`}>
                <TableCell>{m.kind === 'room_type' ? 'Room type' : 'Rate plan'}</TableCell>
                <TableCell>{m.parentName ? `${m.parentName} · ` : ''}{m.name}</TableCell>
                <TableCell><CopyId id={m.channexId} /></TableCell>
                <TableCell><Chip size="small" label={m.status} color={m.status === 'active' ? 'success' : m.status === 'not_synced' ? 'default' : 'warning'} /></TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(m.lastSyncedAt)}</TableCell>
                <TableCell sx={{ color: 'error.main', maxWidth: 320, wordBreak: 'break-word' }}>{m.error ?? ''}</TableCell>
              </TableRow>
            ))}
            {mappings.length === 0 && <TableRow><TableCell colSpan={6}>No room types or rate plans.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Box>
      <ChannexRepairPanel tenantId={tenant._id} active={Boolean(status?.property?.channexPropertyId)} onChanged={load} />
      <TenantAlerts tenantId={tenant._id} />
    </Paper>
  );
};

const CODE_RE = /^[A-Z]{3}$/;

/** OTAs offered to every tenant, in the order their cards appear */
const OfferedChannelsEditor: React.FC<{ saved: string[]; onSave: (codes: string[]) => Promise<void> }> = ({ saved, onSave }) => {
  const [draft, setDraft] = useState<string[]>(saved);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(saved), [saved]);
  const catalog = channelCatalog();
  const changed = draft.join(',') !== saved.join(',');
  const label = (code: string) => {
    const known = catalog.find((c) => c.code === code);
    return known ? `${known.name} (${code})` : code;
  };

  const change = (values: string[]) => {
    const codes = values.map((v) => v.trim().toUpperCase());
    const bad = codes.find((c) => !CODE_RE.test(c));
    if (bad !== undefined) { setInvalid(`"${bad}" is not a channel code (three letters, e.g. BDC).`); return; }
    setInvalid(null);
    setDraft(codes.filter((c, i) => codes.indexOf(c) === i));
  };
  const save = async () => { setBusy(true); try { await onSave(draft); } finally { setBusy(false); } };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" fontWeight={700}>OTAs offered to tenants</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        The cards of "Conectar un canal" and the channels allowed in the Channex screen, in this order. Pick a known OTA or type any Channex channel code and press Enter; codes without their own guide get the generic one.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Autocomplete
          multiple freeSolo size="small" sx={{ flex: 1, minWidth: 320 }}
          options={catalog.map((c) => c.code)} value={draft} getOptionLabel={label}
          renderOption={(props, code) => <li {...props} key={code}>{label(code)}{catalog.find((c) => c.code === code)?.guided ? '' : ' — generic guide'}</li>}
          renderTags={(values, getTagProps) => values.map((code, index) => {
            const { key, ...tagProps } = getTagProps({ index });
            return <Chip key={key} size="small" label={label(code)} color={catalog.find((c) => c.code === code)?.guided ? 'primary' : 'default'} {...tagProps} />;
          })}
          onChange={(_e, values) => change(values as string[])}
          renderInput={(params) => <TextField {...params} placeholder={draft.length ? '' : 'No OTAs offered'} error={Boolean(invalid)} helperText={invalid ?? ' '} />}
        />
        <Button variant="contained" size="small" disabled={!changed || busy} onClick={save} sx={{ mt: 0.5 }}>Save</Button>
        <Button size="small" disabled={!changed || busy} onClick={() => { setDraft(saved); setInvalid(null); }} sx={{ mt: 0.5 }}>Reset</Button>
      </Box>
      {draft.length === 0 && <Alert severity="warning" sx={{ mt: 1 }}>With no OTAs offered, tenants cannot connect any channel themselves.</Alert>}
    </Box>
  );
};

const ChannelManagerPage: React.FC = () => {
  const [data, setData] = useState<{ environment: string; tenants: PlatformChannexTenantRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [settings, setSettings] = useState<PlatformChannexSettings | null>(null);

  const load = useCallback(async () => {
    try { setData((await platformChannexService.tenants()).data.data ?? null); setError(null); } catch (e: any) { setError(e?.response?.data?.message ?? 'Failed to load tenants.'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { platformChannexService.settings().then((r) => setSettings(r.data.data ?? null)).catch(() => undefined); }, []);
  const saveSettings = async (patch: Partial<PlatformChannexSettings>) => {
    try { setSettings((await platformChannexService.saveSettings(patch)).data.data ?? null); setError(null); } catch (e: any) { setError(e?.response?.data?.message ?? 'Failed to save.'); }
  };

  const tenant = data?.tenants.find((t) => t._id === selected) ?? null;

  return (
    <PlatformLayout>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>Channel Manager (Channex)</Typography>
        {data && <Chip label={`CHANNEX_ENV: ${data.environment}`} color={data.environment === 'production' ? 'primary' : 'default'} />}
        <Tooltip title="Refresh"><IconButton onClick={load}><Refresh /></IconButton></Tooltip>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <ChannexGlobalPanel onChanged={load} />

      {settings && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>Channel connection</Typography>
          <FormControlLabel control={<Switch checked={settings.iframePlatformOnly} onChange={(e) => saveSettings({ iframePlatformOnly: e.target.checked })} />}
            label="Channel screen is platform-only by default" />
          <Typography variant="caption" color="text.secondary" display="block">
            On: tenants without their own setting cannot open the Channex channel screen; superadmins connect OTAs for them (use if the iframe isolation check fails, plan 9.5). Per-tenant override in each tenant’s Channels section.
          </Typography>
          <OfferedChannelsEditor saved={settings.offeredChannels} onSave={(offeredChannels) => saveSettings({ offeredChannels })} />
        </Paper>
      )}

      <Paper variant="outlined" sx={{ mb: 3, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow>
            {['Tenant', 'Plan', 'Status', 'Channex property id', 'Channels', 'Pending', 'Critical alerts', 'Last push', 'Last full sync', 'Problem'].map((c) => <TableCell key={c}>{c}</TableCell>)}
          </TableRow></TableHead>
          <TableBody>
            {(data?.tenants ?? []).map((t) => (
              <TableRow key={t._id} hover selected={t._id === selected} onClick={() => setSelected(t._id)} sx={{ cursor: 'pointer' }}>
                <TableCell>{t.name} <Typography component="span" variant="caption" color="text.secondary">[{t.slug}]</Typography></TableCell>
                <TableCell>{t.plan}</TableCell>
                <TableCell>{t.property ? <Chip size="small" color={STATE_COLOR[t.property.status]} label={t.property.status} /> : <Typography variant="caption" color="text.secondary">not set up</Typography>}</TableCell>
                <TableCell>{t.property?.channexPropertyId ? <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{t.property.channexPropertyId}</Typography> : '—'}</TableCell>
                <TableCell>{t.channels ? `${t.channels.active}/${t.channels.total}` : '—'}</TableCell>
                <TableCell>{t.pendingOutbox ?? 0}</TableCell>
                <TableCell>{t.openCriticalAlerts ? <Chip size="small" color="error" label={t.openCriticalAlerts} /> : 0}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(t.property?.lastPushAt)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(t.property?.lastFullSyncAt)}</TableCell>
                <TableCell sx={{ maxWidth: 260 }}>
                  {t.property?.pushesPaused && <Chip size="small" color="warning" label="paused by superadmin" sx={{ mr: 0.5 }} />}
                  {t.property?.pausedUntil && <Chip size="small" color="warning" label={`backoff (${t.property.consecutiveFailures ?? 0} failures)`} sx={{ mr: 0.5 }} />}
                  {t.property?.lastError && <Tooltip title={t.property.lastError}><Chip size="small" color="error" label="error" /></Tooltip>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {tenant ? <TenantDetail key={tenant._id} tenant={tenant} onChanged={load} />
        : <Typography color="text.secondary">Select a tenant to see its sync log, task ids and mappings.</Typography>}
    </PlatformLayout>
  );
};

export default ChannelManagerPage;
