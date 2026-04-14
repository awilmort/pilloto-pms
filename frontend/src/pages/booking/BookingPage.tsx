/**
 * BookingPage — the main public booking flow.
 *
 * Caribbean Teal (#0A7EA4) primary brand & Sunset Orange (#F06543) CTA accent.
 * Fully internationalized via react-i18next.
 *
 * The landing page (search step) features:
 * - A pill-shaped search bar with DateRangePicker + GuestSelector + Search button
 * - Room Type showcase cards in a responsive property grid
 * - An attractive amenities section
 *
 * Multi-step wizard:
 * 1. Search — date range + guest count (prominent search bar, room cards, amenities)
 * 2. Results — available room types in responsive grid + optional services
 * 3. Details — guest information form
 * 4. Verify — 4-digit email verification
 * 5. Review — summary + terms acceptance + confirm
 * 6. Confirmation — booking confirmed
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Container, Typography, TextField, Button, Paper, Grid, Card,
  CardContent, CardMedia, CardActions, Chip, Stepper, Step, StepLabel,
  CircularProgress, Alert, Divider, Stack, IconButton, FormControlLabel,
  Checkbox, Link, InputAdornment, useTheme, useMediaQuery, Skeleton,
  Tabs, Tab, MenuItem, Popover,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import ChildCareIcon from '@mui/icons-material/ChildCare';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EmailIcon from '@mui/icons-material/Email';
import VerifiedIcon from '@mui/icons-material/Verified';
import WifiIcon from '@mui/icons-material/Wifi';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import BalconyIcon from '@mui/icons-material/Balcony';
import HotTubIcon from '@mui/icons-material/HotTub';
import KitchenIcon from '@mui/icons-material/Kitchen';
import LocalBarIcon from '@mui/icons-material/LocalBar';
import LandscapeIcon from '@mui/icons-material/Landscape';
import StarIcon from '@mui/icons-material/Star';
import HotelIcon from '@mui/icons-material/Hotel';
import RoomServiceIcon from '@mui/icons-material/RoomService';
import { useTranslation } from 'react-i18next';
import { useBooking, BookingItem } from '../../contexts/BookingContext';
import { bookingService } from '../../services/api';
import { resolveMediaUrl } from '../../services/api';
import BookingLayout from '../../components/booking/BookingLayout';
import DateRangePicker from '../../components/booking/DateRangePicker';
import GuestSelector from '../../components/booking/GuestSelector';
import SingleDatePicker from '../../components/booking/SingleDatePicker';
import { RoomIllustration, AmenityIllustration, isIllustrationUrl, getIllustrationByKey, getIllustrationKey } from '../../components/illustrations';

// ── Design tokens ────────────────────────────────────────────────────────────
const ACCENT = '#F06543';         // Sunset Orange — CTA accent
const ACCENT_HOVER = '#C84E33';
const ACCENT_LIGHT = '#FFF0EC';
const BRAND  = '#0A7EA4';         // Caribbean Teal — primary brand
const BRAND_LIGHT = '#E6F4F9';
const TEXT_PRIMARY = '#222222';
const TEXT_SECONDARY = '#717171';
const SURFACE = '#F7F7F7';
const BORDER = '#EBEBEB';
const CARD_RADIUS = '12px';
const BTN_RADIUS = '8px';
const BTN_PILL = '9999px';
const FONT = '"Inter", "Plus Jakarta Sans", "Helvetica", sans-serif';
const TRANSITION = 'all 0.2s ease-out';

const FEATURE_ICONS: Record<string, React.ReactNode> = {
  wifi: <WifiIcon fontSize="small" />,
  airConditioning: <AcUnitIcon fontSize="small" />,
  miniBar: <LocalBarIcon fontSize="small" />,
  balcony: <BalconyIcon fontSize="small" />,
  oceanView: <LandscapeIcon fontSize="small" />,
  kitchenette: <KitchenIcon fontSize="small" />,
  jacuzzi: <HotTubIcon fontSize="small" />,
};

function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

// ── Skeleton loader for cards ────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <Card sx={{ borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
      <Skeleton variant="rectangular" height={200} animation="wave" />
      <CardContent>
        <Skeleton width="60%" height={28} />
        <Skeleton width="40%" height={20} sx={{ mt: 1 }} />
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Skeleton variant="rounded" width={60} height={24} />
          <Skeleton variant="rounded" width={60} height={24} />
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" justifyContent="space-between">
          <Skeleton width="30%" height={20} />
          <Skeleton width="25%" height={28} />
        </Stack>
      </CardContent>
    </Card>
  );
}

// ── Amenity Data ─────────────────────────────────────────────────────────────
interface AmenityData {
  _id: string;
  name: string;
  description: string;
  image: string;
  category: string;
  order: number;
}

// ── Charge basis label map (shared across steps) ─────────────────────────────
const chargeBasisLabelMap: Record<string, string> = {
  perPerson: 'Por persona',
  perRoom: 'Por habitación',
  perStay: 'Por estadía',
  perEvent: 'Por evento',
};

// ── Room Type Data for showcase ──────────────────────────────────────────────
interface RoomTypeShowcase {
  _id: string;
  name: string;
  capacity: number;
  image: string;
}

// ── Step 1: Search ───────────────────────────────────────────────────────────
function SearchStep() {
  const { config, searchAvailability, searchParams, availabilityLoading, availability, setPreselectedRoomTypeId, addItem, setCurrentStep, setPrevStep } = useBooking();
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isMd = useMediaQuery(theme.breakpoints.down('md'));
  const [checkIn, setCheckIn] = useState(searchParams?.checkIn || '');
  const [checkOut, setCheckOut] = useState(searchParams?.checkOut || '');
  const [adults, setAdults] = useState(searchParams?.adults || 2);
  const [children, setChildren] = useState(searchParams?.children || 0);
  const [error, setError] = useState('');
  const [amenities, setAmenities] = useState<AmenityData[]>([]);
  const [amenitiesLoading, setAmenitiesLoading] = useState(true);
  const [roomTypes, setRoomTypes] = useState<RoomTypeShowcase[]>([]);
  const [roomTypesLoading, setRoomTypesLoading] = useState(true);
  const [reviews, setReviews] = useState<Array<{ _id: string; guestName: string; rating: number; comment: string; source: string }>>([]);

  // ── Services tab state ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'rooms' | 'services'>('rooms');
  const [svcList, setSvcList] = useState<ServiceData[]>([]);
  const [selectedSvcId, setSelectedSvcId] = useState('');
  const [svcDate, setSvcDate] = useState('');
  const [svcCheckIn, setSvcCheckIn] = useState('');
  const [svcCheckOut, setSvcCheckOut] = useState('');
  const [svcAdults, setSvcAdults] = useState(2);
  const [svcChildren, setSvcChildren] = useState(0);
  const [svcResult, setSvcResult] = useState<(ServiceData & { quotedPrice?: number; quotedTaxes?: number }) | null>(null);
  const [svcSearchLoading, setSvcSearchLoading] = useState(false);
  const [svcError, setSvcError] = useState('');
  const [svcSelectorOpen, setSvcSelectorOpen] = useState(false);
  const svcSelectorRef = useRef<HTMLDivElement>(null);

  const selectedSvc = svcList.find(s => s._id === selectedSvcId) || null;
  const isSingleDate = selectedSvc?.reservationMode === 'singleDate';

  const minDate = new Date(Date.now() + (config?.minAdvanceHours || 24) * 3600000);
  const maxDate = new Date(Date.now() + (config?.maxAdvanceDays || 365) * 86400000);

  // Load amenities, room types, reviews, and non-addon services on mount
  useEffect(() => {
    bookingService.getAmenities()
      .then(res => setAmenities(res.data?.data || []))
      .catch(() => {})
      .finally(() => setAmenitiesLoading(false));
    bookingService.getRoomTypes()
      .then(res => setRoomTypes(res.data?.data || []))
      .catch(() => {})
      .finally(() => setRoomTypesLoading(false));
    bookingService.getReviews()
      .then(res => setReviews(res.data?.data || []))
      .catch(() => {});
    bookingService.getServices()
      .then(res => {
        const all = res.data?.data || [];
        setSvcList(all.filter(s => s.kind !== 'roomAddon'));
      })
      .catch(() => {});
  }, []);

  const handleSearch = async () => {
    setError('');
    if (!checkIn || !checkOut) {
      setError(t('bookingEngine.search.errorSelectDates'));
      return;
    }
    if (new Date(checkOut) <= new Date(checkIn)) {
      setError(t('bookingEngine.search.errorCheckoutAfter'));
      return;
    }
    try {
      await searchAvailability({ checkIn, checkOut, adults, children });
    } catch (err: any) {
      setError(err?.response?.data?.message || t('bookingEngine.search.errorSearchFailed'));
    }
  };

  /** Click a room type card to start booking with default dates */
  const handleRoomTypeClick = async (roomType: RoomTypeShowcase) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

    const ci = tomorrow.toISOString().split('T')[0];
    const co = dayAfterTomorrow.toISOString().split('T')[0];

    setCheckIn(ci);
    setCheckOut(co);
    setAdults(2);
    setChildren(0);
    setError('');
    setPreselectedRoomTypeId(roomType._id);

    try {
      await searchAvailability({ checkIn: ci, checkOut: co, adults: 2, children: 0 });
    } catch (err: any) {
      setError(err?.response?.data?.message || t('bookingEngine.search.errorSearchFailed'));
    }
  };

  /** Services tab: search and quote the selected service */
  const handleServiceSearch = async () => {
    setSvcError('');
    setSvcResult(null);
    if (!selectedSvcId) {
      setSvcError(t('bookingEngine.search.errorChooseService', 'Please choose a service.'));
      return;
    }
    if (isSingleDate && !svcDate) {
      setSvcError(t('bookingEngine.search.errorSelectDate', 'Please select a date.'));
      return;
    }
    if (!isSingleDate && (!svcCheckIn || !svcCheckOut)) {
      setSvcError(t('bookingEngine.search.errorSelectDates'));
      return;
    }
    setSvcSearchLoading(true);
    try {
      const dateParam = isSingleDate ? svcDate : svcCheckIn;
      const res = await bookingService.getServiceQuote({
        serviceId: selectedSvcId,
        date: dateParam,
        adults: svcAdults,
        children: svcChildren,
      });
      const quote = res.data?.data;
      if (quote) {
        setSvcResult({
          ...selectedSvc!,
          quotedPrice: quote.finalTotal,
          quotedTaxes: quote.totalTaxes ?? 0,
        });
      }
    } catch {
      setSvcError(t('bookingEngine.search.errorSearchFailed'));
    } finally {
      setSvcSearchLoading(false);
    }
  };

  /** Services tab: add the quoted service to cart and go to details */
  const handleAddServiceFromTab = () => {
    if (!svcResult?.quotedPrice) return;
    const dateParam = isSingleDate ? svcDate : svcCheckIn;
    addItem({
      kind: 'service',
      serviceId: svcResult._id,
      serviceName: svcResult.name,
      date: dateParam,
      adults: svcAdults,
      children: svcChildren,
      quantity: 1,
      pricing: {
        subtotal: svcResult.quotedPrice - (svcResult.quotedTaxes ?? 0),
        taxes: svcResult.quotedTaxes ?? 0,
        total: svcResult.quotedPrice,
      },
    });
    setPrevStep('search');
    setCurrentStep('details');
  };

  return (
    <Box sx={{ pb: 8 }}>
      {/* ── Rooms / Services tab bar + search forms ── */}
      <Box sx={{ bgcolor: 'white', borderBottom: `1px solid ${BORDER}` }}>
        <Container maxWidth="md">
          {/* Tab bar */}
          <Tabs
            value={activeTab}
            onChange={(_, v) => { setActiveTab(v); setSvcResult(null); }}
            centered
            TabIndicatorProps={{ style: { backgroundColor: ACCENT } }}
            sx={{ borderBottom: `1px solid ${BORDER}` }}
          >
            <Tab
              icon={<HotelIcon fontSize="small" />}
              iconPosition="start"
              label={t('bookingEngine.search.tabRooms', 'Habitaciones')}
              value="rooms"
              sx={{ fontFamily: FONT, fontWeight: 600, textTransform: 'none', minHeight: 52 }}
            />
            <Tab
              icon={<RoomServiceIcon fontSize="small" />}
              iconPosition="start"
              label={t('bookingEngine.search.tabServices', 'Servicios')}
              value="services"
              sx={{ fontFamily: FONT, fontWeight: 600, textTransform: 'none', minHeight: 52 }}
            />
          </Tabs>

          <Box sx={{ py: { xs: 3, md: 4 } }}>
            {/* ── ROOMS TAB ── */}
            {activeTab === 'rooms' && (
              <>
                <Paper
                  elevation={0}
                  sx={{
                    display: 'flex',
                    alignItems: isMd ? 'stretch' : 'center',
                    justifyContent: 'space-between',
                    flexDirection: isMd ? 'column' : 'row',
                    gap: isMd ? 2 : 1.5,
                    p: isMd ? 2.5 : 1,
                    pl: isMd ? 2.5 : 2,
                    borderRadius: isMd ? CARD_RADIUS : BTN_PILL,
                    border: `1px solid ${BORDER}`,
                    boxShadow: '0 3px 12px rgba(0,0,0,0.08)',
                    bgcolor: 'white',
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <DateRangePicker
                      checkIn={checkIn}
                      checkOut={checkOut}
                      onChange={(ci, co) => { setCheckIn(ci); setCheckOut(co); }}
                      minDate={minDate}
                      maxDate={maxDate}
                    />
                  </Box>

                  {!isMd && <Divider orientation="vertical" flexItem sx={{ borderColor: BORDER }} />}

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <GuestSelector
                      adults={adults}
                      children={children}
                      onChange={(a, c) => { setAdults(a); setChildren(c); }}
                    />
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Button
                      variant="contained"
                      onClick={handleSearch}
                      disabled={availabilityLoading}
                      fullWidth
                      startIcon={availabilityLoading ? <CircularProgress size={18} sx={{ color: 'white' }} /> : <SearchIcon />}
                      sx={{
                        bgcolor: ACCENT,
                        '&:hover': { bgcolor: ACCENT_HOVER },
                        height: 48,
                        textTransform: 'none',
                        fontWeight: 600,
                        fontFamily: FONT,
                        borderRadius: BTN_PILL,
                        boxShadow: 'none',
                        fontSize: '0.95rem',
                        transition: TRANSITION,
                      }}
                    >
                      {t('bookingEngine.search.search')}
                    </Button>
                  </Box>
                </Paper>
                {error && <Alert severity="error" sx={{ mt: 2, borderRadius: BTN_RADIUS }}>{error}</Alert>}
              </>
            )}

            {/* ── SERVICES TAB ── */}
            {activeTab === 'services' && (
              <>
                <Paper
                  elevation={0}
                  sx={{
                    display: 'flex',
                    flexDirection: isMd ? 'column' : 'row',
                    alignItems: isMd ? 'stretch' : 'center',
                    gap: isMd ? 2 : 1.5,
                    p: isMd ? 2.5 : 1.5,
                    borderRadius: isMd ? CARD_RADIUS : BTN_PILL,
                    border: `1px solid ${BORDER}`,
                    boxShadow: '0 3px 12px rgba(0,0,0,0.08)',
                    bgcolor: 'white',
                  }}
                >
                  {/* Choose Service — pill-styled custom selector */}
                  <Box sx={{ flex: 1.2, minWidth: 0 }}>
                    <Box
                      ref={svcSelectorRef}
                      onClick={() => setSvcSelectorOpen(true)}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 44,
                        px: 2,
                        borderRadius: '9999px',
                        border: `1px solid ${svcSelectorOpen ? ACCENT : BORDER}`,
                        cursor: 'pointer',
                        fontFamily: FONT,
                        fontSize: '0.875rem',
                        color: selectedSvc ? TEXT_PRIMARY : TEXT_SECONDARY,
                        fontWeight: selectedSvc ? 500 : 400,
                        bgcolor: 'white',
                        transition: 'all 0.2s ease-out',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        '&:hover': { borderColor: TEXT_PRIMARY },
                      }}
                    >
                      {selectedSvc?.name || t('bookingEngine.search.chooseService', 'Elige un servicio')}
                    </Box>
                    <Popover
                      open={svcSelectorOpen}
                      anchorEl={svcSelectorRef.current}
                      onClose={() => setSvcSelectorOpen(false)}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                      PaperProps={{
                        sx: {
                          borderRadius: '12px',
                          boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
                          mt: 1,
                          minWidth: 240,
                          py: 1,
                        },
                      }}
                    >
                      {svcList.length === 0 ? (
                        <Box sx={{ px: 2, py: 1.5, color: TEXT_SECONDARY, fontFamily: FONT, fontSize: '0.875rem' }}>
                          {t('bookingEngine.search.noServices', 'No hay servicios disponibles')}
                        </Box>
                      ) : svcList.map(svc => (
                        <Box
                          key={svc._id}
                          onClick={() => { setSelectedSvcId(svc._id); setSvcResult(null); setSvcSelectorOpen(false); }}
                          sx={{
                            px: 2,
                            py: 1.25,
                            cursor: 'pointer',
                            fontFamily: FONT,
                            fontSize: '0.9rem',
                            color: svc._id === selectedSvcId ? ACCENT : TEXT_PRIMARY,
                            fontWeight: svc._id === selectedSvcId ? 600 : 400,
                            bgcolor: svc._id === selectedSvcId ? 'rgba(240,101,67,0.06)' : 'transparent',
                            '&:hover': { bgcolor: 'rgba(240,101,67,0.08)' },
                            transition: 'background-color 0.15s',
                          }}
                        >
                          {svc.name}
                        </Box>
                      ))}
                    </Popover>
                  </Box>

                  {!isMd && <Divider orientation="vertical" flexItem sx={{ borderColor: BORDER }} />}

                  {/* Dynamic date picker */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {isSingleDate ? (
                      <SingleDatePicker
                        date={svcDate}
                        onChange={setSvcDate}
                        minDate={minDate}
                        maxDate={maxDate}
                        placeholder={t('bookingEngine.search.serviceDate', 'Fecha')}
                      />
                    ) : (
                      <DateRangePicker
                        checkIn={svcCheckIn}
                        checkOut={svcCheckOut}
                        onChange={(ci, co) => { setSvcCheckIn(ci); setSvcCheckOut(co); }}
                        minDate={minDate}
                        maxDate={maxDate}
                      />
                    )}
                  </Box>

                  {!isMd && <Divider orientation="vertical" flexItem sx={{ borderColor: BORDER }} />}

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <GuestSelector
                      adults={svcAdults}
                      children={svcChildren}
                      onChange={(a, c) => { setSvcAdults(a); setSvcChildren(c); }}
                    />
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Button
                      variant="contained"
                      onClick={handleServiceSearch}
                      disabled={svcSearchLoading}
                      fullWidth
                      startIcon={svcSearchLoading ? <CircularProgress size={18} sx={{ color: 'white' }} /> : <SearchIcon />}
                      sx={{
                        bgcolor: ACCENT,
                        '&:hover': { bgcolor: ACCENT_HOVER },
                        height: 48,
                        textTransform: 'none',
                        fontWeight: 600,
                        fontFamily: FONT,
                        borderRadius: BTN_PILL,
                        boxShadow: 'none',
                        fontSize: '0.95rem',
                        transition: TRANSITION,
                      }}
                    >
                      {t('bookingEngine.search.search')}
                    </Button>
                  </Box>
                </Paper>

                {svcError && <Alert severity="error" sx={{ mt: 2, borderRadius: BTN_RADIUS }}>{svcError}</Alert>}

                {/* Service quote result card */}
                {svcResult && (
                  <Box sx={{ mt: 4, maxWidth: 420, mx: 'auto' }}>
                    <Card
                      elevation={0}
                      sx={{
                        borderRadius: CARD_RADIUS,
                        border: `1px solid ${BORDER}`,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                      }}
                    >
                      <CardContent>
                        <Typography variant="h6" sx={{ fontWeight: 700, fontFamily: FONT }}>{svcResult.name}</Typography>
                        <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 1.5 }}>
                          {chargeBasisLabelMap[svcResult.chargeBasis] || svcResult.chargeBasis}
                        </Typography>
                        {/* Unit price */}
                        {svcResult.basePrice != null && (
                          <Stack direction="row" alignItems="baseline" spacing={0.5} sx={{ mb: 0.5 }}>
                            <Typography sx={{ fontWeight: 700, color: TEXT_PRIMARY, fontFamily: FONT, fontSize: '1.2rem' }}>
                              {formatCurrency(svcResult.basePrice, config?.currency || 'USD')}
                            </Typography>
                            <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>
                              / {chargeBasisLabelMap[svcResult.chargeBasis] || svcResult.chargeBasis}
                            </Typography>
                          </Stack>
                        )}
                        {/* Quoted total */}
                        <Stack direction="row" alignItems="baseline" spacing={1}>
                          <Typography sx={{ fontWeight: 700, color: ACCENT, fontFamily: FONT, fontSize: '1.4rem' }}>
                            {formatCurrency(svcResult.quotedPrice!, config?.currency || 'USD')}
                          </Typography>
                          {svcResult.basePrice != null && (
                            <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>
                              {t('bookingEngine.search.totalEstimate', 'total estimado')}
                            </Typography>
                          )}
                        </Stack>
                        {(svcResult.quotedTaxes ?? 0) > 0 && (
                          <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>
                            {t('bookingEngine.results.taxes', { amount: formatCurrency(svcResult.quotedTaxes!, config?.currency || 'USD') })}
                          </Typography>
                        )}
                      </CardContent>
                      <CardActions sx={{ px: 2, pb: 2 }}>
                        <Button
                          variant="contained"
                          fullWidth
                          onClick={handleAddServiceFromTab}
                          sx={{
                            bgcolor: ACCENT,
                            '&:hover': { bgcolor: ACCENT_HOVER },
                            textTransform: 'none',
                            fontWeight: 600,
                            fontFamily: FONT,
                            borderRadius: BTN_RADIUS,
                            boxShadow: 'none',
                          }}
                        >
                          {t('bookingEngine.search.bookService', 'Reservar este servicio')}
                        </Button>
                      </CardActions>
                    </Card>
                  </Box>
                )}
              </>
            )}
          </Box>
        </Container>
      </Box>

      {/* ── Room Type Showcase (all room types, always visible) ── */}
      {activeTab === 'rooms' && roomTypes.length > 0 && !availability.length && (
        <Container maxWidth="lg" sx={{ mt: 6 }}>
          <Typography
            variant="h5"
            sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5, textAlign: 'center' }}
          >
            {t('bookingEngine.roomTypes.heading', 'Our Rooms')}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 4, textAlign: 'center' }}
          >
            {t('bookingEngine.roomTypes.subtitle', 'Discover our rooms and start your stay')}
          </Typography>

          <Grid container spacing={3} justifyContent="center">
            {roomTypes.map(rt => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={rt._id}>
                <Card
                  elevation={0}
                  onClick={() => handleRoomTypeClick(rt)}
                  sx={{
                    borderRadius: CARD_RADIUS,
                    border: `1px solid ${BORDER}`,
                    overflow: 'hidden',
                    transition: TRANSITION,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: 'pointer',
                    '&:hover': {
                      boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                      transform: 'translateY(-2px)',
                      borderColor: BRAND,
                    },
                  }}
                >
                  {rt.image && isIllustrationUrl(rt.image) ? (() => {
                    const Illus = getIllustrationByKey(getIllustrationKey(rt.image));
                    return (
                      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 180, bgcolor: '#F9FAFB' }}>
                        <Illus width={260} height={160} />
                      </Box>
                    );
                  })() : rt.image ? (
                    <CardMedia
                      component="img"
                      height={180}
                      image={resolveMediaUrl(rt.image)}
                      alt={rt.name}
                      sx={{ objectFit: 'cover' }}
                    />
                  ) : (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 180, bgcolor: '#F0F7FA' }}>
                      <RoomIllustration width={260} height={160} />
                    </Box>
                  )}
                  <CardContent sx={{ p: 2, flex: 1, textAlign: 'center' }}>
                    <Typography
                      variant="subtitle1"
                      sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}
                    >
                      {rt.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 1.5 }}>
                      {t('bookingEngine.results.upToGuests', { count: rt.capacity })}
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={availabilityLoading}
                      sx={{
                        bgcolor: ACCENT,
                        '&:hover': { bgcolor: ACCENT_HOVER },
                        textTransform: 'none',
                        fontWeight: 600,
                        fontFamily: FONT,
                        borderRadius: BTN_PILL,
                        boxShadow: 'none',
                        px: 3,
                        transition: TRANSITION,
                      }}
                    >
                      {availabilityLoading ? <CircularProgress size={16} sx={{ color: 'white' }} /> : t('bookingEngine.roomTypes.bookNow', 'Book Now')}
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      )}

      {/* Skeleton loading for room types */}
      {activeTab === 'rooms' && roomTypesLoading && (
        <Container maxWidth="lg" sx={{ mt: 6 }}>
          <Skeleton width={200} height={32} sx={{ mb: 1, mx: 'auto' }} />
          <Skeleton width={300} height={20} sx={{ mb: 4, mx: 'auto' }} />
          <Grid container spacing={3} justifyContent="center">
            {[1, 2, 3].map(i => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={i}>
                <Skeleton variant="rounded" height={280} sx={{ borderRadius: CARD_RADIUS }} animation="wave" />
              </Grid>
            ))}
          </Grid>
        </Container>
      )}

      {/* ── Service Showcase (Services tab, no active result) ── */}
      {activeTab === 'services' && svcList.length > 0 && !svcResult && (
        <Container maxWidth="lg" sx={{ mt: 6 }}>
          <Typography
            variant="h5"
            sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5, textAlign: 'center' }}
          >
            {t('bookingEngine.services.heading', 'Nuestros Servicios')}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 4, textAlign: 'center' }}
          >
            {t('bookingEngine.services.subtitle', 'Elige un servicio y consulta disponibilidad')}
          </Typography>
          <Grid container spacing={3} justifyContent="center">
            {svcList.map(svc => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={svc._id}>
                <Card
                  elevation={0}
                  onClick={() => { setSelectedSvcId(svc._id); setSvcResult(null); }}
                  sx={{
                    borderRadius: CARD_RADIUS,
                    border: `1px solid ${selectedSvcId === svc._id ? ACCENT : BORDER}`,
                    overflow: 'hidden',
                    transition: TRANSITION,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: 'pointer',
                    '&:hover': {
                      boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                      transform: 'translateY(-2px)',
                      borderColor: ACCENT,
                    },
                  }}
                >
                  <Box sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: 140,
                    bgcolor: '#FFF5F2',
                  }}>
                    <RoomServiceIcon sx={{ fontSize: 56, color: ACCENT, opacity: 0.8 }} />
                  </Box>
                  <CardContent sx={{ p: 2, flex: 1, textAlign: 'center' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}>
                      {svc.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 1 }}>
                      {chargeBasisLabelMap[svc.chargeBasis] || svc.chargeBasis}
                    </Typography>
                    {svc.basePrice != null && (
                      <Typography sx={{ fontWeight: 700, color: ACCENT, fontFamily: FONT, fontSize: '1.1rem', mb: 1.5 }}>
                        {formatCurrency(svc.basePrice, config?.currency || 'USD')}
                      </Typography>
                    )}
                    <Button
                      variant={selectedSvcId === svc._id ? 'contained' : 'outlined'}
                      size="small"
                      sx={{
                        bgcolor: selectedSvcId === svc._id ? ACCENT : 'transparent',
                        borderColor: ACCENT,
                        color: selectedSvcId === svc._id ? 'white' : ACCENT,
                        '&:hover': { bgcolor: ACCENT_HOVER, color: 'white', borderColor: ACCENT_HOVER },
                        textTransform: 'none',
                        fontWeight: 600,
                        fontFamily: FONT,
                        borderRadius: BTN_PILL,
                        boxShadow: 'none',
                        px: 3,
                        transition: TRANSITION,
                      }}
                    >
                      {selectedSvcId === svc._id
                        ? t('bookingEngine.services.selected', 'Seleccionado')
                        : t('bookingEngine.services.select', 'Seleccionar')}
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      )}

      {/* ── Room Type Showcase Cards (after search) ── */}
      {activeTab === 'rooms' && availability.length > 0 && (
        <Container maxWidth="lg" sx={{ mt: 5 }}>
          <Typography
            variant="h5"
            sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}
          >
            {t('bookingEngine.results.roomTypesAvailable', { count: availability.length })}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 3 }}
          >
            {t('bookingEngine.search.heroSubtitleDefault')}
          </Typography>

          <Grid container spacing={3}>
            {availability.map(room => (
              <Grid item xs={12} sm={6} lg={3} key={room.roomType._id}>
                <RoomShowcaseCard room={room} />
              </Grid>
            ))}
          </Grid>
        </Container>
      )}

      {/* ── Amenities Section ── */}
      {activeTab === 'rooms' && amenities.length > 0 && (
        <Container maxWidth="lg" sx={{ mt: 8 }}>
          <Typography
            variant="h5"
            sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}
          >
            {t('bookingEngine.amenities.heading')}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 4 }}
          >
            {t('bookingEngine.amenities.subtitle')}
          </Typography>

          <Grid container spacing={3}>
            {amenities.map(amenity => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={amenity._id}>
                <Card
                  elevation={0}
                  sx={{
                    borderRadius: CARD_RADIUS,
                    border: `1px solid ${BORDER}`,
                    overflow: 'hidden',
                    transition: TRANSITION,
                    height: '100%',
                    '&:hover': {
                      boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                      transform: 'translateY(-2px)',
                    },
                  }}
                >
                  {amenity.image ? (
                    isIllustrationUrl(amenity.image) ? (() => {
                      const Illus = getIllustrationByKey(getIllustrationKey(amenity.image));
                      return (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160, bgcolor: '#F9FAFB' }}>
                          <Illus width={240} height={140} />
                        </Box>
                      );
                    })() : (
                      <CardMedia
                        component="img"
                        height={160}
                        image={resolveMediaUrl(amenity.image)}
                        alt={amenity.name}
                        sx={{ objectFit: 'cover' }}
                      />
                    )
                  ) : (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160, bgcolor: '#F0F7FA' }}>
                      <AmenityIllustration width={240} height={140} />
                    </Box>
                  )}
                  <CardContent sx={{ p: 2 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}
                    >
                      {amenity.name}
                    </Typography>
                    {amenity.description && (
                      <Typography
                        variant="body2"
                        sx={{
                          color: TEXT_SECONDARY,
                          fontFamily: FONT,
                          fontSize: '0.8rem',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {amenity.description}
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      )}

      {/* Skeleton loading for amenities */}
      {activeTab === 'rooms' && amenitiesLoading && (
        <Container maxWidth="lg" sx={{ mt: 8 }}>
          <Skeleton width={200} height={32} sx={{ mb: 1 }} />
          <Skeleton width={300} height={20} sx={{ mb: 4 }} />
          <Grid container spacing={3}>
            {[1, 2, 3, 4].map(i => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={i}>
                <Skeleton variant="rounded" height={220} sx={{ borderRadius: CARD_RADIUS }} animation="wave" />
              </Grid>
            ))}
          </Grid>
        </Container>
      )}

      {/* ── Trust & Credibility Bar ── */}
      {activeTab === 'rooms' && reviews.length > 0 && (
        <Box sx={{ bgcolor: SURFACE, py: 6, mt: 8, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
          <Container maxWidth="lg">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5, justifyContent: 'center' }}>
              <StarIcon sx={{ color: '#FBBF24', fontSize: 28 }} />
              <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: FONT, color: TEXT_PRIMARY }}>
                {t('bookingEngine.reviews.heading', 'What Our Guests Say')}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 4, textAlign: 'center' }}>
              {t('bookingEngine.reviews.subtitle', 'Real reviews from verified guests')}
            </Typography>

            <Grid container spacing={3} justifyContent="center">
              {reviews.slice(0, 6).map(review => (
                <Grid item xs={12} sm={6} md={4} key={review._id}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 3,
                      borderRadius: CARD_RADIUS,
                      border: `1px solid ${BORDER}`,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: TRANSITION,
                      '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.08)' },
                    }}
                  >
                    <Stack direction="row" spacing={0.5} sx={{ mb: 1.5 }}>
                      {[1, 2, 3, 4, 5].map(star => (
                        <StarIcon
                          key={star}
                          sx={{
                            fontSize: 18,
                            color: star <= review.rating ? '#FBBF24' : '#E5E7EB',
                          }}
                        />
                      ))}
                    </Stack>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: FONT,
                        color: TEXT_PRIMARY,
                        flex: 1,
                        display: '-webkit-box',
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        lineHeight: 1.6,
                        fontStyle: 'italic',
                        mb: 2,
                      }}
                    >
                      &ldquo;{review.comment}&rdquo;
                    </Typography>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY }}>
                        {review.guestName}
                      </Typography>
                      {review.source && review.source !== 'Direct' && (
                        <Chip
                          label={review.source}
                          size="small"
                          variant="outlined"
                          sx={{ borderRadius: BTN_PILL, fontFamily: FONT, fontSize: '0.7rem', borderColor: BORDER }}
                        />
                      )}
                    </Stack>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Container>
        </Box>
      )}
    </Box>
  );
}

