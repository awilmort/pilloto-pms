/**
 * EditReservationDialog
 *
 * Full edit form for an existing reservation: dates, guest counts, status,
 * room assignment, contact info, and price. Owns its own loading state and
 * API calls; reports results via callbacks.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { Reservation, Room } from '../../../types';
import { reservationsService, roomsService } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import NumberField from '../../common/NumberField';

// ─── Local helpers ────────────────────────────────────────────────────────────
const toInputDate = (dateString: string): string => {
  const d = new Date(dateString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const addOneDay = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const normalizeRange = (checkIn: string, checkOut?: string) => ({
  ci: checkIn,
  co: (!checkOut || checkOut <= checkIn) ? addOneDay(checkIn) : checkOut,
});

const isImmutableStatus = (res: Reservation | null): boolean =>
  !!res && (res.status === 'completed' || res.status === 'cancelled');

const formatDateTime = (dateString?: string): string => {
  if (!dateString) return 'N/A';
  try { return new Date(dateString).toLocaleString(); } catch { return dateString; }
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  open: boolean;
  reservation: Reservation | null;
  rooms: Room[];
  onClose: () => void;
  onSaved: (updated: Reservation) => void;
  onSnackbar: (message: string, severity: 'success' | 'error') => void;
  canCancel: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
const EditReservationDialog: React.FC<Props> = ({
  open, reservation, rooms, onClose, onSaved, onSnackbar, canCancel,
}) => {
  const { t } = useTranslation();
  const { user, permissions } = useAuth();

  const immutable = isImmutableStatus(reservation);

  const [editForm, setEditForm] = useState({
    checkInDate:     '',
    checkOutDate:    '',
    adults:          1,
    children:        0,
    infants:         0,
    totalPrice:      0,
    email:           '',
    phone:           '',
    specialRequests: '',
    status:          'pending' as 'pending' | 'confirmed' | 'cancelled' | 'completed',
    roomsIds:        [] as string[],
  });
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAvailableRoomsForDates = useCallback(async (checkIn: string, checkOut: string) => {
    try {
      const res = await roomsService.getAvailableRooms(checkIn, checkOut);
      const list = res.data.data ?? [];
      setAvailableRooms(Array.isArray(list) ? list : []);
    } catch {
      setAvailableRooms([]);
    }
  }, []);

  // Populate form when dialog opens
  useEffect(() => {
    if (!open || !reservation) return;

    const ci = toInputDate(reservation.checkInDate);
    const co = reservation.type === 'room'
      ? (reservation.checkOutDate ? toInputDate(reservation.checkOutDate) : addOneDay(ci))
      : (reservation.checkOutDate ? toInputDate(reservation.checkOutDate) : '');

    const currentRoomsIds: string[] = [];
    const arr = (reservation as any).rooms as any[] | undefined;
    if (Array.isArray(arr)) arr.forEach((rid: any) => currentRoomsIds.push(String(rid?._id ?? rid)));
    if (currentRoomsIds.length === 0 && reservation.room) {
      currentRoomsIds.push(String(typeof reservation.room === 'object' ? (reservation.room as any)._id : reservation.room));
    }

    setEditForm({
      checkInDate:     ci,
      checkOutDate:    co,
      adults:          reservation.guestDetails.adults,
      children:        reservation.guestDetails.children,
      infants:         reservation.guestDetails.infants,
      totalPrice:      reservation.totalPrice ?? 0,
      email:           reservation.contactInfo.email || '',
      phone:           reservation.contactInfo.phone || '',
      specialRequests: reservation.specialRequests || '',
      status:          reservation.status as any,
      roomsIds:        currentRoomsIds,
    });

    if (reservation.type === 'room') {
      loadAvailableRoomsForDates(ci, co || addOneDay(ci));
    }
  }, [open, reservation, loadAvailableRoomsForDates]);

  // Refresh available rooms when dates change inside the edit dialog
  useEffect(() => {
    if (!open || !reservation || reservation.type !== 'room' || !editForm.checkInDate) return;
    const { ci, co } = normalizeRange(editForm.checkInDate, editForm.checkOutDate);
    const timer = setTimeout(() => loadAvailableRoomsForDates(ci, co), 250);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editForm.checkInDate, editForm.checkOutDate]);

  const getAssignableRooms = (): Room[] => {
    if (!reservation) return [];
    const merged: Room[] = [...availableRooms];
    const ensureWithName = (ridOrObj: any) => {
      const id = typeof ridOrObj === 'object' ? ridOrObj._id : String(ridOrObj || '');
      if (!id || merged.find(r => r._id === id)) return;
      const nameFromObj  = typeof ridOrObj === 'object' ? (ridOrObj.name || '') : '';
      const nameFromList = rooms.find(r => r._id === id)?.name || '';
      merged.unshift({ _id: id, name: nameFromObj || nameFromList || id } as any);
    };
    if (reservation.room) ensureWithName(reservation.room);
    ((reservation as any).rooms as any[] | undefined || []).forEach(ensureWithName);
    return merged;
  };

  const handleSave = async () => {
    if (!reservation) return;
    try {
      setLoading(true);

      let payload: any = {};
      if (!immutable) {
        payload = {
          guestDetails:    { adults: editForm.adults, children: editForm.children, infants: editForm.infants },
          contactInfo:     { email: editForm.email, phone: editForm.phone },
          specialRequests:  editForm.specialRequests,
        };
      }

      // Only send dates if changed
      const originalCi = toInputDate(reservation.checkInDate);
      const originalCo = reservation.type === 'room'
        ? (reservation.checkOutDate ? toInputDate(reservation.checkOutDate) : addOneDay(originalCi))
        : (reservation.checkOutDate ? toInputDate(reservation.checkOutDate) : '');

      if (editForm.checkInDate !== originalCi) payload.checkInDate = editForm.checkInDate;
      if ((reservation.type === 'room' || reservation.type === 'event') && editForm.checkOutDate !== originalCo) {
        payload.checkOutDate = editForm.checkOutDate;
      }

      const isAdminRole = String(user?.role).toLowerCase() === 'admin';
      const canUpdateTotal = isAdminRole || (permissions || []).includes('admin.reservations.amountUpdate');
      if (canUpdateTotal && (reservation.totalPrice || 0) !== editForm.totalPrice) {
        payload.totalPrice = editForm.totalPrice;
      }

      let updated = reservation as Reservation;
      if (!immutable) {
        const res = await reservationsService.updateReservation(reservation._id, payload);
        updated = res.data.data as Reservation;
      }

      if (reservation.status !== editForm.status) {
        const statusRes = await reservationsService.updateReservationStatus(reservation._id, editForm.status);
        updated = statusRes.data.data as Reservation;
      }

      // Handle rooms assignment for room reservations
      if (!immutable && reservation.type === 'room') {
        const originalIds: string[] = [];
        const origArr = (reservation as any).rooms as any[] | undefined;
        if (Array.isArray(origArr)) origArr.forEach((rid: any) => originalIds.push(String(rid?._id ?? rid)));
        if (originalIds.length === 0 && reservation.room) {
          originalIds.push(String(typeof reservation.room === 'object' ? (reservation.room as any)._id : reservation.room));
        }
        const desiredIds = editForm.roomsIds.filter(Boolean);
        const changed = originalIds.length !== desiredIds.length
          || originalIds.some(id => !desiredIds.includes(id))
          || desiredIds.some(id => !originalIds.includes(id));
        if (changed) {
          const assignRes = await reservationsService.assignRooms(reservation._id, desiredIds);
          updated = assignRes.data.data as Reservation;
        }
      }

      onSaved(updated);
      onSnackbar('Reservation updated successfully!', 'success');
      onClose();
    } catch (error: any) {
      onSnackbar(error.response?.data?.message || 'Failed to update reservation', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!reservation) return null;

  const assignableRooms = getAssignableRooms();
  const guestLabel = reservation.guestName?.firstName
    ? `${reservation.guestName.firstName} ${reservation.guestName.lastName || ''}`.trim()
    : (reservation.user && typeof reservation.user === 'object'
      ? `${(reservation.user as any).firstName} ${(reservation.user as any).lastName}`
      : t('admin.dashboard.recentReservations.guestFallback'));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('admin.reservations.dialog.editTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>

          <Box>
            <Typography variant="subtitle2">{t('admin.reservations.form.guest')}</Typography>
            <Typography variant="body2" color="text.secondary">{guestLabel}</Typography>
          </Box>

          <TextField
            label={t('admin.reservations.form.checkinDate')}
            type="date"
            value={editForm.checkInDate}
            onChange={e => setEditForm(f => ({ ...f, checkInDate: e.target.value }))}
            InputLabelProps={{ shrink: true }}
            disabled={immutable}
          />

          {(reservation.type === 'room' || reservation.type === 'event') && (
            <TextField
              label={t('admin.reservations.form.checkoutDate')}
              type="date"
              value={editForm.checkOutDate}
              onChange={e => setEditForm(f => ({ ...f, checkOutDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              disabled={immutable}
            />
          )}

          {reservation.type === 'room' && (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <TextField
                label={t('admin.reservations.form.actualCheckin')}
                value={formatDateTime(reservation.actualCheckInAt)}
                InputProps={{ readOnly: true }}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label={t('admin.reservations.form.actualCheckout')}
                value={formatDateTime(reservation.actualCheckOutAt)}
                InputProps={{ readOnly: true }}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
          )}

          {reservation.type === 'room' && (
            <FormControl fullWidth>
              <InputLabel>{t('admin.reservations.form.assignedRoom')}</InputLabel>
              <Select
                multiple
                value={editForm.roomsIds}
                label={t('admin.reservations.form.assignedRoom')}
                onChange={e => setEditForm(f => ({ ...f, roomsIds: e.target.value as string[] }))}
                renderValue={selected => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(selected as string[]).map(id => {
                      const rm = assignableRooms.find(r => r._id === id);
                      return <Chip key={id} label={rm ? rm.name : id} size="small" />;
                    })}
                  </Box>
                )}
                disabled={immutable}
              >
                {assignableRooms.map(room => (
                  <MenuItem key={room._id} value={room._id}>
                    <Typography variant="body2">{room.name}</Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControl fullWidth>
            <InputLabel>{t('admin.reservations.form.status')}</InputLabel>
            <Select
              value={editForm.status}
              label={t('admin.reservations.form.status')}
              onChange={e => setEditForm(f => ({ ...f, status: e.target.value as any }))}
            >
              <MenuItem value="pending">{t('admin.reservations.statusLabels.pending')}</MenuItem>
              <MenuItem value="confirmed">{t('admin.reservations.statusLabels.confirmed')}</MenuItem>
              <MenuItem value="cancelled" disabled={!canCancel}>{t('admin.reservations.statusLabels.cancelled')}</MenuItem>
              <MenuItem value="completed">{t('admin.reservations.statusLabels.completed')}</MenuItem>
            </Select>
          </FormControl>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <NumberField label={t('admin.reservations.form.adults')}   value={editForm.adults}   onChange={v => setEditForm(f => ({ ...f, adults:   v ?? 1 }))} min={1} disabled={immutable} />
            <NumberField label={t('admin.reservations.form.children')} value={editForm.children} onChange={v => setEditForm(f => ({ ...f, children: v ?? 0 }))} min={0} disabled={immutable} />
            <NumberField label={t('admin.reservations.form.infants')}  value={editForm.infants}  onChange={v => setEditForm(f => ({ ...f, infants:  v ?? 0 }))} min={0} disabled={immutable} />
          </Box>

          <NumberField
            label={t('admin.reservations.form.totalPrice')}
            value={editForm.totalPrice}
            onChange={v => setEditForm(f => ({ ...f, totalPrice: v ?? 0 }))}
            min={0}
            disabled={immutable || !(String(user?.role).toLowerCase() === 'admin' || (permissions || []).includes('admin.reservations.amountUpdate'))}
            inputProps={{ step: 0.01 }}
          />

          <TextField
            label={t('admin.reservations.form.email')}
            value={editForm.email}
            onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
            disabled={immutable}
          />
          <TextField
            label={t('admin.reservations.form.phone')}
            value={editForm.phone}
            onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
            disabled={immutable}
          />
          <TextField
            label={t('admin.reservations.form.specialRequests')}
            multiline rows={3}
            value={editForm.specialRequests}
            onChange={e => setEditForm(f => ({ ...f, specialRequests: e.target.value }))}
            disabled={immutable}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('admin.reservations.actions.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={loading}>
          {t('admin.reservations.actions.saveChanges')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditReservationDialog;
