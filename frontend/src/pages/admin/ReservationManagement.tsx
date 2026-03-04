import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Snackbar,
  Box,
  TextField,
  Card,
  CardActionArea,
  Stepper,
  Step,
  StepLabel,
  Divider,
  Autocomplete,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  Visibility,
  CheckCircle,
  Pending,
  Cancel,
  Hotel,
  Edit,
  Delete,
  Add,
  WbSunny,
  Celebration,
  EventNote,
  ArrowBack,
  ArrowForward,
  Search,
} from '@mui/icons-material';
import { Reservation, Room, Company } from '../../types';
import { reservationsService, roomsService, settingsService, pricingService, companiesService } from '../../services/api';
import { findApplicablePricing, findStandardPricing, PricingRule } from '../../utils/pricing';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import ReservationDetails from '../../components/admin/ReservationDetails';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import NumberField from '../../components/common/NumberField';
import DateRangePicker from '../../components/common/DateRangePicker';
import { formatMoney } from '../../utils/currency';

const ReservationManagement: React.FC = () => {
  const { t } = useTranslation();
  const { user, permissions } = useAuth();
  const isAdmin = String(user?.role).toLowerCase() === 'admin';
  const canCheckIn = isAdmin || (permissions || []).includes('admin.reservations.checkin');
  const canCancel = isAdmin || (permissions || []).includes('admin.reservations.cancel');
  const canCheckOut = canCheckIn || ['staff', 'maintenance'].includes(String(user?.role).toLowerCase());
  // Using unified admin.schedule.* keys
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState<'all' | 'room' | 'daypass' | 'PasaTarde' | 'event'>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success' as 'success' | 'error' | 'warning' | 'info'
  });
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');

  // Removed Assign Room dialog state and form (feature deprecated)

  // Page-style details view state
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const [editDialog, setEditDialog] = useState<{ open: boolean; reservation: Reservation | null }>({ open: false, reservation: null });
  const [editForm, setEditForm] = useState({
    checkInDate: '',
    checkOutDate: '',
    adults: 1,
    children: 0,
    infants: 0,
    adultPrice: 0,
    childrenPrice: 0,
    totalPrice: 0,
    email: '',
    phone: '',
    specialRequests: '',
    status: 'pending' as 'pending' | 'confirmed' | 'cancelled' | 'completed',
    roomsIds: [] as string[]
  });
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [pricingModel, setPricingModel] = useState<'perGuest' | 'perRoom'>('perGuest');
  const [reservationServices, setReservationServices] = useState({ daypass: true, accommodation: true, pasatarde: true, event: true });
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);

  useEffect(() => {
    settingsService.getSettings()
      .then(res => {
        setPricingModel(res.data.data?.accommodationPricingModel ?? 'perGuest');
        if (res.data.data?.services) setReservationServices(s => ({ ...s, ...res.data.data!.services }));
      })
      .catch(() => {});
  }, []);

  const defaultCreateForm = {
    type: 'room' as 'room' | 'daypass' | 'PasaTarde' | 'event',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    checkInDate: '',
    checkOutDate: '',
    adults: 1,
    children: 0,
    infants: 0,
    specialRequests: '',
    totalPrice: 0,
  };
  const [createDialog, setCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState(defaultCreateForm);
  const [createLoading, setCreateLoading] = useState(false);
  // Multi-step create flow
  const [createStep, setCreateStep] = useState<0 | 1 | 2 | 3>(0);
  const [createGuestPriceApplied, setCreateGuestPriceApplied] = useState(false);
  const [createStep2Error, setCreateStep2Error] = useState<string | null>(null);
  const [createCorporatePriceApplied, setCreateCorporatePriceApplied] = useState(false);
  const [createIsCorporate, setCreateIsCorporate] = useState(false);
  const [createCompanyId, setCreateCompanyId] = useState('');
  const [createCompanyName, setCreateCompanyName] = useState('');
  const [createCompanyOptions, setCreateCompanyOptions] = useState<Company[]>([]);
  const [createCompanySearch, setCreateCompanySearch] = useState('');

  useEffect(() => {
    if (createCompanySearch.length >= 1) {
      companiesService.getCompanies({ search: createCompanySearch, limit: 20 })
        .then(res => setCreateCompanyOptions(res.data.data || []))
        .catch(() => {});
    }
  }, [createCompanySearch]);

  const [createAvailableRooms, setCreateAvailableRooms] = useState<Room[]>([]);
  const [createCheckingAvailability, setCreateCheckingAvailability] = useState(false);
  const [createAvailabilityChecked, setCreateAvailabilityChecked] = useState(false);

  // Check-in / Check-out modal state
  const [opsDialog, setOpsDialog] = useState<{ open: boolean; mode: 'checkin' | 'checkout'; reservation: Reservation | null }>({ open: false, mode: 'checkin', reservation: null });
  const [idDocument, setIdDocument] = useState<string>('');
  const [checkoutFinancial, setCheckoutFinancial] = useState<{ totalCharges: number; totalPayments: number; balance: number; creditAvailability: number } | null>(null);
  const [checkoutFinancialLoading, setCheckoutFinancialLoading] = useState(false);

  useEffect(() => {
    if (!opsDialog.open || opsDialog.mode !== 'checkout' || !opsDialog.reservation?._id) return;
    setCheckoutFinancialLoading(true);
    reservationsService.getReservationFinancial(opsDialog.reservation._id)
      .then((res) => {
        setCheckoutFinancial(res.data.data?.summary || null);
      })
      .catch(() => setCheckoutFinancial(null))
      .finally(() => setCheckoutFinancialLoading(false));
  }, [opsDialog.open, opsDialog.mode, opsDialog.reservation?._id]);

  const fetchReservations = useCallback(async (opts?: { reset?: boolean }) => {
    try {
      const reset = !!opts?.reset;
      if (reset) {
        setPage(1);
        setHasMore(true);
        // Avoid clearing list on subsequent resets to preserve focus/UX
        if (!initialLoadDone) {
          setReservations([]);
        }
      }
      const currentPage = reset ? 1 : page;
      const params: any = { page: currentPage, limit: 20, sort: '-createdAt' };
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterType !== 'all') params.type = filterType;
      if (search.trim()) params.search = search.trim();
      // Pass raw date strings; backend will interpret day boundaries
      if (filterDateFrom) params.dateFrom = filterDateFrom;
      if (filterDateTo) params.dateTo = filterDateTo;
      if (reset && !initialLoadDone) setLoading(true); else setLoadingMore(true);
      setError(null);
      const response = await reservationsService.getReservations(params);
      const newItems = response.data.data || [];
      setReservations(prev => reset ? newItems : [...prev, ...newItems]);
      setInitialLoadDone(true);
      const pagination = (response.data as any).pagination;
      if (pagination) {
        setHasMore(pagination.page < pagination.totalPages);
      } else {
        setHasMore(newItems.length === params.limit);
      }
      if (!reset) setPage(currentPage + 1);
    } catch (error: any) {
      console.error('Error fetching reservations:', error);
      setError(t('admin.reservations.messages.loadFailed'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [page, filterStatus, filterType, search, filterDateFrom, filterDateTo, initialLoadDone, t]);

  const fetchRooms = async () => {
    try {
      const response = await roomsService.getRooms();
      if (response.data.data?.rooms) {
        setRooms(response.data.data.rooms);
      } else if (Array.isArray(response.data.data)) {
        setRooms(response.data.data);
      } else {
        setRooms([]);
      }
    } catch (error: any) {
      console.error('Error fetching rooms:', error);
    }
  };

  useEffect(() => {
    fetchReservations({ reset: true });
    fetchRooms();
    pricingService.getPricing().then(res => setPricingRules(res.data.data || [])).catch(() => {});
    // Run once on mount to initialize data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchReservations({ reset: true }), 300);
    return () => clearTimeout(t);
    // Avoid re-running on page changes (fetchReservations identity); only react to filters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterType, search, filterDateFrom, filterDateTo]);

  // Debounce search input updates to actual filter to reduce re-fetches
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'warning';
      case 'confirmed': return 'success';
      case 'cancelled': return 'error';
      case 'checked-in': return 'info';
      case 'checked-out': return 'default';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Pending />;
      case 'confirmed': return <CheckCircle />;
      case 'cancelled': return <Cancel />;
      default: return <Hotel />;
    }
  };

  const loadAvailableRoomsForDates = useCallback(async (checkIn: string, checkOut: string) => {
    try {
      const res = await roomsService.getAvailableRooms(checkIn, checkOut);
      const list = (res.data.data || []) as any;
      setAvailableRooms(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error('Failed to load available rooms', e);
      setAvailableRooms([]);
    }
  }, []);

  const getAssignableRooms = (reservation: Reservation) => {
    if (!reservation) return [];
    const merged: Room[] = [...availableRooms];
    const ensureWithName = (ridOrObj: any) => {
      const id = typeof ridOrObj === 'object' ? ridOrObj._id : String(ridOrObj || '');
      if (!id) return;
      if (merged.find(r => r._id === id)) return;
      const nameFromObj = typeof ridOrObj === 'object' ? (ridOrObj.name || '') : '';
      const nameFromRooms = rooms.find(r => r._id === id)?.name || '';
      const name = nameFromObj || nameFromRooms || id;
      merged.unshift({ _id: id, name } as any);
    };
    // Include single room if present
    if (reservation.room) ensureWithName(reservation.room as any);
    // Include multi rooms if present
    const currentArray = Array.isArray((reservation as any).rooms) ? (reservation as any).rooms : [];
    currentArray.forEach(ensureWithName);
    return merged;
  };

  // Removed Assign Room handler (feature deprecated)

  const filteredReservations = reservations.filter(reservation =>
    filterStatus === 'all' || reservation.status === filterStatus
  );
  const openDetailsView = (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setShowDetails(true);
  };

  const closeDetailsView = () => {
    setShowDetails(false);
    setSelectedReservation(null);
  };


  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatDateTime = (dateString?: string) => {
    if (!dateString) return t('admin.reservations.na');
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  const toInputDate = (dateString: string) => {
    const d = new Date(dateString);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const addOneDay = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, (m - 1), d);
    dt.setDate(dt.getDate() + 1);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };

  const normalizeRange = (checkIn: string, checkOut?: string) => {
    const ci = checkIn;
    const co = (!checkOut || checkOut <= checkIn) ? addOneDay(checkIn) : checkOut;
    return { ci, co };
  };

  // Refresh available rooms when dates in the edit form change
  useEffect(() => {
    if (!editDialog.open) return;
    // Only load availability for room reservations
    if (editForm.checkInDate && editDialog.reservation?.type === 'room') {
      const { ci, co } = normalizeRange(editForm.checkInDate, editForm.checkOutDate);
      const t = setTimeout(() => loadAvailableRoomsForDates(ci, co), 250);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDialog.open, editForm.checkInDate, editForm.checkOutDate]);

  const isImmutableReservation = (res?: Reservation | null) => {
    if (!res) return false;
    return res.status === 'completed' || res.status === 'cancelled';
  };

  const openEdit = (reservation: Reservation) => {
    setEditDialog({ open: true, reservation });
    setEditForm({
      checkInDate: toInputDate(reservation.checkInDate),
      // For room reservations, default checkout to next day if missing; for others, do not auto-set
      checkOutDate: (() => {
        const ci = toInputDate(reservation.checkInDate);
        if (reservation.type === 'room') {
          return reservation.checkOutDate ? toInputDate(reservation.checkOutDate) : addOneDay(ci);
        }
        return reservation.checkOutDate ? toInputDate(reservation.checkOutDate) : '';
      })(),
      adults: reservation.guestDetails.adults,
      children: reservation.guestDetails.children,
      infants: reservation.guestDetails.infants,
      adultPrice: reservation.adultPrice || 0,
      childrenPrice: reservation.childrenPrice || 0,
      totalPrice: reservation.totalPrice ?? 0,
      email: reservation.contactInfo.email || '',
      phone: reservation.contactInfo.phone || '',
      specialRequests: reservation.specialRequests || '',
      status: reservation.status as any,
      roomsIds: (() => {
        const ids: string[] = [];
        const arr = (reservation as any).rooms as any[] | undefined;
        if (Array.isArray(arr)) {
          arr.forEach((rid: any) => ids.push(String((rid && rid._id) ? rid._id : rid)));
        }
        // Include single room for backward compatibility if no array
        if (ids.length === 0 && reservation.room) {
          ids.push(String((reservation.room && typeof reservation.room === 'object') ? (reservation.room as any)._id : (reservation.room as any)));
        }
        return ids;
      })()
    });
    // Load date-based available rooms for this reservation
    if (reservation.type === 'room') {
      const ci = toInputDate(reservation.checkInDate);
      const co = reservation.checkOutDate ? toInputDate(reservation.checkOutDate) : addOneDay(toInputDate(reservation.checkInDate));
      loadAvailableRoomsForDates(ci, co);
    }
  };

  const handleSaveEdit = async () => {
    if (!editDialog.reservation) return;
    try {
      setLoading(true);
      const immutable = isImmutableReservation(editDialog.reservation);
      let payload: any = {};
      if (!immutable) {
        payload = {
          guestDetails: {
            adults: editForm.adults,
            children: editForm.children,
            infants: editForm.infants,
          },
          contactInfo: {
            email: editForm.email,
            phone: editForm.phone,
          },
          specialRequests: editForm.specialRequests,
        };
      }

      // Include dates only if changed to avoid unnecessary validation
      const originalCheckIn = toInputDate(editDialog.reservation.checkInDate);
      // For room reservations, treat missing original checkout as next day; for others, as empty
      const originalCheckOut = (() => {
        if (editDialog.reservation.type === 'room') {
          return editDialog.reservation.checkOutDate
            ? toInputDate(editDialog.reservation.checkOutDate)
            : addOneDay(toInputDate(editDialog.reservation.checkInDate));
        }
        return editDialog.reservation.checkOutDate
          ? toInputDate(editDialog.reservation.checkOutDate)
          : '';
      })();
      if (editForm.checkInDate !== originalCheckIn) {
        payload.checkInDate = editForm.checkInDate;
      }
      // Only include checkout updates for room or event types; skip for daypass/PasaTarde
      if ((editDialog.reservation.type === 'room' || editDialog.reservation.type === 'event') && (editForm.checkOutDate !== originalCheckOut)) {
        payload.checkOutDate = editForm.checkOutDate;
      }
      const isAdmin = String(user?.role).toLowerCase() === 'admin';
      const canUpdatePrice = isAdmin || permissions.includes('admin.reservations.priceUpdate');
      const canUpdateTotal = isAdmin || permissions.includes('admin.reservations.amountUpdate');
      if (canUpdatePrice) {
        // send price fields only when changed to minimize backend friction
        if ((editDialog.reservation.adultPrice || 0) !== editForm.adultPrice) {
          payload.adultPrice = editForm.adultPrice;
        }
        if ((editDialog.reservation.childrenPrice || 0) !== editForm.childrenPrice) {
          payload.childrenPrice = editForm.childrenPrice;
        }
      }
      if (canUpdateTotal) {
        // IMPORTANT: only send totalPrice if user manually changed it
        if ((editDialog.reservation.totalPrice || 0) !== editForm.totalPrice) {
          payload.totalPrice = editForm.totalPrice;
        }
      }
      let updated = editDialog.reservation as Reservation;
      if (!immutable) {
        const res = await reservationsService.updateReservation(editDialog.reservation._id, payload);
        updated = res.data.data as Reservation;
      }
      if (editDialog.reservation.status !== editForm.status) {
        const statusRes = await reservationsService.updateReservationStatus(editDialog.reservation._id, editForm.status);
        updated = statusRes.data.data as Reservation;
      }

      // Handle rooms assignment changes for room reservations (multi-room support)
      if (!immutable && editDialog.reservation.type === 'room') {
        const originalIds: string[] = (() => {
          const ids: string[] = [];
          const arr = (editDialog.reservation as any).rooms as any[] | undefined;
          if (Array.isArray(arr)) {
            arr.forEach((rid: any) => ids.push(String((rid && rid._id) ? rid._id : rid)));
          }
          if (ids.length === 0 && editDialog.reservation.room) {
            ids.push(String((editDialog.reservation.room && typeof editDialog.reservation.room === 'object') ? (editDialog.reservation.room as any)._id : (editDialog.reservation.room as any)));
          }
          return ids;
        })();
        const desiredIds = Array.isArray(editForm.roomsIds) ? editForm.roomsIds.filter(Boolean) : [];
        const changed = originalIds.length !== desiredIds.length || originalIds.some(id => !desiredIds.includes(id)) || desiredIds.some(id => !originalIds.includes(id));
        if (changed) {
          const assignRes = await reservationsService.assignRooms(editDialog.reservation._id, desiredIds);
          updated = assignRes.data.data as Reservation;
          await fetchRooms();
        }
      }

      setReservations(prev => prev.map(r => r._id === updated._id ? updated : r));
      setSnackbar({ open: true, message: 'Reservation updated successfully!', severity: 'success' });
      setEditDialog({ open: false, reservation: null });
    } catch (error: any) {
      setSnackbar({ open: true, message: error.response?.data?.message || 'Failed to update reservation', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Cancel action handled via status field in edit dialog

  const handleCheckCreateAvailability = async (): Promise<Room[]> => {
    if (!createForm.checkInDate || !createForm.checkOutDate) return [];
    setCreateCheckingAvailability(true);
    setCreateAvailabilityChecked(false);
    try {
      const { ci, co } = normalizeRange(createForm.checkInDate, createForm.checkOutDate);
      const res = await roomsService.getAvailableRooms(ci, co);
      const list = (res.data.data || []) as Room[];
      const raw = Array.isArray(list) ? list : [];
      // Filter by room capacity when capacity fields are set
      const filtered = raw.filter(room => {
        const adultOk = room.adultCapacity === undefined || room.adultCapacity >= createForm.adults;
        const childrenOk = room.childrenCapacity === undefined || room.childrenCapacity >= createForm.children;
        return adultOk && childrenOk;
      });
      setCreateAvailableRooms(filtered);
      setCreateAvailabilityChecked(true);
      return filtered;
    } catch (e) {
      setCreateAvailableRooms([]);
      setCreateAvailabilityChecked(true);
      return [];
    } finally {
      setCreateCheckingAvailability(false);
    }
  };

  const handleContinueStep1 = async () => {
    if (createForm.type !== 'room') {
      setCreateStep(2);
      return;
    }
    // For room type: always (re-)check availability, then advance only if rooms found
    const available = createAvailabilityChecked
      ? createAvailableRooms
      : await handleCheckCreateAvailability();
    if (available.length > 0) {
      setCreateStep(2);
    }
    // If no rooms, stay on step 1 — the alert will show the message
  };

  const handleContinueStep2 = () => {
    if (createIsCorporate && !createCompanyId) {
      setCreateStep2Error(t('admin.reservations.create.companyRequired', 'Please select a company for the corporate booking.'));
      return;
    }
    setCreateStep2Error(null);
    // Detect whether a guest or company pricing rule matches
    const typeToService: Record<string, 'daypass' | 'pasatarde' | 'hospedaje' | null> = {
      daypass: 'daypass', PasaTarde: 'pasatarde', room: 'hospedaje', event: null,
    };
    const service = typeToService[createForm.type];
    let guestApplied = false;
    let corporateApplied = false;
    if (service && createForm.checkInDate) {
      const checkDate = new Date(createForm.checkInDate + 'T12:00:00');
      if (createIsCorporate && createCompanyId) {
        const companyRule = pricingRules.find(r =>
          r.service === service &&
          (r as any).category === 'company' &&
          (r as any).companyId === createCompanyId &&
          r.isActive !== false &&
          r.startDate && r.endDate &&
          checkDate >= new Date(new Date(r.startDate).toDateString()) &&
          checkDate <= new Date(new Date(r.endDate).toDateString())
        );
        corporateApplied = !!companyRule;
      }
      if (!corporateApplied && createForm.email.trim()) {
        const guestRule = pricingRules.find(r =>
          r.service === service &&
          r.category === 'guest' &&
          r.guestEmail === createForm.email.trim() &&
          r.isActive !== false &&
          r.startDate && r.endDate &&
          checkDate >= new Date(new Date(r.startDate).toDateString()) &&
          checkDate <= new Date(new Date(r.endDate).toDateString())
        );
        guestApplied = !!guestRule;
      }
    }
    setCreateGuestPriceApplied(guestApplied);
    setCreateCorporatePriceApplied(corporateApplied);
    setCreateStep(3);
  };

  const handleCreateReservation = async () => {
    try {
      setCreateLoading(true);
      const guests = createForm.adults + createForm.children + createForm.infants;
      const payload: any = {
        type: createForm.type,
        checkInDate: createForm.checkInDate,
        guests,
        guestDetails: {
          adults: createForm.adults,
          children: createForm.children,
          infants: createForm.infants,
        },
        guestName: {
          firstName: createForm.firstName,
          lastName: createForm.lastName,
        },
        contactInfo: {
          email: createForm.email,
          phone: createForm.phone,
        },
        specialRequests: createForm.specialRequests,
        totalPrice: createForm.totalPrice,
      };
      if (createForm.checkOutDate) payload.checkOutDate = createForm.checkOutDate;
      if (createIsCorporate && createCompanyId) {
        payload.isCorporate = true;
        payload.company = createCompanyId;
      }
      const res = await reservationsService.createReservation(payload);
      const newReservation = res.data.data as Reservation;
      setReservations(prev => [newReservation, ...prev]);
      setSnackbar({ open: true, message: t('admin.reservations.messages.createSuccess', 'Reservation created successfully!'), severity: 'success' });
      setCreateDialog(false);
      setCreateForm(defaultCreateForm);
    } catch (error: any) {
      setSnackbar({ open: true, message: error.response?.data?.message || 'Failed to create reservation', severity: 'error' });
    } finally {
      setCreateLoading(false);
    }
  };

  // ── Auto-calculate total price for create form ─────────────────────────
  const calculatedCreateTotal = useMemo(() => {
    const typeToService: Record<string, 'daypass' | 'pasatarde' | 'hospedaje' | null> = {
      daypass: 'daypass',
      PasaTarde: 'pasatarde',
      room: 'hospedaje',
      event: null,
    };
    const service = typeToService[createForm.type];
    if (!service) return null;
    const rulesForService = pricingRules.filter(r => r.service === service);
    if (rulesForService.length === 0) return null;

    // When a date is provided: prefer special pricing that matches the date,
    // then fall back to standard. When no date: use standard directly.
    let rule: PricingRule | null;
    if (createForm.checkInDate) {
      const checkInDate = new Date(createForm.checkInDate + 'T12:00:00');
      // Company pricing has highest priority
      if (createIsCorporate && createCompanyId) {
        const companyRule = pricingRules.find(r =>
          r.service === service &&
          (r as any).category === 'company' &&
          (r as any).companyId === createCompanyId &&
          r.isActive !== false &&
          r.startDate && r.endDate &&
          checkInDate >= new Date(new Date(r.startDate).toDateString()) &&
          checkInDate <= new Date(new Date(r.endDate).toDateString())
        );
        if (companyRule) {
          rule = companyRule;
        } else {
          rule = findApplicablePricing(rulesForService, checkInDate, createForm.email.trim() || undefined) ?? findStandardPricing(rulesForService);
        }
      } else {
        rule = findApplicablePricing(rulesForService, checkInDate, createForm.email.trim() || undefined) ?? findStandardPricing(rulesForService);
      }
    } else {
      rule = findStandardPricing(rulesForService);
    }
    if (!rule) return null;

    if (service === 'hospedaje') {
      let nights = 1;
      if (createForm.checkInDate && createForm.checkOutDate) {
        const ci = new Date(createForm.checkInDate + 'T12:00:00');
        const co = new Date(createForm.checkOutDate + 'T12:00:00');
        nights = Math.max(1, Math.round((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24)));
      }
      if (pricingModel === 'perRoom') {
        return (rule.roomPrice ?? rule.adultPrice) * nights;
      }
      return (rule.adultPrice * createForm.adults + rule.childrenPrice * createForm.children) * nights;
    }
    // daypass / pasatarde
    return rule.adultPrice * createForm.adults + rule.childrenPrice * createForm.children;
  }, [createForm.type, createForm.checkInDate, createForm.checkOutDate, createForm.adults, createForm.children, createForm.email, pricingRules, pricingModel, createIsCorporate, createCompanyId]);

  useEffect(() => {
    if (createDialog && calculatedCreateTotal !== null) {
      setCreateForm(f => ({ ...f, totalPrice: calculatedCreateTotal }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculatedCreateTotal, createDialog]);

  const editImmutable = isImmutableReservation(editDialog.reservation);

  if (loading && !initialLoadDone) {
    return (
      <AdminLayout>
        <Container maxWidth="lg" sx={{ py: 8, textAlign: 'center' }}>
          <CircularProgress size={60} />
          <Typography variant="h6" sx={{ mt: 2 }}>
            {t('admin.reservations.loading')}
          </Typography>
        </Container>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <Container maxWidth="xl" sx={{ py: 4 }}>
        {/* Header */}
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <SectionTitle title={t('admin.reservations.title')} />
            <Typography variant="body1" color="text.secondary">
              {t('admin.reservations.subtitle')}
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => {
              setCreateForm(defaultCreateForm);
              setCreateStep(0);
              setCreateAvailableRooms([]);
              setCreateAvailabilityChecked(false);
              setCreateGuestPriceApplied(false);
              setCreateCorporatePriceApplied(false);
              setCreateIsCorporate(false);
              setCreateCompanyId('');
              setCreateCompanyName('');
              setCreateStep2Error(null);
              setCreateDialog(true);
            }}
            sx={{ mt: 1 }}
          >
            {t('admin.reservations.actions.newReservation', 'New Reservation')}
          </Button>
        </Box>
        {showDetails && selectedReservation ? (
          <ReservationDetails
            reservation={selectedReservation}
            onBack={closeDetailsView}
            onUpdated={(updated) => {
              setSelectedReservation(updated);
              setReservations(prev => prev.map(r => r._id === updated._id ? updated : r));
            }}
          />
        ) : (
        <>
        {/* Alerts */}
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Filters */}
        <Box sx={{ mb: 4, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>{t('admin.reservations.filters.statusLabel')}</InputLabel>
            <Select
              value={filterStatus}
              label={t('admin.reservations.filters.statusLabel')}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <MenuItem value="all">{t('admin.reservations.filters.status.all')}</MenuItem>
              <MenuItem value="pending">{t('admin.reservations.statusLabels.pending')}</MenuItem>
              <MenuItem value="confirmed">{t('admin.reservations.statusLabels.confirmed')}</MenuItem>
              <MenuItem value="checked-in">{t('admin.reservations.statusLabels.checked_in')}</MenuItem>
              <MenuItem value="checked-out">{t('admin.reservations.statusLabels.checked_out')}</MenuItem>
              <MenuItem value="cancelled">{t('admin.reservations.statusLabels.cancelled')}</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>{t('admin.reservations.filters.typeLabel')}</InputLabel>
            <Select
              value={filterType}
              label={t('admin.reservations.filters.typeLabel')}
              onChange={(e) => setFilterType(e.target.value as any)}
            >
                <MenuItem value="all">{t('admin.reservations.filters.types.all')}</MenuItem>
                {reservationServices.accommodation && <MenuItem value="room">{t('admin.reservations.typeLabels.room')}</MenuItem>}
                {reservationServices.daypass && <MenuItem value="daypass">{t('admin.reservations.typeLabels.daypass')}</MenuItem>}
                {reservationServices.pasatarde && <MenuItem value="PasaTarde">{t('admin.reservations.typeLabels.pasatarde')}</MenuItem>}
                {reservationServices.event && <MenuItem value="event">{t('admin.reservations.typeLabels.event')}</MenuItem>}
            </Select>
          </FormControl>
          <TextField size="small" label={t('admin.reservations.filters.search')} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          <TextField size="small" type="date" label={t('admin.reservations.filters.from')} value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label={t('admin.reservations.filters.to')} value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Button onClick={() => {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const today = `${yyyy}-${mm}-${dd}`;
            setFilterDateFrom(today);
            setFilterDateTo(today);
          }}>{t('admin.reservations.filters.today')}</Button>
          <Button color="error" variant="outlined" onClick={() => {
            setFilterStatus('all');
            setFilterType('all');
            setSearch('');
            setSearchInput('');
            setFilterDateFrom('');
            setFilterDateTo('');
          }}>{t('admin.reservations.filters.clear')}</Button>
        </Box>

        {/* Reservations Table */}
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
              {filteredReservations.map((reservation) => (
                <TableRow key={reservation._id}>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <Button variant="text" size="small" onClick={() => openDetailsView(reservation)} sx={{ p: 0, minWidth: 0, textTransform: 'none' }}>
                        <Typography variant="body2" fontWeight="medium">
                          {reservation.guestName && reservation.guestName.firstName
                            ? `${reservation.guestName.firstName} ${reservation.guestName.lastName || ''}`.trim()
                            : (reservation.user && typeof reservation.user === 'object'
                              ? `${reservation.user.firstName} ${reservation.user.lastName}`
                              : t('admin.dashboard.recentReservations.guestFallback'))}
                        </Typography>
                      </Button>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', wordBreak: 'break-word' }}>
                        {reservation.contactInfo?.email}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={(() => {
                        const type = reservation.type || 'unknown';
                        const key = type === 'PasaTarde' ? 'pasatarde' : type;
                        return t(`admin.reservations.typeLabels.${key}`);
                      })()}
                      size="small"
                      sx={{ textTransform: 'capitalize' }}
                    />
                  </TableCell>
                  <TableCell>
                    <Box>
                      <Typography variant="body2">
                        {formatDate(reservation.checkInDate)} - {reservation.checkOutDate ? formatDate(reservation.checkOutDate) : t('admin.reservations.na')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {reservation.totalNights} {t('admin.reservations.nights')}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>{reservation.guests}</TableCell>
                  <TableCell>
                    <Chip
                      icon={getStatusIcon(reservation.status)}
                      label={t(`admin.reservations.statusLabels.${reservation.status.replace('-', '_')}`)}
                      color={getStatusColor(reservation.status) as any}
                      size="small"
                      sx={{ textTransform: 'capitalize' }}
                    />
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const rooms = (reservation as any).rooms as any[] | undefined;
                      if (Array.isArray(rooms) && rooms.length > 0) {
                        return (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {rooms.map((rm: any) => (
                              <Chip key={rm?._id || String(rm)} label={typeof rm === 'object' ? rm.name : String(rm)} size="small" />
                            ))}
                          </Box>
                        );
                      }
                      if (reservation.room && typeof reservation.room === 'object') {
                        return (
                          <Box>
                            <Typography variant="body2" fontWeight="medium">
                              {reservation.room.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {t('admin.schedule.table.room')} {reservation.room._id?.slice(-4)}
                            </Typography>
                          </Box>
                        );
                      }
                      return (
                        <Typography variant="body2" color="text.secondary">
                          {t('admin.schedule.notAssigned')}
                        </Typography>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      {formatMoney(reservation.estimatedTotal ?? reservation.totalPrice ?? 0)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const total = reservation.estimatedTotal ?? reservation.totalPrice ?? 0;
                      const paid = (reservation as any).totalPayments ?? 0;
                      const pendingBalance = Math.max(0, total - paid);
                      const isPaid = pendingBalance === 0;
                      return (
                        <Chip
                          label={isPaid ? t('admin.reservations.paymentStatus.paid') : t('admin.reservations.paymentStatus.pending')}
                          color={isPaid ? 'success' : 'warning'}
                          size="small"
                          sx={{ textTransform: 'capitalize' }}
                        />
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {/* Assign Room feature removed */}
                      <Tooltip title={t('admin.reservations.actions.viewDetails')}>
                        <IconButton size="small" color="info" onClick={() => openDetailsView(reservation)}>
                          <Visibility />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('admin.reservations.actions.editReservation')}>
                        <IconButton size="small" color="secondary" onClick={() => openEdit(reservation)}>
                          <Edit />
                        </IconButton>
                      </Tooltip>
                      {/* Admin-only remove action */}
                      {String(user?.role).toLowerCase() === 'admin' && (
                        <Tooltip title={t('admin.reservations.actions.removeReservation')}>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={async () => {
                              const ok = window.confirm(t('admin.reservations.dialog.deletePrompt'));
                              if (!ok) return;
                              try {
                                await reservationsService.deleteReservation(reservation._id);
                                setReservations(prev => prev.filter(r => r._id !== reservation._id));
                                setSnackbar({ open: true, message: t('admin.reservations.messages.removed'), severity: 'success' });
                              } catch (err: any) {
                                setSnackbar({ open: true, message: err?.response?.data?.message || t('admin.reservations.messages.removeFailed'), severity: 'error' });
                              }
                            }}
                          >
                            <Delete />
                          </IconButton>
                        </Tooltip>
                      )}
                      {reservation.type === 'room' && (
                        <>
                          {!reservation.actualCheckInAt && canCheckIn && reservation.status !== 'cancelled' && (
                            <Tooltip title={(() => {
                              if (!reservation.room) return t('admin.reservations.tooltips.assignBeforeCheckin');
                              const now = new Date();
                              const ci = new Date(reservation.checkInDate);
                              const co = reservation.checkOutDate ? new Date(reservation.checkOutDate) : null;
                              const dateAllowed = now >= ci && (!co || now < co);
                              return dateAllowed ? t('admin.reservations.tooltips.checkin') : t('admin.reservations.tooltips.checkinDateGuard');
                            })()}>
                              <span>
                                <Button
                                  size="small"
                                  variant="contained"
                                  disabled={(() => {
                                    const hasRoom = !!reservation.room || (Array.isArray((reservation as any).rooms) && (reservation as any).rooms.length > 0);
                                    if (!hasRoom) return true;
                                    const now = new Date();
                                    const ci = new Date(reservation.checkInDate);
                                    const co = reservation.checkOutDate ? new Date(reservation.checkOutDate) : null;
                                    const dateAllowed = now >= ci && (!co || now < co);
                                    return !dateAllowed;
                                  })()}
                                  onClick={() => {
                                    // Guard: require assigned room before check-in to avoid backend 400
                                    const hasRoom = !!reservation.room || (Array.isArray((reservation as any).rooms) && (reservation as any).rooms.length > 0);
                                    if (!hasRoom) {
                                      setSnackbar({ open: true, message: t('admin.reservations.messages.assignBeforeCheckin'), severity: 'warning' });
                                      return;
                                    }
                                    const now = new Date();
                                    const ci = new Date(reservation.checkInDate);
                                    const co = reservation.checkOutDate ? new Date(reservation.checkOutDate) : null;
                                    const dateAllowed = now >= ci && (!co || now < co);
                                    if (!dateAllowed) {
                                      setSnackbar({ open: true, message: t('admin.reservations.messages.checkinDateGuard'), severity: 'warning' });
                                      return;
                                    }
                                    setOpsDialog({ open: true, mode: 'checkin', reservation });
                                    setIdDocument('');
                                  }}
                                >
                                  {t('admin.reservations.actions.checkin')}
                                </Button>
                              </span>
                            </Tooltip>
                          )}
                          {canCheckOut && reservation.actualCheckInAt && !reservation.actualCheckOutAt && (
                            <Button size="small" variant="outlined" onClick={() => setOpsDialog({ open: true, mode: 'checkout', reservation })}>{t('admin.reservations.actions.checkout')}</Button>
                          )}
                        </>
                      )}
                      {reservation.type !== 'room' && (
                        <>
                          {!reservation.actualCheckInAt && canCheckIn && reservation.status !== 'cancelled' && (
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => {
                                setOpsDialog({ open: true, mode: 'checkin', reservation });
                                setIdDocument('');
                              }}
                            >
                              {t('admin.reservations.actions.checkin')}
                            </Button>
                          )}
                          {canCheckOut && reservation.actualCheckInAt && !reservation.actualCheckOutAt && (
                            <Button size="small" variant="outlined" onClick={() => setOpsDialog({ open: true, mode: 'checkout', reservation })}>{t('admin.reservations.actions.checkout')}</Button>
                          )}
                        </>
                      )}
                      {/* Cancel action removed; use Edit to change status */}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {filteredReservations.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="h6" color="text.secondary">
              {t('admin.reservations.empty.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {filterStatus === 'all'
                ? t('admin.reservations.empty.initial')
                : t('admin.reservations.empty.filtered', { status: t(`admin.reservations.statusLabels.${filterStatus.replace('-', '_')}`) })
              }
            </Typography>
          </Box>
        )}

        {hasMore && (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <Button variant="outlined" onClick={() => fetchReservations()} disabled={loadingMore}>
              {loadingMore ? t('admin.reservations.loadingMore') : t('admin.reservations.loadMore')}
            </Button>
          </Box>
        )}

        </>
        )}

        {/* Assign Room dialog removed */}

        {/* Edit Reservation Dialog */}
        <Dialog
          open={editDialog.open}
          onClose={() => setEditDialog({ open: false, reservation: null })}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>{t('admin.reservations.dialog.editTitle')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
              {editDialog.reservation && (
                <Box>
                  <Typography variant="subtitle2">{t('admin.reservations.form.guest')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {editDialog.reservation.guestName && editDialog.reservation.guestName.firstName
                      ? `${editDialog.reservation.guestName.firstName} ${editDialog.reservation.guestName.lastName || ''}`.trim()
                      : (editDialog.reservation.user && typeof editDialog.reservation.user === 'object'
                        ? `${editDialog.reservation.user.firstName} ${editDialog.reservation.user.lastName}`
                        : t('admin.dashboard.recentReservations.guestFallback'))}
                  </Typography>
                </Box>
              )}
              <TextField
                label={t('admin.reservations.form.checkinDate')}
                type="date"
                value={editForm.checkInDate}
                onChange={(e) => setEditForm({ ...editForm, checkInDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                disabled={editImmutable}
              />
              {(editDialog.reservation?.type === 'room' || editDialog.reservation?.type === 'event') && (
                <TextField
                  label={t('admin.reservations.form.checkoutDate')}
                  type="date"
                  value={editForm.checkOutDate}
                  onChange={(e) => setEditForm({ ...editForm, checkOutDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  disabled={editImmutable}
                />
              )}
              {editDialog.reservation?.type === 'room' && (
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  <TextField
                    label={t('admin.reservations.form.actualCheckin')}
                    value={formatDateTime(editDialog.reservation.actualCheckInAt)}
                    InputProps={{ readOnly: true }}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label={t('admin.reservations.form.actualCheckout')}
                    value={formatDateTime(editDialog.reservation.actualCheckOutAt)}
                    InputProps={{ readOnly: true }}
                    InputLabelProps={{ shrink: true }}
                  />
                </Box>
              )}
              {editDialog.reservation?.type === 'room' && (
                <FormControl fullWidth>
                  <InputLabel>{t('admin.reservations.form.assignedRoom')}</InputLabel>
                  <Select
                    multiple
                    value={editForm.roomsIds}
                    label={t('admin.reservations.form.assignedRoom')}
                    onChange={(e) => setEditForm({ ...editForm, roomsIds: (e.target.value as string[]) })}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {(selected as string[]).map((id) => {
                          const rm = getAssignableRooms(editDialog.reservation!).find(r => r._id === id);
                          return <Chip key={id} label={rm ? rm.name : id} size="small" />;
                        })}
                      </Box>
                    )}
                    disabled={editImmutable}
                  >
                    {editDialog.reservation && getAssignableRooms(editDialog.reservation).map((room) => (
                      <MenuItem key={room._id} value={room._id}>
                        <Box>
                          <Typography variant="body2">{room.name}</Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <FormControl fullWidth>
                <InputLabel>{t('admin.reservations.form.status')}</InputLabel>
                <Select
                  value={editForm.status}
                  label={t('admin.reservations.form.status')}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value as any })}
                >
                  <MenuItem value="pending">{t('admin.reservations.statusLabels.pending')}</MenuItem>
                  <MenuItem value="confirmed">{t('admin.reservations.statusLabels.confirmed')}</MenuItem>
                  <MenuItem value="cancelled" disabled={!canCancel}>{t('admin.reservations.statusLabels.cancelled')}</MenuItem>
                  <MenuItem value="completed">{t('admin.reservations.statusLabels.completed')}</MenuItem>
                </Select>
              </FormControl>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <NumberField
                  label={t('admin.reservations.form.adults')}
                  value={editForm.adults}
                  onChange={(val) => setEditForm({ ...editForm, adults: val == null ? 1 : val })}
                  min={1}
                  disabled={editImmutable}
                />
                <NumberField
                  label={t('admin.reservations.form.children')}
                  value={editForm.children}
                  onChange={(val) => setEditForm({ ...editForm, children: val == null ? 0 : val })}
                  min={0}
                  disabled={editImmutable}
                />
                <NumberField
                  label={t('admin.reservations.form.infants')}
                  value={editForm.infants}
                  onChange={(val) => setEditForm({ ...editForm, infants: val == null ? 0 : val })}
                  min={0}
                  disabled={editImmutable}
                />
              </Box>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, 1fr)', mt: 1 }}>
                {editDialog.reservation?.type === 'room' && pricingModel === 'perRoom' ? (
                  <NumberField
                    label={t('admin.pricing.form.roomPrice', 'Room Price')}
                    value={editForm.adultPrice}
                    onChange={(val) => setEditForm({ ...editForm, adultPrice: val == null ? 0 : val })}
                    min={0}
                    disabled={editImmutable || !(String(user?.role).toLowerCase() === 'admin' || permissions.includes('admin.reservations.priceUpdate'))}
                    inputProps={{ step: 0.01 }}
                  />
                ) : (
                  <>
                    <NumberField
                      label={t('admin.reservations.form.adultPrice')}
                      value={editForm.adultPrice}
                      onChange={(val) => setEditForm({ ...editForm, adultPrice: val == null ? 0 : val })}
                      min={0}
                      disabled={editImmutable || !(String(user?.role).toLowerCase() === 'admin' || permissions.includes('admin.reservations.priceUpdate'))}
                      inputProps={{ step: 0.01 }}
                    />
                    <NumberField
                      label={t('admin.reservations.form.childrenPrice')}
                      value={editForm.childrenPrice}
                      onChange={(val) => setEditForm({ ...editForm, childrenPrice: val == null ? 0 : val })}
                      min={0}
                      disabled={editImmutable || !(String(user?.role).toLowerCase() === 'admin' || permissions.includes('admin.reservations.priceUpdate'))}
                      inputProps={{ step: 0.01 }}
                    />
                  </>
                )}
              </Box>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr' }}>
                <NumberField
                  label={t('admin.reservations.form.totalPrice')}
                  value={editForm.totalPrice}
                  onChange={(val) => setEditForm({ ...editForm, totalPrice: val == null ? 0 : val })}
                  min={0}
                  disabled={editImmutable || !(String(user?.role).toLowerCase() === 'admin' || permissions.includes('admin.reservations.amountUpdate'))}
                  inputProps={{ step: 0.01 }}
                />
              </Box>
              <TextField
                label={t('admin.reservations.form.email')}
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                disabled={editImmutable}
              />
              <TextField
                label={t('admin.reservations.form.phone')}
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                disabled={editImmutable}
              />
              <TextField
                label={t('admin.reservations.form.specialRequests')}
                multiline rows={3}
                value={editForm.specialRequests}
                onChange={(e) => setEditForm({ ...editForm, specialRequests: e.target.value })}
                disabled={editImmutable}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialog({ open: false, reservation: null })}>{t('admin.reservations.actions.cancel')}</Button>
            <Button variant="contained" onClick={handleSaveEdit}>{t('admin.reservations.actions.saveChanges')}</Button>
          </DialogActions>
        </Dialog>

        {/* Check-In / Check-Out Dialog */}
        <Dialog
          open={opsDialog.open}
          onClose={() => setOpsDialog({ open: false, mode: 'checkin', reservation: null })}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>{opsDialog.mode === 'checkin' ? t('admin.reservations.checkin.title') : t('admin.reservations.checkout.title')}</DialogTitle>
          <DialogContent>
            {opsDialog.mode === 'checkin' ? (
              <Box sx={{ display: 'grid', gap: 2 }}>
                <Alert severity="info">{t('admin.reservations.checkin.provideId')}</Alert>
                <TextField
                  label={t('admin.reservations.checkin.idDocument')}
                  value={idDocument}
                  onChange={(e) => setIdDocument(e.target.value)}
                  required
                />
              </Box>
            ) : (
              <Box sx={{ display: 'grid', gap: 1.5 }}>
                <Alert severity="warning">{t('admin.reservations.checkout.confirm')}</Alert>
                {checkoutFinancialLoading ? (
                  <Typography variant="body2" color="text.secondary">{t('common.loading', 'Loading...')}</Typography>
                ) : checkoutFinancial ? (
                  <Box sx={{ display: 'grid', gap: 0.5 }}>
                    <Typography variant="body2"><strong>{t('admin.reservations.checkout.totalCharges', 'Total charges')}:</strong> ${checkoutFinancial.totalCharges.toFixed(2)}</Typography>
                    <Typography variant="body2"><strong>{t('admin.reservations.checkout.paymentsMade', 'Payments made')}:</strong> ${checkoutFinancial.totalPayments.toFixed(2)}</Typography>
                    <Typography variant="body2"><strong>{t('admin.reservations.checkout.remainingBalance', 'Remaining balance')}:</strong> ${checkoutFinancial.balance.toFixed(2)}</Typography>
                    <Typography variant="body2"><strong>{t('admin.reservations.checkout.availableCredit', 'Available credit')}:</strong> ${checkoutFinancial.creditAvailability.toFixed(2)}</Typography>
                    {checkoutFinancial.balance > 0 && (
                      <Alert severity="info">{t('admin.reservations.checkout.pendingHint', 'You can add a payment from Reservation Details or use credit to complete checkout.')}</Alert>
                    )}
                  </Box>
                ) : null}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpsDialog({ open: false, mode: 'checkin', reservation: null })}>{t('admin.reservations.actions.cancel')}</Button>
            {opsDialog.mode === 'checkout' && checkoutFinancial && checkoutFinancial.balance > 0 && (
              <Button
                variant="outlined"
                onClick={() => {
                  if (!opsDialog.reservation) return;
                  setSelectedReservation(opsDialog.reservation);
                  setShowDetails(true);
                  setOpsDialog({ open: false, mode: 'checkin', reservation: null });
                }}
              >
                {t('admin.reservations.checkout.addPayment', 'Add Payment')}
              </Button>
            )}
            {opsDialog.mode === 'checkout' && checkoutFinancial && checkoutFinancial.balance > 0 && (
              <Button
                variant="outlined"
                onClick={async () => {
                  if (!opsDialog.reservation) return;
                  try {
                    setLoading(true);
                    const res = await reservationsService.useCreditAndCheckout(opsDialog.reservation._id);
                    const updated = res.data.data as Reservation;
                    setReservations(prev => prev.map(r => r._id === updated._id ? updated : r));
                    setSnackbar({ open: true, message: t('admin.reservations.messages.checkoutSuccess'), severity: 'success' });
                    await fetchRooms();
                    setOpsDialog({ open: false, mode: 'checkin', reservation: null });
                  } catch (e: any) {
                    const msg = e?.response?.data?.message || e?.message || t('admin.reservations.messages.operationFailed');
                    setSnackbar({ open: true, message: msg, severity: 'error' });
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                {t('admin.reservations.checkout.useCredit', 'Use Credit')}
              </Button>
            )}
            <Button
              variant="contained"
              onClick={async () => {
                if (!opsDialog.reservation) return;
                try {
                  setLoading(true);
                  if (opsDialog.mode === 'checkin') {
                    const isRoom = opsDialog.reservation.type === 'room';
                    if (isRoom && !idDocument.trim()) {
                      setSnackbar({ open: true, message: t('admin.reservations.checkin.idRequired'), severity: 'error' });
                    } else {
                      const payload = isRoom ? { identificationDocument: idDocument.trim() } : { identificationDocument: '' };
                      const res = await reservationsService.checkInReservation(opsDialog.reservation._id, payload as any);
                      const updated = res.data.data as Reservation;
                      setReservations(prev => prev.map(r => r._id === updated._id ? updated : r));
                      setSnackbar({ open: true, message: t('admin.reservations.messages.checkinSuccess'), severity: 'success' });
                      setOpsDialog({ open: false, mode: 'checkin', reservation: null });
                    }
                  } else {
                    const res = await reservationsService.checkOutReservation(opsDialog.reservation._id, {});
                    const updated = res.data.data as Reservation;
                    setReservations(prev => prev.map(r => r._id === updated._id ? updated : r));
                    setSnackbar({ open: true, message: t('admin.reservations.messages.checkoutSuccess'), severity: 'success' });
                    // Refresh rooms so the newly freed room appears available
                    await fetchRooms();
                    setOpsDialog({ open: false, mode: 'checkin', reservation: null });
                  }
                } catch (e: any) {
                  const msg = e?.response?.data?.message || e?.message || t('admin.reservations.messages.operationFailed');
                  setSnackbar({ open: true, message: msg, severity: 'error' });
                } finally {
                  setLoading(false);
                }
              }}
              disabled={(opsDialog.mode === 'checkin' && opsDialog.reservation?.type === 'room' && !idDocument.trim()) || checkoutFinancialLoading}
            >
              {opsDialog.mode === 'checkin' ? t('admin.reservations.checkin.confirm') : t('admin.reservations.checkout.confirmButton')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* ── Create Reservation Dialog (multi-step) ─────────────────── */}
        <Dialog
          open={createDialog}
          onClose={() => setCreateDialog(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle sx={{ pb: 1 }}>
            {createStep === 0
              ? t('admin.reservations.actions.newReservation', 'New Reservation')
              : createStep === 1
              ? t('admin.reservations.create.step1Title', 'Dates & Guests')
              : createStep === 2
              ? t('admin.reservations.create.step2Title', 'Guest Details')
              : t('admin.reservations.create.step3Title', 'Summary')}
          </DialogTitle>

          {/* Stepper — only show on steps 1 & 2 */}
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

            {/* ── STEP 0: Service Type Cards ─────────────────────────── */}
            {createStep === 0 && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('admin.reservations.create.pickServicePrompt', 'Select the type of reservation you want to create.')}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
                  {reservationServices.accommodation && (
                    <Card variant="outlined" sx={{ borderRadius: 2, '&:hover': { borderColor: 'primary.main', boxShadow: 3 }, transition: 'box-shadow 0.2s' }}>
                      <CardActionArea
                        onClick={() => {
                          setCreateForm(f => ({ ...f, type: 'room' }));
                          setCreateAvailableRooms([]);
                          setCreateAvailabilityChecked(false);
                          setCreateStep(1);
                        }}
                        sx={{ p: 2.5 }}
                      >
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <Hotel sx={{ fontSize: 40, color: 'primary.main' }} />
                          <Typography variant="subtitle1" fontWeight={700}>
                            {t('admin.reservations.typeLabels.room', 'Accommodation')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" textAlign="center">
                            {t('admin.reservations.create.roomDesc', 'Multi-night room stay')}
                          </Typography>
                        </Box>
                      </CardActionArea>
                    </Card>
                  )}
                  {reservationServices.daypass && (
                    <Card variant="outlined" sx={{ borderRadius: 2, '&:hover': { borderColor: 'primary.main', boxShadow: 3 }, transition: 'box-shadow 0.2s' }}>
                      <CardActionArea
                        onClick={() => {
                          setCreateForm(f => ({ ...f, type: 'daypass', checkOutDate: '' }));
                          setCreateStep(1);
                        }}
                        sx={{ p: 2.5 }}
                      >
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <WbSunny sx={{ fontSize: 40, color: 'warning.main' }} />
                          <Typography variant="subtitle1" fontWeight={700}>
                            {t('admin.reservations.typeLabels.daypass', 'Day Pass')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" textAlign="center">
                            {t('admin.reservations.create.daypassDesc', 'Full-day pool & facilities')}
                          </Typography>
                        </Box>
                      </CardActionArea>
                    </Card>
                  )}
                  {reservationServices.pasatarde && (
                    <Card variant="outlined" sx={{ borderRadius: 2, '&:hover': { borderColor: 'primary.main', boxShadow: 3 }, transition: 'box-shadow 0.2s' }}>
                      <CardActionArea
                        onClick={() => {
                          setCreateForm(f => ({ ...f, type: 'PasaTarde', checkOutDate: '' }));
                          setCreateStep(1);
                        }}
                        sx={{ p: 2.5 }}
                      >
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <Celebration sx={{ fontSize: 40, color: 'secondary.main' }} />
                          <Typography variant="subtitle1" fontWeight={700}>
                            {t('admin.reservations.typeLabels.pasatarde', 'Pasa Tarde')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" textAlign="center">
                            {t('admin.reservations.create.pasatardeDesc', 'Afternoon experience')}
                          </Typography>
                        </Box>
                      </CardActionArea>
                    </Card>
                  )}
                  {reservationServices.event && (
                    <Card variant="outlined" sx={{ borderRadius: 2, '&:hover': { borderColor: 'primary.main', boxShadow: 3 }, transition: 'box-shadow 0.2s' }}>
                      <CardActionArea
                        onClick={() => {
                          setCreateForm(f => ({ ...f, type: 'event' }));
                          setCreateStep(1);
                        }}
                        sx={{ p: 2.5 }}
                      >
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <EventNote sx={{ fontSize: 40, color: 'info.main' }} />
                          <Typography variant="subtitle1" fontWeight={700}>
                            {t('admin.reservations.typeLabels.event', 'Event')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" textAlign="center">
                            {t('admin.reservations.create.eventDesc', 'Private event or celebration')}
                          </Typography>
                        </Box>
                      </CardActionArea>
                    </Card>
                  )}
                </Box>
              </Box>
            )}

            {/* ── STEP 1: Dates & Guests ─────────────────────────────── */}
            {createStep === 1 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

                {/* Availability result pinned at top — visible without scrolling */}
                {createForm.type === 'room' && createAvailabilityChecked && (
                  <Alert
                    severity={createAvailableRooms.length > 0 ? 'success' : 'error'}
                    sx={{ borderRadius: 2 }}
                  >
                    {createAvailableRooms.length > 0
                      ? t('admin.reservations.create.roomsAvailable', '{{count}} room(s) available for your selection.', { count: createAvailableRooms.length })
                      : t('admin.reservations.create.noRoomsAvailable', 'No rooms available for the selected dates and guest count. Try different dates or fewer guests.')}
                  </Alert>
                )}

                {/* Date picker — dual-month range for room/event; single date for daypass/PasaTarde */}
                {(createForm.type === 'room' || createForm.type === 'event') ? (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>
                      {t('admin.reservations.create.selectDateRange', 'Select dates')}
                    </Typography>
                    <DateRangePicker
                      startDate={createForm.checkInDate}
                      endDate={createForm.checkOutDate}
                      onChange={(start, end) => {
                        setCreateForm(f => ({ ...f, checkInDate: start, checkOutDate: end }));
                        setCreateAvailabilityChecked(false);
                      }}
                    />
                  </Box>
                ) : (
                  <TextField
                    fullWidth
                    size="small"
                    type="date"
                    label={t('admin.reservations.form.checkIn', 'Date')}
                    value={createForm.checkInDate}
                    onChange={(e) => setCreateForm(f => ({ ...f, checkInDate: e.target.value }))}
                    InputLabelProps={{ shrink: true }}
                    required
                  />
                )}

                <Divider />

                {/* Guest counts */}
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('admin.reservations.create.guestCount', 'Guests')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <NumberField
                      label={t('admin.reservations.form.adults', 'Adults')}
                      value={createForm.adults}
                      min={1}
                      onChange={(v) => {
                        setCreateForm(f => ({ ...f, adults: v ?? 1 }));
                        setCreateAvailabilityChecked(false);
                      }}
                    />
                    <NumberField
                      label={t('admin.reservations.form.children', 'Children')}
                      value={createForm.children}
                      min={0}
                      onChange={(v) => {
                        setCreateForm(f => ({ ...f, children: v ?? 0 }));
                        setCreateAvailabilityChecked(false);
                      }}
                    />
                    <NumberField
                      label={t('admin.reservations.form.infants', 'Infants')}
                      value={createForm.infants}
                      min={0}
                      onChange={(v) => setCreateForm(f => ({ ...f, infants: v ?? 0 }))}
                    />
                  </Box>
                </Box>

              </Box>
            )}

            {/* ── STEP 2: Guest Info ─────────────────────────────────── */}
            {createStep === 2 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {createStep2Error && (
                  <Alert severity="error" onClose={() => setCreateStep2Error(null)}>{createStep2Error}</Alert>
                )}
                {/* Summary chip */}
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip size="small" label={t(`admin.reservations.typeLabels.${createForm.type === 'PasaTarde' ? 'pasatarde' : createForm.type}`, createForm.type)} color="primary" variant="outlined" />
                  {createForm.checkInDate && <Chip size="small" label={createForm.checkInDate} variant="outlined" />}
                  {createForm.checkOutDate && <Chip size="small" label={`→ ${createForm.checkOutDate}`} variant="outlined" />}
                  <Chip size="small" label={`${createForm.adults}A ${createForm.children}C ${createForm.infants}I`} variant="outlined" />
                </Box>

                {/* Guest name */}
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label={t('admin.reservations.form.firstName', 'First Name')}
                    value={createForm.firstName}
                    onChange={(e) => setCreateForm(f => ({ ...f, firstName: e.target.value }))}
                    required
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={t('admin.reservations.form.lastName', 'Last Name')}
                    value={createForm.lastName}
                    onChange={(e) => setCreateForm(f => ({ ...f, lastName: e.target.value }))}
                  />
                </Box>

                {/* Contact */}
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label={t('admin.reservations.form.email', 'Email')}
                    type="email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm(f => ({ ...f, email: e.target.value }))}
                    required
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={t('admin.reservations.form.phone', 'Phone')}
                    value={createForm.phone}
                    onChange={(e) => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </Box>

                {/* Total Price */}
                <TextField
                  fullWidth
                  size="small"
                  label={t('admin.reservations.form.totalPrice', 'Total Price')}
                  type="number"
                  value={createForm.totalPrice}
                  onChange={(e) => setCreateForm(f => ({ ...f, totalPrice: parseFloat(e.target.value) || 0 }))}
                  inputProps={{ min: 0, step: 0.01 }}
                  helperText={
                    calculatedCreateTotal !== null
                      ? `${t('admin.reservations.form.calculatedTotal', 'Auto-calculated')}: $${calculatedCreateTotal.toFixed(2)}${
                          createForm.totalPrice !== calculatedCreateTotal
                            ? ` · ${t('admin.reservations.form.manualOverride', 'manually overridden')}`
                            : ''
                        }`
                      : t('admin.reservations.form.noPricingRule', 'No pricing rule found for this date')
                  }
                />

                {/* Special Requests */}
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  rows={3}
                  label={t('admin.reservations.form.specialRequests', 'Special Requests')}
                  value={createForm.specialRequests}
                  onChange={(e) => setCreateForm(f => ({ ...f, specialRequests: e.target.value }))}
                />

                {/* Corporate Booking */}
                <FormControlLabel
                  control={
                    <Switch
                      checked={createIsCorporate}
                      onChange={(e) => {
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
                    onChange={(_, newVal: Company | null) => {
                      setCreateCompanyId(newVal?._id || '');
                      setCreateCompanyName(newVal?.name || '');
                    }}
                    onInputChange={(_, v) => setCreateCompanySearch(v)}
                    renderInput={(params) => (
                      <TextField {...params} size="small" label={t('admin.reservations.create.company', 'Company')} required />
                    )}
                  />
                )}
              </Box>
            )}

            {/* ── STEP 3: Summary ───────────────────────────────────── */}
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
                      <Typography variant="body2" fontWeight={600}>
                        {t(`admin.reservations.typeLabels.${createForm.type === 'PasaTarde' ? 'pasatarde' : createForm.type}`, createForm.type)}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.dates', 'Dates')}</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {createForm.checkInDate}{createForm.checkOutDate ? ` → ${createForm.checkOutDate}` : ''}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('admin.reservations.table.guests', 'Guests')}</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {createForm.adults} {t('admin.reservations.form.adults', 'Adults')},{' '}
                        {createForm.children} {t('admin.reservations.form.children', 'Children')},{' '}
                        {createForm.infants} {t('admin.reservations.form.infants', 'Infants')}
                      </Typography>
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
                    <Box sx={{ gridColumn: '1 / -1', pt: 1.5, mt: 0.5, borderTop: 1, borderColor: 'divider' }}>
                      <Typography variant="h6" fontWeight={700} color="primary.main">
                        {t('admin.reservations.form.totalPrice', 'Total')}: {formatMoney(createForm.totalPrice)}
                      </Typography>
                    </Box>
                  </Box>
                </Paper>
              </Box>
            )}

          </DialogContent>

          <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
            {/* Cancel always */}
            <Button onClick={() => setCreateDialog(false)} disabled={createLoading}>
              {t('admin.reservations.actions.cancel')}
            </Button>

            {/* Back button on steps 1 and 2 */}
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

            {/* Step 1 room: Check Availability */}
            {createStep === 1 && createForm.type === 'room' && (
              <Button
                variant="outlined"
                startIcon={createCheckingAvailability ? <CircularProgress size={16} /> : <Search />}
                onClick={handleCheckCreateAvailability}
                disabled={createCheckingAvailability || !createForm.checkInDate || !createForm.checkOutDate}
              >
                {t('admin.reservations.create.checkAvailability', 'Check Availability')}
              </Button>
            )}

            {/* Step 1: Continue */}
            {createStep === 1 && (
              <Button
                variant="contained"
                endIcon={createCheckingAvailability ? <CircularProgress size={16} color="inherit" /> : <ArrowForward />}
                onClick={handleContinueStep1}
                disabled={
                  !createForm.checkInDate ||
                  (createForm.type === 'room' && !createForm.checkOutDate) ||
                  createCheckingAvailability
                }
              >
                {t('common.continue', 'Continue')}
              </Button>
            )}

            {/* Step 2: Continue to summary */}
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

            {/* Step 3: Book Reservation */}
            {createStep === 3 && (
              <Button
                variant="contained"
                onClick={handleCreateReservation}
                disabled={createLoading || !createForm.firstName.trim() || !createForm.email.trim() || !createForm.checkInDate}
              >
                {createLoading ? t('common.saving', 'Saving...') : t('admin.reservations.create.bookReservation', 'Book Reservation')}
              </Button>
            )}
          </DialogActions>
        </Dialog>

        {/* Snackbar for notifications */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={6000}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
        >
          <Alert
            onClose={() => setSnackbar({ ...snackbar, open: false })}
            severity={snackbar.severity}
            sx={{ width: '100%' }}
          >
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Container>
    </AdminLayout>
  );
};

export default ReservationManagement;
