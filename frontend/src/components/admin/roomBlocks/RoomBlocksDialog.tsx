/**
 * RoomBlocksDialog — current and upcoming out-of-service blocks for one room,
 * opened from the rooms screen. Add / edit / delete go through RoomBlockDialog.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add, Edit } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { roomBlocksService } from '../../../services/api';
import { Room, RoomBlock } from '../../../types';
import RoomBlockDialog from './RoomBlockDialog';

interface Props {
  open: boolean;
  room: Pick<Room, '_id' | 'name'> | null;
  rooms: Pick<Room, '_id' | 'name'>[];
  canManage: boolean;
  onClose: () => void;
  onSnackbar: (message: string, severity: 'success' | 'error') => void;
}

const RoomBlocksDialog: React.FC<Props> = ({ open, room, rooms, canManage, onClose, onSnackbar }) => {
  const { t } = useTranslation();
  const [blocks, setBlocks] = useState<RoomBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; block: RoomBlock | null }>({ open: false, block: null });

  const load = useCallback(async () => {
    if (!room) return;
    setLoading(true);
    setError(null);
    try {
      const from = dayjs().format('YYYY-MM-DD');
      const to = dayjs().add(730, 'day').format('YYYY-MM-DD');
      const res = await roomBlocksService.list({ roomId: room._id, from, to });
      setBlocks(res.data.data ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.message || t('admin.roomBlocks.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [room, t]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const fmt = (d: string) => dayjs(d).format('ddd D MMM YYYY');

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>{t('admin.roomBlocks.list.title', { room: room?.name ?? '' })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('admin.roomBlocks.help')}</Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {loading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>
          ) : blocks.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2 }}>{t('admin.roomBlocks.list.empty')}</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.roomBlocks.fields.from')}</TableCell>
                  <TableCell>{t('admin.roomBlocks.fields.until')}</TableCell>
                  <TableCell>{t('admin.roomBlocks.fields.reason')}</TableCell>
                  <TableCell>{t('admin.roomBlocks.fields.notes')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {blocks.map(b => (
                  <TableRow key={b._id} hover>
                    <TableCell>{fmt(b.startDate)}</TableCell>
                    <TableCell>{fmt(b.endDate)}</TableCell>
                    <TableCell>{t(`admin.roomBlocks.reasons.${b.reason}`)}</TableCell>
                    <TableCell sx={{ maxWidth: 240 }}><Typography variant="body2" noWrap>{b.notes}</Typography></TableCell>
                    <TableCell align="right">
                      <Tooltip title={t(canManage ? 'admin.roomBlocks.title.edit' : 'admin.roomBlocks.list.view')}>
                        <IconButton size="small" onClick={() => setEditor({ open: true, block: b })}><Edit fontSize="small" /></IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {canManage && (
            <Button startIcon={<Add />} onClick={() => setEditor({ open: true, block: null })} sx={{ mr: 'auto' }}>
              {t('admin.roomBlocks.list.add')}
            </Button>
          )}
          <Button onClick={onClose}>{t('admin.roomBlocks.close')}</Button>
        </DialogActions>
      </Dialog>

      <RoomBlockDialog
        open={editor.open}
        rooms={rooms}
        block={editor.block}
        defaults={{ roomId: room?._id }}
        canManage={canManage}
        onClose={() => setEditor({ open: false, block: null })}
        onSaved={(message) => { onSnackbar(message, 'success'); load(); }}
      />
    </>
  );
};

export default RoomBlocksDialog;
