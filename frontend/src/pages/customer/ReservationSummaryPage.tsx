import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Box,
  Button,
  Grid,
  Divider,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  CalendarToday as CalendarIcon,
  Person as PersonIcon,
  AttachMoney as MoneyIcon
} from '@mui/icons-material';
import { reservationsService } from '../../services/api';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../utils/currency';
import { Reservation } from '../../types';

const ReservationSummaryPage: React.FC = () => {
  const { confirmationToken, reservationCode } = useParams<{ confirmationToken?: string; reservationCode?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState(false);

  const loadReservation = React.useCallback(async () => {
    const identifier = reservationCode || confirmationToken;
    if (!identifier) {
      setError(t('pages.reservationSummary.notFound'));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = reservationCode
        ? await reservationsService.getPublicReservationByCode(reservationCode)
        : await reservationsService.getPublicReservation(confirmationToken as string);
      if (response.data.data) {
        setReservation(response.data.data);
      }
      setError(null);
    } catch (err: any) {
      console.error('Error loading reservation:', err);
      setError(err.response?.data?.message || t('pages.reservationSummary.notFound'));
    } finally {
      setLoading(false);
    }
  }, [confirmationToken, reservationCode, t]);

  useEffect(() => {
    loadReservation();
  }, [loadReservation]);

  const handleCancelReservation = async () => {
    const identifier = reservationCode || confirmationToken;
    if (!identifier) return;

    try {
      setCancelling(true);
      if (reservationCode) {
        await reservationsService.cancelPublicReservationByCode(reservationCode, cancellationReason);
      } else if (confirmationToken) {
        await reservationsService.cancelPublicReservation(confirmationToken, cancellationReason);
      }
      setCancelSuccess(true);
      setCancelDialogOpen(false);
      // Reload reservation to show updated status
      await loadReservation();
    } catch (err: any) {
      console.error('Error cancelling reservation:', err);
      alert(err.response?.data?.message || 'Failed to cancel reservation');
    } finally {
      setCancelling(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'success';
      case 'pending':
        return 'warning';
      case 'cancelled':
        return 'error';
      case 'completed':
        return 'info';
      default:
        return 'default';
    }
  };

  // Localized labels now handled via translations

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, mb: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>
          {t('pages.reservationSummary.loading')}
        </Typography>
      </Container>
    );
  }

  if (error || !reservation) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Alert severity="error">{error || t('pages.reservationSummary.notFound')}</Alert>
        <Button variant="contained" onClick={() => navigate('/admin')} sx={{ mt: 2 }}>
          {t('pages.reservationSummary.goHome')}
        </Button>
      </Container>
    );
  }

  const guestName = `${reservation.guestName?.firstName || ''} ${reservation.guestName?.lastName || ''}`.trim() || 'Guest';

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        {cancelSuccess && (
          <Alert severity="success" sx={{ mb: 3 }}>
            {t('pages.reservationSummary.cancelSuccess')}
          </Alert>
        )}

        <Paper elevation={3} sx={{ p: 4 }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <CheckCircleIcon sx={{ fontSize: 60, color: 'success.main', mb: 2 }} />
            <Typography variant="h4" gutterBottom>
              {t('pages.reservationSummary.headerTitle')}
            </Typography>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              {t(`pages.reservationSummary.typeLabels.${reservation.type}`)}
            </Typography>
            <Chip
              label={reservation.status.toUpperCase()}
              color={getStatusColor(reservation.status) as any}
              sx={{ mt: 1 }}
            />
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* Reservation Details */}
          <Grid container spacing={3}>
            {/* Guest Information */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <PersonIcon sx={{ mr: 1 }} />
                {t('pages.reservationSummary.guestInfo')}
              </Typography>
              <Box sx={{ pl: 4 }}>
                <Typography><strong>{t('pages.reservationSummary.nameLabel')}:</strong> {guestName}</Typography>
                <Typography sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                  <EmailIcon sx={{ mr: 1, fontSize: 20 }} />
                  {reservation.contactInfo.email}
                </Typography>
                <Typography sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                  <PhoneIcon sx={{ mr: 1, fontSize: 20 }} />
                  {reservation.contactInfo.phone}
                </Typography>
                <Typography sx={{ mt: 1 }}>
                  <strong>{t('pages.reservationSummary.guestsLabel')}:</strong> {reservation.guestDetails.adults} Adults, {reservation.guestDetails.children} Children, {reservation.guestDetails.infants} Infants
                </Typography>
              </Box>
            </Grid>

            {/* Reservation Dates */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <CalendarIcon sx={{ mr: 1 }} />
                {t('pages.reservationSummary.dates')}
              </Typography>
              <Box sx={{ pl: 4 }}>
                {reservation.type === 'room' && (
                  <>
                    <Typography><strong>{t('pages.reservationSummary.checkIn')}:</strong> {formatDate(reservation.checkInDate)}</Typography>
                    <Typography><strong>{t('pages.reservationSummary.checkOut')}:</strong> {reservation.checkOutDate ? formatDate(reservation.checkOutDate) : 'N/A'}</Typography>
                    <Typography><strong>{t('pages.reservationSummary.nights')}:</strong> {reservation.totalNights || 0}</Typography>
                  </>
                )}
                {reservation.type === 'daypass' && (
                  <Typography><strong>{t('pages.reservationSummary.visitDate')}:</strong> {formatDate(reservation.checkInDate)}</Typography>
                )}
                {reservation.type === 'event' && (
                  <>
                    <Typography><strong>{t('pages.reservationSummary.eventDate')}:</strong> {formatDate(reservation.checkInDate)}</Typography>
                    {reservation.checkOutDate && (
                      <Typography><strong>{t('pages.reservationSummary.endDate')}:</strong> {formatDate(reservation.checkOutDate)}</Typography>
                    )}
                    <Typography><strong>{t('pages.reservationSummary.eventType')}:</strong> {reservation.eventType}</Typography>
                    {reservation.expectedAttendees && (
                      <Typography><strong>{t('pages.reservationSummary.expectedAttendees')}:</strong> {reservation.expectedAttendees}</Typography>
                    )}
                  </>
                )}
              </Box>
            </Grid>

            {/* Room Details (if applicable) */}
            {reservation.type === 'room' && (
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>
                  {t('pages.reservationSummary.roomDetails')}
                </Typography>
                <Box sx={{ pl: 4 }}>
                  {reservation.room && typeof reservation.room === 'object' && (
                    <Typography><strong>Room Name:</strong> {reservation.room.name}</Typography>
                  )}
                </Box>
              </Grid>
            )}

            {/* Special Requests */}
            {reservation.specialRequests && (
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>
                  {t('pages.reservationSummary.specialRequests')}
                </Typography>
                <Box sx={{ pl: 4 }}>
                  <Typography>{reservation.specialRequests}</Typography>
                </Box>
              </Grid>
            )}

            {/* Pricing */}
            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <MoneyIcon sx={{ mr: 1 }} />
                {t('pages.reservationSummary.paymentInfo')}
              </Typography>
              <Box sx={{ pl: 4 }}>
                <Typography variant="h5" color="primary">
                  <strong>{t('pages.reservationSummary.total')}: {formatMoney(reservation.totalPrice || 0)}</strong>
                </Typography>
              </Box>
            </Grid>

            {/* Reservation Code */}
            {reservation.reservationCode && (
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }} />
                <Typography variant="body2" color="text.secondary" align="center">
                  {t('pages.reservationSummary.reservationCode')}: <strong>{reservation.reservationCode}</strong>
                </Typography>
              </Grid>
            )}
          </Grid>

          {/* Action Buttons */}
          <Box sx={{ mt: 4, display: 'flex', gap: 2, justifyContent: 'center' }}>
            {reservation.status !== 'cancelled' && reservation.status !== 'completed' && (
              <Button
                variant="outlined"
                color="error"
                startIcon={<CancelIcon />}
                onClick={() => setCancelDialogOpen(true)}
              >
                {t('pages.reservationSummary.actions.cancelReservation')}
              </Button>
            )}
            <Button
              variant="contained"
              onClick={() => navigate('/admin')}
            >
              {t('pages.reservationSummary.actions.backToHome')}
            </Button>
          </Box>
        </Paper>

        {/* Cancel Confirmation Dialog */}
        <Dialog open={cancelDialogOpen} onClose={() => setCancelDialogOpen(false)}>
          <DialogTitle>{t('pages.reservationSummary.dialog.cancelTitle')}</DialogTitle>
          <DialogContent>
            <Typography gutterBottom>
              {t('pages.reservationSummary.dialog.cancelPrompt')}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('pages.reservationSummary.dialog.cancelPolicy')}
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={3}
              label={t('pages.reservationSummary.dialog.cancelReason')}
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              sx={{ mt: 2 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCancelDialogOpen(false)} disabled={cancelling}>
              {t('pages.reservationSummary.dialog.keepReservation')}
            </Button>
            <Button
              onClick={handleCancelReservation}
              color="error"
              variant="contained"
              disabled={cancelling}
            >
              {cancelling ? t('pages.reservationSummary.dialog.cancelling') : t('pages.reservationSummary.dialog.cancelButton')}
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
  );
};

export default ReservationSummaryPage;
