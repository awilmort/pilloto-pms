import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Snackbar,
  Typography,
} from '@mui/material';
import { Reservation, Room } from '../../types';
import { reservationsService, roomsService, servicesService } from '../../services/api';
import AdminLayout from '../../components/admin/AdminLayout';
import ReservationDetails from '../../components/admin/ReservationDetails';
import EditReservationDialog from '../../components/admin/reservations/EditReservationDialog';
import CheckInOutDialog from '../../components/admin/reservations/CheckInOutDialog';
import CreateReservationDialog from '../../components/admin/reservations/CreateReservationDialog';
import ReservationFilters from '../../components/admin/reservations/ReservationFilters';
import ReservationTable from '../../components/admin/reservations/ReservationTable';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

const ReservationManagement: React.FC = () => {
  const { t } = useTranslation();
  const { user, permissions } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const deepLinkHandled = useRef(false);
  const isAdmin     = String(user?.role).toLowerCase() === 'admin';
  const canCheckIn  = isAdmin || (permissions || []).includes('admin.reservations.checkin');
  const canCancel   = isAdmin || (permissions || []).includes('admin.reservations.cancel');
  const canCheckOut = canCheckIn || ['staff', 'maintenance'].includes(String(user?.role).toLowerCase());

  // ── Core data ──────────────────────────────────────────────────────────────
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState<'all' | 'room' | 'daypass' | 'PasaTarde' | 'event'>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo]     = useState('');

  // ── Pagination ─────────────────────────────────────────────────────────────
  const [page, setPage]              = useState(1);
  const [hasMore, setHasMore]        = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── Notifications ──────────────────────────────────────────────────────────
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success' as 'success' | 'error' | 'warning' | 'info',
  });
  const showSnackbar = (message: string, severity: 'success' | 'error' | 'warning' | 'info' = 'success') =>
    setSnackbar({ open: true, message, severity });

  // ── Services config: accommodation always active; other kinds from active Service records ──
  const [reservationServices, setReservationServices] = useState({
    daypass: false, accommodation: true, pasatarde: false, event: false,
  });
  useEffect(() => {
    // daypass / pasatarde / event availability is derived from active Service records
    servicesService.getServices({ active: true })
      .then(res => {
        const list: any[] = res.data.data ?? [];
        const hasKind = (k: string) => list.some(svc => svc.kind === k);
        setReservationServices(s => ({
          ...s,
          daypass:   hasKind('daypass'),
          pasatarde: hasKind('pasatarde'),
          event:     hasKind('event'),
        }));
      })
      .catch(() => {});
  }, []);

  // ── Detail page view ───────────────────────────────────────────────────────
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const openDetailsView  = (reservation: Reservation) => { setSelectedReservation(reservation); setShowDetails(true); };
  const closeDetailsView = () => { setShowDetails(false); setSelectedReservation(null); };

  // ── Dialog open states ─────────────────────────────────────────────────────
  const [editDialog, setEditDialog] = useState<{ open: boolean; reservation: Reservation | null }>({ open: false, reservation: null });
  const [opsDialog, setOpsDialog]   = useState<{ open: boolean; mode: 'checkin' | 'checkout'; reservation: Reservation | null }>({ open: false, mode: 'checkin', reservation: null });
  const [createDialog, setCreateDialog] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchReservations = useCallback(async (opts?: { reset?: boolean }) => {
    try {
      const reset = !!opts?.reset;
      if (reset) {
        setPage(1);
        setHasMore(true);
        if (!initialLoadDone) setReservations([]);
      }
      const currentPage = reset ? 1 : page;
      const params: any = { page: currentPage, limit: 20, sort: '-createdAt' };
      if (filterStatus !== 'all') params.status   = filterStatus;
      if (filterType   !== 'all') params.type     = filterType;
      if (search.trim())          params.search   = search.trim();
      if (filterDateFrom)         params.dateFrom = filterDateFrom;
      if (filterDateTo)           params.dateTo   = filterDateTo;
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
    } catch (err: any) {
      console.error('Error fetching reservations:', err);
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
    } catch (err: any) {
      console.error('Error fetching rooms:', err);
    }
  };

  // Initial load
  useEffect(() => {
    fetchReservations({ reset: true });
    fetchRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link: open details view when ?id= is present in the URL
  useEffect(() => {
    if (deepLinkHandled.current) return;
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) return;
    deepLinkHandled.current = true;
    reservationsService.getReservation(id)
      .then(res => {
        const reservation = res.data.data as any;
        if (reservation) openDetailsView(reservation);
      })
      .catch(() => { /* ignore — reservation may not exist */ })
      .finally(() => {
        // Clean the ?id= from the URL without adding a history entry
        navigate(location.pathname, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Re-fetch on filter changes
  useEffect(() => {
    const timer = setTimeout(() => fetchReservations({ reset: true }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterType, search, filterDateFrom, filterDateTo]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filteredReservations = reservations.filter(
    r => filterStatus === 'all' || r.status === filterStatus,
  );

  const handleFilterToday = () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setFilterDateFrom(today);
    setFilterDateTo(today);
  };

  const handleClearFilters = () => {
    setFilterStatus('all');
    setFilterType('all');
    setSearch('');
    setSearchInput('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  // ─── Loading skeleton ──────────────────────────────────────────────────────
  if (loading && !initialLoadDone) {
    return (
      <AdminLayout>
        <Container maxWidth="lg" sx={{ py: 8, textAlign: 'center' }}>
          <CircularProgress size={60} />
          <Typography variant="h6" sx={{ mt: 2 }}>{t('admin.reservations.loading')}</Typography>
        </Container>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={t('admin.reservations.title')}>
      <Container maxWidth="xl" sx={{ pt: 0, pb: 4 }}>

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
            {error && (
              <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>
            )}

            {/* ── Filters ── */}
            <ReservationFilters
              filterStatus={filterStatus}
              filterType={filterType}
              searchInput={searchInput}
              filterDateFrom={filterDateFrom}
              filterDateTo={filterDateTo}
              reservationServices={reservationServices}
              onFilterStatusChange={setFilterStatus}
              onFilterTypeChange={setFilterType}
              onSearchInputChange={setSearchInput}
              onFilterDateFromChange={setFilterDateFrom}
              onFilterDateToChange={setFilterDateTo}
              onFilterToday={handleFilterToday}
              onClear={handleClearFilters}
              onCreateNew={() => setCreateDialog(true)}
            />

            {/* ── Table ── */}
            <ReservationTable
              reservations={filteredReservations}
              user={user}
              canCheckIn={canCheckIn}
              canCheckOut={canCheckOut}
              onViewDetails={openDetailsView}
              onEdit={(reservation) => setEditDialog({ open: true, reservation })}
              onDelete={async (reservationId) => {
                await reservationsService.deleteReservation(reservationId);
                setReservations(prev => prev.filter(r => r._id !== reservationId));
                showSnackbar(t('admin.reservations.messages.removed'), 'success');
              }}
              onCheckIn={(reservation) => setOpsDialog({ open: true, mode: 'checkin', reservation })}
              onCheckOut={(reservation) => setOpsDialog({ open: true, mode: 'checkout', reservation })}
              onSnackbar={showSnackbar}
            />

            {filteredReservations.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 6 }}>
                <Typography variant="h6" color="text.secondary">{t('admin.reservations.empty.title')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {filterStatus === 'all'
                    ? t('admin.reservations.empty.initial')
                    : t('admin.reservations.empty.filtered', { status: t(`admin.reservations.statusLabels.${filterStatus.replace('-', '_')}`) })}
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

        {/* ── Edit Reservation Dialog ── */}
        <EditReservationDialog
          open={editDialog.open}
          reservation={editDialog.reservation}
          rooms={rooms}
          onClose={() => setEditDialog({ open: false, reservation: null })}
          onSaved={(updated) => {
            setReservations(prev => prev.map(r => r._id === updated._id ? updated : r));
            fetchRooms();
          }}
          onSnackbar={showSnackbar}
          canCancel={canCancel}
        />

        {/* ── Check-In / Check-Out Dialog ── */}
        <CheckInOutDialog
          open={opsDialog.open}
          mode={opsDialog.mode}
          reservation={opsDialog.reservation}
          onClose={() => setOpsDialog({ open: false, mode: 'checkin', reservation: null })}
          onSuccess={(updated) => setReservations(prev => prev.map(r => r._id === updated._id ? updated : r))}
          onSnackbar={showSnackbar}
          onOpenDetails={(r) => { openDetailsView(r); setOpsDialog({ open: false, mode: 'checkin', reservation: null }); }}
          onRoomsRefresh={fetchRooms}
        />

        {/* ── Create Reservation Dialog ── */}
        <CreateReservationDialog
          open={createDialog}
          onClose={() => setCreateDialog(false)}
          onCreated={(newRes) => setReservations(prev => [newRes, ...prev])}
          onSnackbar={showSnackbar}
          reservationServices={reservationServices}
        />

        {/* ── Snackbar ── */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={6000}
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        >
          <Alert
            onClose={() => setSnackbar(s => ({ ...s, open: false }))}
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
