/**
 * RoomBlockDialog — create, edit or delete one room block (a room out of service
 * for a range of nights). Used from the booking calendar and the rooms screen.
 *
 * Dates follow the hotel convention: the first night out of service, and the day the
 * room is back (exclusive), like a reservation's check-in / check-out. When the room has
 * bookings on those nights the API answers 409; the dialog lists them and offers
 * "Block anyway".
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
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
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { roomBlocksService, RoomBlockConflict } from '../../../services/api';
import { Room, RoomBlock, RoomBlockReason } from '../../../types';

export const ROOM_BLOCK_REASONS: RoomBlockReason[] = ['maintenance', 'out_of_order', 'owner_use', 'other'];

interface Props {
  open: boolean;
  rooms: Pick<Room, '_id' | 'name'>[];
  /** Edit this block; omit to create */
  block?: RoomBlock | null;
  defaults?: { roomId?: string; startDate?: string; endDate?: string };
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const blockRoomId = (b: RoomBlock) => (typeof b.roomId === 'object' ? b.roomId._id : b.roomId);

const RoomBlockDialog: React.FC<Props> = ({ open, rooms, block, defaults, canManage, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [roomId, setRoomId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState<RoomBlockReason>('maintenance');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<RoomBlockConflict | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const today = dayjs().format('YYYY-MM-DD');
    setRoomId(block ? blockRoomId(block) : defaults?.roomId || '');
    setStartDate(block?.startDate || defaults?.startDate || today);
    setEndDate(block?.endDate || defaults?.endDate || dayjs(defaults?.startDate || today).add(1, 'day').format('YYYY-MM-DD'));
    setReason(block?.reason || 'maintenance');
    setNotes(block?.notes || '');
    setError(null);
    setConflict(null);
    setConfirmDelete(false);
    // Reset only when the dialog opens: callers pass `defaults` inline (a new object each render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const nights = startDate && endDate ? dayjs(endDate).diff(dayjs(startDate), 'day') : 0;
  const datesValid = Boolean(roomId && startDate && endDate && nights > 0);
  const roomName = rooms.find(r => r._id === roomId)?.name || '';
  const fmt = (d: string) => dayjs(d).format('ddd D MMM YYYY');

  const save = async (force = false) => {
    if (!datesValid) {
      setError(t('admin.roomBlocks.errors.dates'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = { roomId, startDate, endDate, reason, notes, force };
      if (block) await roomBlocksService.update(block._id, data);
      else await roomBlocksService.create(data);
      onSaved(t(block ? 'admin.roomBlocks.messages.updated' : 'admin.roomBlocks.messages.created'));
      onClose();
    } catch (e: any) {
      const body = e?.response?.data;
      if (e?.response?.status === 409 && body?.code === 'reservation_overlap') {
        setConflict(body as RoomBlockConflict);
      } else {
        setConflict(null);
        setError(body?.message || t('admin.roomBlocks.messages.failed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!block) return;
    setSaving(true);
    try {
      await roomBlocksService.remove(block._id);
      onSaved(t('admin.roomBlocks.messages.deleted'));
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || t('admin.roomBlocks.messages.failed'));
    } finally {
      setSaving(false);
    }
  };

  const readOnly = !canManage;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t(block ? 'admin.roomBlocks.title.edit' : 'admin.roomBlocks.title.create')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('admin.roomBlocks.help')}</Typography>

          <FormControl fullWidth size="small" disabled={readOnly}>
            <InputLabel>{t('admin.roomBlocks.fields.room')}</InputLabel>
            <Select value={roomId} label={t('admin.roomBlocks.fields.room')} onChange={e => { setRoomId(String(e.target.value)); setConflict(null); }}>
              {rooms.map(r => <MenuItem key={r._id} value={r._id}>{r.name}</MenuItem>)}
            </Select>
          </FormControl>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              type="date"
              size="small"
              label={t('admin.roomBlocks.fields.from')}
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setConflict(null); }}
              InputLabelProps={{ shrink: true }}
              disabled={readOnly}
              sx={{ flex: 1, minWidth: 180 }}
            />
            <TextField
              type="date"
              size="small"
              label={t('admin.roomBlocks.fields.until')}
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setConflict(null); }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: startDate ? dayjs(startDate).add(1, 'day').format('YYYY-MM-DD') : undefined }}
              disabled={readOnly}
              sx={{ flex: 1, minWidth: 180 }}
            />
          </Box>

          <FormControl fullWidth size="small" disabled={readOnly}>
            <InputLabel>{t('admin.roomBlocks.fields.reason')}</InputLabel>
            <Select value={reason} label={t('admin.roomBlocks.fields.reason')} onChange={e => setReason(e.target.value as RoomBlockReason)}>
              {ROOM_BLOCK_REASONS.map(r => <MenuItem key={r} value={r}>{t(`admin.roomBlocks.reasons.${r}`)}</MenuItem>)}
            </Select>
          </FormControl>

          <TextField
            size="small"
            label={t('admin.roomBlocks.fields.notes')}
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 500))}
            multiline
            minRows={2}
            disabled={readOnly}
          />

          {datesValid && roomName && (
            <Alert severity="info" variant="outlined">
              {t('admin.roomBlocks.summary', {
                room: roomName,
                count: nights,
                from: fmt(startDate),
                last: fmt(dayjs(endDate).subtract(1, 'day').format('YYYY-MM-DD')),
                until: fmt(endDate),
              })}
            </Alert>
          )}

          {conflict && (
            <Alert severity="warning">
              <Typography variant="body2" fontWeight={600}>{t('admin.roomBlocks.conflictTitle')}</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {conflict.conflicts.map(c => (
                  <li key={c.reservationId}>
                    <Typography variant="body2">
                      {[c.reservationCode, c.guestName].filter(Boolean).join(' · ')} — {c.checkIn && fmt(c.checkIn)} → {c.checkOut && fmt(c.checkOut)}
                    </Typography>
                  </li>
                ))}
              </Box>
              <Typography variant="body2" sx={{ mt: 1 }}>{t('admin.roomBlocks.conflictHint')}</Typography>
            </Alert>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          {confirmDelete && (
            <Alert severity="error" action={
              <Button color="inherit" size="small" onClick={remove} disabled={saving}>{t('admin.roomBlocks.delete')}</Button>
            }>
              {t('admin.roomBlocks.confirmDelete')}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {block && canManage && !confirmDelete && (
          <Button color="error" onClick={() => setConfirmDelete(true)} disabled={saving} sx={{ mr: 'auto' }}>
            {t('admin.roomBlocks.delete')}
          </Button>
        )}
        <Button onClick={onClose} disabled={saving}>{t('admin.roomBlocks.cancel')}</Button>
        {canManage && conflict && (
          <Button color="warning" variant="outlined" onClick={() => save(true)} disabled={saving}>
            {t('admin.roomBlocks.blockAnyway')}
          </Button>
        )}
        {canManage && (
          <Button variant="contained" onClick={() => save(false)} disabled={saving || !datesValid}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {t(block ? 'admin.roomBlocks.save' : 'admin.roomBlocks.create')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default RoomBlockDialog;
