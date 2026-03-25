/**
 * CheckInOutDialog
 *
 * Handles both check-in and check-out operations for a reservation.
 * For check-out, loads the financial summary to warn about outstanding balance
 * and offers "Use Credit" or "Add Payment" options.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
import { Reservation } from '../../../types';
import { reservationsService } from '../../../services/api';
import { useTranslation } from 'react-i18next';

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  open: boolean;
  mode: 'checkin' | 'checkout';
  reservation: Reservation | null;
  onClose: () => void;
  onSuccess: (updated: Reservation) => void;
  onSnackbar: (message: string, severity: 'success' | 'error') => void;
  /** Called when user clicks "Add Payment" during checkout — navigate to details */
  onOpenDetails?: (reservation: Reservation) => void;
  /** Called after successful checkout so parent can refresh room availability */
  onRoomsRefresh?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
const CheckInOutDialog: React.FC<Props> = ({
  open, mode, reservation, onClose, onSuccess, onSnackbar, onOpenDetails, onRoomsRefresh,
}) => {
  const { t } = useTranslation();

  const [idDocument, setIdDocument] = useState('');
  const [idType, setIdType]         = useState('cedula');
  const [checkoutFinancial, setCheckoutFinancial] = useState<{
    stage: 'pre_arrival' | 'in_house' | 'checked_out';
    estimatedTotal: number;
    totalCharges: number; totalPayments: number; balance: number; depositTotal: number; balanceOnArrival: number; creditAvailability: number;
  } | null>(null);
  const [checkoutFinancialLoading, setCheckoutFinancialLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load financial summary when dialog opens (both modes)
  useEffect(() => {
    if (!open || !reservation?._id) return;
    setCheckoutFinancialLoading(true);
    reservationsService.getReservationFinancial(reservation._id)
      .then(res => setCheckoutFinancial(res.data.data?.summary ?? null))
      .catch(() => setCheckoutFinancial(null))
      .finally(() => setCheckoutFinancialLoading(false));
  }, [open, reservation?._id]);

  // Reset text fields when dialog opens for check-in
  useEffect(() => {
    if (open && mode === 'checkin') {
      setIdDocument('');
      setIdType('cedula');
    }
  }, [open, mode]);

  const handleConfirm = async () => {
    if (!reservation) return;
    try {
      setLoading(true);
      if (mode === 'checkin') {
        const isRoom = reservation.type === 'room';
        if (isRoom && !idDocument.trim()) {
          onSnackbar(t('admin.reservations.checkin.idRequired'), 'error');
          return;
        }
        const payload = isRoom
          ? { identificationDocument: idDocument.trim(), identificationType: idType }
          : { identificationDocument: '' };
        const res = await reservationsService.checkInReservation(reservation._id, payload as any);
        onSuccess(res.data.data as Reservation);
        onSnackbar(t('admin.reservations.messages.checkinSuccess'), 'success');
        onClose();
      } else {
        const res = await reservationsService.checkOutReservation(reservation._id, {});
        onSuccess(res.data.data as Reservation);
        onSnackbar(t('admin.reservations.messages.checkoutSuccess'), 'success');
        onRoomsRefresh?.();
        onClose();
      }
    } catch (e: any) {
      onSnackbar(
        e?.response?.data?.message || e?.message || t('admin.reservations.messages.operationFailed'),
        'error',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleUseCreditAndCheckout = async () => {
    if (!reservation) return;
    try {
      setLoading(true);
      const res = await reservationsService.useCreditAndCheckout(reservation._id);
      onSuccess(res.data.data as Reservation);
      onSnackbar(t('admin.reservations.messages.checkoutSuccess'), 'success');
      onRoomsRefresh?.();
      onClose();
    } catch (e: any) {
      onSnackbar(
        e?.response?.data?.message || e?.message || t('admin.reservations.messages.operationFailed'),
        'error',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {mode === 'checkin'
          ? t('admin.reservations.checkin.title')
          : t('admin.reservations.checkout.title')}
      </DialogTitle>

      <DialogContent>
        {mode === 'checkin' ? (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Alert severity="info">{t('admin.reservations.checkin.provideId')}</Alert>
            {reservation?.type === 'room' && (
              <>
                <FormControl fullWidth>
                  <InputLabel>{t('admin.reservations.checkin.idType')}</InputLabel>
                  <Select
                    value={idType}
                    label={t('admin.reservations.checkin.idType')}
                    onChange={e => setIdType(e.target.value)}
                  >
                    <MenuItem value="cedula">{t('admin.reservations.checkin.idTypeOptions.cedula')}</MenuItem>
                    <MenuItem value="pasaporte">{t('admin.reservations.checkin.idTypeOptions.pasaporte')}</MenuItem>
                    <MenuItem value="rnc">{t('admin.reservations.checkin.idTypeOptions.rnc')}</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  label={t('admin.reservations.checkin.idDocument')}
                  value={idDocument}
                  onChange={e => setIdDocument(e.target.value)}
                  required
                />
              </>
            )}
            {checkoutFinancial && checkoutFinancial.depositTotal > 0 && (
              <Alert severity="success">
                {t('admin.reservations.financial.depositOnFile', 'Deposit on file')}: {' '}
                <strong>${checkoutFinancial.depositTotal.toFixed(2)}</strong>
                {' '}&mdash;{' '}
                {t('admin.reservations.financial.depositWillApply', 'will be applied automatically at check-in.')}
                {' '}{t('admin.reservations.financial.balanceAfterCheckin', 'Remaining balance')}: {' '}
                <strong>${(checkoutFinancial.estimatedTotal - checkoutFinancial.depositTotal).toFixed(2)}</strong>
              </Alert>
            )}
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            <Alert severity="warning">{t('admin.reservations.checkout.confirm')}</Alert>
            {checkoutFinancialLoading ? (
              <Typography variant="body2" color="text.secondary">{t('common.loading', 'Loading...')}</Typography>
            ) : checkoutFinancial ? (
              <Box sx={{ display: 'grid', gap: 0.5 }}>
                <Typography variant="body2">
                  <strong>{t('admin.reservations.checkout.totalCharges')}:</strong>{' '}
                  ${checkoutFinancial.totalCharges.toFixed(2)}
                </Typography>
                <Typography variant="body2">
                  <strong>{t('admin.reservations.checkout.paymentsMade')}:</strong>{' '}
                  ${checkoutFinancial.totalPayments.toFixed(2)}
                </Typography>
                <Typography variant="body2">
                  <strong>{t('admin.reservations.checkout.remainingBalance')}:</strong>{' '}
                  ${checkoutFinancial.balance.toFixed(2)}
                </Typography>
                <Typography variant="body2">
                  <strong>{t('admin.reservations.checkout.availableCredit')}:</strong>{' '}
                  ${checkoutFinancial.creditAvailability.toFixed(2)}
                </Typography>
                {checkoutFinancial.balance > 0 && (
                  <Alert severity="info">{t('admin.reservations.checkout.pendingHint')}</Alert>
                )}
              </Box>
            ) : null}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          {t('admin.reservations.actions.cancel')}
        </Button>

        {mode === 'checkout' && checkoutFinancial && checkoutFinancial.balance > 0 && (
          <Button
            variant="outlined"
            disabled={loading}
            onClick={() => {
              if (reservation && onOpenDetails) {
                onOpenDetails(reservation);
                onClose();
              }
            }}
          >
            {t('admin.reservations.checkout.addPayment', 'Add Payment')}
          </Button>
        )}

        {mode === 'checkout' && checkoutFinancial && checkoutFinancial.balance > 0 && (
          <Button variant="outlined" onClick={handleUseCreditAndCheckout} disabled={loading}>
            {t('admin.reservations.checkout.useCredit', 'Use Credit')}
          </Button>
        )}

        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={
            (mode === 'checkin' && reservation?.type === 'room' && !idDocument.trim()) ||
            checkoutFinancialLoading ||
            loading
          }
        >
          {mode === 'checkin'
            ? t('admin.reservations.checkin.confirm')
            : t('admin.reservations.checkout.confirmButton')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CheckInOutDialog;
