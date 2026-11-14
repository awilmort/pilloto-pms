/**
 * ReservationTable
 *
 * The paginated list of reservations. Each row has one contextual primary action (check-in or
 * check-out, when it applies) and a "more" menu for the rest (view, edit, delete); clicking the
 * row opens the details. All action logic (dialogs, API calls) is delegated to the parent via callbacks.
 */
import React from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Cancel,
  CheckCircle,
  Delete,
  Edit,
  Hotel,
  MoreVert,
  Pending,
  SearchOff,
  Visibility,
} from '@mui/icons-material';
import { Reservation } from '../../../types';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../../utils/currency';
import ChannelBadge from './ChannelBadge';
import i18n from '../../../i18n';

// ─── Local helpers ────────────────────────────────────────────────────────────
const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString(i18n.language);

const getStatusColor = (status: string) => {
  switch (status) {
    case 'pending':     return 'warning';
    case 'confirmed':   return 'success';
    case 'cancelled':   return 'error';
    case 'checked-in':  return 'info';
    case 'checked-out': return 'default';
    default:            return 'default';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'pending':   return <Pending />;
    case 'confirmed': return <CheckCircle />;
    case 'cancelled': return <Cancel />;
    default:          return <Hotel />;
  }
};

const hasAssignedRoom = (r: Reservation) =>
  !!r.room || (Array.isArray((r as any).rooms) && (r as any).rooms.length > 0);

const guestLabel = (r: Reservation, fallback: string) => {
  if (r.guestName?.firstName) return `${r.guestName.firstName} ${r.guestName.lastName || ''}`.trim();
  if (r.user && typeof r.user === 'object') return `${(r.user as any).firstName} ${(r.user as any).lastName}`;
  return fallback;
};

const COLUMN_COUNT = 7;

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  reservations: Reservation[];
  user: any;
  canCheckIn: boolean;
  canCheckOut: boolean;
  /** First page still on its way — the table shows placeholder rows. */
  initialLoading?: boolean;
  /** A new filter is being applied; the previous rows stay (dimmed) until the answer arrives. */
  refreshing?: boolean;
  emptyTitle: string;
  emptyBody: string;
  onViewDetails:  (reservation: Reservation) => void;
  onEdit:         (reservation: Reservation) => void;
  onDelete:       (reservationId: string) => Promise<void>;
  onCheckIn:      (reservation: Reservation) => void;
  onCheckOut:     (reservation: Reservation) => void;
  onSnackbar:     (message: string, severity: 'success' | 'error' | 'warning') => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