// ── Room Showcase Card ───────────────────────────────────────────────────────
function RoomShowcaseCard({ room }: { room: any }) {
  const { config } = useBooking();
  const { t } = useTranslation();
  const currency = config?.currency || 'USD';

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: CARD_RADIUS,
        border: `1px solid ${BORDER}`,
        transition: TRANSITION,
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
          transform: 'translateY(-2px)',
        },
      }}
    >
      {(() => {
        const rtImage = room.roomType?.image;
        if (rtImage && isIllustrationUrl(rtImage)) {
          const Illus = getIllustrationByKey(getIllustrationKey(rtImage));
          return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200, bgcolor: '#F9FAFB' }}>
              <Illus width={300} height={180} />
            </Box>
          );
        }
        if (rtImage) {
          return (
            <CardMedia
              component="img"
              height={200}
              image={resolveMediaUrl(rtImage)}
              alt={room.roomType.name}
              sx={{ objectFit: 'cover' }}
            />
          );
        }
        return (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200, bgcolor: '#F0F7FA' }}>
            <RoomIllustration width={300} height={180} />
          </Box>
        );
      })()}
      <CardContent sx={{ p: 2, flex: 1 }}>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, lineHeight: 1.3, mb: 0.5 }}
        >
          {room.roomType.name}
        </Typography>
        <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 1.5 }}>
          {t('bookingEngine.results.upToGuests', { count: room.roomType.capacity })} · {room.bedConfiguration || 'Standard'}
        </Typography>

        {/* Features */}
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          {Object.entries(room.features || {})
            .filter(([, v]) => v)
            .slice(0, 4)
            .map(([key]) => (
              <Chip
                key={key}
                icon={FEATURE_ICONS[key] as React.ReactElement || undefined}
                label={t(`bookingEngine.features.${key}`, key)}
                size="small"
                variant="outlined"
                sx={{ fontSize: '0.7rem', borderRadius: BTN_PILL, fontFamily: FONT, borderColor: BORDER }}
              />
            ))}
        </Stack>

        <Divider sx={{ borderColor: BORDER }} />

        {/* Pricing */}
        <Box sx={{ mt: 1.5 }}>
          <Typography sx={{ fontWeight: 700, fontFamily: FONT, color: TEXT_PRIMARY, fontSize: '1.1rem' }}>
            {formatCurrency(room.pricing.perNight, currency)}
            <Typography component="span" sx={{ fontWeight: 400, color: TEXT_SECONDARY, fontSize: '0.85rem' }}>
              {' '}{t('bookingEngine.results.perNight')}
            </Typography>
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

