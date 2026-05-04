/**
 * CalendarReservationModal
 *
 * Quick-view modal opened when clicking a reservation bar in BookingCalendar.
 * Also owns the check-in and add-payment sub-dialogs that stem from this view.
 */
import React, { useEffect, useState } from 'react';
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
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowDropDown, Close, Email as EmailIcon, OpenInNew, Print as PrintIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../../../contexts/TenantContext';
import { printConfirmation } from '../../../utils/print';
import { reservationsService } from '../../../services/api';
import { Reservation } from '../../../types';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../../utils/currency';

// ─── Types ────────────────────────────────────────────────────────────────────
type FinancialData = {
  charges: any[];
  payments: any[];
  summary: {
    stage: 'pre_arrival' | 'in_house' | 'checked_out';
    estimatedTotal: number;
    totalCharges: number;
    totalPayments: number;
    depositTotal: number;
    balance: number;
    balanceOnArrival: number;
    creditAvailability: number;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getGuestName = (res: Reservation, fallback: string): string => {
  if (res.guestName?.firstName)
    return `${res.guestName.firstName} ${res.guestName.lastName ?? ''}`.trim();
  if (res.user && typeof res.user === 'object')
    return `${(res.user as any).firstName} ${(res.user as any).lastName}`;
  return fallback;
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  reservation: Reservation | null;
  onClose: () => void;
  onUpdated: (updated: Reservation) => void;
  canCheckIn: boolean;
  canManagePayments: boolean;
  onSnackbar: (message: string, severity: 'success' | 'error') => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
const CalendarReservationModal: React.FC<Props> = ({
  reservation,
  onClose,
  onUpdated,
  canCheckIn,
  canManagePayments,
  onSnackbar,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const hotelInfo = { name: tenant?.name ?? 'Hotel', logoUrl: tenant?.settings?.logoUrl };

  const [financial, setFinancial] = useState<FinancialData | null>(null);
  const [financialLoading, setFinancialLoading] = useState(false);

  const [checkinOpen, setCheckinOpen] = useState(false);
  const [idDocument, setIdDocument] = useState('');
  const [idType, setIdType] = useState('cedula');
  const [checkinLoading, setCheckinLoading] = useState(false);

  const [emailMenuAnchor, setEmailMenuAnchor] = useState<HTMLElement | null>(null);
  const [emailSending, setEmailSending] = useState(false);

  const [checkoutMenuAnchor, setCheckoutMenuAnchor] = useState<HTMLElement | null>(null);

  const handleSendEmail = async (type: 'confirmation' | 'invoice') => {
    setEmailMenuAnchor(null);
    if (!reservation?._id) return;
    setEmailSending(true);
    try {
      await reservationsService.sendReservationEmail(reservation._id as string, type);
      onSnackbar(t('admin.printing.emailSent', 'Email sent successfully'), 'success');
    } catch (e: any) {
      const msg = e?.response?.data?.message || t('admin.printing.emailSendFailed', 'Failed to send email');
      onSnackbar(msg, 'error');
    } finally {
      setEmailSending(false);
    }
  };

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payAmount, setPayAmount] = useState<string>('');
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'transfer' | 'credit' | 'check' | ''>('');
  const [payNote, setPayNote] = useState('');
  const [payIsDeposit, setPayIsDeposit] = useState(false);
  const [paySubmitting, setPaySubmitting] = useState(false);

  useEffect(() => {
    if (!reservation?._id) { setFinancial(null); return; }
    setFinancialLoading(true);
    reservationsService.getReservationFinancial(reservation._id as string)
      .then(res => {
        const d = res.data.data;
        setFinancial(d ? {
          charges:  d.charges  ?? [],
          payments: d.payments ?? [],
          summary:  d.summary  ?? { stage: 'pre_arrival' as const, estimatedTotal: 0, totalCharges: 0, totalPayments: 0, depositTotal: 0, balance: 0, balanceOnArrival: 0, creditAvailability: 0 },
        } : null);
      })
      .catch(() => setFinancial(null))
      .finally(() => setFinancialLoading(false));
  }, [reservation?._id]);

  if (!reservation) return null;

  const guestName   = getGuestName(reservation, t('admin.dashboard.recentReservations.guestFallback'));
  const nights      = reservation.checkInDate && reservation.checkOutDate
    ? Math.max(1, Math.round(
        (new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime()) / 86400000,
      ))
    : null;
  const canDoCheckin  = reservation.status === 'pending' || reservation.status === 'confirmed';
  const canDoCheckout = reservation.status === 'checked-in';

  return (
    <>
      {/* ── Main view dialog ─────────────────────────────────────── */}
      <Dialog open={!!reservation} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', pb: 1 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {t('admin.reservations.details.reservationTitle', 'Reservation')}{' '}
              {reservation.reservationCode ?? ''}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('admin.reservations.table.guest', 'for')} {guestName}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 2, flexShrink: 0 }}>
            <Chip
              size="small"
              label={t(`admin.reservations.statusLabels.${reservation.status.replace('-', '_')}`, reservation.status)}
              color={
                reservation.status === 'pending'    ? 'warning' :
                reservation.status === 'confirmed'  ? 'success' :
                reservation.status === 'checked-in' ? 'info' : 'default'
              }
            />
            <IconButton size="small" onClick={onClose}>
              <Close fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent dividers sx={{ p: 0 }}>
          <Box sx={{ display: 'flex', minHeight: 360 }}>

            {/* ── Left 60%: Contact + Reservation details ── */}
            <Box sx={{ flex: '0 0 60%', p: 3, borderRight: '1px solid', borderColor: 'divider', overflowY: 'auto' }}>
              <Typography variant="overline" color="text.secondary" fontWeight={700} sx={{ letterSpacing: 1 }}>
                {t('admin.reservations.details.primaryContact', 'Primary Contact')}
              </Typography>
              <Box sx={{ mt: 0.5, mb: 2.5, display: 'grid', gap: 0.5 }}>
                <Typography variant="body2">
                  <strong>{t('admin.reservations.form.email', 'Email')}:</strong>{' '}
                  {reservation.contactInfo?.email
                    || (typeof reservation.guestRecord === 'object' ? (reservation.guestRecord as any)?.email : null)
                    || '–'}
                </Typography>
                <Typography variant="body2">
                  <strong>{t('admin.reservations.form.phone', 'Phone')}:</strong>{' '}
                  {reservation.contactInfo?.phone
                    || (typeof reservation.guestRecord === 'object' ? (reservation.guestRecord as any)?.phone : null)
                    || '–'}
                </Typography>
                {reservation.company && typeof reservation.company === 'object' && (
                  <Typography variant="body2">
                    <strong>{t('admin.reservations.create.company', 'Company')}:</strong>{' '}
                    {(reservation.company as any).name}
                  </Typography>
                )}
              </Box>

              <Divider sx={{ mb: 2 }} />

              <Typography variant="overline" color="text.secondary" fontWeight={700} sx={{ letterSpacing: 1 }}>
                {t('admin.reservations.details.reservationDetails', 'Reservation Details')}
              </Typography>
              <Box sx={{ mt: 0.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.checkIn', 'Check-in')}</Typography>
                  <Typography variant="body2" fontWeight={600}>{reservation.checkInDate ? new Date(reservation.checkInDate).toLocaleDateString() : '–'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.checkOut', 'Check-out')}</Typography>
                  <Typography variant="body2" fontWeight={600}>{reservation.checkOutDate ? new Date(reservation.checkOutDate).toLocaleDateString() : '–'}</Typography>
                </Box>
                {nights && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.nights', 'Nights')}</Typography>
                    <Typography variant="body2" fontWeight={600}>{nights}</Typography>
                  </Box>
                )}
                <Box>
                  <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.guests', 'Guests')}</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {reservation.guestDetails?.adults}A · {reservation.guestDetails?.children}C · {reservation.guestDetails?.infants ?? 0}I
                  </Typography>
                </Box>
                {Array.isArray((reservation as any).rooms) && (reservation as any).rooms.length > 0 && (
                  <Box sx={{ gridColumn: '1 / -1' }}>
                    <Typography variant="caption" color="text.secondary">{t('admin.bookingCalendar.room', 'Room')}</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {(reservation as any).rooms.map((r: any) => (typeof r === 'object' ? r.name : r)).join(', ')}
                    </Typography>
                  </Box>
                )}
                {reservation.specialRequests && (
                  <Box sx={{ gridColumn: '1 / -1' }}>
                    <Typography variant="caption" color="text.secondary">{t('admin.reservations.form.specialRequests', 'Special Requests')}</Typography>
                    <Typography variant="body2">{reservation.specialRequests}</Typography>
                  </Box>
                )}
                {reservation.actualCheckInAt && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">{t('admin.reservations.details.checkedInAt', 'Checked-in at')}</Typography>
                    <Typography variant="body2" fontWeight={600}>{new Date(reservation.actualCheckInAt).toLocaleString()}</Typography>
                  </Box>
                )}
              </Box>
            </Box>

            {/* ── Right 40%: Payment summary ── */}
            <Box sx={{ flex: '0 0 40%', p: 3, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="overline" color="text.secondary" fontWeight={700} sx={{ letterSpacing: 1 }}>
                {t('admin.reservations.details.paymentSummary', 'Payment')}
              </Typography>
              {financialLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : financial ? (
                <>
                  <Box sx={{ display: 'grid', gap: 1 }}>
                    {financial.summary.stage === 'pre_arrival' ? (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">{t('admin.reservations.financial.estimatedTotal', 'Estimated Total')}</Typography>
                          <Typography variant="body2" fontWeight={600}>{formatMoney(financial.summary.estimatedTotal)}</Typography>
                        </Box>
                        {financial.summary.depositTotal > 0 && (
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="body2" color="text.secondary">{t('admin.reservations.financial.depositReceived', 'Deposit Received')}</Typography>
                            <Typography variant="body2" fontWeight={600} color="success.main">−{formatMoney(financial.summary.depositTotal)}</Typography>
                          </Box>
                        )}
                        <Divider />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" fontWeight={700}>{t('admin.reservations.financial.balanceOnArrival', 'Balance on Arrival')}</Typography>
                          <Typography variant="body2" fontWeight={700} color={financial.summary.balanceOnArrival > 0 ? 'warning.main' : 'success.main'}>
                            {formatMoney(financial.summary.balanceOnArrival)}
                          </Typography>
                        </Box>
                      </>
                    ) : (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">{t('admin.reservations.checkout.totalCharges', 'Total charges')}</Typography>
                          <Typography variant="body2" fontWeight={600}>{formatMoney(financial.summary.totalCharges)}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">{t('admin.reservations.checkout.paymentsMade', 'Payments made')}</Typography>
                          <Typography variant="body2" fontWeight={600} color="success.main">{formatMoney(financial.summary.totalPayments)}</Typography>
                        </Box>
                        <Divider />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" fontWeight={700}>{t('admin.reservations.checkout.remainingBalance', 'Balance due')}</Typography>
                          <Typography variant="body2" fontWeight={700} color={financial.summary.balance > 0 ? 'error.main' : 'success.main'}>
                            {formatMoney(financial.summary.balance)}
                          </Typography>
                        </Box>
                        {financial.summary.creditAvailability > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            {t('admin.reservations.checkout.availableCredit', 'Credit available')}: {formatMoney(financial.summary.creditAvailability)}
                          </Typography>
                        )}
                      </>
                    )}
                  </Box>
                  {financial.payments.length > 0 && (
                    <Box>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                        {t('admin.reservations.details.payments', 'Payments')}
                      </Typography>
                      <Box sx={{ mt: 0.5, display: 'grid', gap: 0.5 }}>
                        {financial.payments.map((p: any) => (
                          <Box key={p._id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                              {new Date(p.createdAt).toLocaleDateString()} · {p.method}
                              {p.paymentStage === 'deposit' && (
                                <Box component="span" sx={{ ml: 0.5, color: 'info.main', fontWeight: 600 }}>
                                  ({t('admin.reservations.financial.deposit', 'deposit')})
                                </Box>
                              )}
                            </Typography>
                            <Typography variant="caption" fontWeight={600} color="success.main">
                              {formatMoney(p.amount)}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">–</Typography>
              )}
              {canManagePayments && reservation.status !== 'cancelled' && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    const isPreArrival = financial?.summary.stage === 'pre_arrival';
                    setPayIsDeposit(isPreArrival);
                    setPayAmount(String(isPreArrival ? (financial?.summary.balanceOnArrival ?? 0) : (financial?.summary.balance ?? 0)));
                    setPayMethod('');
                    setPayNote('');
                    setPaymentOpen(true);
                  }}
                >
                  {financial?.summary.stage === 'pre_arrival'
                    ? t('admin.reservations.financial.recordDeposit', 'Record Deposit')
                    : t('admin.reservations.checkout.addPayment', 'Add Payment')}
                </Button>
              )}
            </Box>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 1.5, gap: 1 }}>
          <Button onClick={onClose}>{t('admin.reservations.actions.cancel', 'Close')}</Button>
          <Button
            size="small"
            startIcon={<OpenInNew fontSize="small" />}
            onClick={() => {
              onClose();
              navigate(`/admin/reservations?id=${reservation._id as string}`);
            }}
          >
            {t('admin.reservations.actions.viewFullDetails', 'View Details')}
          </Button>
          <Button
            size="small"
            startIcon={<PrintIcon fontSize="small" />}
            onClick={() => printConfirmation(reservation, hotelInfo)}
          >
            {t('admin.printing.printConfirmation', 'Print Confirmation')}
          </Button>
          <Button
            size="small"
            startIcon={emailSending ? <CircularProgress size={14} color="inherit" /> : <EmailIcon fontSize="small" />}
            endIcon={<ArrowDropDown fontSize="small" />}
            onClick={(e) => setEmailMenuAnchor(e.currentTarget)}
            disabled={emailSending}
          >
            {t('admin.printing.sendEmail', 'Send Email')}
          </Button>
          <Menu
            anchorEl={emailMenuAnchor}
            open={Boolean(emailMenuAnchor)}
            onClose={() => setEmailMenuAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          >
            <MenuItem onClick={() => handleSendEmail('confirmation')}>
              {t('admin.printing.sendConfirmation', 'Send Confirmation Email')}
            </MenuItem>
            <MenuItem onClick={() => handleSendEmail('invoice')}>
              {t('admin.printing.sendInvoice', 'Send Invoice Email')}
            </MenuItem>
          </Menu>
          <Box sx={{ flex: 1 }} />
          {canCheckIn && canDoCheckin && (
            <Button
              variant="contained"
              color="info"
              onClick={() => { setIdDocument(''); setIdType('cedula'); setCheckinOpen(true); }}
            >
              {t('admin.reservations.actions.checkin', 'Check In')}
            </Button>
          )}
          {canCheckIn && canDoCheckout && (
            <>
              <Button
                variant="contained"
                color="info"
                endIcon={checkinLoading ? <CircularProgress size={14} color="inherit" /> : <ArrowDropDown fontSize="small" />}
                disabled={checkinLoading}
                onClick={(e) => setCheckoutMenuAnchor(e.currentTarget)}
              >
                {t('admin.reservations.statusLabels.checked_in', 'Checked In')}
              </Button>
              <Menu
                anchorEl={checkoutMenuAnchor}
                open={Boolean(checkoutMenuAnchor)}
                onClose={() => setCheckoutMenuAnchor(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              >
                <MenuItem
                  onClick={async () => {
                    setCheckoutMenuAnchor(null);
                    try {
                      setCheckinLoading(true);
                      const res = await reservationsService.checkOutReservation(reservation._id as string, {});
                      onUpdated(res.data.data as Reservation);
                      onSnackbar(t('admin.reservations.messages.checkoutSuccess', 'Checked out'), 'success');
                    } catch (e: any) {
                      onSnackbar(e?.response?.data?.message || 'Checkout failed', 'error');
                    } finally {
                      setCheckinLoading(false);
                    }
                  }}
                >
                  {t('admin.reservations.checkout.confirmButton', 'Check Out')}
                </MenuItem>
              </Menu>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* ── Check-in sub-dialog ────────────────────────────────────── */}
      <Dialog open={checkinOpen} onClose={() => setCheckinOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('admin.reservations.checkin.title', 'Check In')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <Alert severity="info">{t('admin.reservations.checkin.provideId', 'Please provide a valid ID document.')}</Alert>
            <FormControl fullWidth>
              <InputLabel>{t('admin.reservations.checkin.idType', 'ID Type')}</InputLabel>
              <Select value={idType} label={t('admin.reservations.checkin.idType', 'ID Type')} onChange={e => setIdType(e.target.value)}>
                <MenuItem value="cedula">{t('admin.reservations.checkin.idTypeOptions.cedula', 'Cédula')}</MenuItem>
                <MenuItem value="pasaporte">{t('admin.reservations.checkin.idTypeOptions.pasaporte', 'Pasaporte')}</MenuItem>
                <MenuItem value="rnc">{t('admin.reservations.checkin.idTypeOptions.rnc', 'RNC')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label={t('admin.reservations.checkin.idDocument', 'ID Number')}
              value={idDocument}
              onChange={e => setIdDocument(e.target.value)}
              required
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCheckinOpen(false)}>{t('admin.reservations.actions.cancel', 'Cancel')}</Button>
          <Button
            variant="contained"
            disabled={!idDocument.trim() || checkinLoading}
            onClick={async () => {
              try {
                setCheckinLoading(true);
                const res = await reservationsService.checkInReservation(reservation._id as string, {
                  identificationDocument: idDocument.trim(),
                  identificationType:     idType,
                } as any);
                onUpdated(res.data.data as Reservation);
                onSnackbar(t('admin.reservations.messages.checkinSuccess', 'Checked in successfully'), 'success');
                setCheckinOpen(false);
              } catch (e: any) {
                onSnackbar(e?.response?.data?.message || 'Check-in failed', 'error');
              } finally {
                setCheckinLoading(false);
              }
            }}
          >
            {checkinLoading
              ? <CircularProgress size={18} color="inherit" />
              : t('admin.reservations.checkin.confirm', 'Confirm Check-In')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Add payment sub-dialog ─────────────────────────────────── */}
      <Dialog open={paymentOpen} onClose={() => setPaymentOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {payIsDeposit
            ? t('admin.reservations.financial.recordDeposit', 'Record Deposit')
            : t('admin.reservations.checkout.addPayment', 'Add Payment')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
            {payIsDeposit && (
              <Alert severity="info">
                {t('admin.reservations.financial.depositInfo', 'This deposit will be applied against the balance when the guest checks in.')}
              </Alert>
            )}
            <TextField
              label={t('admin.reservations.form.amount', 'Amount')}
              type="number"
              value={payAmount}
              onChange={e => setPayAmount(e.target.value)}
              inputProps={{ min: 0, step: 0.01 }}
              required
            />
            <FormControl fullWidth required>
              <InputLabel>{t('admin.reservations.form.paymentMethod', 'Method')}</InputLabel>
              <Select value={payMethod} label={t('admin.reservations.form.paymentMethod', 'Method')} onChange={e => setPayMethod(e.target.value as any)}>
                <MenuItem value="cash">{t('admin.reservations.paymentMethods.cash', 'Cash')}</MenuItem>
                <MenuItem value="card">{t('admin.reservations.paymentMethods.card', 'Card')}</MenuItem>
                <MenuItem value="transfer">{t('admin.reservations.paymentMethods.transfer', 'Transfer')}</MenuItem>
                <MenuItem value="check">{t('admin.reservations.paymentMethods.check', 'Check')}</MenuItem>
                {!payIsDeposit && (
                  <MenuItem value="credit">{t('admin.reservations.paymentMethods.credit', 'Credit')}</MenuItem>
                )}
              </Select>
            </FormControl>
            <TextField
              label={t('admin.reservations.form.note', 'Note (optional)')}
              value={payNote}
              onChange={e => setPayNote(e.target.value)}
              multiline
              rows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentOpen(false)}>{t('admin.reservations.actions.cancel', 'Cancel')}</Button>
          <Button
            variant="contained"
            disabled={parseFloat(payAmount) <= 0 || !payMethod || paySubmitting}
            onClick={async () => {
              if (!payMethod) return;
              try {
                setPaySubmitting(true);
                await reservationsService.addReservationPayment(reservation._id as string, {
                  amount: parseFloat(payAmount) || 0,
                  method: payMethod,
                  note:   payNote || undefined,
                  paymentStage: payIsDeposit ? 'deposit' : 'in_house',
                });
                const res = await reservationsService.getReservationFinancial(reservation._id as string);
                const d = res.data.data;
                if (d) {
                  setFinancial({
                    charges:  d.charges  ?? [],
                    payments: d.payments ?? [],
                    summary:  d.summary  ?? { stage: 'pre_arrival' as const, estimatedTotal: 0, totalCharges: 0, totalPayments: 0, depositTotal: 0, balance: 0, balanceOnArrival: 0, creditAvailability: 0 },
                  });
                }
                onSnackbar(
                  payIsDeposit
                    ? t('admin.reservations.financial.depositRecorded', 'Deposit recorded successfully')
                    : t('admin.reservations.messages.paymentAdded', 'Payment added'),
                  'success',
                );
                setPaymentOpen(false);
              } catch (e: any) {
                onSnackbar(e?.response?.data?.message || 'Payment failed', 'error');
              } finally {
                setPaySubmitting(false);
              }
            }}
          >
            {paySubmitting ? <CircularProgress size={18} color="inherit" /> : t('admin.reservations.form.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default CalendarReservationModal;
