/**
 * BookingCreateDialog
 *
 * 3-step room reservation creation wizard launched from
 * the BookingCalendar grid (clicking on an empty cell).
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
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowBack, ArrowForward, Hotel } from '@mui/icons-material';
import NumberField from '../../common/NumberField';
import DateRangePicker from '../../common/DateRangePicker';
import { reservationsService, pricingService } from '../../../services/api';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../../utils/currency';

// ─── Types ────────────────────────────────────────────────────────────────────
const DEFAULT_FORM = {
  checkInDate:     '',
  checkOutDate:    '',
  adults:          1,
  children:        0,
  infants:         0,
  firstName:       '',
  lastName:        '',
  email:           '',
  phone:           '',
  specialRequests: '',
  totalPrice:      0,
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  open: boolean;
  defaultCheckIn?: string;
  defaultCheckOut?: string;
  onClose: () => void;
  onCreated: () => void;
  onSnackbar: (message: string, severity: 'success' | 'error') => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
const BookingCreateDialog: React.FC<Props> = ({
  open,
  defaultCheckIn,
  defaultCheckOut,
  onClose,
  onCreated,
  onSnackbar,
}) => {
  const { t } = useTranslation();

  const [step, setStep]             = useState<1 | 2 | 3>(1);
  const [form, setForm]             = useState(DEFAULT_FORM);
  const [ratePlanId, setRatePlanId] = useState('');
  const [ratePlans, setRatePlans]   = useState<any[]>([]);
  const [pricePreview, setPricePreview] = useState<any>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setForm({ ...DEFAULT_FORM, checkInDate: defaultCheckIn ?? '', checkOutDate: defaultCheckOut ?? '' });
    setStep(1);
    setRatePlanId('');
    setPricePreview(null);
    setError(null);
    pricingService.getRatePlans({ active: true })
      .then(res => setRatePlans(res.data.data ?? []))
      .catch(() => {});
  }, [open, defaultCheckIn, defaultCheckOut]);

  // Re-calculate price preview when inputs change
  useEffect(() => {
    if (!open || !ratePlanId || !form.checkInDate || !form.checkOutDate) {
      setPricePreview(null);
      return;
    }
    const ci      = new Date(form.checkInDate  + 'T12:00:00');
    const co      = new Date(form.checkOutDate + 'T12:00:00');
    const nights  = Math.max(1, Math.ceil((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24)));
    setPriceLoading(true);
    pricingService.calculatePrice({
      ratePlanId,
      adults:   form.adults,
      children: form.children,
      date:     form.checkInDate,
      nights,
      rooms:    1,
    })
      .then(res => {
        const data = res.data.data;
        setPricePreview(data);
        if (data?.finalTotal != null) setForm(f => ({ ...f, totalPrice: data.finalTotal }));
      })
      .catch(() => setPricePreview(null))
      .finally(() => setPriceLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ratePlanId, form.checkInDate, form.checkOutDate, form.adults, form.children]);

  const handleCreate = async () => {
    try {
      setLoading(true);
      const payload: any = {
        type:            'room',
        checkInDate:      form.checkInDate,
        checkOutDate:     form.checkOutDate,
        guests:           form.adults + form.children + form.infants,
        guestDetails:    { adults: form.adults, children: form.children, infants: form.infants },
        guestName:       { firstName: form.firstName, lastName: form.lastName },
        contactInfo:     { email: form.email, phone: form.phone },
        specialRequests:  form.specialRequests,
        totalPrice:       form.totalPrice,
      };
      if (ratePlanId) payload.ratePlanId = ratePlanId;
      await reservationsService.createReservation(payload);
      onSnackbar(t('admin.reservations.messages.createSuccess', 'Reservation created successfully!'), 'success');
      onClose();
      onCreated();
    } catch (e: any) {
      onSnackbar(e?.response?.data?.message || 'Failed to create reservation', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        {step === 1
          ? t('admin.reservations.create.step1Title', 'Dates & Guests')
          : step === 2
          ? t('admin.reservations.create.step2Title', 'Guest Details')
          : t('admin.reservations.create.step3Title', 'Summary')}
      </DialogTitle>

      <Box sx={{ px: 3, pb: 1 }}>
        <Stepper activeStep={step - 1} alternativeLabel>
          <Step><StepLabel>{t('admin.reservations.create.stepDates', 'Dates & Guests')}</StepLabel></Step>
          <Step><StepLabel>{t('admin.reservations.create.stepGuest', 'Guest Info')}</StepLabel></Step>
          <Step><StepLabel>{t('admin.reservations.create.stepSummary', 'Summary')}</StepLabel></Step>
        </Stepper>
      </Box>

      <DialogContent sx={{ pt: 1 }}>
        {/* ── Step 1: Dates, guests, rate plan ── */}
        {step === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t('admin.reservations.create.selectDateRange', 'Select dates')}
              </Typography>
              <DateRangePicker
                startDate={form.checkInDate}
                endDate={form.checkOutDate}
                onChange={(start, end) => setForm(f => ({ ...f, checkInDate: start, checkOutDate: end }))}
              />
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t('admin.reservations.create.guestCount', 'Guests')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <NumberField label={t('admin.reservations.form.adults', 'Adults')}    value={form.adults}   min={1} onChange={v => setForm(f => ({ ...f, adults:   v ?? 1 }))} />
                <NumberField label={t('admin.reservations.form.children', 'Children')} value={form.children} min={0} onChange={v => setForm(f => ({ ...f, children: v ?? 0 }))} />
                <NumberField label={t('admin.reservations.form.infants', 'Infants')}   value={form.infants}  min={0} onChange={v => setForm(f => ({ ...f, infants:  v ?? 0 }))} />
              </Box>
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t('admin.reservations.create.ratePlan', 'Rate Plan')}
              </Typography>
              <FormControl fullWidth size="small">
                <InputLabel>{t('admin.reservations.create.selectRatePlan', 'Select a rate plan')}</InputLabel>
                <Select
                  value={ratePlanId}
                  label={t('admin.reservations.create.selectRatePlan', 'Select a rate plan')}
                  onChange={e => setRatePlanId(e.target.value)}
                >
                  <MenuItem value=""><em>{t('admin.reservations.create.noRatePlan', 'None (manual pricing)')}</em></MenuItem>
                  {ratePlans.map((rp: any) => (
                    <MenuItem key={rp._id} value={rp._id}>
                      {rp.name}{rp.roomTypeId?.name ? ` · ${rp.roomTypeId.name}` : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {priceLoading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <CircularProgress size={14} />
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.reservations.create.calculatingPrice', 'Calculating price...')}
                  </Typography>
                </Box>
              )}
              {!priceLoading && pricePreview?.finalTotal != null && (
                <Paper variant="outlined" sx={{ p: 1.5, mt: 1.5, borderRadius: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      {t('admin.reservations.create.basePrice', 'Base')} ({pricePreview.nights} {t('admin.reservations.create.nights', 'nights')})
                    </Typography>
                    <Typography variant="body2">{formatMoney(pricePreview.basePrice)}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 0.5, mt: 0.5, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="body2" fontWeight={700}>{t('admin.reservations.form.totalPrice', 'Total')}</Typography>
                    <Typography variant="body2" fontWeight={700} color="primary.main">{formatMoney(pricePreview.finalTotal)}</Typography>
                  </Box>
                </Paper>
              )}
            </Box>
          </Box>
        )}

        {/* ── Step 2: Guest info ── */}
        {step === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField fullWidth size="small" label={t('admin.reservations.form.firstName', 'First Name')} value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} required />
              <TextField fullWidth size="small" label={t('admin.reservations.form.lastName', 'Last Name')}   value={form.lastName}  onChange={e => setForm(f => ({ ...f, lastName:  e.target.value }))} />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField fullWidth size="small" type="email" label={t('admin.reservations.form.email', 'Email')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
              <TextField fullWidth size="small" label={t('admin.reservations.form.phone', 'Phone')} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </Box>
            <TextField
              fullWidth size="small" type="number"
              label={t('admin.reservations.form.totalPrice', 'Total Price')}
              value={form.totalPrice}
              onChange={e => setForm(f => ({ ...f, totalPrice: parseFloat(e.target.value) || 0 }))}
              inputProps={{ min: 0, step: 0.01 }}
            />
            <TextField
              fullWidth size="small" multiline rows={2}
              label={t('admin.reservations.form.specialRequests', 'Special Requests')}
              value={form.specialRequests}
              onChange={e => setForm(f => ({ ...f, specialRequests: e.target.value }))}
            />
            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          </Box>
        )}

        {/* ── Step 3: Summary ── */}
        {step === 3 && (
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              {t('admin.reservations.create.summaryTitle', 'Reservation Summary')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.type', 'Type')}</Typography>
                <Typography variant="body2" fontWeight={600}>{t('admin.reservations.typeLabels.room', 'Room')}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.dates', 'Dates')}</Typography>
                <Typography variant="body2" fontWeight={600}>{form.checkInDate} → {form.checkOutDate}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.guests', 'Guests')}</Typography>
                <Typography variant="body2" fontWeight={600}>{form.adults}A · {form.children}C · {form.infants}I</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('admin.reservations.form.guest', 'Guest')}</Typography>
                <Typography variant="body2" fontWeight={600}>{form.firstName} {form.lastName}</Typography>
                {form.email && <Typography variant="caption" color="text.secondary" display="block">{form.email}</Typography>}
                {form.phone && <Typography variant="caption" color="text.secondary" display="block">{form.phone}</Typography>}
              </Box>
              {form.specialRequests && (
                <Box sx={{ gridColumn: '1 / -1' }}>
                  <Typography variant="caption" color="text.secondary">{t('admin.reservations.form.specialRequests', 'Special Requests')}</Typography>
                  <Typography variant="body2">{form.specialRequests}</Typography>
                </Box>
              )}
              <Box sx={{ gridColumn: '1 / -1', pt: 1, mt: 0.5, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="h6" fontWeight={700} color="primary.main">
                  {t('admin.reservations.form.totalPrice', 'Total')}: {formatMoney(form.totalPrice)}
                </Typography>
              </Box>
            </Box>
          </Paper>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={loading}>
          {t('admin.reservations.actions.cancel', 'Cancel')}
        </Button>
        {step > 1 && (
          <Button
            startIcon={<ArrowBack />}
            onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}
            disabled={loading}
          >
            {t('common.back', 'Back')}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {step < 3 && (
          <Button
            variant="contained"
            endIcon={<ArrowForward />}
            disabled={
              (step === 1 && (!form.checkInDate || !form.checkOutDate)) ||
              (step === 2 && (!form.firstName.trim() || !form.email.trim()))
            }
            onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)}
          >
            {t('common.continue', 'Continue')}
          </Button>
        )}
        {step === 3 && (
          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <Hotel />}
            disabled={loading}
            onClick={handleCreate}
          >
            {t('admin.reservations.create.bookReservation', 'Book Reservation')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default BookingCreateDialog;