// ── Step 2: Results ──────────────────────────────────────────────────────────
interface ServiceData {
  _id: string;
  name: string;
  code: string;
  kind: string;
  chargeBasis: string;
  reservationMode?: 'dateRange' | 'singleDate';
  basePrice?: number | null;
}

function ResultsStep() {
  const { config, availability, availabilityLoading, searchParams, addItem, removeItem, items, setCurrentStep, preselectedRoomTypeId, setPreselectedRoomTypeId } = useBooking();
  const { t } = useTranslation();
  const currency = config?.currency || 'USD';

  const [services, setServices] = useState<ServiceData[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [serviceQty, setServiceQty] = useState<Record<string, number>>({});

  const nights = searchParams
    ? Math.max(1, Math.ceil(
        (new Date(searchParams.checkOut).getTime() - new Date(searchParams.checkIn).getTime()) / 86400000
      ))
    : 1;

  const roomItemCount = items.filter(i => i.kind === 'room').length;
  const hasRoomSelected = roomItemCount > 0;
  const totalGuests = (searchParams?.adults || 0) + (searchParams?.children || 0);
  const addonServices = services.filter(s => s.kind === 'roomAddon');

  useEffect(() => {
    setServicesLoading(true);
    bookingService.getServices()
      .then(res => setServices(res.data?.data || []))
      .catch(() => {})
      .finally(() => setServicesLoading(false));
  }, []);

  // Auto-select the room type that was clicked from the showcase.
  // Consume the id immediately to prevent double-fire from React re-renders.
  useEffect(() => {
    if (!preselectedRoomTypeId || availability.length === 0) return;
    const idToSelect = preselectedRoomTypeId;
    setPreselectedRoomTypeId(null);

    const match = availability.find(r => r.roomType._id === idToSelect);
    if (match && !items.some(item => item.roomTypeId === idToSelect)) {
      addItem({
        kind: 'room',
        roomTypeId: match.roomType._id,
        ratePlanId: match.ratePlan._id,
        roomTypeName: match.roomType.name,
        checkIn: searchParams!.checkIn,
        checkOut: searchParams!.checkOut,
        adults: searchParams!.adults,
        children: searchParams!.children,
        quantity: 1,
        pricing: {
          subtotal: match.pricing.adjustedSubtotal,
          taxes: match.pricing.totalTaxes,
          total: match.pricing.finalTotal,
          perNight: match.pricing.perNight,
          nights: match.pricing.nights,
        },
      });
    }
  }, [preselectedRoomTypeId, availability]); // eslint-disable-line react-hooks/exhaustive-deps

  const isRoomTypeSelected = (roomTypeId: string) =>
    items.some(item => item.roomTypeId === roomTypeId);

  const isServiceSelected = (serviceId: string) =>
    items.some(item => item.serviceId === serviceId);

  const handleSelectRoom = (room: typeof availability[0]) => {
    if (isRoomTypeSelected(room.roomType._id)) return;
    const item: BookingItem = {
      kind: 'room',
      roomTypeId: room.roomType._id,
      ratePlanId: room.ratePlan._id,
      roomTypeName: room.roomType.name,
      checkIn: searchParams!.checkIn,
      checkOut: searchParams!.checkOut,
      adults: searchParams!.adults,
      children: searchParams!.children,
      quantity: 1,
      pricing: {
        subtotal: room.pricing.adjustedSubtotal,
        taxes: room.pricing.totalTaxes,
        total: room.pricing.finalTotal,
        perNight: room.pricing.perNight,
        nights: room.pricing.nights,
      },
    };
    addItem(item);
  };

  const handleAddService = async (service: ServiceData, quantity: number) => {
    if (isServiceSelected(service._id)) return;
    try {
      const res = await bookingService.getServiceQuote({
        serviceId: service._id,
        date: searchParams!.checkIn,
        adults: searchParams!.adults,
        children: searchParams!.children,
      });
      const quote = res.data?.data;
      if (quote) {
        const item: BookingItem = {
          kind: 'service',
          serviceId: service._id,
          serviceName: service.name,
          date: searchParams!.checkIn,
          adults: searchParams!.adults,
          children: searchParams!.children,
          quantity,
          pricing: {
            subtotal: (quote.subtotal ?? quote.finalTotal) * quantity,
            taxes: (quote.totalTaxes ?? 0) * quantity,
            total: quote.finalTotal * quantity,
          },
        };
        addItem(item);
      }
    } catch {
      // Silently fail — user can retry
    }
  };

  if (availabilityLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 5 }}>
        <Skeleton width={200} height={32} sx={{ mb: 3 }} />
        <Grid container spacing={3}>
          {[1, 2, 3, 4].map(i => (
            <Grid item xs={12} sm={6} lg={3} key={i}>
              <CardSkeleton />
            </Grid>
          ))}
        </Grid>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 5 }}>
      {/* Search summary bar */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 4,
          bgcolor: SURFACE,
          borderRadius: CARD_RADIUS,
          border: `1px solid ${BORDER}`,
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={`${t('bookingEngine.search.checkIn')}: ${searchParams?.checkIn}`} variant="outlined" size="small" sx={{ borderRadius: BTN_PILL, fontFamily: FONT }} />
            <Chip label={`${t('bookingEngine.search.checkOut')}: ${searchParams?.checkOut}`} variant="outlined" size="small" sx={{ borderRadius: BTN_PILL, fontFamily: FONT }} />
            <Chip
              label={t('bookingEngine.results.nightCount', { count: nights })}
              size="small"
              sx={{ bgcolor: BRAND, color: 'white', borderRadius: BTN_PILL, fontFamily: FONT, fontWeight: 600 }}
            />
            <Chip
              icon={<PersonIcon sx={{ fontSize: 16 }} />}
              label={t('bookingEngine.results.adultCount', { count: searchParams?.adults || 0 })}
              size="small"
              sx={{ borderRadius: BTN_PILL, fontFamily: FONT }}
            />
            {(searchParams?.children || 0) > 0 && (
              <Chip
                icon={<ChildCareIcon sx={{ fontSize: 16 }} />}
                label={t('bookingEngine.results.childCount', { count: searchParams?.children || 0 })}
                size="small"
                sx={{ borderRadius: BTN_PILL, fontFamily: FONT }}
              />
            )}
          </Stack>
          <Button
            size="small"
            onClick={() => setCurrentStep('search')}
            sx={{ textTransform: 'none', fontFamily: FONT, fontWeight: 600, color: TEXT_PRIMARY }}
          >
            {t('bookingEngine.results.modifySearch')}
          </Button>
        </Stack>
      </Paper>

      {availability.length === 0 ? (
        <Alert severity="info" sx={{ mt: 4, borderRadius: CARD_RADIUS }}>
          {t('bookingEngine.results.noRoomsAvailable')}
        </Alert>
      ) : (
        <>
          <Typography
            variant="h5"
            sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 3 }}
          >
            {t('bookingEngine.results.roomTypesAvailable', { count: availability.length })}
          </Typography>

          {/* Property grid: 4 desktop, 2 tablet, 1 mobile */}
          <Grid container spacing={3}>
            {availability.map(room => {
              const selected = isRoomTypeSelected(room.roomType._id);
              return (
                <Grid item xs={12} sm={6} lg={3} key={room.roomType._id}>
                  <Card
                    elevation={0}
                    sx={{
                      borderRadius: CARD_RADIUS,
                      border: selected ? `2px solid ${ACCENT}` : `1px solid ${BORDER}`,
                      transition: TRANSITION,
                      overflow: 'hidden',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      '&:hover': {
                        boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                        transform: 'translateY(-2px)',
                      },
                    }}
                  >
                    {(() => {
                      const rtImage = room.roomType?.image;
                      if (rtImage && isIllustrationUrl(rtImage)) {
                        const Illus = getIllustrationByKey(getIllustrationKey(rtImage));
                        return (
                          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200, bgcolor: '#F9FAFB' }}>
                            <Illus width={300} height={180} />
                          </Box>
                        );
                      }
                      if (rtImage) {
                        return (
                          <CardMedia
                            component="img"
                            height={200}
                            image={resolveMediaUrl(rtImage)}
                            alt={room.roomType.name}
                            sx={{ objectFit: 'cover' }}
                          />
                        );
                      }
                      return (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200, bgcolor: '#F0F7FA' }}>
                          <RoomIllustration width={300} height={180} />
                        </Box>
                      );
                    })()}
                    <CardContent sx={{ p: 2, flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={0.5}>
                        <Typography
                          variant="subtitle1"
                          sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, lineHeight: 1.3 }}
                        >
                          {room.roomType.name}
                        </Typography>
                        <Chip
                          label={t('bookingEngine.results.left', { count: room.availableCount })}
                          color={room.availableCount <= 2 ? 'warning' : 'default'}
                          size="small"
                          sx={{ borderRadius: BTN_PILL, fontSize: '0.7rem', ml: 1, flexShrink: 0 }}
                        />
                      </Stack>

                      <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 1.5 }}>
                        {t('bookingEngine.results.upToGuests', { count: room.roomType.capacity })} · {room.bedConfiguration || 'Standard'}
                      </Typography>

                      {/* Features */}
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 2, minHeight: 28 }}>
                        {Object.entries(room.features)
                          .filter(([, v]) => v)
                          .slice(0, 4)
                          .map(([key]) => (
                            <Chip
                              key={key}
                              icon={FEATURE_ICONS[key] as React.ReactElement || undefined}
                              label={t(`bookingEngine.features.${key}`, key)}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: '0.7rem', borderRadius: BTN_PILL, fontFamily: FONT, borderColor: BORDER }}
                            />
                          ))}
                      </Stack>

                      <Box sx={{ mt: 'auto', pt: 1.5 }}>
                        <Divider sx={{ borderColor: BORDER, mb: 1.5 }} />
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-end">
                          <Box>
                            <Typography sx={{ fontWeight: 700, fontFamily: FONT, color: TEXT_PRIMARY, fontSize: '1.1rem' }}>
                              {formatCurrency(room.pricing.perNight, currency)}
                              <Typography component="span" sx={{ fontWeight: 400, color: TEXT_SECONDARY, fontSize: '0.85rem' }}>
                                {' '}{t('bookingEngine.results.perNight')}
                              </Typography>
                            </Typography>
                            {room.pricing.totalTaxes > 0 && (
                              <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>
                                {t('bookingEngine.results.taxes', { amount: formatCurrency(room.pricing.totalTaxes, currency) })}
                              </Typography>
                            )}
                          </Box>
                          <Box textAlign="right">
                            <Typography
                              sx={{ fontWeight: 700, fontFamily: FONT, color: ACCENT, fontSize: '1.25rem' }}
                            >
                              {formatCurrency(room.pricing.finalTotal, currency)}
                            </Typography>
                            <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>
                              {t('bookingEngine.results.totalForNights', { count: nights })}
                            </Typography>
                          </Box>
                        </Stack>
                      </Box>
                    </CardContent>
                    <CardActions sx={{ px: 2, pb: 2 }}>
                      <Button
                        variant={selected ? 'outlined' : 'contained'}
                        fullWidth
                        onClick={() => handleSelectRoom(room)}
                        disabled={selected}
                        startIcon={selected ? <CheckCircleIcon /> : <AddIcon />}
                        sx={{
                          bgcolor: selected ? 'transparent' : ACCENT,
                          color: selected ? ACCENT : 'white',
                          borderColor: ACCENT,
                          '&:hover': { bgcolor: selected ? ACCENT_LIGHT : ACCENT_HOVER },
                          textTransform: 'none',
                          fontWeight: 600,
                          fontFamily: FONT,
                          borderRadius: BTN_RADIUS,
                          boxShadow: 'none',
                          transition: TRANSITION,
                        }}
                      >
                        {selected ? t('bookingEngine.results.selected') : t('bookingEngine.results.selectRoom')}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          {/* Services section — only roomAddon kind, only when a room is in the cart */}
          {servicesLoading && (
            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <CircularProgress size={24} sx={{ color: BRAND }} />
              <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mt: 1 }}>
                {t('bookingEngine.results.loadingServices')}
              </Typography>
            </Box>
          )}

          {!hasRoomSelected && addonServices.length > 0 && (
            <Box sx={{ mt: 6 }}>
              <Typography variant="h5" sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}>
                {t('bookingEngine.results.addOnServices')}
              </Typography>
              <Alert severity="info" sx={{ borderRadius: CARD_RADIUS }}>
                {t('bookingEngine.results.selectRoomFirst', 'Select a room first to add services to your stay.')}
              </Alert>
            </Box>
          )}

          {hasRoomSelected && addonServices.length > 0 && (
            <Box sx={{ mt: 6 }}>
              <Typography variant="h5" sx={{ fontWeight: 600, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}>
                {t('bookingEngine.results.addOnServices')}
              </Typography>
              <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 3 }}>
                {t('bookingEngine.results.addOnServicesSubtitle')}
              </Typography>
              <Grid container spacing={2}>
                {addonServices.map(service => {
                  const selected = isServiceSelected(service._id);
                  const qty = serviceQty[service._id] || 1;
                  const maxQty = service.chargeBasis === 'perPerson'
                    ? Math.max(1, totalGuests)
                    : service.chargeBasis === 'perRoom'
                      ? Math.max(1, roomItemCount)
                      : 1;
                  return (
                    <Grid item xs={12} sm={6} md={4} key={service._id}>
                      <Card
                        elevation={0}
                        sx={{
                          borderRadius: CARD_RADIUS,
                          border: selected ? `2px solid ${ACCENT}` : `1px solid ${BORDER}`,
                          transition: TRANSITION,
                          '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
                        }}
                      >
                        <CardContent>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontFamily: FONT }}>{service.name}</Typography>
                          <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>
                            {chargeBasisLabelMap[service.chargeBasis] || service.chargeBasis}
                          </Typography>
                          {service.basePrice != null && (
                            <Typography sx={{ fontWeight: 700, color: ACCENT, fontFamily: FONT, fontSize: '1.1rem', mt: 0.5 }}>
                              {formatCurrency(service.basePrice, currency)}
                              <Typography component="span" sx={{ fontWeight: 400, color: TEXT_SECONDARY, fontSize: '0.8rem' }}>
                                {' '}{t(`bookingEngine.results.${service.chargeBasis}`, `/${service.chargeBasis}`)}
                              </Typography>
                            </Typography>
                          )}
                          {/* Quantity selector */}
                          {!selected && maxQty > 1 && (
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.5 }}>
                              <IconButton
                                size="small"
                                onClick={() => setServiceQty(q => ({ ...q, [service._id]: Math.max(1, (q[service._id] || 1) - 1) }))}
                                disabled={qty <= 1}
                                sx={{ border: `1px solid ${BORDER}`, borderRadius: '6px', p: 0.5 }}
                              >
                                <RemoveIcon fontSize="small" />
                              </IconButton>
                              <Typography sx={{ fontWeight: 600, fontFamily: FONT, minWidth: 24, textAlign: 'center' }}>{qty}</Typography>
                              <IconButton
                                size="small"
                                onClick={() => setServiceQty(q => ({ ...q, [service._id]: Math.min(maxQty, (q[service._id] || 1) + 1) }))}
                                disabled={qty >= maxQty}
                                sx={{ border: `1px solid ${BORDER}`, borderRadius: '6px', p: 0.5 }}
                              >
                                <AddIcon fontSize="small" />
                              </IconButton>
                              <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>
                                {t('bookingEngine.results.maxQty', { count: maxQty })}
                              </Typography>
                            </Stack>
                          )}
                        </CardContent>
                        <CardActions sx={{ px: 2, pb: 2 }}>
                          <Button
                            variant={selected ? 'outlined' : 'contained'}
                            size="small"
                            fullWidth
                            disabled={selected}
                            onClick={() => handleAddService(service, qty)}
                            startIcon={selected ? <CheckCircleIcon /> : <AddIcon />}
                            sx={{
                              bgcolor: selected ? 'transparent' : ACCENT,
                              color: selected ? ACCENT : 'white',
                              borderColor: ACCENT,
                              '&:hover': { bgcolor: selected ? ACCENT_LIGHT : ACCENT_HOVER },
                              textTransform: 'none',
                              fontWeight: 600,
                              fontFamily: FONT,
                              borderRadius: BTN_RADIUS,
                              boxShadow: 'none',
                              transition: TRANSITION,
                            }}
                          >
                            {selected ? t('bookingEngine.results.added') : t('bookingEngine.results.addService')}
                          </Button>
                        </CardActions>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          )}

          {/* Cart / booking panel */}
          {items.length > 0 && (
            <Box sx={{ mt: 5, maxWidth: 560, mx: 'auto' }}>
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 2.5, md: 3 },
                  borderRadius: CARD_RADIUS,
                  border: `1px solid ${BORDER}`,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 600, fontFamily: FONT, mb: 1.5 }}>
                  {t('bookingEngine.results.yourSelection')}
                </Typography>

                {/* Reservation summary */}
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                  <Chip
                    label={t('bookingEngine.results.nightCount', { count: nights })}
                    size="small"
                    sx={{ bgcolor: BRAND_LIGHT, color: BRAND, fontFamily: FONT, fontWeight: 600, borderRadius: BTN_PILL }}
                  />
                  <Chip
                    icon={<PersonIcon sx={{ fontSize: 14 }} />}
                    label={t('bookingEngine.results.adultCount', { count: searchParams?.adults || 0 })}
                    size="small"
                    variant="outlined"
                    sx={{ borderRadius: BTN_PILL, fontFamily: FONT }}
                  />
                  {(searchParams?.children || 0) > 0 && (
                    <Chip
                      icon={<ChildCareIcon sx={{ fontSize: 14 }} />}
                      label={t('bookingEngine.results.childCount', { count: searchParams?.children || 0 })}
                      size="small"
                      variant="outlined"
                      sx={{ borderRadius: BTN_PILL, fontFamily: FONT }}
                    />
                  )}
                </Stack>

                <Divider sx={{ borderColor: BORDER, mb: 1 }} />

                {items.map((item, i) => (
                  <Stack key={i} direction="row" justifyContent="space-between" alignItems="center" py={1}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Chip
                        label={item.kind === 'room' ? t('bookingEngine.results.room') : t('bookingEngine.results.service')}
                        size="small"
                        variant="outlined"
                        sx={{ borderRadius: BTN_PILL, fontFamily: FONT, fontSize: '0.75rem' }}
                      />
                      <Typography sx={{ fontFamily: FONT, color: TEXT_PRIMARY }}>{item.roomTypeName || item.serviceName}</Typography>
                      {item.quantity > 1 && (
                        <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>x{item.quantity}</Typography>
                      )}
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography sx={{ fontWeight: 600, fontFamily: FONT }}>{formatCurrency(item.pricing.total, currency)}</Typography>
                      <IconButton
                        size="small"
                        onClick={() => removeItem(i)}
                        sx={{ color: '#E53935', transition: TRANSITION, '&:hover': { bgcolor: '#FFEBEE' } }}
                        aria-label={`Remove ${item.roomTypeName || item.serviceName}`}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Stack>
                ))}
                <Divider sx={{ my: 2, borderColor: BORDER }} />
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6" sx={{ fontWeight: 700, fontFamily: FONT }}>{t('bookingEngine.results.total')}</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, fontFamily: FONT, color: ACCENT }}>
                    {formatCurrency(items.reduce((s, it) => s + it.pricing.total, 0), currency)}
                  </Typography>
                </Stack>

                <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mt: 1, textAlign: 'center' }}>
                  {t('bookingEngine.results.youWontBeCharged')}
                </Typography>

                <Button
                  variant="contained"
                  fullWidth
                  sx={{
                    mt: 2,
                    bgcolor: ACCENT,
                    '&:hover': { bgcolor: ACCENT_HOVER },
                    textTransform: 'none',
                    fontWeight: 600,
                    fontFamily: FONT,
                    py: 1.5,
                    borderRadius: BTN_RADIUS,
                    boxShadow: 'none',
                    fontSize: '1rem',
                    transition: TRANSITION,
                  }}
                  onClick={() => setCurrentStep('details')}
                >
                  {t('bookingEngine.results.continueToDetails')}
                </Button>
              </Paper>
            </Box>
          )}
        </>
      )}
    </Container>
  );
}

