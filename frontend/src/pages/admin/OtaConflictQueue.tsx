import React, { useEffect, useState, useCallback } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Snackbar,
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
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import {
  otaService,
  OtaConflict,
  OtaConflictStatus,
} from '../../services/api';

const STATUS_OPTIONS: { value: OtaConflictStatus | ''; label: string; color: 'warning' | 'success' | 'error' | 'default' | 'info' }[] = [
  { value: '', label: 'All', color: 'default' },
  { value: 'pending_review', label: 'Pending Review', color: 'warning' },
  { value: 'resolved_keep_pilloto', label: 'Keep Pilloto', color: 'success' },
  { value: 'resolved_accept_ota', label: 'Accept OTA', color: 'info' },
  { value: 'resolved_outside_system', label: 'Resolved Outside', color: 'default' },
  { value: 'ignored_false_positive', label: 'False Positive', color: 'default' },
];

const RESOLUTION_OPTIONS: { value: OtaConflictStatus; label: string }[] = [
  { value: 'resolved_keep_pilloto', label: 'Keep Pilloto reservation (OTA block is a false duplicate)' },
  { value: 'resolved_accept_ota', label: 'Accept OTA booking (will need manual reservation creation)' },
  { value: 'resolved_outside_system', label: 'Resolved outside this system' },
  { value: 'ignored_false_positive', label: 'Ignore — false positive, same block from both sides' },
];

const statusChip = (status: OtaConflictStatus) => {
  const opt = STATUS_OPTIONS.find(s => s.value === status);
  if (!opt || !opt.value) return null;
  return <Chip size="small" label={opt.label} color={opt.color} />;
};

interface SnackbarState { open: boolean; message: string; severity: 'success' | 'error' | 'info' }

