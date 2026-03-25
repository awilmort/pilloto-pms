/**
 * BookingCalendar – Gantt-style room booking view
 *
 * Design rationale (industry standard for hotel PMSs):
 *  • Rooms on the Y-axis (left sticky column) — one row per room
 *  • Dates on the X-axis (sticky header) — 8-day sliding window
 *  • Reservation bars span from check-in to check-out, color-coded by status
 *  • Unassigned room reservations collected at the bottom
 *  • Today column highlighted; nav arrows shift the window ±7 days
 *  • Click on a bar  → reservation quick-view modal (details + payments + check-in)
 *  • Click on blank   → create room reservation pre-filled with that date
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  Paper,
  Snackbar,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ChevronLeft,
  ChevronRight,
  Today,
} from '@mui/icons-material';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import CalendarReservationModal from '../../components/admin/reservations/CalendarReservationModal';
import BookingCreateDialog from '../../components/admin/reservations/BookingCreateDialog';
import { roomsService, reservationsService } from '../../services/api';
import { Room, Reservation } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import dayjs, { Dayjs } from 'dayjs';

// ─── Layout constants ────────────────────────────────────────────────────────
const CELL_W = 130;   // px per day column
const ROW_H  = 52;    // px per room row
const HEAD_H = 60;    // px for header row
const NAME_W = 185;   // px for room name column
const DAYS   = 8;     // number of days visible

// ─── Status colour map ───────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  pending:      '#F59E0B',
  confirmed:    '#10B981',
  'checked-in': '#3B82F6',
  'checked-out':'#94A3B8',
  completed:    '#94A3B8',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const getRoomIds = (res: Reservation): string[] => {
  const arr = (res as any).rooms as any[] | undefined;
  if (Array.isArray(arr) && arr.length > 0)
    return arr.map(r => (typeof r === 'object' ? r._id : String(r)));
  if (res.room)
    return [typeof res.room === 'object' ? (res.room as Room)._id : String(res.room)];
  return [];
};

const getGuestName = (res: Reservation, fallback: string) => {
  if (res.guestName?.firstName)
    return `${res.guestName.firstName} ${res.guestName.lastName ?? ''}`.trim();
  if (res.user && typeof res.user === 'object')
    return `${(res.user as any).firstName} ${(res.user as any).lastName}`;
  return fallback;
};



// ─── Component ───────────────────────────────────────────────────────────────
const BookingCalendar: React.FC = () => {
  const { t } = useTranslation();
  const { user, permissions } = useAuth();
  const isAdmin           = String(user?.role).toLowerCase() === 'admin';
  const canCheckIn        = isAdmin || (permissions || []).includes('admin.reservations.checkin');
  const canManagePayments = isAdmin || (permissions || []).includes('admin.reservations.managePayments');

  // ── Calendar state ─────────────────────────────────────────────────────────
  const [startDate, setStartDate]       = useState<Dayjs>(() => dayjs().startOf('day'));
  const [rooms, setRooms]               = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading]           = useState(true);

  // ── View-reservation modal state ───────────────────────────────────────────
  const [viewRes, setViewRes] = useState<Reservation | null>(null);

  // ── Create-reservation dialog state ───────────────────────────────────────
  const [createOpen, setCreateOpen]           = useState(false);
  const [createDefaultCheckIn, setCreateDefaultCheckIn]   = useState('');
  const [createDefaultCheckOut, setCreateDefaultCheckOut] = useState('');

  // ── Shared snackbar ────────────────────────────────────────────────────────
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  const endDate = useMemo(() => startDate.add(DAYS - 1, 'day'), [startDate]);
  const days    = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => startDate.add(i, 'day')),
    [startDate],
  );
  const today = dayjs().startOf('day');

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [roomsRes, resRes] = await Promise.all([
        roomsService.getRooms({ limit: 200 }),
        reservationsService.getReservations({
          dateFrom: startDate.format('YYYY-MM-DD'),
          dateTo:   endDate.format('YYYY-MM-DD'),
          type:     'room',
          limit:    500,
        }),
      ]);
      setRooms((Array.isArray(roomsRes.data.data) ? roomsRes.data.data : (roomsRes.data.data as any)?.rooms ?? []).filter((r: any) => r.status === 'active'));
      setReservations((resRes.data.data ?? []).filter((r: any) => r.status !== 'cancelled'));
    } catch (e) {
      console.error('BookingCalendar: fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Open create dialog pre-filled from a calendar click ───────────────────
  const openCreateDialog = (date: string) => {
    const nextDay = dayjs(date).add(1, 'day').format('YYYY-MM-DD');
    setCreateDefaultCheckIn(date);
    setCreateDefaultCheckOut(nextDay);
    setCreateOpen(true);
  };

  // ── Map reservations → rooms ───────────────────────────────────────────────
  const reservationsByRoom = useMemo(() => {
    const map: Record<string, Reservation[]> = { __unassigned: [] };
    for (const res of reservations) {
      if (res.type !== 'room') continue;
      const ids = getRoomIds(res);
      if (ids.length === 0) {
        map['__unassigned'].push(res);
      } else {
        for (const id of ids) {
          if (!map[id]) map[id] = [];
          map[id].push(res);
        }
      }
    }
    return map;
  }, [reservations]);

  // ── Calculate bar position within the visible window ──────────────────────
  const calcBar = (res: Reservation): { left: number; width: number } | null => {
    const ci = dayjs(res.checkInDate).startOf('day');
    const co = res.checkOutDate
      ? dayjs(res.checkOutDate).startOf('day')
      : ci.add(1, 'day');

    const startOff   = ci.diff(startDate, 'day');
    const endOff     = co.diff(startDate, 'day');
    const clamped0   = Math.max(0, startOff);
    const clampedEnd = Math.min(DAYS, endOff);
    if (clamped0 >= DAYS || clampedEnd <= 0) return null;

    return {
      left:  clamped0 * CELL_W + 4,
      width: (clampedEnd - clamped0) * CELL_W - 8,
    };
  };

  // ── Reservation bar ────────────────────────────────────────────────────────
  const renderBar = (res: Reservation) => {
    const bar = calcBar(res);
    if (!bar) return null;

    const color     = STATUS_COLORS[res.status] ?? '#94A3B8';
    const guestName = getGuestName(res, t('admin.dashboard.recentReservations.guestFallback'));

    return (
      <Tooltip
        key={res._id}
        title={`${guestName} · ${res.checkInDate ? new Date(res.checkInDate).toLocaleDateString() : ''} → ${res.checkOutDate ? new Date(res.checkOutDate).toLocaleDateString() : '–'}`}
        arrow
        placement="top"
        enterDelay={300}
      >
        <Box
          onClick={(e) => { e.stopPropagation(); setViewRes(res); }}
          sx={{
            position:   'absolute',
            top:        8,
            height:     ROW_H - 16,
            left:       bar.left,
            width:      bar.width,
            bgcolor:    color,
            borderRadius: 1,
            display:    'flex',
            alignItems: 'center',
            px:         1,
            cursor:     'pointer',
            overflow:   'hidden',
            zIndex:     1,
            boxShadow:  '0 1px 3px rgba(0,0,0,0.25)',
            transition: 'filter 0.15s',
            '&:hover': { filter: 'brightness(0.88)', zIndex: 2 },
          }}
        >
          <Typography variant="caption" color="#fff" noWrap fontWeight={600} sx={{ lineHeight: 1.2 }}>
            {guestName}
          </Typography>
        </Box>
      </Tooltip>
    );
  };

  // ── Shared day-grid lines inside a row ────────────────────────────────────
  const renderGridLines = () =>
    days.map((day, i) => (
      <div
        key={i}
        style={{
          position:    'absolute',
          left:        i * CELL_W,
          top:         0,
          width:       CELL_W,
          height:      ROW_H,
          borderRight: '1px solid rgba(0,0,0,0.07)',
          background:  day.isSame(today, 'day') ? 'rgba(59,130,246,0.06)' : 'transparent',
          boxSizing:   'border-box',
        }}
      />
    ));

  // ── Row renderer ──────────────────────────────────────────────────────────
  const renderRow = (
    key: string,
    name: string,
    rowReservations: Reservation[],
    isUnassigned: boolean,
    stripeIdx: number,
  ) => {
    const bg = isUnassigned ? '#FFFBEB' : stripeIdx % 2 === 0 ? '#ffffff' : '#F8FAFC';

    const handleGridClick = (e: React.MouseEvent<HTMLTableCellElement>) => {
      // Reservation-bar clicks call e.stopPropagation(), so this only fires
      // for genuinely blank-space clicks.
      const rect    = e.currentTarget.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const dayIdx  = Math.min(Math.floor(offsetX / CELL_W), DAYS - 1);
      const clicked = days[dayIdx];
      if (clicked) openCreateDialog(clicked.format('YYYY-MM-DD'));
    };

    return (
      <tr key={key} style={{ height: ROW_H }}>
        {/* Sticky room-name cell */}
        <td
          style={{
            position:      'sticky',
            left:          0,
            zIndex:        1,
            width:         NAME_W,
            minWidth:      NAME_W,
            maxWidth:      NAME_W,
            borderRight:   '1px solid rgba(0,0,0,0.1)',
            borderBottom:  '1px solid rgba(0,0,0,0.07)',
            padding:       '0 14px',
            background:    bg,
            verticalAlign: 'middle',
          }}
        >
          <Typography
            variant="body2"
            fontWeight={600}
            noWrap
            color={isUnassigned ? 'warning.dark' : 'text.primary'}
          >
            {name}
          </Typography>
        </td>

        {/* Relative container holding grid lines + reservation bars */}
        <td
          colSpan={DAYS}
          onClick={handleGridClick}
          style={{
            position:      'relative',
            width:         CELL_W * DAYS,
            minWidth:      CELL_W * DAYS,
            height:        ROW_H,
            padding:       0,
            borderBottom:  '1px solid rgba(0,0,0,0.07)',
            background:    bg,
            verticalAlign: 'top',
            overflow:      'hidden',
            cursor:        'cell',
          }}
        >
          {renderGridLines()}
          {rowReservations.map(res => renderBar(res))}
        </td>
      </tr>
    );
  };

  const unassigned    = reservationsByRoom['__unassigned'] ?? [];
  const hasUnassigned = unassigned.length > 0;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <AdminLayout>
      <Container maxWidth={false} sx={{ py: 4, px: { xs: 2, md: 3 } }}>

        {/* ── Header bar ── */}
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <SectionTitle title={t('admin.bookingCalendar.title')} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Today />}
              onClick={() => setStartDate(dayjs().startOf('day'))}
              disabled={startDate.isSame(today, 'day')}
            >
              {t('admin.bookingCalendar.today')}
            </Button>
            <IconButton size="small" onClick={() => setStartDate(d => d.subtract(7, 'day'))}>
              <ChevronLeft />
            </IconButton>
            <Typography variant="body2" sx={{ minWidth: 190, textAlign: 'center', fontWeight: 500 }}>
              {startDate.format('MMM D')} – {endDate.format('MMM D, YYYY')}
            </Typography>
            <IconButton size="small" onClick={() => setStartDate(d => d.add(7, 'day'))}>
              <ChevronRight />
            </IconButton>
          </Box>
        </Box>

        {/* ── Status legend ── */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2.5 }}>
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color, flexShrink: 0 }} />
              <Typography variant="caption" color="text.secondary">
                {t(`admin.reservations.statusLabels.${status.replace('-', '_')}`, status)}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* ── Calendar grid ── */}
        {loading ? (
          <Box sx={{ py: 12, textAlign: 'center' }}>
            <CircularProgress />
          </Box>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              overflow: 'hidden',
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box
              sx={{
                overflowX: 'auto',
                overflowY: 'auto',
                maxHeight: 'calc(100vh - 290px)',
              }}
            >
              <table
                style={{
                  borderCollapse: 'collapse',
                  tableLayout:    'fixed',
                  width:          NAME_W + CELL_W * DAYS,
                  minWidth:       NAME_W + CELL_W * DAYS,
                }}
              >
                {/* ── Sticky date header ── */}
                <thead>
                  <tr style={{ height: HEAD_H }}>
                    {/* Corner cell */}
                    <th
                      style={{
                        position:    'sticky',
                        top:         0,
                        left:        0,
                        zIndex:      4,
                        width:       NAME_W,
                        minWidth:    NAME_W,
                        maxWidth:    NAME_W,
                        background:  '#F1F5F9',
                        borderRight: '1px solid rgba(0,0,0,0.12)',
                        borderBottom:'2px solid rgba(0,0,0,0.12)',
                        padding:     '0 14px',
                        textAlign:   'left',
                      }}
                    >
                      <Typography
                        variant="caption"
                        fontWeight={700}
                        color="text.secondary"
                        sx={{ textTransform: 'uppercase', letterSpacing: 0.8 }}
                      >
                        {t('admin.bookingCalendar.room')}
                      </Typography>
                    </th>

                    {/* Day columns */}
                    {days.map(day => {
                      const isToday = day.isSame(today, 'day');
                      return (
                        <th
                          key={day.toISOString()}
                          style={{
                            position:    'sticky',
                            top:         0,
                            zIndex:      3,
                            width:       CELL_W,
                            minWidth:    CELL_W,
                            maxWidth:    CELL_W,
                            background:  isToday ? '#EFF6FF' : '#F1F5F9',
                            borderRight: '1px solid rgba(0,0,0,0.08)',
                            borderBottom: isToday
                              ? '2px solid #3B82F6'
                              : '2px solid rgba(0,0,0,0.12)',
                            padding:     '6px 0',
                            textAlign:   'center',
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ display: 'block', letterSpacing: 0.5 }}
                            color={isToday ? 'primary.main' : 'text.secondary'}
                            fontWeight={isToday ? 700 : 500}
                          >
                            {day.format('ddd').toUpperCase()}
                          </Typography>
                          <Typography
                            variant="body2"
                            fontWeight={isToday ? 700 : 400}
                            color={isToday ? 'primary.main' : 'text.primary'}
                          >
                            {day.format('D')}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.disabled"
                            sx={{ display: 'block', fontSize: '0.65rem' }}
                          >
                            {day.format('MMM')}
                          </Typography>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* ── Room rows ── */}
                <tbody>
                  {rooms.map((room, idx) =>
                    renderRow(
                      room._id,
                      room.name,
                      reservationsByRoom[room._id] ?? [],
                      false,
                      idx,
                    )
                  )}

                  {/* Unassigned row */}
                  {hasUnassigned && renderRow(
                    '__unassigned',
                    t('admin.bookingCalendar.unassigned'),
                    unassigned,
                    true,
                    rooms.length,
                  )}

                  {/* Empty state */}
                  {rooms.length === 0 && (
                    <tr>
                      <td
                        colSpan={DAYS + 1}
                        style={{ padding: 48, textAlign: 'center' }}
                      >
                        <Typography color="text.secondary">
                          {t('admin.bookingCalendar.noRooms')}
                        </Typography>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Box>
          </Paper>
        )}
      </Container>

      {/* ══════════════════════════════════════════════════════════════
          RESERVATION QUICK-VIEW MODAL
      ══════════════════════════════════════════════════════════════ */}
      <CalendarReservationModal
        reservation={viewRes}
        onClose={() => setViewRes(null)}
        onUpdated={(updated) => {
          setViewRes(updated);
          setReservations(prev => prev.map(r => r._id === updated._id ? updated : r));
        }}
        canCheckIn={canCheckIn}
        canManagePayments={canManagePayments}
        onSnackbar={(message, severity) => setSnackbar({ open: true, message, severity })}
      />

      {/* ══════════════════════════════════════════════════════════════
          CREATE RESERVATION DIALOG
      ══════════════════════════════════════════════════════════════ */}
      <BookingCreateDialog
        open={createOpen}
        defaultCheckIn={createDefaultCheckIn}
        defaultCheckOut={createDefaultCheckOut}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchData}
        onSnackbar={(message, severity) => setSnackbar({ open: true, message, severity })}
      />

      {/* ── Snackbar ── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>

    </AdminLayout>
  );
};

export default BookingCalendar;