// ── Step 3: Guest Details ────────────────────────────────────────────────────
function DetailsStep() {
  const { config, guestInfo, setGuestInfo, setCurrentStep, prevStep, totalPrice } = useBooking();
  const { t } = useTranslation();
  const currency = config?.currency || 'USD';
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!guestInfo.firstName.trim()) e.firstName = t('bookingEngine.details.firstNameRequired');
    if (!guestInfo.lastName.trim()) e.lastName = t('bookingEngine.details.lastNameRequired');
    if (!guestInfo.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestInfo.email))
      e.email = t('bookingEngine.details.emailRequired');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleContinue = () => {
    if (validate()) setCurrentStep('verify');
  };

  const inputSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: BTN_RADIUS,
      fontFamily: FONT,
      '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: BRAND },
      '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: BRAND },
    },
    '& .MuiInputLabel-root.Mui-focused': { color: BRAND },
  };

  return (
    <Container maxWidth="sm" sx={{ py: 5 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}>
        {t('bookingEngine.details.heading')}
      </Typography>
      <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 3 }}>
        {t('bookingEngine.details.totalPayAtProperty', { amount: formatCurrency(totalPrice, currency) })}
      </Typography>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 3 },
          borderRadius: CARD_RADIUS,
          border: `1px solid ${BORDER}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
        }}
      >
        <Stack spacing={2.5}>
          <TextField
            label={t('bookingEngine.details.firstName')}
            value={guestInfo.firstName}
            onChange={e => setGuestInfo({ ...guestInfo, firstName: e.target.value })}
            error={!!errors.firstName}
            helperText={errors.firstName}
            fullWidth
            required
            inputProps={{ maxLength: 100 }}
            sx={inputSx}
          />
          <TextField
            label={t('bookingEngine.details.lastName')}
            value={guestInfo.lastName}
            onChange={e => setGuestInfo({ ...guestInfo, lastName: e.target.value })}
            error={!!errors.lastName}
            helperText={errors.lastName}
            fullWidth
            required
            inputProps={{ maxLength: 100 }}
            sx={inputSx}
          />
          <TextField
            label={t('bookingEngine.details.email')}
            type="email"
            value={guestInfo.email}
            onChange={e => setGuestInfo({ ...guestInfo, email: e.target.value })}
            error={!!errors.email}
            helperText={errors.email || t('bookingEngine.details.emailHint')}
            fullWidth
            required
            InputProps={{
              startAdornment: <InputAdornment position="start"><EmailIcon sx={{ fontSize: 18, color: TEXT_SECONDARY }} /></InputAdornment>,
            }}
            inputProps={{ maxLength: 254 }}
            sx={inputSx}
          />
          <TextField
            label={t('bookingEngine.details.phone')}
            value={guestInfo.phone}
            onChange={e => setGuestInfo({ ...guestInfo, phone: e.target.value })}
            fullWidth
            inputProps={{ maxLength: 20 }}
            sx={inputSx}
          />
          <TextField
            label={t('bookingEngine.details.specialRequests')}
            value={guestInfo.specialRequests}
            onChange={e => setGuestInfo({ ...guestInfo, specialRequests: e.target.value })}
            fullWidth
            multiline
            rows={3}
            inputProps={{ maxLength: 1000 }}
            sx={inputSx}
          />
        </Stack>

        <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
          <Button
            variant="outlined"
            onClick={() => setCurrentStep(prevStep || 'results')}
            sx={{
              textTransform: 'none',
              fontFamily: FONT,
              borderColor: BORDER,
              color: TEXT_PRIMARY,
              borderRadius: BTN_RADIUS,
              '&:hover': { borderColor: TEXT_PRIMARY, bgcolor: SURFACE },
            }}
          >
            {t('bookingEngine.details.back')}
          </Button>
          <Button
            variant="contained"
            fullWidth
            onClick={handleContinue}
            sx={{
              bgcolor: ACCENT,
              '&:hover': { bgcolor: ACCENT_HOVER },
              textTransform: 'none',
              fontWeight: 600,
              fontFamily: FONT,
              borderRadius: BTN_RADIUS,
              boxShadow: 'none',
              transition: TRANSITION,
            }}
          >
            {t('bookingEngine.details.continueToVerification')}
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}

// ── Step 4: Email Verification ───────────────────────────────────────────────
function VerifyStep() {
  const { guestInfo, setCurrentStep, setVerificationId } = useBooking();
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  // Guard against React StrictMode double-invoking the mount effect
  const sendAttempted = React.useRef(false);

  const handleSendCode = async () => {
    setSending(true);
    setError('');
    try {
      await bookingService.sendVerification({
        email: guestInfo.email,
        guestName: `${guestInfo.firstName} ${guestInfo.lastName}`,
      });
      setSent(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || t('bookingEngine.verify.failedToSend'));
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setError('');
    try {
      const res = await bookingService.confirmVerification({
        email: guestInfo.email,
        code,
      });
      if (res.data?.data?.verificationId) {
        setVerificationId(res.data.data.verificationId);
        setCurrentStep('review');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || t('bookingEngine.verify.verificationFailed');
      setError(msg);
      if (err?.response?.data?.attemptsRemaining !== undefined) {
        setAttemptsRemaining(err.response.data.attemptsRemaining);
      }
    } finally {
      setVerifying(false);
    }
  };

  // Auto-send on mount — ref guard prevents StrictMode from firing twice
  useEffect(() => {
    if (sendAttempted.current) return;
    sendAttempted.current = true;
    handleSendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Container maxWidth="sm" sx={{ py: 5 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: FONT, color: TEXT_PRIMARY, mb: 0.5 }}>
        {t('bookingEngine.verify.heading')}
      </Typography>
      <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 3 }}>
        {t('bookingEngine.verify.codeSentTo')} <strong>{guestInfo.email}</strong>
      </Typography>

      <Paper
        elevation={0}
        sx={{
          p: 4,
          borderRadius: CARD_RADIUS,
          border: `1px solid ${BORDER}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          textAlign: 'center',
        }}
      >
        {!sent ? (
          <>
            <CircularProgress sx={{ mb: 2, color: BRAND }} />
            <Typography sx={{ fontFamily: FONT }}>{t('bookingEngine.verify.sendingCode')}</Typography>
          </>
        ) : (
          <>
            <VerifiedIcon sx={{ fontSize: 48, color: BRAND, mb: 2 }} />
            <Typography variant="body1" sx={{ mb: 3, fontFamily: FONT }}>
              {t('bookingEngine.verify.enterCode')}
            </Typography>

            <TextField
              value={code}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                setCode(v);
              }}
              placeholder="0000"
              inputProps={{
                maxLength: 4,
                style: {
                  textAlign: 'center',
                  fontSize: '2rem',
                  letterSpacing: '0.5rem',
                  fontWeight: 700,
                  fontFamily: FONT,
                },
              }}
              sx={{
                width: 200,
                mb: 2,
                '& .MuiOutlinedInput-root': {
                  borderRadius: BTN_RADIUS,
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: ACCENT },
                },
              }}
            />

            {error && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: BTN_RADIUS, textAlign: 'left' }}>
                {error}
                {attemptsRemaining < 5 && ` (${t('bookingEngine.verify.attemptsRemaining', { count: attemptsRemaining })})`}
              </Alert>
            )}

            <Stack spacing={2}>
              <Button
                variant="contained"
                onClick={handleVerify}
                disabled={code.length !== 4 || verifying}
                startIcon={verifying ? <CircularProgress size={18} sx={{ color: 'white' }} /> : <CheckCircleIcon />}
                sx={{
                  bgcolor: ACCENT,
                  '&:hover': { bgcolor: ACCENT_HOVER },
                  textTransform: 'none',
                  fontWeight: 600,
                  fontFamily: FONT,
                  borderRadius: BTN_RADIUS,
                  boxShadow: 'none',
                  transition: TRANSITION,
                }}
              >
                {t('bookingEngine.verify.verifyCode')}
              </Button>

              <Button
                variant="text"
                size="small"
                onClick={handleSendCode}
                disabled={sending}
                sx={{ textTransform: 'none', fontFamily: FONT, color: TEXT_SECONDARY }}
              >
                {sending ? t('bookingEngine.verify.sending') : t('bookingEngine.verify.resendCode')}
              </Button>
            </Stack>
          </>
        )}

        <Button
          variant="text"
          onClick={() => setCurrentStep('details')}
          sx={{ mt: 2, textTransform: 'none', fontFamily: FONT, color: TEXT_SECONDARY }}
        >
          ← {t('bookingEngine.verify.backToDetails')}
        </Button>
      </Paper>
    </Container>
  );
}

