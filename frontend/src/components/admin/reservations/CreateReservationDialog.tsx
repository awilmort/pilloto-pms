/**
 * CreateReservationDialog
 *
 * 4-step reservation creation wizard used in ReservationManagement.
 * Step 0: service type selection (room / day pass / pasa tarde / event)
 * Step 1: dates, guest counts, rate plan (+ availability check for rooms)
 * Step 2: guest info, contact, optional corporate booking
 * Step 3: summary + confirm
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardActionArea,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Step,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowBack,
  ArrowForward,
  Celebration,
  CheckCircle,
  EventNote,
  Hotel,
  KingBed,
  Search,
  WbSunny,
} from '@mui/icons-material';
import { Reservation, Company, RoomType } from '../../../types';
import { reservationsService, roomsService, pricingService, companiesService, servicesService } from '../../../services/api';
import type { ServiceRecord, ServiceKind } from '../../../services/api';
import { useTranslation } from 'react-i18next';
import NumberField from '../../common/NumberField';
import DateRangePicker from '../../common/DateRangePicker';
import { formatMoney } from '../../../utils/currency';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const addOneDay = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const normalizeRange = (checkIn: string, checkOut?: string) => ({
  ci: checkIn,
  co: (!checkOut || checkOut <= checkIn) ? addOneDay(checkIn) : checkOut,
});

// ─── Types ────────────────────────────────────────────────────────────────────
type ReservationType = 'room' | 'daypass' | 'PasaTarde' | 'event';

interface ReservationServices {
  daypass: boolean;
  accommodation: boolean;
  pasatarde: boolean;
  event: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (reservation: Reservation) => void;
  onSnackbar: (message: string, severity: 'success' | 'error') => void;
  reservationServices: ReservationServices;
}

const DEFAULT_FORM = {
  type:            'room' as ReservationType,
  firstName:       '',
  lastName:        '',
  email:           '',
  phone:           '',
  checkInDate:     '',
  checkOutDate:    '',
  adults:          1,
  children:        0,
  infants:         0,
  specialRequests: '',
  totalPrice:      0,
};

// ─── Component ────────────────────────────────────────────────────────────────
const CreateReservationDialog: React.FC<Props> = ({
  open, onClose, onCreated, onSnackbar, reservationServices,
}) => {
  const { t } = useTranslation();

  const [createStep, setCreateStep]     = useState<0 | 1 | 2 | 3>(0);
  const [createForm, setCreateForm]     = useState(DEFAULT_FORM);
  const [createLoading, setCreateLoading] = useState(false);

  // Corporate booking
  const [createIsCorporate, setCreateIsCorporate]     = useState(false);
  const [createCompanyId, setCreateCompanyId]         = useState('');
  const [createCompanyName, setCreateCompanyName]     = useState('');
  const [createCompanyOptions, setCreateCompanyOptions] = useState<Company[]>([]);
  const [createCompanySearch, setCreateCompanySearch] = useState('');

  // Room availability + selection
  const [createAvailableRooms, setCreateAvailableRooms]       = useState<any[]>([]);
  const [createCheckingAvailability, setCreateCheckingAvailability] = useState(false);
  const [createAvailabilityChecked, setCreateAvailabilityChecked]   = useState(false);
  const [selectedRooms, setSelectedRooms]                           = useState<any[]>([]);
  const [roomSearch, setRoomSearch]                                 = useState('');
  // Rooms-based pricing preview
  const [createPricePreview, setCreatePricePreview] = useState<any>(null);
  const [createPriceLoading, setCreatePriceLoading] = useState(false);

  // Validation
  const [createStep2Error, setCreateStep2Error] = useState<string | null>(null);
  const [createGuestPriceApplied, setCreateGuestPriceApplied]         = useState(false);
  const [createCorporatePriceApplied, setCreateCorporatePriceApplied] = useState(false);

  // Service pricing (non-room types)
  const [serviceOptions, setServiceOptions]           = useState<ServiceRecord[]>([]);
  const [selectedServiceId, setSelectedServiceId]     = useState('');
  const [servicePricePreview, setServicePricePreview] = useState<any>(null);
  const [servicePriceLoading, setServicePriceLoading] = useState(false);

  // Company search autocomplete
  useEffect(() => {
    if (createCompanySearch.length < 1) return;
    companiesService.getCompanies({ search: createCompanySearch, limit: 20 })
      .then(res => setCreateCompanyOptions(res.data.data ?? []))
      .catch(() => {});
  }, [createCompanySearch]);

  // Auto-fetch available rooms when both dates are set (room type only)
  useEffect(() => {
    if (!open || createForm.type !== 'room' || !createForm.checkInDate || !createForm.checkOutDate) return;
    const { ci, co } = normalizeRange(createForm.checkInDate, createForm.checkOutDate);
    setCreateCheckingAvailability(true);
    setCreateAvailabilityChecked(false);
    setSelectedRooms([]);
    setCreatePricePreview(null);
    roomsService.getAvailableRooms(ci, co)
      .then(res => {
        setCreateAvailableRooms(Array.isArray(res.data.data) ? res.data.data : []);
        setCreateAvailabilityChecked(true);
      })
      .catch(() => { setCreateAvailableRooms([]); setCreateAvailabilityChecked(true); })
      .finally(() => setCreateCheckingAvailability(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, createForm.type, createForm.checkInDate, createForm.checkOutDate]);

  // Auto-calculate price preview when selected rooms change
  useEffect(() => {
    if (
      createForm.type !== 'room' ||
      selectedRooms.length === 0 ||
      !createForm.checkInDate ||
      !createForm.checkOutDate
    ) {
      if (createForm.type === 'room') setCreatePricePreview(null);
      return;
    }
    setCreatePriceLoading(true);
    pricingService.calculateRoomsPrice({
      roomIds:      selectedRooms.map(r => r._id),
      checkInDate:  createForm.checkInDate,
      checkOutDate: createForm.checkOutDate,
      adults:       createForm.adults,
      children:     createForm.children,
      companyId:    createIsCorporate && createCompanyId ? createCompanyId : undefined,
      guestEmail:   createForm.email || undefined,
    })
      .then(res => {
        const data = res.data.data;
        setCreatePricePreview(data);
        if (data?.finalTotal != null) setCreateForm(f => ({ ...f, totalPrice: data.finalTotal }));
      })
      .catch(() => setCreatePricePreview(null))
      .finally(() => setCreatePriceLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, createForm.type, selectedRooms, createForm.checkInDate, createForm.checkOutDate, createForm.adults, createForm.children, createIsCorporate, createCompanyId, createForm.email]);

  // Load services for non-room types when dialog opens or type changes
  useEffect(() => {
    if (!open || createForm.type === 'room') { setServiceOptions([]); setSelectedServiceId(''); return; }
    const kindMap: Record<string, ServiceKind> = { daypass: 'daypass', PasaTarde: 'pasatarde', event: 'event' };
    const kind = kindMap[createForm.type];
    if (!kind) return;
    servicesService.getServices({ active: true, kind })
      .then(res => {
        const list: ServiceRecord[] = res.data.data ?? [];
        setServiceOptions(list);
        if (list.length === 1) setSelectedServiceId(list[0]._id!);
        else setSelectedServiceId('');
      })
      .catch(() => setServiceOptions([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, createForm.type]);

  // Auto-calculate service price preview for non-room types
  useEffect(() => {
    if (createForm.type === 'room' || !selectedServiceId || !createForm.checkInDate) {
      if (createForm.type !== 'room') setServicePricePreview(null);
      return;
    }
    setServicePriceLoading(true);
    pricingService.calculateServicePrice({
      serviceId:  selectedServiceId,
      date:       createForm.checkInDate,
      adults:     createForm.adults,
      children:   createForm.children,
      companyId:  createIsCorporate && createCompanyId ? createCompanyId : undefined,
      guestEmail: createForm.email || undefined,
    })
      .then(res => {
        const data = res.data.data;
        setServicePricePreview(data);
        if (data?.finalTotal != null) setCreateForm(f => ({ ...f, totalPrice: data.finalTotal }));
      })
      .catch(() => setServicePricePreview(null))
      .finally(() => setServicePriceLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, createForm.type, selectedServiceId, createForm.checkInDate, createForm.adults, createForm.children, createIsCorporate, createCompanyId, createForm.email]);

  const resetDialog = () => {
    setCreateForm(DEFAULT_FORM);
    setCreateStep(0);
    setCreateAvailableRooms([]);
    setCreateAvailabilityChecked(false);
    setSelectedRooms([]);
    setRoomSearch('');
    setCreateGuestPriceApplied(false);
    setCreateCorporatePriceApplied(false);
    setCreateIsCorporate(false);
    setCreateCompanyId('');
    setCreateCompanyName('');
    setCreateStep2Error(null);
    setCreatePricePreview(null);
    setServiceOptions([]);
    setSelectedServiceId('');
    setServicePricePreview(null);
  };

  const handleClose = () => {
    resetDialog();
    onClose();
  };

  // Capacity helpers
  const totalBillableGuests = createForm.adults + createForm.children;
  const selectedCapacity = selectedRooms.reduce((sum, r) => {
    const cap = (r.roomTypeId as any)?.capacity ?? (typeof r.roomTypeId === 'object' ? (r.roomTypeId as RoomType)?.capacity : undefined) ?? 1;
    return sum + cap;
  }, 0);
  const capacitySatisfied = selectedCapacity >= totalBillableGuests;

  const toggleRoomSelection = (room: any) => {
    setSelectedRooms(prev => {
      const already = prev.some(r => r._id === room._id);
      return already ? prev.filter(r => r._id !== room._id) : [...prev, room];
    });
  };

  const handleContinueStep1 = async () => {
    if (createForm.type !== 'room') { setCreateStep(2); return; }
    // Rooms must be selected and capacity must be sufficient
    if (selectedRooms.length === 0 || !capacitySatisfied) return;
    setCreateStep(2);
  };

  const handleContinueStep2 = () => {
    if (createIsCorporate && !createCompanyId) {
      setCreateStep2Error(t('admin.reservations.create.companyRequired', 'Please select a company for the corporate booking.'));
      return;
    }
    setCreateStep2Error(null);
    setCreateStep(3);
  };

  const handleCreate = async () => {
    try {
      setCreateLoading(true);
      const guests  = createForm.adults + createForm.children + createForm.infants;
      const payload: any = {
        type:            createForm.type,
        checkInDate:      createForm.checkInDate,
        guests,
        guestDetails:    { adults: createForm.adults, children: createForm.children, infants: createForm.infants },
        guestName:       { firstName: createForm.firstName, lastName: createForm.lastName },
        contactInfo:     { email: createForm.email, phone: createForm.phone },
        specialRequests:  createForm.specialRequests,
        totalPrice:       createForm.totalPrice,
      };
      if (createForm.checkOutDate) payload.checkOutDate = createForm.checkOutDate;
      if (createForm.type === 'room' && selectedRooms.length > 0) {
        payload.rooms = selectedRooms.map(r => r._id);
      }
      if (createIsCorporate && createCompanyId) {
        payload.isCorporate = true;
        payload.company = createCompanyId;
      }
      if (createForm.type !== 'room' && selectedServiceId && servicePricePreview) {
        payload.items = [{
          kind:           'service',
          serviceId:      selectedServiceId,
          servicePriceId: servicePricePreview.servicePrice?._id,
          date:           createForm.checkInDate,
          adults:         createForm.adults,
          children:       createForm.children,
          quantity:       servicePricePreview.quantity,
          unitPrice:      servicePricePreview.unitPrice,
          subtotal:       servicePricePreview.baseSubtotal,
          taxes:          servicePricePreview.taxes,
          totalTaxes:     servicePricePreview.totalTaxes,
          total:          servicePricePreview.finalTotal,
        }];
      }
      const res = await reservationsService.createReservation(payload);
      onCreated(res.data.data as Reservation);
      onSnackbar(t('admin.reservations.messages.createSuccess', 'Reservation created successfully!'), 'success');
      handleClose();
    } catch (error: any) {
      const detail = error.response?.data?.errors?.join(', ')
        || error.response?.data?.message
        || 'Failed to create reservation';
      onSnackbar(detail, 'error');
    } finally {
      setCreateLoading(false);
    }
  };

  const typeLabel = (type: ReservationType) =>
    t(`admin.reservations.typeLabels.${type === 'PasaTarde' ? 'pasatarde' : type}`, type);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        {createStep === 0
          ? t('admin.reservations.actions.newReservation', 'New Reservation')
          : createStep === 1
          ? t('admin.reservations.create.step1Title', 'Dates & Guests')
          : createStep === 2
          ? t('admin.reservations.create.step2Title', 'Guest Details')
          : t('admin.reservations.create.step3Title', 'Summary')}
      </DialogTitle>

      {createStep > 0 && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Stepper activeStep={createStep - 1} alternativeLabel>
            <Step><StepLabel>{t('admin.reservations.create.stepDates', 'Dates & Guests')}</StepLabel></Step>
            <Step><StepLabel>{t('admin.reservations.create.stepGuest', 'Guest Info')}</StepLabel></Step>
            <Step><StepLabel>{t('admin.reservations.create.stepSummary', 'Summary')}</StepLabel></Step>
          </Stepper>
        </Box>
      )}

      <DialogContent sx={{ pt: 1 }}>

        {/* ── Step 0: Service type cards ── */}
        {createStep === 0 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('admin.reservations.create.pickServicePrompt', 'Select the type of reservation you want to create.')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
              {reservationServices.accommodation && (
                <Card variant="outlined" sx={{ borderRadius: 2, '&:hover': { borderColor: 'primary.main', boxShadow: 3 }, transition: 'box-shadow 0.2s' }}>
                  <CardActionArea onClick={() => { setCreateForm(f => ({ ...f, type: 'room' })); setCreateAvailableRooms([]); setCreateAvailabilityChecked(false); setCreateStep(1); }} sx={{ p: 2.5 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                      <Hotel sx={{ fontSize: 40, color: 'primary.main' }} />
                      <Typography variant="subtitle1" fontWeight={700}>{t('admin.reservations.typeLabels.room', 'Accommodation')}</Typography>
                      <Typography variant="caption" color="text.secondary" textAlign="center">{t('admin.reservations.create.roomDesc', 'Multi-night room stay')}</Typography>
                    </Box>
                  </CardActionArea>
                </Card>
              )}
              {reservationServices.daypass && (
                <Card variant="outlined" sx={{ borderRadius: 2, '&:hover': { borderColor: 'primary.main', boxShadow: 3 }, transition: 'box-shadow 0.2s' }}>
                  <CardActionArea onClick={() => { setCreateForm(f => ({ ...f, type: 'daypass', checkOutDate: '' })); setCreateStep(1); }} sx={{ p: 2.5 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                      <WbSunny sx={{ fontSize: 40, color: 'warning.main' }} />
                      <Typography variant="subtitle1" fontWeight={700}>{t('admin.reservations.typeLabels.daypass', 'Day Pass')}</Typography>
                      <Typography variant="caption" color="text.secondary" textAlign="center">{t('admin.reservations.create.daypassDesc', 'Full-day pool & facilities')}</Typography>
                    </Box>
                  </CardActionArea>
                </Card>
              )}
              {reservationServices.pasatarde && (
                <Card variant="outlined" sx={{ borderRadius: 2, '&:hover': { borderColor: 'primary.main', boxShadow: 3 }, transition: 'box-shadow 0.2s' }}>
                  <CardActionArea onClick={() => { setCreateForm(f => ({ ...f, type: 'PasaTarde', checkOutDate: '' })); setCreateStep(1); }} sx={{ p: 2.5 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                      <Celebration sx={{ fontSize: 40, color: 'secondary.main' }} />
                      <Typography variant="subtitle1" fontWeight={700}>{t('admin.reservations.typeLabels.pasatarde', 'Pasa Tarde')}</Typography>
                      <Typography variant="caption" color="text.secondary" textAlign="center">{t('admin.reservations.create.pasatardeDesc', 'Afternoon experience')}</Typography>
                    </Box>
                  </CardActionArea>
                </Card>
              )}
              {reservationServices.event && (
                <Card variant="outlined" sx={{ borderRadius: 2, '&:hover': { borderColor: 'primary.main', boxShadow: 3 }, transition: 'box-shadow 0.2s' }}>
                  <CardActionArea onClick={() => { setCreateForm(f => ({ ...f, type: 'event' })); setCreateStep(1); }} sx={{ p: 2.5 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                      <EventNote sx={{ fontSize: 40, color: 'info.main' }} />
                      <Typography variant="subtitle1" fontWeight={700}>{t('admin.reservations.typeLabels.event', 'Event')}</Typography>
                      <Typography variant="caption" color="text.secondary" textAlign="center">{t('admin.reservations.create.eventDesc', 'Private event or celebration')}</Typography>
                    </Box>
                  </CardActionArea>
                </Card>
              )}
            </Box>
          </Box>
        )}

        {/* ── Step 1: Dates & guests ── */}
        {createStep === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {createForm.type === 'room' && createAvailabilityChecked && (
              <Alert severity={createAvailableRooms.length > 0 ? 'success' : 'error'} sx={{ borderRadius: 2 }}>
                {createAvailableRooms.length > 0
                  ? t('admin.reservations.create.roomsAvailable', '{{count}} room(s) available for your selection.', { count: createAvailableRooms.length })
                  : t('admin.reservations.create.noRoomsAvailable', 'No rooms available for the selected dates and guest count. Try different dates or fewer guests.')}
              </Alert>
            )}

            {(createForm.type === 'room' || createForm.type === 'event') ? (
              <Box>
                <Typography variant="subtitle2" gutterBottom>{t('admin.reservations.create.selectDateRange', 'Select dates')}</Typography>
                <DateRangePicker
                  startDate={createForm.checkInDate}
                  endDate={createForm.checkOutDate}
                  onChange={(start, end) => { setCreateForm(f => ({ ...f, checkInDate: start, checkOutDate: end })); setCreateAvailabilityChecked(false); }}
                />
              </Box>
            ) : (
              <TextField
                fullWidth size="small" type="date"
                label={t('admin.reservations.form.checkIn', 'Date')}
                value={createForm.checkInDate}
                onChange={e => setCreateForm(f => ({ ...f, checkInDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                required
              />
            )}

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom>{t('admin.reservations.create.guestCount', 'Guests')}</Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <NumberField label={t('admin.reservations.form.adults', 'Adults')}    value={createForm.adults}   min={1} onChange={v => setCreateForm(f => ({ ...f, adults:   v ?? 1 }))} />
                <NumberField label={t('admin.reservations.form.children', 'Children')} value={createForm.children} min={0} onChange={v => setCreateForm(f => ({ ...f, children: v ?? 0 }))} />
                <NumberField label={t('admin.reservations.form.infants', 'Infants')}   value={createForm.infants}  min={0} onChange={v => setCreateForm(f => ({ ...f, infants: v ?? 0 }))} />
              </Box>
            </Box>

            {createForm.type === 'room' && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
                  <Typography variant="subtitle2">
                    {t('admin.reservations.create.assignRooms', 'Assign Rooms')}
                  </Typography>
                  {selectedRooms.length > 0 && (
                    <Typography variant="caption" color="primary.main" fontWeight={600}>
                      {selectedRooms.length} {t('admin.reservations.create.selected', 'selected')}
                      {' · '}
                      {t('admin.reservations.create.capacityOf', '{{cap}} guest capacity', { cap: selectedCapacity })}
                    </Typography>
                  )}
                </Box>

                {createCheckingAvailability && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={14} />
                    <Typography variant="caption" color="text.secondary">
                      {t('admin.reservations.create.checkingAvailability', 'Checking availability...')}
                    </Typography>
                  </Box>
                )}

                {!createCheckingAvailability && createAvailabilityChecked && createAvailableRooms.length === 0 && (
                  <Alert severity="error" sx={{ borderRadius: 1.5 }}>
                    {t('admin.reservations.create.noRoomsAvailable', 'No rooms available for the selected dates.')}
                  </Alert>
                )}

                {!createCheckingAvailability && createAvailabilityChecked && createAvailableRooms.length > 0 && (() => {
                  const query = roomSearch.trim().toLowerCase();
                  const filteredRooms = query
                    ? createAvailableRooms.filter((r: any) => {
                        const typeName: string = (r.roomTypeId as any)?.name ?? '';
                        return (
                          r.name?.toLowerCase().includes(query) ||
                          typeName.toLowerCase().includes(query) ||
                          r.bedConfiguration?.toLowerCase().includes(query)
                        );
                      })
                    : createAvailableRooms;

                  return (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {/* Search filter */}
                      <TextField
                        size="small" fullWidth
                        placeholder={t('admin.reservations.create.filterRooms', 'Filter rooms...')}
                        value={roomSearch}
                        onChange={e => setRoomSearch(e.target.value)}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <Search sx={{ fontSize: 18, color: 'text.disabled' }} />
                            </InputAdornment>
                          ),
                        }}
                      />

                      {/* Compact room list */}
                      <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
                        <Box sx={{ maxHeight: 240, overflowY: 'auto' }}>
                          {filteredRooms.length === 0 && (
                            <Box sx={{ p: 2, textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary">
                                {t('admin.reservations.create.noMatchingRooms', 'No matching rooms')}
                              </Typography>
                            </Box>
                          )}
                          {filteredRooms.map((room: any, idx: number) => {
                            const isSelected = selectedRooms.some(r => r._id === room._id);
                            const capacity = (room.roomTypeId as any)?.capacity ?? 1;
                            const typeName: string = (room.roomTypeId as any)?.name ?? '';
                            return (
                              <Box key={room._id}>
                                <Box
                                  onClick={() => toggleRoomSelection(room)}
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    px: 1,
                                    py: 0.5,
                                    cursor: 'pointer',
                                    bgcolor: isSelected ? 'primary.50' : 'transparent',
                                    '&:hover': { bgcolor: isSelected ? 'primary.100' : 'action.hover' },
                                    transition: 'background-color 0.1s',
                                    userSelect: 'none',
                                  }}
                                >
                                  <Checkbox
                                    size="small"
                                    checked={isSelected}
                                    tabIndex={-1}
                                    disableRipple
                                    sx={{ p: 0.5, mr: 0.5 }}
                                  />
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography
                                      variant="body2"
                                      fontWeight={isSelected ? 600 : 400}
                                      noWrap
                                    >
                                      {room.name}
                                    </Typography>
                                    {(typeName || room.bedConfiguration) && (
                                      <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.2 }}>
                                        {typeName}{room.bedConfiguration ? ` · ${room.bedConfiguration}` : ''}
                                      </Typography>
                                    )}
                                  </Box>
                                  <Tooltip title={t('admin.reservations.create.roomCapacity', 'Up to {{n}} guests', { n: capacity })}>
                                    <Chip
                                      size="small"
                                      icon={<KingBed sx={{ fontSize: '14px !important' }} />}
                                      label={capacity}
                                      variant={isSelected ? 'filled' : 'outlined'}
                                      color={isSelected ? 'primary' : 'default'}
                                      sx={{ height: 20, fontSize: 11, flexShrink: 0 }}
                                    />
                                  </Tooltip>
                                </Box>
                                {idx < filteredRooms.length - 1 && <Divider />}
                              </Box>
                            );
                          })}
                        </Box>
                      </Paper>

                      {/* Capacity gauge — only when rooms selected */}
                      {selectedRooms.length > 0 && (
                        <Box>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              {t('admin.reservations.create.capacityGauge', '{{accommodated}} of {{total}} guests accommodated', {
                                accommodated: Math.min(selectedCapacity, totalBillableGuests),
                                total: totalBillableGuests,
                              })}
                            </Typography>
                            {capacitySatisfied && (
                              <CheckCircle sx={{ fontSize: 14, color: 'success.main' }} />
                            )}
                          </Box>
                          <LinearProgress
                            variant="determinate"
                            value={Math.min((selectedCapacity / Math.max(totalBillableGuests, 1)) * 100, 100)}
                            color={capacitySatisfied ? 'success' : 'warning'}
                            sx={{ borderRadius: 1, height: 5 }}
                          />
                          {!capacitySatisfied && (
                            <Alert severity="warning" sx={{ mt: 0.75, borderRadius: 1.5, py: 0.25 }}>
                              {t('admin.reservations.create.insufficientCapacity', 'Selected rooms fit {{cap}} guests, but {{needed}} are needed.', {
                                cap: selectedCapacity,
                                needed: totalBillableGuests,
                              })}
                            </Alert>
                          )}
                        </Box>
                      )}

                      {/* Per-room price preview */}
                      {selectedRooms.length > 0 && (
                        <>
                          {createPriceLoading && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <CircularProgress size={14} />
                              <Typography variant="caption" color="text.secondary">
                                {t('admin.reservations.create.calculatingPrice', 'Calculating price...')}
                              </Typography>
                            </Box>
                          )}
                          {!createPriceLoading && createPricePreview?.perRoom && (
                            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                                {t('admin.reservations.create.pricePreview', 'Price Preview')}
                              </Typography>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                {createPricePreview.perRoom.map((pr: any, idx: number) => (
                                  <Box key={idx} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, pb: 0.75, mb: 0.25, borderBottom: idx < createPricePreview.perRoom.length - 1 ? 1 : 0, borderColor: 'divider' }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <Typography variant="body2" fontWeight={600}>{pr.roomName}</Typography>
                                      <Typography variant="body2" fontWeight={600}>{formatMoney(pr.finalTotal)}</Typography>
                                    </Box>
                                    <Typography variant="caption" color="text.secondary">
                                      {pr.roomTypeName}{pr.ratePlanName ? ` · ${pr.ratePlanName}` : ''}
                                    </Typography>
                                  </Box>
                                ))}
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 0.5, borderTop: 1, borderColor: 'divider' }}>
                                  <Typography variant="body2" fontWeight={700}>{t('admin.reservations.form.totalPrice', 'Total')}</Typography>
                                  <Typography variant="body2" fontWeight={700} color="primary.main">{formatMoney(createPricePreview.finalTotal)}</Typography>
                                </Box>
                              </Box>
                            </Paper>
                          )}
                        </>
                      )}
                    </Box>
                  );
                })()}
              </Box>
            )}

            {createForm.type !== 'room' && serviceOptions.length > 1 && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>{t('admin.reservations.create.selectService', 'Service')}</Typography>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('admin.reservations.create.selectService', 'Select service')}</InputLabel>
                  <Select
                    value={selectedServiceId}
                    label={t('admin.reservations.create.selectService', 'Select service')}
                    onChange={e => setSelectedServiceId(e.target.value)}
                  >
                    <MenuItem value=""><em>{t('admin.reservations.create.noService', 'None')}</em></MenuItem>
                    {serviceOptions.map(svc => (
                      <MenuItem key={svc._id} value={svc._id!}>{svc.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            )}

            {createForm.type !== 'room' && selectedServiceId && (
              <Box>
                {servicePriceLoading && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={14} />
                    <Typography variant="caption" color="text.secondary">{t('admin.reservations.create.calculatingPrice', 'Calculating price...')}</Typography>
                  </Box>
                )}
                {!servicePriceLoading && servicePricePreview && (
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      {t('admin.reservations.create.pricePreview', 'Price Preview')}
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="body2" color="text.secondary">{t('admin.reservations.create.basePrice', 'Base')}</Typography>
                        <Typography variant="body2">{formatMoney(servicePricePreview.baseSubtotal)}</Typography>
                      </Box>
                      {servicePricePreview.taxes?.filter((tx: any) => !tx.isInclusive).map((tx: any) => (
                        <Box key={tx.name} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">{tx.name}</Typography>
                          <Typography variant="body2">{formatMoney(tx.amount)}</Typography>
                        </Box>
                      ))}
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 0.5, mt: 0.25, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="body2" fontWeight={700}>{t('admin.reservations.form.totalPrice', 'Total')}</Typography>
                        <Typography variant="body2" fontWeight={700} color="primary.main">{formatMoney(servicePricePreview.finalTotal)}</Typography>
                      </Box>
                    </Box>
                  </Paper>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* ── Step 2: Guest info ── */}
        {createStep === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {createStep2Error && (
              <Alert severity="error" onClose={() => setCreateStep2Error(null)}>{createStep2Error}</Alert>
            )}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip size="small" label={typeLabel(createForm.type)} color="primary" variant="outlined" />
              {createForm.checkInDate  && <Chip size="small" label={createForm.checkInDate} variant="outlined" />}
              {createForm.checkOutDate && <Chip size="small" label={`→ ${createForm.checkOutDate}`} variant="outlined" />}
              <Chip size="small" label={`${createForm.adults}A ${createForm.children}C ${createForm.infants}I`} variant="outlined" />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField fullWidth size="small" label={t('admin.reservations.form.firstName', 'First Name')} value={createForm.firstName} onChange={e => setCreateForm(f => ({ ...f, firstName: e.target.value }))} required />
              <TextField fullWidth size="small" label={t('admin.reservations.form.lastName', 'Last Name')}   value={createForm.lastName}  onChange={e => setCreateForm(f => ({ ...f, lastName:  e.target.value }))} />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField fullWidth size="small" type="email" label={t('admin.reservations.form.email', 'Email')} value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} required />
              <TextField fullWidth size="small" label={t('admin.reservations.form.phone', 'Phone')} value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} />
            </Box>
            <TextField
              fullWidth size="small" type="number"
              label={t('admin.reservations.form.totalPrice', 'Total Price')}
              value={createForm.totalPrice}
              onChange={e => setCreateForm(f => ({ ...f, totalPrice: parseFloat(e.target.value) || 0 }))}
              inputProps={{ min: 0, step: 0.01 }}
            />
            <TextField
              fullWidth size="small" multiline rows={3}
              label={t('admin.reservations.form.specialRequests', 'Special Requests')}
              value={createForm.specialRequests}
              onChange={e => setCreateForm(f => ({ ...f, specialRequests: e.target.value }))}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={createIsCorporate}
                  onChange={e => {
                    setCreateIsCorporate(e.target.checked);
                    if (!e.target.checked) { setCreateCompanyId(''); setCreateCompanyName(''); }
                  }}
                />
              }
              label={t('admin.reservations.create.corporateBooking', 'Corporate Booking')}
            />
            {createIsCorporate && (
              <Autocomplete
                options={createCompanyOptions}
                getOptionLabel={(o: Company) => o.name}
                value={createCompanyOptions.find(c => c._id === createCompanyId) || null}
                onChange={(_, newVal: Company | null) => { setCreateCompanyId(newVal?._id || ''); setCreateCompanyName(newVal?.name || ''); }}
                onInputChange={(_, v) => setCreateCompanySearch(v)}
                renderInput={params => (
                  <TextField {...params} size="small" label={t('admin.reservations.create.company', 'Company')} required />
                )}
              />
            )}
          </Box>
        )}

        {/* ── Step 3: Summary ── */}
        {createStep === 3 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {createCorporatePriceApplied && (
              <Alert severity="success">
                {t('admin.reservations.create.corporatePriceApplied', 'A corporate rate has been applied for {{company}}.', { company: createCompanyName })}
              </Alert>
            )}
            {createGuestPriceApplied && (
              <Alert severity="info">
                {t('admin.reservations.create.guestPriceApplied', 'A special guest rate has been applied for {{email}}.', { email: createForm.email })}
              </Alert>
            )}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                {t('admin.reservations.create.summaryTitle', 'Reservation Summary')}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.type', 'Service')}</Typography>
                  <Typography variant="body2" fontWeight={600}>{typeLabel(createForm.type)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.dates', 'Dates')}</Typography>
                  <Typography variant="body2" fontWeight={600}>{createForm.checkInDate}{createForm.checkOutDate ? ` → ${createForm.checkOutDate}` : ''}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.guests', 'Guests')}</Typography>
                  <Typography variant="body2" fontWeight={600}>{createForm.adults} {t('admin.reservations.form.adults')}, {createForm.children} {t('admin.reservations.form.children')}, {createForm.infants} {t('admin.reservations.form.infants')}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">{t('admin.reservations.form.guest', 'Guest')}</Typography>
                  <Typography variant="body2" fontWeight={600}>{createForm.firstName} {createForm.lastName}</Typography>
                  {createForm.email && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{createForm.email}</Typography>}
                  {createForm.phone && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{createForm.phone}</Typography>}
                </Box>
                {createIsCorporate && createCompanyName && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">{t('admin.reservations.create.company', 'Company')}</Typography>
                    <Typography variant="body2" fontWeight={600}>{createCompanyName}</Typography>
                  </Box>
                )}
                {createForm.specialRequests && (
                  <Box sx={{ gridColumn: '1 / -1' }}>
                    <Typography variant="caption" color="text.secondary">{t('admin.reservations.form.specialRequests', 'Special Requests')}</Typography>
                    <Typography variant="body2">{createForm.specialRequests}</Typography>
                  </Box>
                )}

                {createPricePreview?.perRoom && createForm.type === 'room' ? (
                  <Box sx={{ gridColumn: '1 / -1', pt: 1.5, mt: 0.5, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      {t('admin.reservations.create.roomBreakdown', 'Room Breakdown')} · {createPricePreview.nights} {t('admin.reservations.create.nights', 'nights')}
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {createPricePreview.perRoom.map((pr: any, idx: number) => (
                        <Box key={idx} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, pb: 0.75, borderBottom: idx < createPricePreview.perRoom.length - 1 ? 1 : 0, borderColor: 'divider' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="body2" fontWeight={600}>{pr.roomName}</Typography>
                            <Typography variant="body2" fontWeight={600}>{formatMoney(pr.finalTotal)}</Typography>
                          </Box>
                          <Typography variant="caption" color="text.secondary">
                            {pr.roomTypeName}{pr.ratePlanName ? ` · ${pr.ratePlanName}` : ''}
                          </Typography>
                        </Box>
                      ))}
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 0.5, mt: 0.25, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="h6" fontWeight={700} color="primary.main">{t('admin.reservations.form.totalPrice', 'Total')}</Typography>
                        <Typography variant="h6" fontWeight={700} color="primary.main">{formatMoney(createPricePreview.finalTotal)}</Typography>
                      </Box>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ gridColumn: '1 / -1', pt: 1.5, mt: 0.5, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="h6" fontWeight={700} color="primary.main">
                      {t('admin.reservations.form.totalPrice', 'Total')}: {formatMoney(createForm.totalPrice)}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Paper>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={handleClose} disabled={createLoading}>{t('admin.reservations.actions.cancel')}</Button>

        {createStep > 0 && (
          <Button
            startIcon={<ArrowBack />}
            onClick={() => setCreateStep(s => Math.max(0, s - 1) as 0 | 1 | 2 | 3)}
            disabled={createLoading}
          >
            {t('common.back', 'Back')}
          </Button>
        )}

        <Box sx={{ flex: 1 }} />

        {createStep === 1 && (
          <Button
            variant="contained"
            endIcon={createCheckingAvailability ? <CircularProgress size={16} color="inherit" /> : <ArrowForward />}
            onClick={handleContinueStep1}
            disabled={!createForm.checkInDate || (createForm.type === 'room' && !createForm.checkOutDate) || createCheckingAvailability}
          >
            {t('common.continue', 'Continue')}
          </Button>
        )}

        {createStep === 2 && (
          <Button
            variant="contained"
            endIcon={<ArrowForward />}
            onClick={handleContinueStep2}
            disabled={!createForm.firstName.trim() || !createForm.email.trim()}
          >
            {t('common.continue', 'Continue')}
          </Button>
        )}

        {createStep === 3 && (
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={createLoading || !createForm.firstName.trim() || !createForm.email.trim() || !createForm.checkInDate}
          >
            {createLoading ? t('common.saving', 'Saving...') : t('admin.reservations.create.bookReservation', 'Book Reservation')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default CreateReservationDialog;
