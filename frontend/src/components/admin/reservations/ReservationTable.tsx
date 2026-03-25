/**
 * ReservationTable
 *
 * Displays the paginated list of reservations with status, room, payment
 * indicators and inline action buttons. All action logic (dialogs, API calls)
 * is delegated to the parent via callbacks.
 */
import React from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
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
  Pending,
  Visibility,
} from '@mui/icons-material';
import { Reservation } from '../../../types';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../../utils/currency';

// ─── Local helpers ────────────────────────────────────────────────────────────
const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString();

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

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  reservations: Reservation[];
  user: any;
  canCheckIn: boolean;
  canCheckOut: boolean;
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
  onViewDetails,
  onEdit,
  onDelete,
  onCheckIn,
  onCheckOut,
  onSnackbar,
}) => {
  const { t } = useTranslation();
  const isAdminRole = String(user?.role).toLowerCase() === 'admin';

  return (
    <TableContainer component={Paper} sx={{ mb: 4 }}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>{t('admin.reservations.table.guest')}</TableCell>
            <TableCell>{t('admin.reservations.table.type')}</TableCell>
            <TableCell>{t('admin.reservations.table.dates')}</TableCell>
            <TableCell>{t('admin.reservations.table.guests')}</TableCell>
            <TableCell>{t('admin.reservations.table.status')}</TableCell>
            <TableCell>{t('admin.reservations.table.assignedRoom')}</TableCell>
            <TableCell>{t('admin.reservations.table.total')}</TableCell>
            <TableCell>{t('admin.reservations.table.payment')}</TableCell>
            <TableCell>{t('admin.reservations.table.actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {reservations.map(reservation => (
            <TableRow key={reservation._id}>

              {/* Guest name + email */}
              <TableCell>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Button variant="text" size="small" onClick={() => onViewDetails(reservation)} sx={{ p: 0, minWidth: 0, textTransform: 'none' }}>
                    <Typography variant="body2" fontWeight="medium">
                      {reservation.guestName?.firstName
                        ? `${reservation.guestName.firstName} ${reservation.guestName.lastName || ''}`.trim()
                        : (reservation.user && typeof reservation.user === 'object'
                          ? `${(reservation.user as any).firstName} ${(reservation.user as any).lastName}`
                          : t('admin.dashboard.recentReservations.guestFallback'))}
                    </Typography>
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', wordBreak: 'break-word' }}>
                    {reservation.contactInfo?.email}
                  </Typography>
                </Box>
              </TableCell>

              {/* Type */}
              <TableCell>
                <Chip
                  label={(() => {
                    const type = reservation.type || 'unknown';
                    const key  = type === 'PasaTarde' ? 'pasatarde' : type;
                    return t(`admin.reservations.typeLabels.${key}`);
                  })()}
                  size="small"
                  sx={{ textTransform: 'capitalize' }}
                />
              </TableCell>

              {/* Dates */}
              <TableCell>
                <Box>
                  <Typography variant="body2">
                    {formatDate(reservation.checkInDate)} – {reservation.checkOutDate ? formatDate(reservation.checkOutDate) : t('admin.reservations.na')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {reservation.totalNights} {t('admin.reservations.nights')}
                  </Typography>
                </Box>
              </TableCell>

              {/* Guest count */}
              <TableCell>{reservation.guests}</TableCell>

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

              {/* Assigned room(s) */}
              <TableCell>
                {(() => {
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
                    return (
                      <Box>
                        <Typography variant="body2" fontWeight="medium">{reservation.room.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t('admin.schedule.table.room')} {reservation.room._id?.slice(-4)}
                        </Typography>
                      </Box>
                    );
                  }
                  return <Typography variant="body2" color="text.secondary">{t('admin.schedule.notAssigned')}</Typography>;
                })()}
              </TableCell>

              {/* Total price */}
              <TableCell>
                <Typography variant="body2" fontWeight="medium">
                  {formatMoney(reservation.estimatedTotal ?? reservation.totalPrice ?? 0)}
                </Typography>
              </TableCell>

              {/* Payment status */}
              <TableCell>
                {(() => {
                  const total          = reservation.estimatedTotal ?? reservation.totalPrice ?? 0;
                  const paid           = (reservation as any).totalPayments ?? 0;
                  const pendingBalance = Math.max(0, total - paid);
                  const isPaid         = pendingBalance === 0;
                  return (
                    <Chip
                      label={isPaid
                        ? t('admin.reservations.paymentStatus.paid')
                        : t('admin.reservations.paymentStatus.pending')}
                      color={isPaid ? 'success' : 'warning'}
                      size="small"
                      sx={{ textTransform: 'capitalize' }}
                    />
                  );
                })()}
              </TableCell>

              {/* Actions */}
              <TableCell>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Tooltip title={t('admin.reservations.actions.viewDetails')}>
                    <IconButton size="small" color="info" onClick={() => onViewDetails(reservation)}>
                      <Visibility />
                    </IconButton>
                  </Tooltip>

                  <Tooltip title={t('admin.reservations.actions.editReservation')}>
                    <IconButton size="small" color="secondary" onClick={() => onEdit(reservation)}>
                      <Edit />
                    </IconButton>
                  </Tooltip>

                  {isAdminRole && (
                    <Tooltip title={t('admin.reservations.actions.removeReservation')}>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={async () => {
                          if (!window.confirm(t('admin.reservations.dialog.deletePrompt'))) return;
                          try {
                            await onDelete(reservation._id);
                          } catch {
                            // onDelete handles snackbar
                          }
                        }}
                      >
                        <Delete />
                      </IconButton>
                    </Tooltip>
                  )}

                  {/* Room check-in / check-out */}
                  {reservation.type === 'room' && (
                    <>
                      {!reservation.actualCheckInAt && canCheckIn && reservation.status !== 'cancelled' && (
                        <Tooltip title={(() => {
                          if (!reservation.room) return t('admin.reservations.tooltips.assignBeforeCheckin');
                          const now = new Date();
                          const ci  = new Date(reservation.checkInDate);
                          const co  = reservation.checkOutDate ? new Date(reservation.checkOutDate) : null;
                          if (now < ci) return t('admin.reservations.tooltips.checkinEarly', 'Check-in date has not yet arrived — confirm to proceed');
                          if (co && now >= co) return t('admin.reservations.tooltips.checkinLate', 'Past scheduled checkout date — confirm to proceed');
                          return t('admin.reservations.tooltips.checkin');
                        })()}>
                          <span>
                            <Button
                              size="small"
                              variant="contained"
                              disabled={!reservation.room && !(Array.isArray((reservation as any).rooms) && (reservation as any).rooms.length > 0)}
                              onClick={() => {
                                const hasRoom = !!reservation.room || (Array.isArray((reservation as any).rooms) && (reservation as any).rooms.length > 0);
                                if (!hasRoom) {
                                  onSnackbar(t('admin.reservations.messages.assignBeforeCheckin'), 'warning');
                                  return;
                                }
                                const now = new Date();
                                const ci  = new Date(reservation.checkInDate);
                                const co  = reservation.checkOutDate ? new Date(reservation.checkOutDate) : null;
                                const isOutsideWindow = now < ci || (co != null && now >= co);
                                if (isOutsideWindow) {
                                  const msg = co && now >= co
                                    ? t('admin.reservations.messages.checkinLateConfirm', 'This reservation\'s checkout date has passed. Check in anyway?')
                                    : t('admin.reservations.messages.checkinEarlyConfirm', 'Check-in date has not yet arrived. Check in anyway?');
                                  if (!window.confirm(msg)) return;
                                }
                                onCheckIn(reservation);
                              }}
                            >
                              {t('admin.reservations.actions.checkin')}
                            </Button>
                          </span>
                        </Tooltip>
                      )}

                      {canCheckOut && reservation.actualCheckInAt && !reservation.actualCheckOutAt && (
                        <Button size="small" variant="outlined" onClick={() => onCheckOut(reservation)}>
                          {t('admin.reservations.actions.checkout')}
                        </Button>
                      )}
                    </>
                  )}

                  {/* Non-room check-in / check-out */}
                  {reservation.type !== 'room' && (
                    <>
                      {!reservation.actualCheckInAt && canCheckIn && reservation.status !== 'cancelled' && (
                        <Button size="small" variant="contained" onClick={() => onCheckIn(reservation)}>
                          {t('admin.reservations.actions.checkin')}
                        </Button>
                      )}
                      {canCheckOut && reservation.actualCheckInAt && !reservation.actualCheckOutAt && (
                        <Button size="small" variant="outlined" onClick={() => onCheckOut(reservation)}>
                          {t('admin.reservations.actions.checkout')}
                        </Button>
                      )}
                    </>
                  )}
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default ReservationTable;