// ── Step 5: Review & Confirm ─────────────────────────────────────────────────
function ReviewStep() {
  const {
    config, guestInfo, items, totalPrice, searchParams,
    verificationId, setCurrentStep, setBookingResult,
  } = useBooking();
  const { t } = useTranslation();
  const currency = config?.currency || 'USD';
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (!termsAccepted) {
      setError(t('bookingEngine.review.acceptTermsError'));
      return;
    }
    if (!verificationId) {
      setError(t('bookingEngine.review.emailVerificationRequired'));
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const bookingItems = items.map(item => ({
        kind: item.kind,
        roomTypeId: item.roomTypeId,
        ratePlanId: item.ratePlanId,
        checkIn: item.checkIn,
        checkOut: item.checkOut,
        serviceId: item.serviceId,
        date: item.date,
        adults: item.adults,
        children: item.children,
        quantity: item.quantity,
      }));

      const res = await bookingService.reserve({
        verificationId,
        email: guestInfo.email,
        firstName: guestInfo.firstName,
        lastName: guestInfo.lastName,
        phone: guestInfo.phone || undefined,
        specialRequests: guestInfo.specialRequests || undefined,
        items: bookingItems,
        acceptedTermsVersion: config?.termsVersion || '1.0',
        acceptedPrivacyVersion: config?.termsVersion || '1.0',
      });

      if (res.data?.data) {
        setBookingResult(res.data.data);
        setCurrentStep('confirmation');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('bookingEngine.review.reservationFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const nights = searchParams
    ? Math.max(1, Math.ceil(
        (new Date(searchParams.checkOut).getTime() - new Date(searchParams.checkIn).getTime()) / 86400000
      ))
    : 1;

  return (
    <Container maxWidth="sm" sx={{ py: 5 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: FONT, color: TEXT_PRIMARY, mb: 3 }}>
        {t('bookingEngine.review.heading')}
      </Typography>

      <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: CARD_RADIUS,
          border: `1px solid ${BORDER}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          mb: 3,
        }}
      >
        <Typography variant="subtitle2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 0.5 }}>
          {t('bookingEngine.review.guestInfo')}
        </Typography>
        <Typography sx={{ fontWeight: 600, fontFamily: FONT }}>{guestInfo.firstName} {guestInfo.lastName}</Typography>
        <Typography variant="body2" sx={{ fontFamily: FONT }}>{guestInfo.email}</Typography>
        {guestInfo.phone && <Typography variant="body2" sx={{ fontFamily: FONT }}>{guestInfo.phone}</Typography>}
        {guestInfo.specialRequests && (
          <Typography variant="body2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mt: 1, fontStyle: 'italic' }}>
            {t('bookingEngine.review.specialRequests', { requests: guestInfo.specialRequests })}
          </Typography>
        )}

        <Divider sx={{ my: 2, borderColor: BORDER }} />

        <Typography variant="subtitle2" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 1 }}>
          {t('bookingEngine.review.bookingDetails')}
        </Typography>
        {searchParams && (
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontFamily: FONT }}>
              <strong>{t('bookingEngine.review.checkInLabel')}</strong> {new Date(searchParams.checkIn).toLocaleDateString()}
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: FONT }}>
              <strong>{t('bookingEngine.review.checkOutLabel')}</strong> {new Date(searchParams.checkOut).toLocaleDateString()}
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: FONT }}>
              <strong>{t('bookingEngine.review.durationLabel')}</strong> {t('bookingEngine.results.nightCount', { count: nights })}
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: FONT }}>
              <strong>{t('bookingEngine.review.guestsLabel')}</strong> {t('bookingEngine.results.adultCount', { count: searchParams.adults })}
              {searchParams.children > 0 && `, ${t('bookingEngine.results.childCount', { count: searchParams.children })}`}
            </Typography>
          </Stack>
        )}

        {items.map((item, i) => (
          <Stack key={i} direction="row" justifyContent="space-between" py={0.5}>
            <Typography variant="body2" sx={{ fontFamily: FONT }}>{item.roomTypeName || item.serviceName}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: FONT }}>{formatCurrency(item.pricing.total, currency)}</Typography>
          </Stack>
        ))}

        <Divider sx={{ my: 2, borderColor: BORDER }} />

        <Stack direction="row" justifyContent="space-between">
          <Typography variant="h6" sx={{ fontWeight: 700, fontFamily: FONT }}>{t('bookingEngine.review.total')}</Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, fontFamily: FONT, color: ACCENT }}>
            {formatCurrency(totalPrice, currency)}
          </Typography>
        </Stack>

        <Alert
          severity="info"
          sx={{
            mt: 2,
            borderRadius: BTN_RADIUS,
            '& .MuiAlert-message': { fontFamily: FONT },
          }}
        >
          <strong>{t('bookingEngine.review.payAtProperty')}</strong> — {t('bookingEngine.review.payAtPropertyDetail')}
        </Alert>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: CARD_RADIUS,
          border: `1px solid ${BORDER}`,
          mb: 3,
        }}
      >
        <FormControlLabel
          control={
            <Checkbox
              checked={termsAccepted}
              onChange={e => setTermsAccepted(e.target.checked)}
              sx={{ '&.Mui-checked': { color: BRAND } }}
            />
          }
          label={
            <Typography variant="body2" sx={{ fontFamily: FONT }}>
              {t('bookingEngine.review.agreeTermsAndPrivacy')}{' '}
              <Link href="/booking/terms" target="_blank" rel="noopener" sx={{ color: BRAND, fontWeight: 600 }}>
                {t('bookingEngine.review.termsOfService')}
              </Link>
              {' '}{t('bookingEngine.review.and')}{' '}
              <Link href="/booking/privacy" target="_blank" rel="noopener" sx={{ color: BRAND, fontWeight: 600 }}>
                {t('bookingEngine.review.privacyPolicy')}
              </Link>
            </Typography>
          }
        />
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: BTN_RADIUS }}>{error}</Alert>}

      <Stack direction="row" spacing={2}>
        <Button
          variant="outlined"
          onClick={() => setCurrentStep('verify')}
          sx={{
            textTransform: 'none',
            fontFamily: FONT,
            borderColor: BORDER,
            color: TEXT_PRIMARY,
            borderRadius: BTN_RADIUS,
            '&:hover': { borderColor: TEXT_PRIMARY, bgcolor: SURFACE },
          }}
        >
          {t('bookingEngine.review.back')}
        </Button>
        <Button
          variant="contained"
          fullWidth
          onClick={handleConfirm}
          disabled={submitting || !termsAccepted}
          startIcon={submitting ? <CircularProgress size={18} sx={{ color: 'white' }} /> : <CheckCircleIcon />}
          sx={{
            bgcolor: ACCENT,
            '&:hover': { bgcolor: ACCENT_HOVER },
            textTransform: 'none',
            fontWeight: 600,
            fontFamily: FONT,
            py: 1.5,
            borderRadius: BTN_RADIUS,
            boxShadow: 'none',
            fontSize: '1rem',
            transition: TRANSITION,
          }}
        >
          {submitting ? t('bookingEngine.review.confirming') : t('bookingEngine.review.confirmBooking')}
        </Button>
      </Stack>
    </Container>
  );
}

// ── Step 6: Confirmation ─────────────────────────────────────────────────────
function ConfirmationStep() {
  const { config, bookingResult, totalPrice, guestInfo } = useBooking();
  const { t } = useTranslation();
  const currency = config?.currency || 'USD';

  return (
    <Container maxWidth="sm" sx={{ py: 6, textAlign: 'center' }}>
      <CheckCircleIcon sx={{ fontSize: 80, color: BRAND, mb: 2 }} />
      <Typography variant="h4" sx={{ fontWeight: 700, fontFamily: FONT, color: TEXT_PRIMARY, mb: 1 }}>
        {t('bookingEngine.confirmation.heading')}
      </Typography>
      <Typography variant="body1" sx={{ color: TEXT_SECONDARY, fontFamily: FONT, mb: 4 }}>
        {t('bookingEngine.confirmation.emailSentTo')} <strong>{guestInfo.email}</strong>
      </Typography>

      <Paper
        elevation={0}
        sx={{
          p: 4,
          borderRadius: CARD_RADIUS,
          border: `1px solid ${BORDER}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          textAlign: 'left',
        }}
      >
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>
              {t('bookingEngine.confirmation.confirmationCode')}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: ACCENT, fontFamily: FONT, letterSpacing: 2 }}>
              {bookingResult?.reservationCode}
            </Typography>
          </Box>
          <Divider sx={{ borderColor: BORDER }} />
          <Stack direction="row" justifyContent="space-between">
            <Typography sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>{t('bookingEngine.confirmation.totalPayAtProperty')}</Typography>
            <Typography sx={{ fontWeight: 700, fontFamily: FONT }}>{formatCurrency(bookingResult?.estimatedTotal || totalPrice, currency)}</Typography>
          </Stack>
          {bookingResult?.checkIn && (
            <Stack direction="row" justifyContent="space-between">
              <Typography sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>{t('bookingEngine.confirmation.checkIn')}</Typography>
              <Typography sx={{ fontFamily: FONT }}>{new Date(bookingResult.checkIn).toLocaleDateString()}</Typography>
            </Stack>
          )}
          {bookingResult?.checkOut && (
            <Stack direction="row" justifyContent="space-between">
              <Typography sx={{ color: TEXT_SECONDARY, fontFamily: FONT }}>{t('bookingEngine.confirmation.checkOut')}</Typography>
              <Typography sx={{ fontFamily: FONT }}>{new Date(bookingResult.checkOut).toLocaleDateString()}</Typography>
            </Stack>
          )}
        </Stack>
      </Paper>

      <Alert
        severity="success"
        sx={{
          mt: 3,
          textAlign: 'left',
          borderRadius: BTN_RADIUS,
          '& .MuiAlert-message': { fontFamily: FONT },
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: FONT }}>{t('bookingEngine.confirmation.whatNext')}</Typography>
        <Typography variant="body2" sx={{ fontFamily: FONT }}>
          {t('bookingEngine.confirmation.whatNextDetail', { code: bookingResult?.reservationCode })}
          {config?.contactPhone && t('bookingEngine.confirmation.whatNextPhone', { phone: config.contactPhone })}
        </Typography>
      </Alert>

      {bookingResult?.confirmationToken && (
        <Button
          variant="contained"
          href={`/booking/reservation/${bookingResult.reservationCode}?token=${bookingResult.confirmationToken}`}
          sx={{
            mt: 3,
            textTransform: 'none',
            fontFamily: FONT,
            bgcolor: ACCENT,
            color: '#fff',
            borderRadius: BTN_RADIUS,
            fontWeight: 600,
            width: '100%',
            py: 1.5,
            '&:hover': { bgcolor: '#C84E33' },
          }}
        >
          {t('bookingEngine.confirmation.viewReservation')}
        </Button>
      )}

      <Button
        variant="outlined"
        href="/booking"
        sx={{
          mt: 2,
          textTransform: 'none',
          fontFamily: FONT,
          borderColor: BRAND,
          color: BRAND,
          borderRadius: BTN_RADIUS,
          fontWeight: 600,
          '&:hover': { bgcolor: BRAND_LIGHT, borderColor: BRAND },
        }}
      >
        {t('bookingEngine.confirmation.makeAnother')}
      </Button>
    </Container>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
const BookingPage: React.FC = () => {
  const { configLoading, configError, currentStep } = useBooking();
  const { t } = useTranslation();

  const STEPS_KEYS = [
    { key: 'search', label: t('bookingEngine.steps.search') },
    { key: 'select', label: t('bookingEngine.steps.select') },
    { key: 'details', label: t('bookingEngine.steps.details') },
    { key: 'verify', label: t('bookingEngine.steps.verify') },
    { key: 'confirm', label: t('bookingEngine.steps.confirm') },
  ];

  if (configLoading) {
    return (
      <BookingLayout>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <CircularProgress sx={{ color: BRAND }} />
        </Box>
      </BookingLayout>
    );
  }

  if (configError) {
    return (
      <BookingLayout>
        <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
          <Alert severity="warning" sx={{ borderRadius: CARD_RADIUS }}>{configError}</Alert>
        </Container>
      </BookingLayout>
    );
  }

  const stepIndex =
    currentStep === 'search' ? 0 :
    currentStep === 'results' ? 1 :
    currentStep === 'details' ? 2 :
    currentStep === 'verify' ? 3 :
    currentStep === 'review' || currentStep === 'confirmation' ? 4 : 0;

  return (
    <BookingLayout>
      {/* Progress stepper (hidden on first/last step) */}
      {currentStep !== 'search' && currentStep !== 'confirmation' && (
        <Container maxWidth="md" sx={{ pt: 3 }}>
          <Stepper
            activeStep={stepIndex}
            alternativeLabel
            sx={{
              '& .MuiStepIcon-root.Mui-active': { color: ACCENT },
              '& .MuiStepIcon-root.Mui-completed': { color: ACCENT },
              '& .MuiStepLabel-label': { fontFamily: FONT, fontSize: '0.85rem' },
            }}
          >
            {STEPS_KEYS.map(step => (
              <Step key={step.key}>
                <StepLabel>{step.label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Container>
      )}

      {currentStep === 'search' && <SearchStep />}
      {currentStep === 'results' && <ResultsStep />}
      {currentStep === 'details' && <DetailsStep />}
      {currentStep === 'verify' && <VerifyStep />}
      {currentStep === 'review' && <ReviewStep />}
      {currentStep === 'confirmation' && <ConfirmationStep />}
    </BookingLayout>
  );
};

export default BookingPage;
