import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  CircularProgress,
  Tab,
  Tabs,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import {
  Event,
  Person,
  Payment,
  Hotel,
  Cancel,
  Check,
  AccessTime,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { reservationsService } from '../../services/api';
import { Reservation } from '../../types';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../utils/currency';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const ReservationsPage: React.FC = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [cancelDialog, setCancelDialog] = useState<{
    open: boolean;
    reservation: Reservation | null;
  }>({ open: false, reservation: null });
  const [cancellationReason, setCancellationReason] = useState('');

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <Check />;
      case 'pending':
        return <AccessTime />;
      case 'cancelled':
        return <Cancel />;
      case 'completed':
        return <Check />;
      default:
        return <AccessTime />;
    }
  };

  const fetchReservations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await reservationsService.getUserReservations();
      setReservations(response.data.data || []);
    } catch (error: any) {
      console.error('Error fetching reservations:', error);
      setError(error.response?.data?.message || t('pages.reservations.fetchError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  const handleCancelReservation = async () => {
    if (!cancelDialog.reservation) return;

    try {
      await reservationsService.cancelReservation(cancelDialog.reservation._id);
      setCancelDialog({ open: false, reservation: null });
      setCancellationReason('');
      fetchReservations(); // Refresh the list
    } catch (error: any) {
      console.error('Error cancelling reservation:', error);
      setError(error.response?.data?.message || t('pages.reservations.cancelError'));
    }
  };

  const filterReservationsByStatus = (status?: string) => {
    if (!status) return reservations;
    return reservations.filter(reservation => reservation.status === status);
  };

  const getTabLabel = (status: string) => {
    const count = filterReservationsByStatus(status).length;
    const key = `pages.reservations.tabs.${status}`;
    return `${t(key)} (${count})`;
  };

  if (!user) {
    return (
      <Container maxWidth="lg" sx={{ py: 8, textAlign: 'center' }}>
        <Typography variant="h4" gutterBottom>
          {t('pages.reservations.loginPrompt')}
        </Typography>
        <Button variant="contained" href="/login">
          {t('auth.login')}
        </Button>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress size={60} />
        <Typography variant="h6" sx={{ mt: 2 }}>
          {t('pages.reservations.loading')}
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <Box sx={{ textAlign: 'center', mb: 6 }}>
        <Typography variant="h2" component="h1" gutterBottom>
          {t('pages.reservations.title')}
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
          {t('pages.reservations.subtitle')}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 4 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
          <Tab label={`${t('pages.reservations.tabs.all')} (${reservations.length})`} />
          <Tab label={getTabLabel('pending')} />
          <Tab label={getTabLabel('confirmed')} />
          <Tab label={getTabLabel('completed')} />
          <Tab label={getTabLabel('cancelled')} />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <ReservationList
          reservations={reservations}
          onCancel={(reservation) => setCancelDialog({ open: true, reservation })}
          getStatusColor={getStatusColor}
          getStatusIcon={getStatusIcon}
        />
      </TabPanel>
      <TabPanel value={tabValue} index={1}>
        <ReservationList
          reservations={filterReservationsByStatus('pending')}
          onCancel={(reservation) => setCancelDialog({ open: true, reservation })}
          getStatusColor={getStatusColor}
          getStatusIcon={getStatusIcon}
        />
      </TabPanel>
      <TabPanel value={tabValue} index={2}>
        <ReservationList
          reservations={filterReservationsByStatus('confirmed')}
          onCancel={(reservation) => setCancelDialog({ open: true, reservation })}
          getStatusColor={getStatusColor}
          getStatusIcon={getStatusIcon}
        />
      </TabPanel>
      <TabPanel value={tabValue} index={3}>
        <ReservationList
          reservations={filterReservationsByStatus('completed')}
          onCancel={(reservation) => setCancelDialog({ open: true, reservation })}
          getStatusColor={getStatusColor}
          getStatusIcon={getStatusIcon}
        />
      </TabPanel>
      <TabPanel value={tabValue} index={4}>
        <ReservationList
          reservations={filterReservationsByStatus('cancelled')}
          onCancel={(reservation) => setCancelDialog({ open: true, reservation })}
          getStatusColor={getStatusColor}
          getStatusIcon={getStatusIcon}
        />
      </TabPanel>

      {/* Cancel Reservation Dialog */}
      <Dialog open={cancelDialog.open} onClose={() => setCancelDialog({ open: false, reservation: null })}>
        <DialogTitle>{t('pages.reservations.cancelTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t('pages.reservations.cancelPrompt')}
          </Typography>
          <TextField
            fullWidth
            label={t('pages.reservations.cancelReason')}
            multiline
            rows={3}
            value={cancellationReason}
            onChange={(e) => setCancellationReason(e.target.value)}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialog({ open: false, reservation: null })}>
            {t('pages.reservations.keepReservation')}
          </Button>
          <Button onClick={handleCancelReservation} color="error" variant="contained">
            {t('pages.reservations.cancelButton')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

interface ReservationListProps {
  reservations: Reservation[];
  onCancel: (reservation: Reservation) => void;
  getStatusColor: (status: string) => string;
  getStatusIcon: (status: string) => React.JSX.Element;
}

const ReservationList: React.FC<ReservationListProps> = ({
  reservations,
  onCancel,
  getStatusColor,
  getStatusIcon
}) => {
  const { t } = useTranslation();
  if (reservations.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="h6" color="text.secondary">
          {t('pages.reservations.empty')}
        </Typography>
      </Box>
    );
  }

  return (
    <Grid container spacing={3}>
      {reservations.map((reservation) => (
        <Grid item xs={12} key={reservation._id}>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Grid container spacing={3}>
                <Grid item xs={12} md={8}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Typography variant="h5" component="h3">
                      {reservation.room && typeof reservation.room === 'object' ? reservation.room.name : 'Room'}
                    </Typography>
                    <Chip
                      icon={<Hotel />}
                      label={reservation.room && typeof reservation.room === 'object' ? reservation.room.name : 'Room'}
                      size="small"
                      variant="outlined"
                    />
                    <Chip
                      icon={getStatusIcon(reservation.status)}
                      label={reservation.status.charAt(0).toUpperCase() + reservation.status.slice(1)}
                      color={getStatusColor(reservation.status) as any}
                      size="small"
                    />
                  </Box>

                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Event color="action" />
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            Check-in
                          </Typography>
                          <Typography variant="body1">
                            {new Date(reservation.checkInDate).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: '2-digit'
                            })}
                          </Typography>
                        </Box>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Event color="action" />
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            Check-out
                          </Typography>
                          <Typography variant="body1">
                            {reservation.checkOutDate ? new Date(reservation.checkOutDate).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: '2-digit'
                            }) : 'N/A'}
                          </Typography>
                        </Box>
                      </Box>
                    </Grid>
                  </Grid>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Person color="action" />
                    <Typography variant="body1">
                      {reservation.guests} guest{reservation.guests > 1 ? 's' : ''}
                    </Typography>
                  </Box>

                  {reservation.specialRequests && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Special Requests:
                      </Typography>
                      <Typography variant="body2">
                        {reservation.specialRequests}
                      </Typography>
                    </Box>
                  )}
                </Grid>

                <Grid item xs={12} md={4}>
                  <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: { xs: 'flex-start', md: 'flex-end' }, mb: 2 }}>
                      <Payment color="action" />
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          Total Amount
                        </Typography>
                        <Typography variant="h6" color="primary">
                          {formatMoney(reservation.estimatedTotal ?? reservation.totalPrice ?? 0)}
                        </Typography>
                      </Box>
                    </Box>

                    <Chip
                      label={`Payment: ${(reservation.totalPayments ?? 0) >= (reservation.estimatedTotal ?? reservation.totalPrice ?? 0) ? 'paid' : 'pending'}`}
                      color={(reservation.totalPayments ?? 0) >= (reservation.estimatedTotal ?? reservation.totalPrice ?? 0) ? 'success' : 'warning'}
                      size="small"
                      sx={{ mb: 2 }}
                    />

                    <Typography variant="caption" color="text.secondary" display="block">
                      Booked on {new Date(reservation.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: '2-digit'
                      })}
                    </Typography>

                    {reservation.status === 'pending' && (
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        onClick={() => onCancel(reservation)}
                        sx={{ mt: 2 }}
                      >
                        Cancel Booking
                      </Button>
                    )}
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default ReservationsPage;
