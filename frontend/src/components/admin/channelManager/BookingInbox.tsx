/**
 * Booking inbox (CHANNEX_ARCHITECTURE.md §9.2; plan Phase 7.2), tenant view: bookings received
 * from the channels — when, which channel and code, guest, stay, kind of change, whether it is
 * in Pilloto — with a link to the reservation. Revision ids, sources and raw errors are the
 * platform console's.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, Link, Paper, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookingInbox as BookingInboxData, BookingInboxState, channelManagerService } from '../../../services/api';
import { otaLabel } from '../../../utils/channels';

interface Props {
  /** Only poll while the property is active */
  active: boolean;
}

const POLL_MS = 15_000;
const STATE_COLOR: Record<BookingInboxState, 'default' | 'success' | 'error' | 'info'> = {
  waiting: 'info', imported: 'success', outdated: 'default', failed: 'error',
};


const BookingInbox: React.FC<Props> = ({ active }) => {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<BookingInboxData | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try { setData((await channelManagerService.bookingInbox(page)).data.data ?? null); } catch { /* keep the last data */ }
  }, [page]);

  useEffect(() => {
    load();
    if (!active) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load, active]);

  const time = (d?: string) => (d ? new Date(d).toLocaleString(i18n.language) : '—');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const failing = data?.rows.some((r) => r.state === 'failed');
  const k = (key: string) => `admin.channelManager.home.bookingInbox.${key}`;

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>{t(k('title'))}</Typography>
        <Tooltip title={t(k('refresh'))}><IconButton size="small" onClick={load}><Refresh fontSize="small" /></IconButton></Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t(k('intro'))}</Typography>
      {failing && <Alert severity="warning" sx={{ mb: 1.5 }}>{t(k('someFailed'))}</Alert>}

      {data && data.rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{t(k('empty'))}</Typography>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow>
              {(['received', 'channel', 'code', 'guest', 'stay', 'change', 'state'] as const).map((c) => (
                <TableCell key={c}>{t(k(`columns.${c}`))}</TableCell>
              ))}
            </TableRow></TableHead>
            <TableBody>
              {(data?.rows ?? []).map((r) => (
                <TableRow key={r._id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(r.receivedAt)}</TableCell>
                  <TableCell>{otaLabel(r.otaName)}</TableCell>
                  <TableCell>
                    {r.reservationId ? (
                      <Tooltip title={t(k('open'))}>
                        <Link component={RouterLink} to={`/admin/reservations?id=${r.reservationId}`}>{r.otaReservationCode ?? r.reservationCode ?? t(k('open'))}</Link>
                      </Tooltip>
                    ) : (r.otaReservationCode ?? '—')}
                  </TableCell>
                  <TableCell>{r.guestName ?? '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.arrivalDate ? `${r.arrivalDate} → ${r.departureDate ?? ''}` : '—'}</TableCell>
                  <TableCell>{r.status ? t(k(`status.${r.status}`)) : '—'}</TableCell>
                  <TableCell>
                    <Tooltip title={t(k(`stateHint.${r.state}`))}>
                      <Chip size="small" color={STATE_COLOR[r.state]} label={t(k(`state.${r.state}`))} />
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {pages > 1 && (
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1 }}>
          <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t(k('prev'))}</Button>
          <Button size="small" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t(k('next'))}</Button>
        </Box>
      )}
    </Paper>
  );
};

export default BookingInbox;