const OtaConflictQueue: React.FC = () => {
  const { t } = useTranslation();
  const [conflicts, setConflicts] = useState<OtaConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<OtaConflictStatus | ''>('pending_review');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const LIMIT = 20;

  // Resolve dialog
  const [resolveDialog, setResolveDialog] = useState<{ open: boolean; conflict: OtaConflict | null }>({ open: false, conflict: null });
  const [resolveStatus, setResolveStatus] = useState<OtaConflictStatus>('resolved_keep_pilloto');
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolveSaving, setResolveSaving] = useState(false);

  const [snackbar, setSnackbar] = useState<SnackbarState>({ open: false, message: '', severity: 'success' });
  const showSnackbar = (message: string, severity: SnackbarState['severity'] = 'success') =>
    setSnackbar({ open: true, message, severity });

  const loadConflicts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, limit: LIMIT };
      if (statusFilter) params.status = statusFilter;
      const res = await otaService.getConflicts(params);
      setConflicts(res.data.data ?? []);
      setTotalPages(res.data.pagination?.pages ?? 1);
    } catch {
      showSnackbar(t('admin.ota.conflicts.loadFailed', 'Failed to load conflicts'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, t]);

  const loadPendingCount = useCallback(async () => {
    try {
      const res = await otaService.getPendingConflictCount();
      setPendingCount(res.data.data?.count ?? 0);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    loadConflicts();
    loadPendingCount();
  }, [loadConflicts, loadPendingCount]);

  const openResolve = (conflict: OtaConflict) => {
    setResolveStatus('resolved_keep_pilloto');
    setResolveNotes('');
    setResolveDialog({ open: true, conflict });
  };

  const closeResolve = () => setResolveDialog({ open: false, conflict: null });

  const submitResolve = async () => {
    if (!resolveDialog.conflict) return;
    setResolveSaving(true);
    try {
      await otaService.resolveConflict(resolveDialog.conflict._id, {
        status: resolveStatus,
        notes: resolveNotes || undefined,
      });
      showSnackbar(t('admin.ota.conflicts.resolved', 'Conflict resolved'));
      closeResolve();
      await Promise.all([loadConflicts(), loadPendingCount()]);
    } catch {
      showSnackbar(t('admin.ota.conflicts.resolveFailed', 'Failed to resolve conflict'), 'error');
    } finally {
      setResolveSaving(false);
    }
  };

  const formatDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString() : '—';

  return (
    <AdminLayout>
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <SectionTitle title={t('admin.ota.conflicts.heading', 'OTA Conflict Queue')} />
          {pendingCount !== null && pendingCount > 0 && (
            <Chip
              label={t('admin.ota.conflicts.pendingBadge', '{{count}} pending', { count: pendingCount })}
              color="warning"
              size="small"
            />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('admin.ota.conflicts.description', 'OTA calendar blocks that overlap with existing Pilloto reservations. Review and resolve each conflict before the next sync run.')}
        </Typography>

        {/* Filter */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>{t('admin.ota.conflicts.statusFilter', 'Status')}</InputLabel>
            <Select
              value={statusFilter}
              label={t('admin.ota.conflicts.statusFilter', 'Status')}
              onChange={e => { setStatusFilter(e.target.value as OtaConflictStatus | ''); setPage(1); }}
            >
              {STATUS_OPTIONS.map(s => (
                <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="outlined" size="small" onClick={() => { setPage(1); loadConflicts(); }}>
            {t('common.refresh', 'Refresh')}
          </Button>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.ota.conflicts.table.provider', 'Provider / Listing')}</TableCell>
                    <TableCell>{t('admin.ota.conflicts.table.otaBlock', 'OTA Block')}</TableCell>
                    <TableCell>{t('admin.ota.conflicts.table.pillotoReservation', 'Pilloto Reservation')}</TableCell>
                    <TableCell>{t('admin.ota.conflicts.table.type', 'Type')}</TableCell>
                    <TableCell>{t('admin.ota.conflicts.table.status', 'Status')}</TableCell>
                    <TableCell>{t('admin.ota.conflicts.table.detected', 'Detected')}</TableCell>
                    <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {conflicts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                          {t('admin.ota.conflicts.empty', 'No conflicts found for this filter.')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    conflicts.map(c => {
                      const mapping = typeof c.mappingId === 'object' ? c.mappingId : null;
                      return (
                        <TableRow key={c._id} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={500}>
                              {mapping ? (mapping as any).listingLabel ?? (mapping as any).provider : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Box>
                              <Typography variant="body2">
                                {formatDate(c.snapshot.otaCheckIn)} → {formatDate(c.snapshot.otaCheckOut)}
                              </Typography>
                              {c.snapshot.otaGuestName && (
                                <Typography variant="caption" color="text.secondary">
                                  {c.snapshot.otaGuestName}
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Box>
                              <Typography variant="body2">
                                {formatDate(c.snapshot.pillotoCheckIn)} → {formatDate(c.snapshot.pillotoCheckOut)}
                              </Typography>
                              {c.snapshot.pillotoGuestName && (
                                <Typography variant="caption" color="text.secondary">
                                  {c.snapshot.pillotoGuestName}
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={c.conflictType === 'exact_match'
                                ? t('admin.ota.conflicts.exactMatch', 'Exact match')
                                : t('admin.ota.conflicts.overlap', 'Overlap')}
                              color={c.conflictType === 'exact_match' ? 'default' : 'error'}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>{statusChip(c.status)}</TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {new Date(c.createdAt).toLocaleDateString()}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            {c.status === 'pending_review' && (
                              <Tooltip title={t('admin.ota.conflicts.resolve', 'Resolve')}>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => openResolve(c)}
                                >
                                  {t('admin.ota.conflicts.resolve', 'Resolve')}
                                </Button>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            {totalPages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Pagination
                  count={totalPages}
                  page={page}
                  onChange={(_e, v) => setPage(v)}
                  color="primary"
                />
              </Box>
            )}
          </>
        )}
      </Box>

      {/* ── Resolve Dialog ─────────────────────────────────────── */}
      <Dialog open={resolveDialog.open} onClose={closeResolve} maxWidth="sm" fullWidth>
        <DialogTitle>{t('admin.ota.conflicts.resolveTitle', 'Resolve Conflict')}</DialogTitle>
        <DialogContent>
          {resolveDialog.conflict && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              {/* Conflict summary */}
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {t('admin.ota.conflicts.otaBlock', 'OTA block')}
                </Typography>
                <Typography variant="body2">
                  {formatDate(resolveDialog.conflict.snapshot.otaCheckIn)} – {formatDate(resolveDialog.conflict.snapshot.otaCheckOut)}
                  {resolveDialog.conflict.snapshot.otaGuestName && ` · ${resolveDialog.conflict.snapshot.otaGuestName}`}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5, mb: 0.5 }}>
                  {t('admin.ota.conflicts.pillotoBlock', 'Pilloto reservation')}
                </Typography>
                <Typography variant="body2">
                  {formatDate(resolveDialog.conflict.snapshot.pillotoCheckIn)} – {formatDate(resolveDialog.conflict.snapshot.pillotoCheckOut)}
                  {resolveDialog.conflict.snapshot.pillotoGuestName && ` · ${resolveDialog.conflict.snapshot.pillotoGuestName}`}
                </Typography>
              </Paper>

              <FormControl fullWidth size="small">
                <InputLabel>{t('admin.ota.conflicts.resolution', 'Resolution')}</InputLabel>
                <Select
                  value={resolveStatus}
                  label={t('admin.ota.conflicts.resolution', 'Resolution')}
                  onChange={e => setResolveStatus(e.target.value as OtaConflictStatus)}
                >
                  {RESOLUTION_OPTIONS.map(r => (
                    <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label={t('admin.ota.conflicts.notes', 'Notes (optional)')}
                multiline
                rows={3}
                size="small"
                value={resolveNotes}
                onChange={e => setResolveNotes(e.target.value)}
                helperText={t('admin.ota.conflicts.notesHint', 'Add any context for the audit trail.')}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeResolve} disabled={resolveSaving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" onClick={submitResolve} disabled={resolveSaving}>
            {resolveSaving ? t('common.saving', 'Saving…') : t('admin.ota.conflicts.submitResolve', 'Submit Resolution')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </AdminLayout>
  );
};

export default OtaConflictQueue;
