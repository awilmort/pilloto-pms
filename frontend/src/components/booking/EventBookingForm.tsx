import NumberField from '../common/NumberField';
import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Button,
  Grid,
  TextField,
  Alert,
  Paper,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
} from '@mui/material';
import { DeleteOutline } from '@mui/icons-material';
import { format } from 'date-fns';
import { reservationsService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { getCountriesForDisplay } from '../../utils/countries';
import { useTranslation } from 'react-i18next';

interface EventBookingFormProps {
  eventType: string;
  eventData?: {
    title: string;
    priceFrom: number;
    maxGuests: number;
    maxChildren?: number;
    maxAdults?: number;
    features: string[];
  };
  onCancel: () => void;
}

interface BookingData {
  // Event details
  eventType: string;
  eventDescription: string;
  expectedAttendees: number;

  // Dates
  eventDate: Date | null;
  endDate: Date | null;

  // Guest details
  guestDetails: {
    adults: number;
    children: number;
    infants: number;
  };

  // Contact info
  contactInfo: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    emergencyContact: string;
    country: string;
  };

  // Special requests
  specialRequests: string;
}

const EventBookingForm: React.FC<EventBookingFormProps> = ({
  eventType,
  eventData,
  onCancel,
}) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showEndDate, setShowEndDate] = useState<boolean>(false);

  const [bookingData, setBookingData] = useState<BookingData>({
    eventType,
    eventDescription: '',
    expectedAttendees: 1,
    eventDate: null,
    endDate: null,
    guestDetails: {
      adults: 1,
      children: 0,
      infants: 0,
    },
    contactInfo: {
      firstName: '',
      lastName: '',
      phone: '',
      email: user?.email || '',
      emergencyContact: '',
      country: '',
    },
    specialRequests: '',
  });

  // Keep internal eventType in sync with the selected type from parent
  useEffect(() => {
    setBookingData(prev => ({ ...prev, eventType }));
  }, [eventType]);

  const stepIds = ['eventDetails', 'contactInfo', 'servicesExtras', 'confirmation'] as const;

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        {
          const totalBreakdown = bookingData.guestDetails.adults + bookingData.guestDetails.children + bookingData.guestDetails.infants;
          const childrenWithinLimit = (eventData?.maxChildren === undefined) || (bookingData.guestDetails.children <= (eventData?.maxChildren || 0));
          const adultsWithinLimit = (eventData?.maxAdults === undefined) || (bookingData.guestDetails.adults <= (eventData?.maxAdults || 0));
          return !!(
            bookingData.eventDate &&
            totalBreakdown > 0 &&
            bookingData.guestDetails.adults > 0 &&
            childrenWithinLimit && adultsWithinLimit &&
            bookingData.eventDescription.trim()
          );
        }
      case 1:
        return !!(
          bookingData.contactInfo.firstName &&
          bookingData.contactInfo.lastName &&
          bookingData.contactInfo.phone &&
          bookingData.contactInfo.email &&
          bookingData.contactInfo.email.includes('@')
        );
      case 2:
        return true; // Services are optional
      case 3:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => prev + 1);
      setError(null);
    } else {
      setError(t('pages.eventBooking.errors.requiredFields'));
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => prev - 1);
    setError(null);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const reservationData = {
        type: 'event' as const,
        eventType: bookingData.eventType,
        eventDescription: bookingData.eventDescription,
        expectedAttendees: bookingData.expectedAttendees,
        checkInDate: bookingData.eventDate || new Date(),
        checkOutDate: bookingData.endDate || undefined,
        guests: bookingData.expectedAttendees,
        guestDetails: bookingData.guestDetails,
        contactInfo: bookingData.contactInfo,
        specialRequests: bookingData.specialRequests,
        // Prices for events will be set manually by an admin later
        totalPrice: 0,
      };
      // Always include the guestName from contact info for clarity in emails
      (reservationData as any).guestName = {
        firstName: bookingData.contactInfo.firstName,
        lastName: bookingData.contactInfo.lastName,
      };

      await reservationsService.createReservation(reservationData as any);
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.message || t('pages.eventBooking.errors.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Card sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}>
        <CardContent sx={{ textAlign: 'center', p: 4 }}>
          <Typography variant="h4" gutterBottom color="primary">
            🎉 {t('pages.eventBooking.successTitle')}
          </Typography>
          <Typography variant="body1" sx={{ mb: 3 }}>
            {t('pages.eventBooking.successBody')}
          </Typography>
          <Button
            variant="contained"
            onClick={() => window.location.href = '/profile'}
            sx={{ mr: 2 }}
          >
            {t('pages.eventBooking.viewReservations')}
          </Button>
          <Button variant="outlined" onClick={onCancel}>
            {t('pages.eventBooking.bookAnother')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                {t('pages.eventBooking.eventDetails')}
              </Typography>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label={t('pages.eventBooking.eventDate')}
                type="date"
                value={bookingData.eventDate ? format(bookingData.eventDate, 'yyyy-MM-dd') : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    // Create date with local timezone to avoid day-before issue
                    const [year, month, day] = e.target.value.split('-').map(Number);
                    const date = new Date(year, month - 1, day);
                    setBookingData(prev => ({ ...prev, eventDate: date }));
                  } else {
                    setBookingData(prev => ({ ...prev, eventDate: null }));
                  }
                }}
                fullWidth
                required
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: format(new Date(), 'yyyy-MM-dd') }}
              />
            </Grid>

            {!showEndDate && (
              <Grid item xs={12} md={6}>
                <Button
                  variant="outlined"
                  onClick={() => setShowEndDate(true)}
                  sx={{ mt: { xs: 2, md: 0 } }}
                >
                  {t('pages.eventBooking.addEndDate')}
                </Button>
              </Grid>
            )}

            {showEndDate && (
              <Grid item xs={12} md={6}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField
                    label={t('pages.eventBooking.endDate')}
                    type="date"
                    value={bookingData.endDate ? format(bookingData.endDate, 'yyyy-MM-dd') : ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        // Create date with local timezone to avoid day-before issue
                        const [year, month, day] = e.target.value.split('-').map(Number);
                        const date = new Date(year, month - 1, day);
                        setBookingData(prev => ({ ...prev, endDate: date }));
                      } else {
                        setBookingData(prev => ({ ...prev, endDate: null }));
                      }
                    }}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    helperText={t('pages.eventBooking.endDateHelper')}
                    inputProps={{
                      min: bookingData.eventDate ? format(bookingData.eventDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
                    }}
                  />
                  <IconButton
                    aria-label={t('pages.eventBooking.removeEndDate')}
                    color="error"
                    onClick={() => {
                      setBookingData(prev => ({ ...prev, endDate: null }));
                      setShowEndDate(false);
                    }}
                  >
                    <DeleteOutline />
                  </IconButton>
                </Box>
              </Grid>
            )}

            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                {t('common.guestDistribution')}
              </Typography>
            </Grid>

            <Grid item xs={12} md={4}>
              <NumberField
                label={t('pages.eventBooking.adults')}
                value={bookingData.guestDetails.adults}
                onChange={(val) => {
                  const adults = val == null ? 0 : val;
                  const total = adults + bookingData.guestDetails.children + bookingData.guestDetails.infants;
                  setBookingData(prev => ({
                    ...prev,
                    guestDetails: { ...prev.guestDetails, adults },
                    expectedAttendees: total
                  }));
                }}
                min={1}
                max={eventData?.maxAdults ?? undefined}
                fullWidth
                required
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <NumberField
                label={t('pages.eventBooking.children')}
                value={bookingData.guestDetails.children}
                onChange={(val) => {
                  const children = val == null ? 0 : val;
                  const total = bookingData.guestDetails.adults + children + bookingData.guestDetails.infants;
                  setBookingData(prev => ({
                    ...prev,
                    guestDetails: { ...prev.guestDetails, children },
                    expectedAttendees: total
                  }));
                }}
                min={0}
                max={eventData?.maxChildren ?? undefined}
                fullWidth
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <NumberField
                label={t('pages.eventBooking.infants')}
                value={bookingData.guestDetails.infants}
                onChange={(val) => {
                  const infants = val == null ? 0 : val;
                  const total = bookingData.guestDetails.adults + bookingData.guestDetails.children + infants;
                  setBookingData(prev => ({
                    ...prev,
                    guestDetails: { ...prev.guestDetails, infants },
                    expectedAttendees: total
                  }));
                }}
                min={0}
                fullWidth
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                label={t('pages.eventBooking.eventDescription')}
                multiline
                rows={4}
                value={bookingData.eventDescription}
                onChange={(e) => setBookingData(prev => ({
                  ...prev,
                  eventDescription: e.target.value
                }))}
                placeholder={t('pages.eventBooking.eventDescriptionPlaceholder')}
                fullWidth
                required
              />
            </Grid>
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                {t('pages.eventBooking.contactInfo')}
              </Typography>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label={t('pages.eventBooking.firstName')}
                value={bookingData.contactInfo.firstName}
                onChange={(e) => setBookingData(prev => ({
                  ...prev,
                  contactInfo: { ...prev.contactInfo, firstName: e.target.value }
                }))}
                fullWidth
                required
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label={t('pages.eventBooking.lastName')}
                value={bookingData.contactInfo.lastName}
                onChange={(e) => setBookingData(prev => ({
                  ...prev,
                  contactInfo: { ...prev.contactInfo, lastName: e.target.value }
                }))}
                fullWidth
                required
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label={t('pages.eventBooking.phone')}
                value={bookingData.contactInfo.phone}
                onChange={(e) => setBookingData(prev => ({
                  ...prev,
                  contactInfo: { ...prev.contactInfo, phone: e.target.value }
                }))}
                fullWidth
                required
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label={t('pages.eventBooking.email')}
                type="email"
                value={bookingData.contactInfo.email}
                onChange={(e) => setBookingData(prev => ({
                  ...prev,
                  contactInfo: { ...prev.contactInfo, email: e.target.value }
                }))}
                fullWidth
                required
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label={t('pages.eventBooking.emergencyContact')}
                value={bookingData.contactInfo.emergencyContact}
                onChange={(e) => setBookingData(prev => ({
                  ...prev,
                  contactInfo: { ...prev.contactInfo, emergencyContact: e.target.value }
                }))}
                fullWidth
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>{t('pages.eventBooking.country')}</InputLabel>
                <Select
                  value={bookingData.contactInfo.country}
                  label={t('pages.eventBooking.country')}
                  onChange={(e) => setBookingData(prev => ({
                    ...prev,
                    contactInfo: { ...prev.contactInfo, country: e.target.value }
                  }))}
                >
                  {getCountriesForDisplay().map((country) => (
                    <MenuItem key={country.code} value={country.code}>
                      {country.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Guest Distribution moved to Event Details step */}
          </Grid>
        );

      case 2:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                {t('pages.eventBooking.specialRequests')}
              </Typography>
            </Grid>

            <Grid item xs={12}>
              <TextField
                label={t('pages.eventBooking.specialRequests')}
                multiline
                rows={3}
                value={bookingData.specialRequests}
                onChange={(e) => setBookingData(prev => ({
                  ...prev,
                  specialRequests: e.target.value
                }))}
                placeholder={t('pages.eventBooking.specialRequestsPlaceholder')}
                fullWidth
              />
            </Grid>
          </Grid>
        );

      case 3:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                {t('pages.eventBooking.bookingSummary')}
              </Typography>
            </Grid>

            <Grid item xs={12} md={8}>
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom color="primary">
                  {t('pages.eventBooking.eventTitle', { title: eventData?.title })}
                </Typography>

                <Typography variant="body1" sx={{ mb: 2 }}>
                  <strong>{t('pages.eventBooking.labels.date')}</strong> {bookingData.eventDate ? format(bookingData.eventDate, 'MMMM dd, yyyy') : t('pages.eventBooking.labels.notSelected')}
                  {bookingData.endDate && ` - ${format(bookingData.endDate, 'MMMM dd, yyyy')}`}
                </Typography>

                <Typography variant="body1" sx={{ mb: 2 }}>
                  <strong>{t('pages.eventBooking.labels.attendees')}</strong> {bookingData.expectedAttendees} {t('pages.eventBooking.labels.guests')}
                </Typography>

                <Typography variant="body1" sx={{ mb: 2 }}>
                  <strong>{t('pages.eventBooking.labels.description')}</strong> {bookingData.eventDescription || t('pages.eventBooking.labels.noneProvided')}
                </Typography>

                <Typography variant="body1" sx={{ mb: 2 }}>
                  <strong>{t('pages.eventBooking.labels.contact')}</strong> {bookingData.contactInfo.email} • {bookingData.contactInfo.phone}
                </Typography>

                {bookingData.specialRequests && (
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    <strong>{t('pages.eventBooking.specialRequests')}</strong> {bookingData.specialRequests}
                  </Typography>
                )}
              </Paper>
            </Grid>

            {/* Price summary removed: events are manually priced by admin */}
          </Grid>
        );

      default:
        return null;
    }
  };

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', py: 4 }}>
      <Typography variant="h4" gutterBottom align="center" sx={{ mb: 4 }}>
        {t('pages.eventBooking.bookYourEvent', { title: eventData?.title })}
      </Typography>

      <Stepper activeStep={currentStep} sx={{ mb: 4 }}>
        {stepIds.map((id) => (
          <Step key={id}>
            <StepLabel>{t(`pages.eventBooking.steps.${id}`)}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent sx={{ p: 4 }}>
          {renderStepContent()}

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
            <Box>
              {currentStep > 0 && (
                <Button onClick={handleBack} sx={{ mr: 1 }}>
                  {t('pages.eventBooking.actions.back')}
                </Button>
              )}
              <Button variant="outlined" onClick={onCancel}>
                {t('pages.eventBooking.actions.cancel')}
              </Button>
            </Box>

            <Box>
              {currentStep < stepIds.length - 1 ? (
                <Button
                  variant="contained"
                  onClick={handleNext}
                  disabled={!validateStep(currentStep)}
                >
                  {t('pages.eventBooking.actions.next')}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  onClick={handleSubmit}
                  disabled={loading || !validateStep(currentStep)}
                >
                  {loading ? t('pages.eventBooking.actions.booking') : t('pages.eventBooking.actions.confirmBooking')}
                </Button>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default EventBookingForm;
