import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  Snackbar,
} from '@mui/material';
import { Reservation, Room } from '../../types';
import { reservationsService, roomsService } from '../../services/api';
import { useReservationServices } from '../../hooks/useReservationServices';
import { reservationHref } from '../../utils/reservationPaths';
import { usePageTitle } from '../../components/shared/PageTitle';
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
  usePageTitle(t('admin.reservations.title'));
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
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // ── Filters ────────────────────────────────────────────────────────────────
  // Kept in the URL (?status=&type=&q=&from=&to=&source=) so a reservation's page can send you "back" to the
  // same filtered list, and a filtered list can be linked or refreshed. Read once, here; written by an effect below.
  const initialFilters = useRef(new URLSearchParams(location.search)).current;
  const [filterStatus, setFilterStatus] = useState(initialFilters.get('status') || 'all');
  const [filterType, setFilterType] = useState<'all' | 'room' | 'daypass' | 'PasaTarde' | 'event'>(
    (['room', 'daypass', 'PasaTarde', 'event'].includes(initialFilters.get('type') ?? '') ? initialFilters.get('type') : 'all') as any
  );
  const [search, setSearch] = useState(initialFilters.get('q') || '');
  const [searchInput, setSearchInput] = useState(initialFilters.get('q') || '');
  const [filterDateFrom, setFilterDateFrom] = useState(initialFilters.get('from') || '');
  const [filterDateTo, setFilterDateTo]     = useState(initialFilters.get('to') || '');
  const [filterSource, setFilterSource]     = useState(initialFilters.get('source') || '');
  const [channelSources, setChannelSources] = useState<string[]>([]);

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

  // ── Services config: accommodation always active; other kinds from active Service records (shared + cached) ──
  const { services: reservationServices } = useReservationServices();

  // ── Details live on their own page (/admin/reservations/:id) ───────────────
  const openDetailsView = (reservation: Reservation) => navigate(reservationHref(reservation));

  // ── Dialog open states ─────────────────────────────────────────────────────
  const [editDialog, setEditDialog] = useState<{ open: boolean; reservation: Reservation | null }>({ open: false, reservation: null });
  const [opsDialog, setOpsDialog]   = useState<{ open: boolean; mode: 'checkin' | 'checkout'; reservation: Reservation | null }>({ open: false, mode: 'checkin', reservation: null });
  const [createDialog, setCreateDialog] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────
  // Only the newest request may write to state: a slower, older answer (previous filter, or the extra
  // mount a dev StrictMode makes) is dropped instead of overwriting the list or emptying it.
  const requestSeq = useRef(0);

  const listParams = useCallback((pageNumber: number) => {
    const params: any = { page: pageNumber, limit: 20, sort: '-createdAt' };
    if (filterStatus !== 'all') params.status   = filterStatus;
    if (filterType   !== 'all') params.type     = filterType;
    if (search.trim())          params.search   = search.trim();
    if (filterDateFrom)         params.dateFrom = filterDateFrom;
    if (filterDateTo)           params.dateTo   = filterDateTo;
    if (filterSource)           params.source   = filterSource;
    return params;
  }, [filterStatus, filterType, search, filterDateFrom, filterDateTo, filterSource]);

  const applyPage = (response: Awaited<ReturnType<typeof reservationsService.getReservations>>, pageNumber: number, append: boolean) => {
    const items = response.data.data || [];
    setReservations(prev => (append ? [...prev, ...items] : items));
    const pagination = (response.data as any).pagination;
    setTotal(typeof pagination?.total === 'number' ? pagination.total : undefined);
    setHasMore(pagination ? pagination.page < pagination.totalPages : items.length === 20);
    setPage(pageNumber);
  };

  // First page: on mount and whenever a filter changes. The text search is debounced upstream
  // (searchInput → search), so this effect needs no timer of its own — and no separate "initial load".
  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    reservationsService.getReservations(listParams(1))
      .then(response => {
        if (seq !== requestSeq.current) return;
        applyPage(response, 1, false);
        setInitialLoadDone(true);
      })
      .catch((err: any) => {
        if (seq !== requestSeq.current) return;
        console.error('Error fetching reservations:', err);
        setError(t('admin.reservations.messages.loadFailed'));
        setInitialLoadDone(true);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listParams]);

  const loadMore = async () => {
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const response = await reservationsService.getReservations(listParams(page + 1));
      if (seq === requestSeq.current) applyPage(response, page + 1, true);
    } catch (err: any) {
      console.error('Error fetching reservations:', err);
      if (seq === requestSeq.current) setError(t('admin.reservations.messages.loadFailed'));
    } finally {
      setLoadingMore(false);
    }
  };

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

  // Rooms (for the edit / check-in dialogs)
  useEffect(() => {
    fetchRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep links: ?new=1 opens the create dialog; ?id=&action=checkin|checkout opens that dialog on this page.
  // A plain ?id= is the old way to link a reservation — it now redirects to the reservation's own page.
  useEffect(() => {
    if (deepLinkHandled.current) return;
    const params = new URLSearchParams(location.search);
    const stripped = (...keys: string[]) => {
      const next = new URLSearchParams(location.search);
      keys.forEach(k => next.delete(k));
      const qs = next.toString();
      return { pathname: location.pathname, search: qs ? `?${qs}` : '' };
    };
    if (params.get('new') === '1') {
      deepLinkHandled.current = true;
      setCreateDialog(true);
      navigate(stripped('new'), { replace: true });
      return;
    }
    const id = params.get('id');
    if (!id) return;
    deepLinkHandled.current = true;
    const action = params.get('action');
    if (action !== 'checkin' && action !== 'checkout') {
      navigate(`/admin/reservations/${id}`, { replace: true });
      return;
    }
    reservationsService.getReservation(id)
      .then(res => {
        const reservation = res.data.data as any;
        if (reservation) setOpsDialog({ open: true, mode: action, reservation });
      })
      .catch(() => { /* ignore — reservation may not exist */ })
      .finally(() => {
        // Clean the deep-link params from the URL without adding a history entry
        navigate(stripped('id', 'action'), { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Mirror the filters into the URL (replace — filtering must not fill the history). Skipped while a deep link
  // is still being handled, so it can't overwrite the redirect.
  useEffect(() => {
    const next = new URLSearchParams(location.search);
    if (next.has('id') || next.has('new')) return;
    const put = (key: string, value: string) => (value ? next.set(key, value) : next.delete(key));
    put('status', filterStatus === 'all' ? '' : filterStatus);
    put('type', filterType === 'all' ? '' : filterType);
    put('q', search.trim());
    put('from', filterDateFrom);
    put('to', filterDateTo);
    put('source', filterSource);
    const qs = next.toString();
    if (qs !== location.search.replace(/^\?/, '')) {
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterType, search, filterDateFrom, filterDateTo, filterSource]);

  // OTA names for the source filter
  useEffect(() => {
    reservationsService.getChannelSources().then((r) => setChannelSources(r.data.data ?? [])).catch(() => setChannelSources([]));
  }, []);

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
    setFilterSource('');
  };

  return (
    <Container maxWidth="xl" sx={{ pt: 0, pb: 4 }}>

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
        filterSource={filterSource}
        channelSources={channelSources}
        reservationServices={reservationServices}
        onFilterStatusChange={setFilterStatus}
        onFilterTypeChange={setFilterType}
        onSearchInputChange={setSearchInput}
        onFilterDateFromChange={setFilterDateFrom}
        onFilterDateToChange={setFilterDateTo}
        onFilterSourceChange={setFilterSource}
        resultCount={initialLoadDone && !error ? (total ?? filteredReservations.length) : undefined}
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
        initialLoading={!initialLoadDone}
        refreshing={loading && initialLoadDone}
        emptyTitle={t('admin.reservations.empty.title')}
        emptyBody={filterStatus === 'all'
          ? t('admin.reservations.empty.initial')
          : t('admin.reservations.empty.filtered', { status: t(`admin.reservations.statusLabels.${filterStatus.replace('-', '_')}`) })}
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

      {hasMore && (
        <Box sx={{ textAlign: 'center', py: 2 }}>
          <Button variant="outlined" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t('admin.reservations.loadingMore') : t('admin.reservations.loadMore')}
          </Button>
        </Box>
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
        onOpenDetails={(r) => { setOpsDialog({ open: false, mode: 'checkin', reservation: null }); openDetailsView(r); }}
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
  );
};

export default ReservationManagement;
