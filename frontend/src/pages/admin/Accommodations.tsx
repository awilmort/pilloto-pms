import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Select,
  MenuItem,
  TextField,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
  Snackbar,
  Alert,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  ToggleButtonGroup,
  ToggleButton,
  FormControl,
  InputLabel,
  Chip,
} from '@mui/material';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import { reservationsService, roomsService, adminService } from '../../services/api';
import { Reservation, Room } from '../../types';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

const Accommodations: React.FC = () => {
  const { t } = useTranslation();

  const statusOptions = [
    { value: 'active', label: t('admin.rooms.statusLabels.active') },
    { value: 'inactive', label: t('admin.rooms.statusLabels.inactive') },
  ];

  const conditionOptions = [
    { value: 'pending_cleanup', label: t('admin.rooms.condition.pending_cleanup') },
    { value: 'clean', label: t('admin.rooms.condition.clean') },
  ];
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [snackbar, setSnackbar] = useState<{open: boolean; message: string; severity: 'success'|'error'}>({ open: false, message: '', severity: 'success' });
  const [period, setPeriod] = useState<'today' | 'tomorrow'>('today');

  const selectedDate = useMemo(() => period === 'tomorrow' ? dayjs().add(1, 'day') : dayjs(), [period]);
  const dateLabel = selectedDate.format('dddd, MMMM D, YYYY');

  const [editOpen, setEditOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editFields, setEditFields] = useState<{ status: Room['status'] | undefined; condition: Room['condition'] | undefined; comment: string }>({ status: undefined, condition: undefined, comment: '' });

  const loadRooms = useCallback(async () => {
    const roomsRes = await roomsService.getRooms({ limit: 200 });
    const roomsData = roomsRes.data.data as any;
    setRooms(Array.isArray(roomsData) ? roomsData : roomsData?.rooms || []);
  }, []);

  const loadReservations = useCallback(async () => {
    // Backend expects local date strings (YYYY-MM-DD) to avoid timezone drift
    const dayStr = selectedDate.format('YYYY-MM-DD');
    const res = await reservationsService.getReservations({ type: 'room', dateFrom: dayStr, dateTo: dayStr, limit: 200 });
    const list: Reservation[] = (res.data.data || []) as any;
    setReservations(list.filter(r => r.status !== 'cancelled'));
  }, [selectedDate]);

  // Initial load: rooms + reservations
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadRooms(), loadReservations()]);
      } catch (e: any) {
        console.error('Failed to load accommodations data', e);
        setSnackbar({ open: true, message: e.response?.data?.message || t('admin.accommodations.messages.loadFailed'), severity: 'error' });
      } finally {
        setLoading(false);
      }
    })();
  }, [loadRooms, loadReservations, t]);

  // Subsequent updates: only refresh reservations when period/date changes
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadReservations();
      } catch (e: any) {
        console.error('Failed to refresh reservations', e);
        setSnackbar({ open: true, message: e.response?.data?.message || t('admin.accommodations.messages.operationFailed'), severity: 'error' });
      } finally {
        setLoading(false);
      }
    })();
  }, [loadReservations, t]);

  // Optional grouping by room can be added later if needed

  const openEdit = (room: Room) => {
    setEditingRoom(room);
    setEditFields({ status: (room as any).status, condition: (room as any).condition, comment: (room as any).comment });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editingRoom) return;
    try {
      const res = await adminService.updateRoomOps(editingRoom._id, {
        status: editFields.status,
        condition: editFields.condition,
        comment: editFields.comment,
      } as any);
      if (res.data.success) {
        setSnackbar({ open: true, message: t('admin.accommodations.messages.updateSuccess'), severity: 'success' });
        setEditOpen(false);
        setEditingRoom(null);
        await loadRooms();
      }
    } catch (e: any) {
      console.error('Save ops failed', e);
      setSnackbar({ open: true, message: e.response?.data?.message || t('admin.accommodations.messages.saveFailed'), severity: 'error' });
    }
  };

  const renderConditionBadge = (condition: Room['condition']) => {
    const label = condition === 'pending_cleanup' ? t('admin.rooms.condition.pending_cleanup') : t('admin.rooms.condition.clean');
    const color = condition === 'pending_cleanup' ? 'warning' : 'success';
    return <Chip label={label} color={color as any} size="small" variant="outlined" />;
  };

  const renderStatusBadge = (status: Room['status']) => {
    const label = status === 'active' ? t('admin.rooms.statusLabels.active') : t('admin.rooms.statusLabels.inactive');
    const color = status === 'active' ? 'success' : 'default';
    return <Chip label={label} color={color as any} size="small" variant="outlined" />;
  };

  const getAvailabilityState = (room: Room): 'available' | 'booked' | 'occupied' | 'not_available' => {
    if (room.status === 'inactive') return 'not_available';
    const dayStart = selectedDate.startOf('day');
    const match = reservations.find(r => {
      // match if any assigned room (room or rooms[]) equals this room
      let assigned = false;
      if (r.room) {
        assigned = (typeof r.room === 'object') ? (r.room as any)._id === room._id : String(r.room || '') === String(room._id);
      }
      const roomsArr = (r as any).rooms as any[] | undefined;
      if (!assigned && Array.isArray(roomsArr)) {
        assigned = roomsArr.some((rid: any) => String((rid && rid._id) ? rid._id : rid) === String(room._id));
      }
      if (!assigned) return false;
      const ci = dayjs(r.checkInDate).startOf('day');
      const co = r.checkOutDate ? dayjs(r.checkOutDate).startOf('day') : ci.add(1, 'day');
      // Occupancy condition: checkIn <= date AND checkOut > date (checkout excluded)
      return (ci.isSame(dayStart) || ci.isBefore(dayStart)) && co.isAfter(dayStart);
    });
    if (!match) return 'available';
    return match.actualCheckInAt ? 'occupied' : 'booked';
  };

  const renderAvailabilityBadge = (state: 'available' | 'booked' | 'occupied' | 'not_available') => {
    const labelMap: Record<typeof state, string> = {
      available: t('admin.accommodations.availabilityLabels.available'),
      booked: t('admin.accommodations.availabilityLabels.booked'),
      occupied: t('admin.accommodations.availabilityLabels.occupied'),
      not_available: t('admin.accommodations.availabilityLabels.not_available'),
    } as any;
    const colorMap: Record<typeof state, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
      available: 'success',
      booked: 'warning',
      occupied: 'error',
      not_available: 'default',
    } as any;
    return <Chip label={labelMap[state]} color={colorMap[state]} size="small" variant="outlined" />;
  };

  const getReservationOpsStatus = (r: Reservation): 'arriving' | 'departing' | 'in_progress' => {
    const dayStart = selectedDate.startOf('day');
    const ci = dayjs(r.checkInDate).startOf('day');
    const co = r.checkOutDate ? dayjs(r.checkOutDate).startOf('day') : ci.add(1, 'day');
    if (dayStart.isSame(ci)) return 'arriving';
    if (r.checkOutDate && dayStart.isSame(co)) return 'departing';
    if (dayStart.isAfter(ci) && dayStart.isBefore(co)) return 'in_progress';
    return 'in_progress';
  };

  const renderReservationOpsBadge = (status: 'arriving' | 'departing' | 'in_progress') => {
    const labelMap: Record<typeof status, string> = {
      arriving: t('admin.accommodations.reservationStatusLabels.arriving'),
      departing: t('admin.accommodations.reservationStatusLabels.departing'),
      in_progress: t('admin.accommodations.reservationStatusLabels.in_progress'),
    } as any;
    const colorMap: Record<typeof status, 'info' | 'warning' | 'success'> = {
      arriving: 'info',
      departing: 'warning',
      in_progress: 'success',
    } as any;
    return <Chip label={labelMap[status]} color={colorMap[status]} size="small" variant="outlined" />;
  };

  if (loading) {
    return (
      <AdminLayout>
        <Container maxWidth="lg" sx={{ py: 6, textAlign: 'center' }}>
          <CircularProgress size={60} />
          <Typography variant="h6" sx={{ mt: 2 }}>{t('admin.accommodations.loading')}</Typography>
        </Container>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <Container maxWidth="xl" sx={{ py: 2 }}>
        <SectionTitle
          title={t('admin.accommodations.title')}
          right={
            <ToggleButtonGroup value={period} exclusive onChange={(_, val) => val && setPeriod(val)}>
              <ToggleButton value="today">{t('admin.schedule.today')}</ToggleButton>
              <ToggleButton value="tomorrow">{t('admin.schedule.tomorrow')}</ToggleButton>
            </ToggleButtonGroup>
          }
        />
        <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 2 }}>{dateLabel}</Typography>

        {/* Reservations for selected day (room type) */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6">{t('admin.reservations.title')}</Typography>
          <Divider sx={{ my: 2 }} />
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.schedule.table.guest')}</TableCell>
                <TableCell>{t('admin.schedule.table.room')}</TableCell>
                <TableCell sx={{ minWidth: 140 }}>{t('admin.reservations.table.status')}</TableCell>
                <TableCell>{t('admin.reservations.table.dates')}</TableCell>
                <TableCell align="right">{t('admin.schedule.table.totalGuests')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reservations.map(r => {
                const guest = r.guestName?.firstName
                  ? `${r.guestName.firstName} ${r.guestName.lastName || ''}`.trim()
                  : (typeof r.user === 'object' ? `${(r.user as any).firstName} ${(r.user as any).lastName}` : t('admin.dashboard.recentReservations.guestFallback'));
                const totalGuests = (r.guestDetails?.adults || 0) + (r.guestDetails?.children || 0) + (r.guestDetails?.infants || 0);
                const dateStr = r.type === 'room'
                  ? `${new Date(r.checkInDate).toLocaleDateString()} - ${r.checkOutDate ? new Date(r.checkOutDate).toLocaleDateString() : ''}`
                  : new Date(r.checkInDate).toLocaleDateString();
                const roomName = (() => {
                  const rooms = (r as any).rooms as any[] | undefined;
                  if (Array.isArray(rooms) && rooms.length > 0) {
                    return rooms.map(rm => (typeof rm === 'object' ? rm.name : String(rm))).join(', ');
                  }
                  return r.room && typeof r.room === 'object' ? (r.room as any).name : t('admin.schedule.notAssigned');
                })();
                const opsStatus = renderReservationOpsBadge(getReservationOpsStatus(r));
                return (
                  <TableRow key={r._id}>
                    <TableCell>{guest}</TableCell>
                    <TableCell>{roomName}</TableCell>
                    <TableCell sx={{ minWidth: 140 }}>{opsStatus}</TableCell>
                    <TableCell>{dateStr}</TableCell>
                    <TableCell align="right">{totalGuests}</TableCell>
                  </TableRow>
                );
              })}
              {reservations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">{t('admin.schedule.empty.rooms')}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>

        {/* Rooms Ops Table */}
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>{t('admin.rooms.title')}</Typography>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.schedule.table.room')}</TableCell>
                {/* Removed Type column as requested */}
                <TableCell>{t('admin.rooms.table.status')}</TableCell>
                <TableCell>{t('admin.accommodations.table.availability')}</TableCell>
                <TableCell>{t('admin.rooms.form.condition')}</TableCell>
                <TableCell>{t('admin.rooms.form.comment')}</TableCell>
                <TableCell>{t('admin.rooms.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rooms.map(room => (
                <TableRow key={room._id}>
                  <TableCell>{room.name}</TableCell>
                  <TableCell>{renderStatusBadge((room as any).status)}</TableCell>
                  <TableCell>{renderAvailabilityBadge(getAvailabilityState(room))}</TableCell>
                  <TableCell>{renderConditionBadge((room as any).condition)}</TableCell>
                  <TableCell sx={{ minWidth: 300 }}>{(room as any).comment}</TableCell>
                  <TableCell>
                    <Button variant="contained" size="small" onClick={() => openEdit(room)}>{t('admin.rooms.actions.edit')}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>

        {/* Edit Room Dialog */}
        <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle>{t('admin.rooms.dialog.editTitle')}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 2 }}>{editingRoom?.name}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('admin.rooms.form.status')}</InputLabel>
                <Select
                  label={t('admin.rooms.form.status')}
                  value={editFields.status ?? ''}
                  onChange={(e) => setEditFields({ ...editFields, status: e.target.value as any })}
                >
                  {statusOptions.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>{t('admin.rooms.form.condition')}</InputLabel>
                <Select
                  label={t('admin.rooms.form.condition')}
                  value={editFields.condition ?? ''}
                  onChange={(e) => setEditFields({ ...editFields, condition: e.target.value as any })}
                >
                  {conditionOptions.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                fullWidth
                label={t('admin.rooms.form.comment')}
                multiline
                minRows={4}
                value={editFields.comment}
                onChange={(e) => setEditFields({ ...editFields, comment: e.target.value })}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditOpen(false)}>{t('admin.amenities.actions.cancel')}</Button>
            <Button variant="contained" onClick={saveEdit}>{t('admin.roles.actions.save')}</Button>
          </DialogActions>
        </Dialog>

        <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>{snackbar.message}</Alert>
        </Snackbar>
      </Container>
    </AdminLayout>
  );
};

export default Accommodations;
