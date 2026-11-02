/**
 * Sync activity (CHANNEX_ARCHITECTURE.md §9.2; plan Phase 6.3), tenant view: the recent updates
 * Pilloto sent to the channels (time, origin, what, dates, status), whether changes are waiting
 * or sending is paused, and "Resend everything to my channels". The technical log (task ids,
 * values, raw errors) is the platform console's.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, Paper, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { channelManagerService, SyncActivity as SyncActivityData, SyncLogRow } from '../../../services/api';

interface Props {
  canManage: boolean;
  /** Only fetch/poll while the property is active */
  active: boolean;
}

const POLL_MS = 10_000;
const STATUS_COLOR = { ok: 'success', warning: 'warning', error: 'error' } as const;

const SyncActivity: React.FC<Props> = ({ canManage, active }) => {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<SyncActivityData | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setData((await channelManagerService.syncActivity(page)).data.data ?? null); } catch { /* keep the last data */ }
  }, [page]);

  useEffect(() => {
    load();
    if (!active) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load, active]);

  const fullSync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await channelManagerService.fullSync();
      setMessage({ severity: 'success', text: t('admin.channelManager.home.syncActivity.fullSyncQueued') });
      setTimeout(load, 8000);
    } catch (e: any) {
      const wait = e?.response?.status === 429;
      setMessage({ severity: wait ? 'info' : 'error', text: wait ? t('admin.channelManager.home.syncActivity.fullSyncWait') : (e?.response?.data?.message ?? t('admin.channelManager.home.syncActivity.fullSyncFailed')) });
    } finally {
      setBusy(false);
    }
  };

  const time = (d?: string) => (d ? new Date(d).toLocaleString(i18n.language) : '—');
  const dates = (r: SyncLogRow) => (r.dateFrom ? (r.dateFrom === r.dateTo ? r.dateFrom : `${r.dateFrom} → ${r.dateTo}`) : '—');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const failing = data?.logs.some((r) => r.status === 'error');

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>{t('admin.channelManager.home.syncActivity.title')}</Typography>
        <Tooltip title={t('admin.channelManager.home.syncActivity.refresh')}><IconButton size="small" onClick={load}><Refresh fontSize="small" /></IconButton></Tooltip>
        {canManage && (
          <Button variant="outlined" size="small" onClick={fullSync} disabled={busy || !active} startIcon={busy ? <CircularProgress size={14} /> : undefined}>
            {t('admin.channelManager.home.syncActivity.fullSync')}
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('admin.channelManager.home.syncActivity.intro')}</Typography>
      {canManage && <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>{t('admin.channelManager.home.syncActivity.fullSyncHint')}</Typography>}
      {message && <Alert severity={message.severity} sx={{ mb: 1.5 }} onClose={() => setMessage(null)}>{message.text}</Alert>}
      {data?.pausedUntil && <Alert severity="warning" sx={{ mb: 1.5 }}>{t('admin.channelManager.home.syncActivity.paused', { time: new Date(data.pausedUntil).toLocaleTimeString(i18n.language) })}</Alert>}
      {failing && !data?.pausedUntil && <Alert severity="warning" sx={{ mb: 1.5 }}>{t('admin.channelManager.home.syncActivity.someFailed')}</Alert>}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
        {data && data.pending > 0 && <Typography variant="caption" color="text.secondary">{t('admin.channelManager.home.syncActivity.pending', { count: data.pending })}</Typography>}
        {data?.lastPushAt && <Typography variant="caption" color="text.secondary">{t('admin.channelManager.home.syncActivity.lastPush', { time: time(data.lastPushAt) })}</Typography>}
        {data?.lastFullSyncAt && <Typography variant="caption" color="text.secondary">{t('admin.channelManager.home.syncActivity.lastFull', { time: time(data.lastFullSyncAt) })}</Typography>}
      </Box>

      {data && data.logs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{t('admin.channelManager.home.syncActivity.empty')}</Typography>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow>
              {(['time', 'trigger', 'kind', 'dates', 'status'] as const).map((c) => (
                <TableCell key={c}>{t(`admin.channelManager.home.syncActivity.columns.${c}`)}</TableCell>
              ))}
            </TableRow></TableHead>
            <TableBody>
              {(data?.logs ?? []).map((r) => (
                <TableRow key={r._id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(r.createdAt)}</TableCell>
                  <TableCell>{t(`admin.channelManager.home.syncActivity.triggers.${r.trigger}`)}</TableCell>
                  <TableCell>{t(`admin.channelManager.home.syncActivity.kinds.${r.kind}`)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{dates(r)}</TableCell>
                  <TableCell><Chip size="small" color={STATUS_COLOR[r.status]} label={t(`admin.channelManager.home.syncActivity.status.${r.status}`)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {pages > 1 && (
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1 }}>
          <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('admin.channelManager.home.syncActivity.prev')}</Button>
          <Button size="small" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('admin.channelManager.home.syncActivity.next')}</Button>
        </Box>
      )}
    </Paper>
  );
};

export default SyncActivity;