const ReservationTable: React.FC<Props> = ({
  reservations,
  user,
  canCheckIn,
  canCheckOut,
  initialLoading = false,
  refreshing = false,
  emptyTitle,
  emptyBody,
  onViewDetails,
  onEdit,
  onDelete,
  onCheckIn,
  onCheckOut,
  onSnackbar,
}) => {
  const { t } = useTranslation();
  const isAdminRole = String(user?.role).toLowerCase() === 'admin';
  const [menu, setMenu] = React.useState<{ anchor: HTMLElement; reservation: Reservation } | null>(null);

  const closeMenu = () => setMenu(null);

  /** Same rules as before: a room reservation needs a room, and out-of-window check-ins ask for confirmation. */
  const requestCheckIn = (reservation: Reservation) => {
    if (reservation.type === 'room') {
      if (!hasAssignedRoom(reservation)) {
        onSnackbar(t('admin.reservations.messages.assignBeforeCheckin'), 'warning');
        return;
      }
      const now = new Date();
      const ci = new Date(reservation.checkInDate);
      const co = reservation.checkOutDate ? new Date(reservation.checkOutDate) : null;
      if (now < ci || (co != null && now >= co)) {
        const msg = co && now >= co
          ? t('admin.reservations.messages.checkinLateConfirm', 'This reservation\'s checkout date has passed. Check in anyway?')
          : t('admin.reservations.messages.checkinEarlyConfirm', 'Check-in date has not yet arrived. Check in anyway?');
        if (!window.confirm(msg)) return;
      }
    }
    onCheckIn(reservation);
  };

  const checkInTooltip = (reservation: Reservation): string => {
    if (reservation.type !== 'room') return '';
    if (!hasAssignedRoom(reservation)) return t('admin.reservations.tooltips.assignBeforeCheckin');
    const now = new Date();
    const ci = new Date(reservation.checkInDate);
    const co = reservation.checkOutDate ? new Date(reservation.checkOutDate) : null;
    if (now < ci) return t('admin.reservations.tooltips.checkinEarly', 'Check-in date has not yet arrived — confirm to proceed');
    if (co && now >= co) return t('admin.reservations.tooltips.checkinLate', 'Past scheduled checkout date — confirm to proceed');
    return t('admin.reservations.tooltips.checkin');
  };

  const confirmDelete = async (reservation: Reservation) => {
    if (!window.confirm(t('admin.reservations.dialog.deletePrompt'))) return;
    try {
      await onDelete(reservation._id);
    } catch {
      // onDelete handles the snackbar
    }
  };

  const renderPrimaryAction = (reservation: Reservation) => {
    const showCheckIn = !reservation.actualCheckInAt && canCheckIn && reservation.status !== 'cancelled';
    const showCheckOut = canCheckOut && !!reservation.actualCheckInAt && !reservation.actualCheckOutAt;
    if (showCheckIn) {
      const blocked = reservation.type === 'room' && !hasAssignedRoom(reservation);
      return (
        <Tooltip title={checkInTooltip(reservation)}>
          <span>
            <Button size="small" variant="contained" disabled={blocked} onClick={() => requestCheckIn(reservation)} sx={{ minWidth: 96 }}>
              {t('admin.reservations.actions.checkin')}
            </Button>
          </span>
        </Tooltip>
      );
    }
    if (showCheckOut) {
      return (
        <Button size="small" variant="outlined" onClick={() => onCheckOut(reservation)} sx={{ minWidth: 96 }}>
          {t('admin.reservations.actions.checkout')}
        </Button>
      );
    }
    return null;
  };

  const renderRoom = (reservation: Reservation) => {
    const roomArr = (reservation as any).rooms as any[] | undefined;
    if (Array.isArray(roomArr) && roomArr.length > 0) {
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {roomArr.map((rm: any) => (
            <Chip key={rm?._id || String(rm)} label={typeof rm === 'object' ? rm.name : String(rm)} size="small" />
          ))}
        </Box>
      );
    }
    if (reservation.room && typeof reservation.room === 'object') {
      return <Typography variant="body2" fontWeight={500}>{reservation.room.name}</Typography>;
    }
    return <Typography variant="body2" color="text.secondary">{t('admin.schedule.notAssigned')}</Typography>;
  };

  return (
    <>
      <TableContainer component={Paper} sx={{ mb: 3, position: 'relative' }}>
        {refreshing && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1, height: 2 }} />}
        <Table size="medium" sx={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity .15s' }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.reservations.table.guest')}</TableCell>
              <TableCell>{t('admin.reservations.table.dates')}</TableCell>
              <TableCell>{t('admin.reservations.table.type')}</TableCell>
              <TableCell>{t('admin.reservations.table.status')}</TableCell>
              <TableCell>{t('admin.reservations.table.assignedRoom')}</TableCell>
              <TableCell align="right">{t('admin.reservations.table.total')}</TableCell>
              <TableCell align="right">{t('admin.reservations.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {initialLoading && Array.from({ length: 6 }, (_, i) => (
              <TableRow key={`sk-${i}`}>
                {Array.from({ length: COLUMN_COUNT }, (__, c) => (
                  <TableCell key={c}><Skeleton variant="text" width={c === 0 ? '70%' : '55%'} /></TableCell>
                ))}
              </TableRow>
            ))}

            {!initialLoading && reservations.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} sx={{ border: 0 }}>
                  <Box sx={{ textAlign: 'center', py: 6 }}>
                    <SearchOff sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                    <Typography variant="h6" color="text.secondary">{emptyTitle}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{emptyBody}</Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}

            {!initialLoading && reservations.map((reservation) => {
              const typeKey = reservation.type === 'PasaTarde' ? 'pasatarde' : (reservation.type || 'unknown');
              const total = reservation.estimatedTotal ?? reservation.totalPrice ?? 0;
              const paid = (reservation as any).totalPayments ?? 0;
              const isPaid = Math.max(0, total - paid) === 0;
              return (
                <TableRow
                  key={reservation._id}
                  hover
                  onClick={() => onViewDetails(reservation)}
                  sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                >
                  {/* Guest */}
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {guestLabel(reservation, t('admin.dashboard.recentReservations.guestFallback'))}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {reservation.contactInfo?.email}
                    </Typography>
                    {reservation.channelSource && <Box sx={{ mt: 0.5 }}><ChannelBadge source={reservation.channelSource} /></Box>}
                  </TableCell>

                  {/* Dates + length of stay + party size */}
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2">
                      {formatDate(reservation.checkInDate)} – {reservation.checkOutDate ? formatDate(reservation.checkOutDate) : t('admin.reservations.na')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {reservation.totalNights} {t('admin.reservations.nights')} · {reservation.guests} {String(t('admin.reservations.table.guests')).toLowerCase()}
                    </Typography>
                  </TableCell>

                  {/* Type */}
                  <TableCell>
                    <Chip label={t(`admin.reservations.typeLabels.${typeKey}`)} size="small" variant="outlined" sx={{ textTransform: 'capitalize' }} />
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Chip
                      icon={getStatusIcon(reservation.status)}
                      label={t(`admin.reservations.statusLabels.${reservation.status.replace('-', '_')}`)}
                      color={getStatusColor(reservation.status) as any}
                      size="small"
                      sx={{ textTransform: 'capitalize' }}
                    />
                  </TableCell>

                  {/* Room(s) */}
                  <TableCell>{renderRoom(reservation)}</TableCell>

                  {/* Total + whether it is paid */}
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" fontWeight={600}>{formatMoney(total)}</Typography>
                    <Typography variant="caption" sx={{ color: isPaid ? 'success.main' : 'warning.dark', fontWeight: 600 }}>
                      {isPaid ? t('admin.reservations.paymentStatus.paid') : t('admin.reservations.paymentStatus.pending')}
                    </Typography>
                  </TableCell>

                  {/* Actions: the one that applies now, then the rest behind "more" */}
                  <TableCell align="right" onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: 'nowrap' }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                      {renderPrimaryAction(reservation)}
                      <Tooltip title={t('admin.reservations.actions.moreActions')}>
                        <IconButton
                          size="small"
                          aria-label={t('admin.reservations.actions.moreActions')}
                          onClick={(e) => setMenu({ anchor: e.currentTarget, reservation })}
                        >
                          <MoreVert fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={closeMenu} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={() => { const r = menu!.reservation; closeMenu(); onViewDetails(r); }}>
          <ListItemIcon><Visibility fontSize="small" /></ListItemIcon>
          <ListItemText>{t('admin.reservations.actions.viewDetails')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { const r = menu!.reservation; closeMenu(); onEdit(r); }}>
          <ListItemIcon><Edit fontSize="small" /></ListItemIcon>
          <ListItemText>{t('admin.reservations.actions.editReservation')}</ListItemText>
        </MenuItem>
        {isAdminRole && <Divider />}
        {isAdminRole && (
          <MenuItem sx={{ color: 'error.main' }} onClick={() => { const r = menu!.reservation; closeMenu(); void confirmDelete(r); }}>
            <ListItemIcon sx={{ color: 'inherit' }}><Delete fontSize="small" /></ListItemIcon>
            <ListItemText>{t('admin.reservations.actions.removeReservation')}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  );
};

export default ReservationTable;
