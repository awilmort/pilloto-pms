import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SyncIcon from '@mui/icons-material/Sync';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import {
  otaService,
  roomsService,
  settingsService,
  OtaListingMapping,
  OtaProvider,
  AppSettings,
} from '../../services/api';
import { Room } from '../../types';

const PROVIDERS: { value: OtaProvider; label: string }[] = [
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'booking', label: 'Booking.com' },
  { value: 'vrbo', label: 'VRBO / Expedia' },
  { value: 'other', label: 'Other' },
];

const SYNC_INTERVALS = [15, 30, 60, 120, 360];

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
];

interface MappingDialogState {
  open: boolean;
  mode: 'create' | 'edit';
  mapping: Partial<OtaListingMapping> & { _id?: string };
}

const emptyMapping: Partial<OtaListingMapping> = {
  provider: 'airbnb',
  listingLabel: '',
  externalListingId: '',
  inboundFeedUrl: '',
  roomId: '',
  isActive: true,
};

interface Props {
  showSnackbar: (msg: string, severity?: 'success' | 'error') => void;
}

const OtaSettingsTab: React.FC<Props> = ({ showSnackbar }) => {
  const { t } = useTranslation();

  // ── OTA global settings ────────────────────────────────────────
  const [otaSettings, setOtaSettings] = useState<NonNullable<AppSettings['otaSettings']>>({
    enabled: false,
    syncIntervalMinutes: 60,
    timezone: 'UTC',
    conflictAlerts: true,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);

  // ── Listing mappings ───────────────────────────────────────────
  const [mappings, setMappings] = useState<OtaListingMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(true);

  // ── Rooms for dropdown ─────────────────────────────────────────
  const [rooms, setRooms] = useState<Room[]>([]);

  // ── Sync state ─────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  const [syncingMappingId, setSyncingMappingId] = useState<string | null>(null);

  // ── Dialog ─────────────────────────────────────────────────────
  const [dialog, setDialog] = useState<MappingDialogState>({
    open: false,
    mode: 'create',
    mapping: { ...emptyMapping },
  });
  const [dialogSaving, setDialogSaving] = useState(false);

  // ── Delete confirm ─────────────────────────────────────────────
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Load data ──────────────────────────────────────────────────
  const loadMappings = useCallback(async () => {
    setMappingsLoading(true);
    try {
      const res = await otaService.getMappings();
      setMappings(res.data.data ?? []);
    } catch {
      showSnackbar(t('admin.ota.errors.loadFailed', 'Failed to load OTA mappings'), 'error');
    } finally {
      setMappingsLoading(false);
    }
  }, [showSnackbar, t]);

  useEffect(() => {
    // Load global OTA settings
    settingsService.getSettings().then(res => {
      const s = res.data.data?.otaSettings;
      if (s) setOtaSettings(s);
    }).catch(() => {});

    // Load rooms for the dropdown
    roomsService.getRooms({ limit: 200 }).then(res => {
      const roomsData = res.data.data;
      setRooms(Array.isArray(roomsData) ? roomsData : (roomsData?.rooms ?? []));
    }).catch(() => {});

    loadMappings();
  }, [loadMappings]);

  // ── Save global settings ───────────────────────────────────────
  const saveOtaSettings = async () => {
    setSettingsSaving(true);
    try {
      await settingsService.updateSettings({ otaSettings });
      showSnackbar(t('admin.settings.messages.saved', 'Settings saved'));
    } catch {
      showSnackbar(t('admin.settings.errors.saveFailed', 'Failed to save settings'), 'error');
    } finally {
      setSettingsSaving(false);
    }
  };

  // ── Mapping dialog helpers ─────────────────────────────────────
  const openCreate = () => {
    setDialog({ open: true, mode: 'create', mapping: { ...emptyMapping } });
  };

  const openEdit = (m: OtaListingMapping) => {
    setDialog({
      open: true,
      mode: 'edit',
      mapping: {
        _id: m._id,
        provider: m.provider,
        listingLabel: m.listingLabel,
        externalListingId: m.externalListingId ?? '',
        inboundFeedUrl: m.inboundFeedUrl ?? '',
        roomId: typeof m.roomId === 'object' ? (m.roomId as any)._id : m.roomId,
        isActive: m.isActive,
      },
    });
  };

  const closeDialog = () => setDialog(d => ({ ...d, open: false }));

  const saveDialog = async () => {
    setDialogSaving(true);
    try {
      if (dialog.mode === 'create') {
        await otaService.createMapping(dialog.mapping);
        showSnackbar(t('admin.ota.messages.mappingCreated', 'Listing mapping created'));
      } else if (dialog.mapping._id) {
        await otaService.updateMapping(dialog.mapping._id, dialog.mapping);
        showSnackbar(t('admin.ota.messages.mappingUpdated', 'Listing mapping updated'));
      }
      closeDialog();
      await loadMappings();
    } catch {
      showSnackbar(t('admin.ota.errors.saveFailed', 'Failed to save listing mapping'), 'error');
    } finally {
      setDialogSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await otaService.deleteMapping(deleteId);
      showSnackbar(t('admin.ota.messages.mappingDeleted', 'Listing mapping deleted'));
      setDeleteId(null);
      await loadMappings();
    } catch {
      showSnackbar(t('admin.ota.errors.deleteFailed', 'Failed to delete listing mapping'), 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── Token rotation ─────────────────────────────────────────────
  const rotateToken = async (id: string) => {
    try {
      await otaService.rotateToken(id);
      showSnackbar(t('admin.ota.messages.tokenRotated', 'Outbound feed token rotated'));
      await loadMappings();
    } catch {
      showSnackbar(t('admin.ota.errors.rotateFailed', 'Failed to rotate token'), 'error');
    }
  };

  // ── Manual sync ────────────────────────────────────────────────
  const triggerSync = async (mappingId?: string) => {
    if (mappingId) {
      setSyncingMappingId(mappingId);
    } else {
      setSyncing(true);
    }
    try {
      await otaService.triggerSync(mappingId);
      showSnackbar(t('admin.ota.messages.syncQueued', 'Sync triggered'));
    } catch {
      showSnackbar(t('admin.ota.errors.syncFailed', 'Failed to trigger sync'), 'error');
    } finally {
      setSyncing(false);
      setSyncingMappingId(null);
    }
  };

  // ── Copy feed URL ──────────────────────────────────────────────
  const copyFeedUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      showSnackbar(t('admin.ota.messages.urlCopied', 'Feed URL copied to clipboard'));
    });
  };

  const getRoomLabel = (mapping: OtaListingMapping) => {
    if (typeof mapping.roomId === 'object' && mapping.roomId !== null) {
      const r = mapping.roomId as { name: string };
      return r.name;
    }
    const found = rooms.find(r => r._id === mapping.roomId);
    return found ? found.name : mapping.roomId as string;
  };

  const statusChip = (status?: OtaListingMapping['lastSyncStatus']) => {
    const map: Record<string, { label: string; color: 'success' | 'error' | 'warning' | 'default' }> = {
      ok:      { label: t('admin.ota.syncStatus.success', 'OK'),      color: 'success' },
      partial: { label: t('admin.ota.syncStatus.partial', 'Partial'), color: 'warning' },
      error:   { label: t('admin.ota.syncStatus.failed',  'Error'),   color: 'error'   },
    };
    const entry = map[status ?? ''] ?? { label: t('admin.ota.syncStatus.never', 'Never'), color: 'default' as const };
    return <Chip size="small" label={entry.label} color={entry.color} />;
  };

  return (
    <Box sx={{ maxWidth: 820, pb: 4 }}>

      {/* ── Settings Card ── */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('admin.ota.heading', 'OTA Sync')}
          </Typography>
          <Switch
            checked={otaSettings.enabled}
            onChange={e => setOtaSettings(s => ({ ...s, enabled: e.target.checked }))}
          />
        </Box>

        <Divider />

        <Box sx={{ px: 3, py: 2.5, opacity: otaSettings.enabled ? 1 : 0.45, transition: 'opacity 0.2s' }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>{t('admin.ota.syncInterval', 'Sync frequency')}</InputLabel>
              <Select
                value={otaSettings.syncIntervalMinutes}
                label={t('admin.ota.syncInterval', 'Sync frequency')}
                onChange={e => setOtaSettings(s => ({ ...s, syncIntervalMinutes: Number(e.target.value) }))}
                disabled={!otaSettings.enabled}
              >
                {SYNC_INTERVALS.map(v => (
                  <MenuItem key={v} value={v}>
                    {v < 60 ? `Every ${v} minutes` : `Every ${v / 60} hour${v / 60 > 1 ? 's' : ''}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>{t('admin.ota.timezone', 'Timezone')}</InputLabel>
              <Select
                value={otaSettings.timezone}
                label={t('admin.ota.timezone', 'Timezone')}
                onChange={e => setOtaSettings(s => ({ ...s, timezone: e.target.value }))}
                disabled={!otaSettings.enabled}
              >
                {TIMEZONES.map(tz => (
                  <MenuItem key={tz} value={tz}>{tz}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={otaSettings.conflictAlerts}
                onChange={e => setOtaSettings(s => ({ ...s, conflictAlerts: e.target.checked }))}
                disabled={!otaSettings.enabled}
              />
            }
            label={<Typography variant="body2">{t('admin.ota.conflictAlerts', 'Notify me about booking conflicts')}</Typography>}
          />
        </Box>

        <Divider />

        <Box sx={{ px: 3, py: 2, display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <Button variant="contained" size="small" onClick={saveOtaSettings} disabled={settingsSaving}>
            {settingsSaving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={syncing ? <CircularProgress size={14} /> : <SyncIcon />}
            onClick={() => triggerSync()}
            disabled={syncing || !otaSettings.enabled}
          >
            {t('admin.ota.syncAll', 'Sync Now')}
          </Button>
        </Box>
      </Paper>

      {/* ── Channels ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, px: 3 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('admin.ota.mappings.heading', 'Channels')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title={t('common.refresh', 'Refresh')}>
            <IconButton size="small" onClick={loadMappings} disabled={mappingsLoading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
            {t('admin.ota.mappings.add', 'Add Channel')}
          </Button>
        </Box>
      </Box>

      {mappingsLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : mappings.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{
            py: 6,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1.5,
            borderStyle: 'dashed',
            borderRadius: 2,
          }}
        >
          <SyncIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
          <Typography variant="body2" color="text.secondary">
            {t('admin.ota.mappings.empty', 'No channels connected yet.')}
          </Typography>
          <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={openCreate}>
            {t('admin.ota.mappings.addFirst', 'Add Your First Channel')}
          </Button>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 600, whiteSpace: 'nowrap' } }}>
                <TableCell>{t('admin.ota.mappings.table.provider', 'Provider')}</TableCell>
                <TableCell>{t('admin.ota.mappings.table.label', 'Name')}</TableCell>
                <TableCell>{t('admin.ota.mappings.table.room', 'Room')}</TableCell>
                <TableCell>{t('admin.ota.mappings.table.lastSync', 'Last Sync')}</TableCell>
                <TableCell>{t('admin.ota.mappings.table.status', 'Status')}</TableCell>
                <TableCell>{t('admin.ota.mappings.table.outboundFeed', 'Outbound Feed')}</TableCell>
                <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mappings.map(m => (
                <TableRow key={m._id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {PROVIDERS.find(p => p.value === m.provider)?.label ?? m.provider}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{m.listingLabel}</Typography>
                    {m.externalListingId && (
                      <Typography variant="caption" color="text.secondary">{m.externalListingId}</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{getRoomLabel(m)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {m.lastSyncedAt ? new Date(m.lastSyncedAt).toLocaleString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>{statusChip(m.lastSyncStatus)}</TableCell>
                  <TableCell>
                    {m.outboundFeedUrl ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography
                          variant="caption"
                          sx={{
                            maxWidth: 160,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'block',
                          }}
                          title={m.outboundFeedUrl}
                        >
                          {m.outboundFeedUrl}
                        </Typography>
                        <Tooltip title={t('admin.ota.mappings.copyUrl', 'Copy URL')}>
                          <IconButton size="small" onClick={() => copyFeedUrl(m.outboundFeedUrl!)}>
                            <ContentCopyIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                      <Tooltip title={t('admin.ota.sync', 'Sync now')}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => triggerSync(m._id)}
                            disabled={syncingMappingId === m._id || !otaSettings.enabled}
                          >
                            {syncingMappingId === m._id ? (
                              <CircularProgress size={14} />
                            ) : (
                              <SyncIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={t('admin.ota.mappings.rotateToken', 'Rotate outbound token')}>
                        <IconButton size="small" onClick={() => rotateToken(m._id)}>
                          <RefreshIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.edit', 'Edit')}>
                        <IconButton size="small" onClick={() => openEdit(m)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.delete', 'Delete')}>
                        <IconButton size="small" color="error" onClick={() => setDeleteId(m._id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* ── Add / Edit Channel Dialog ── */}
      <Dialog open={dialog.open} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {dialog.mode === 'create'
            ? t('admin.ota.mappings.addTitle', 'Add Channel')
            : t('admin.ota.mappings.editTitle', 'Edit Channel')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('admin.ota.mappings.provider', 'Platform')}</InputLabel>
              <Select
                value={dialog.mapping.provider ?? 'airbnb'}
                label={t('admin.ota.mappings.provider', 'Platform')}
                onChange={e => setDialog(d => ({ ...d, mapping: { ...d.mapping, provider: e.target.value as OtaProvider } }))}
              >
                {PROVIDERS.map(p => (
                  <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label={t('admin.ota.mappings.label', 'Channel name')}
              size="small"
              value={dialog.mapping.listingLabel ?? ''}
              onChange={e => setDialog(d => ({ ...d, mapping: { ...d.mapping, listingLabel: e.target.value } }))}
              placeholder={t('admin.ota.mappings.labelPlaceholder', 'e.g. Airbnb – Room 12')}
              required
            />

            <TextField
              label={t('admin.ota.mappings.inboundUrl', 'Calendar URL from OTA')}
              size="small"
              value={dialog.mapping.inboundFeedUrl ?? ''}
              onChange={e => setDialog(d => ({ ...d, mapping: { ...d.mapping, inboundFeedUrl: e.target.value } }))}
              helperText={t('admin.ota.mappings.inboundUrlHint', 'Paste the .ics link from your OTA listing settings.')}
              placeholder="https://www.airbnb.com/calendar/ical/..."
            />

            <TextField
              label={t('admin.ota.mappings.externalId', 'Listing ID (optional)')}
              size="small"
              value={dialog.mapping.externalListingId ?? ''}
              onChange={e => setDialog(d => ({ ...d, mapping: { ...d.mapping, externalListingId: e.target.value } }))}
            />

            <FormControl fullWidth size="small" required>
              <InputLabel>{t('admin.ota.mappings.room', 'Room')}</InputLabel>
              <Select
                value={typeof dialog.mapping.roomId === 'object' ? (dialog.mapping.roomId as any)?._id ?? '' : dialog.mapping.roomId ?? ''}
                label={t('admin.ota.mappings.room', 'Room')}
                onChange={e => setDialog(d => ({ ...d, mapping: { ...d.mapping, roomId: e.target.value } }))}
              >
                {rooms.map(r => (
                  <MenuItem key={r._id} value={r._id}>{r.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch
                  checked={dialog.mapping.isActive !== false}
                  onChange={e => setDialog(d => ({ ...d, mapping: { ...d.mapping, isActive: e.target.checked } }))}
                />
              }
              label={t('admin.ota.mappings.active', 'Active')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={dialogSaving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={saveDialog}
            disabled={dialogSaving || !dialog.mapping.listingLabel || !dialog.mapping.roomId}
          >
            {dialogSaving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('admin.ota.mappings.deleteTitle', 'Remove this channel?')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('admin.ota.mappings.deleteConfirm', 'Existing reservations will not be affected.')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)} disabled={deleteLoading}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" color="error" onClick={confirmDelete} disabled={deleteLoading}>
            {deleteLoading ? t('common.deleting', 'Deleting…') : t('common.delete', 'Delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default OtaSettingsTab;
