import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  Tooltip,
  IconButton,
  TablePagination,
  SelectChangeEvent,
} from '@mui/material';
import { PlayArrow, Refresh } from '@mui/icons-material';
import {
  platformOtaService,
  PlatformOtaConfig,
  PlatformOtaTenantRow,
  PlatformOtaSyncRun,
} from '../../services/api';
import PlatformLayout from './PlatformLayout';

const CRON_INTERVALS = [5, 10, 15, 20, 30, 60];

function statusColor(status?: string): 'success' | 'error' | 'warning' | 'default' | 'info' {
  switch (status) {
    case 'completed': return 'success';
    case 'failed':    return 'error';
    case 'partial':   return 'warning';
    case 'running':   return 'info';
    default:          return 'default';
  }
}

function relativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

const OtaSyncPage: React.FC = () => {
  // ── Config state ─────────────────────────────────────────
  const [config, setConfig]           = useState<PlatformOtaConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving]   = useState(false);
  const [configError, setConfigError]     = useState('');

  // Working copies for the form
  const [formEnabled,  setFormEnabled]  = useState(true);
  const [formInterval, setFormInterval] = useState(5);

  // ── Tenant stats state ───────────────────────────────────
  const [tenantRows, setTenantRows]       = useState<PlatformOtaTenantRow[]>([]);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [tenantError, setTenantError]     = useState('');

  // ── Sync runs state ──────────────────────────────────────
  const [runs, setRuns]             = useState<PlatformOtaSyncRun[]>([]);
  const [runsTotal, setRunsTotal]   = useState(0);
  const [runsPage, setRunsPage]     = useState(0);
  const [runsLimit]                 = useState(20);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError]   = useState('');

  // ── Sync trigger ─────────────────────────────────────────
  const [syncing, setSyncing]         = useState<string | null>(null); // tenantId | 'all'
  const [syncMessage, setSyncMessage] = useState('');

  // ── Load config ───────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError('');
    try {
      const res = await platformOtaService.getConfig();
      const d = res.data.data!;
      setConfig(d);
      setFormEnabled(d.globalEnabled);
      setFormInterval(d.cronIntervalMinutes);
    } catch {
      setConfigError('Failed to load OTA configuration.');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  // ── Load tenant stats ─────────────────────────────────────
  const loadTenantStats = useCallback(async () => {
    setTenantLoading(true);
    setTenantError('');
    try {
      const res = await platformOtaService.getTenantStats();
      setTenantRows(res.data.data ?? []);
    } catch {
      setTenantError('Failed to load tenant OTA stats.');
    } finally {
      setTenantLoading(false);
    }
  }, []);

  // ── Load sync runs ────────────────────────────────────────
  const loadRuns = useCallback(async (page: number) => {
    setRunsLoading(true);
    setRunsError('');
    try {
      const res = await platformOtaService.getSyncRuns({ page: page + 1, limit: runsLimit });
      setRuns((res.data as any).data ?? []);
      setRunsTotal((res.data as any).pagination?.total ?? 0);
    } catch {
      setRunsError('Failed to load sync runs.');
    } finally {
      setRunsLoading(false);
    }
  }, [runsLimit]);

  useEffect(() => {
    loadConfig();
    loadTenantStats();
    loadRuns(0);
  }, [loadConfig, loadTenantStats, loadRuns]);

  // ── Save config ───────────────────────────────────────────
  const handleSaveConfig = async () => {
    setConfigSaving(true);
    setConfigError('');
    try {
      const res = await platformOtaService.updateConfig({
        globalEnabled:       formEnabled,
        cronIntervalMinutes: formInterval,
      });
      setConfig(res.data.data!);
    } catch {
      setConfigError('Failed to save OTA configuration.');
    } finally {
      setConfigSaving(false);
    }
  };

  const isDirty =
    config !== null &&
    (formEnabled !== config.globalEnabled || formInterval !== config.cronIntervalMinutes);

  // ── Trigger sync ──────────────────────────────────────────
  const handleSync = async (tenantId?: string) => {
    const key = tenantId ?? 'all';
    setSyncing(key);
    setSyncMessage('');
    try {
      const res = await platformOtaService.triggerSync(tenantId);
      setSyncMessage(res.data.message ?? 'Sync triggered.');
      setTimeout(() => {
        loadTenantStats();
        loadRuns(runsPage);
        setSyncMessage('');
      }, 3000);
    } catch {
      setSyncMessage('Failed to trigger sync.');
    } finally {
      setSyncing(null);
    }
  };

  const handleRunsPageChange = (_: unknown, newPage: number) => {
    setRunsPage(newPage);
    loadRuns(newPage);
  };

  return (
    <PlatformLayout>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        OTA iCal Sync — Platform Control
      </Typography>

      {/* ── Global config card ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Global Settings</Typography>
        <Divider sx={{ mb: 2 }} />

        {configLoading ? (
          <CircularProgress size={24} />
        ) : (
          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} sm={6} md={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formEnabled}
                    onChange={(e) => setFormEnabled(e.target.checked)}
                    color="primary"
                  />
                }
                label="OTA Sync Globally Enabled"
              />
              <Typography variant="caption" color="text.secondary" display="block">
                Disabling this stops the cron for ALL tenants immediately.
              </Typography>
            </Grid>

            <Grid item xs={12} sm={6} md={4}>
              <FormControl size="small" fullWidth>
                <InputLabel>Cron Tick Interval</InputLabel>
                <Select
                  value={formInterval}
                  label="Cron Tick Interval"
                  onChange={(e: SelectChangeEvent<number>) => setFormInterval(Number(e.target.value))}
                >
                  {CRON_INTERVALS.map((m) => (
                    <MenuItem key={m} value={m}>{m} min</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Each tenant still respects its own per-tenant sync interval.
              </Typography>
            </Grid>

            <Grid item xs={12} sm={12} md={4}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  onClick={handleSaveConfig}
                  disabled={!isDirty || configSaving}
                  size="small"
                >
                  {configSaving ? <CircularProgress size={16} /> : 'Save'}
                </Button>

                {config && (
                  <Chip
                    size="small"
                    label={config.cronStatus.running ? `Running — ${config.cronStatus.intervalMinutes}min` : 'Stopped'}
                    color={config.cronStatus.running ? 'success' : 'default'}
                  />
                )}
              </Box>
            </Grid>
          </Grid>
        )}

        {configError && <Alert severity="error" sx={{ mt: 2 }}>{configError}</Alert>}
      </Paper>

      {/* ── Tenant stats card ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6">Tenant Overview</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Sync all tenants now">
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={syncing === 'all' ? <CircularProgress size={14} /> : <PlayArrow />}
                  disabled={syncing !== null}
                  onClick={() => handleSync()}
                >
                  Sync All
                </Button>
              </span>
            </Tooltip>
            <IconButton size="small" onClick={loadTenantStats} disabled={tenantLoading}>
              <Refresh />
            </IconButton>
          </Box>
        </Box>
        <Divider sx={{ mb: 1 }} />

        {syncMessage && <Alert severity="info" sx={{ mb: 1 }}>{syncMessage}</Alert>}

        {tenantLoading ? (
          <CircularProgress size={24} />
        ) : tenantError ? (
          <Alert severity="error">{tenantError}</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tenant</TableCell>
                <TableCell align="center">Active</TableCell>
                <TableCell align="center">OTA On</TableCell>
                <TableCell align="center">Tenant Interval</TableCell>
                <TableCell align="right">Mappings</TableCell>
                <TableCell align="right">Pending Conflicts</TableCell>
                <TableCell>Last Run</TableCell>
                <TableCell>Last Status</TableCell>
                <TableCell align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tenantRows.map((row) => (
                <TableRow key={row.tenantId} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{row.tenantName}</Typography>
                    <Typography variant="caption" color="text.secondary">{row.tenantSlug}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Chip size="small" label={row.isActive ? 'Yes' : 'No'} color={row.isActive ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell align="center">
                    <Chip size="small" label={row.otaEnabled ? 'On' : 'Off'} color={row.otaEnabled ? 'primary' : 'default'} />
                  </TableCell>
                  <TableCell align="center">{row.syncIntervalMinutes} min</TableCell>
                  <TableCell align="right">{row.mappingCount}</TableCell>
                  <TableCell align="right">
                    {row.pendingConflicts > 0 ? (
                      <Chip size="small" label={row.pendingConflicts} color="warning" />
                    ) : (
                      <Typography variant="body2">0</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{relativeTime(row.lastRun?.startedAt)}</Typography>
                  </TableCell>
                  <TableCell>
                    {row.lastRun ? (
                      <Chip size="small" label={row.lastRun.status} color={statusColor(row.lastRun.status)} />
                    ) : (
                      <Typography variant="caption" color="text.secondary">Never</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Trigger sync now">
                      <span>
                        <IconButton
                          size="small"
                          disabled={syncing !== null || !row.otaEnabled}
                          onClick={() => handleSync(row.tenantId)}
                        >
                          {syncing === row.tenantId ? <CircularProgress size={16} /> : <PlayArrow fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {tenantRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} align="center">No tenants found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Paper>

      {/* ── Sync runs log ── */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6">Sync Run History</Typography>
          <IconButton size="small" onClick={() => loadRuns(runsPage)} disabled={runsLoading}>
            <Refresh />
          </IconButton>
        </Box>
        <Divider sx={{ mb: 1 }} />

        {runsLoading ? (
          <CircularProgress size={24} />
        ) : runsError ? (
          <Alert severity="error">{runsError}</Alert>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tenant</TableCell>
                  <TableCell>When</TableCell>
                  <TableCell>Trigger</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Imported</TableCell>
                  <TableCell align="right">Updated</TableCell>
                  <TableCell align="right">Conflicts</TableCell>
                  <TableCell align="right">Errors</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run._id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{run.tenantName}</Typography>
                      <Typography variant="caption" color="text.secondary">{run.tenantSlug}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{relativeTime(run.startedAt)}</Typography>
                      {run.completedAt && (
                        <Typography variant="caption" color="text.secondary">
                          {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={run.triggeredBy} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={run.status} color={statusColor(run.status)} />
                    </TableCell>
                    <TableCell align="right">{run.imported}</TableCell>
                    <TableCell align="right">{run.updated}</TableCell>
                    <TableCell align="right">
                      {run.conflicts > 0 ? (
                        <Chip size="small" label={run.conflicts} color="warning" />
                      ) : (
                        <Typography variant="body2">0</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {run.errorCount > 0 ? (
                        <Tooltip title={run.error ?? ''}>
                          <Chip size="small" label={run.errorCount} color="error" />
                        </Tooltip>
                      ) : (
                        <Typography variant="body2">0</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center">No sync runs yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={runsTotal}
              page={runsPage}
              rowsPerPage={runsLimit}
              rowsPerPageOptions={[runsLimit]}
              onPageChange={handleRunsPageChange}
            />
          </>
        )}
      </Paper>
    </PlatformLayout>
  );
};

export default OtaSyncPage;
