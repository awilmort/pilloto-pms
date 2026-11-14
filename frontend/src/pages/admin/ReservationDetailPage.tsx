import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Container, Typography } from '@mui/material';
import { ArrowBack, SearchOff } from '@mui/icons-material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Reservation } from '../../types';
import { reservationsService } from '../../services/api';
import { usePageTitle } from '../../components/shared/PageTitle';
import PageLoader from '../../components/common/PageLoader';
import ReservationDetails from '../../components/admin/ReservationDetails';
import { matchesReservationRef, reservationHref } from '../../utils/reservationPaths';

type LoadState = 'loading' | 'ready' | 'notFound' | 'error';

const guestName = (r: Reservation | null): string | undefined => {
  if (!r) return undefined;
  if (r.guestName?.firstName) return `${r.guestName.firstName} ${r.guestName.lastName || ''}`.trim();
  if (r.user && typeof r.user === 'object') return `${(r.user as any).firstName} ${(r.user as any).lastName}`.trim();
  return undefined;
};

/**
 * `/admin/reservations/:ref` — one reservation on its own URL, so it can be linked, bookmarked and refreshed.
 * `ref` is the reservation code (the canonical form, e.g. B26X7KQ) or the database id; an id URL is rewritten
 * to the code one once the reservation has loaded. The list page navigates here; "back" returns to wherever the
 * user came from.
 */
const ReservationDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const { id: ref } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  // Whether the user got here from inside the app, read once: rewriting the URL below replaces the history
  // entry (and its key), which must not make a direct link look like an in-app visit.
  const cameFromApp = useRef(location.key !== 'default').current;
  const current = useRef<Reservation | null>(null);
  current.current = reservation;

  usePageTitle(guestName(reservation) ?? t('admin.reservations.details.title'));

  const load = useCallback(() => {
    if (!ref) { setState('notFound'); return () => undefined; }
    // Already showing this reservation (the URL was just rewritten from its id to its code): nothing to fetch.
    if (current.current && matchesReservationRef(current.current, ref)) return () => undefined;
    let cancelled = false;
    setState('loading');
    reservationsService.getReservation(ref)
      .then((res) => {
        if (cancelled) return;
        if (res.data?.data) { setReservation(res.data.data); setState('ready'); } else setState('notFound');
      })
      .catch((err) => {
        if (cancelled) return;
        // A reservation that does not exist (or an id that is not valid) is a dead link; anything else is worth a retry.
        setState([400, 404].includes(err?.response?.status) ? 'notFound' : 'error');
      });
    return () => { cancelled = true; };
  }, [ref]);

  useEffect(() => load(), [load]);

  // Canonical URL: the reservation code. An id URL (an old link, a report, the inbox) becomes the code URL.
  useEffect(() => {
    if (state !== 'ready' || !reservation?.reservationCode || !ref) return;
    if (reservation.reservationCode !== ref) navigate(`${reservationHref(reservation)}${location.search}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, reservation, ref]);

  // Back to wherever the user came from (the filtered list, the calendar, a report…); a direct link falls back to the list.
  const goBack = () => (cameFromApp ? navigate(-1) : navigate('/admin/reservations'));
  const toList = () => navigate('/admin/reservations');

  if (state === 'loading') return <PageLoader />;

  if (state === 'notFound') {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
        <SearchOff sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
        <Typography variant="h6">{t('admin.reservations.details.notFoundTitle')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>{t('admin.reservations.details.notFoundBody')}</Typography>
        <Button variant="contained" startIcon={<ArrowBack />} onClick={toList}>{t('admin.reservations.details.back')}</Button>
      </Container>
    );
  }

  if (state === 'error' || !reservation) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => load()}>{t('admin.reservations.details.retry')}</Button>}>
          {t('admin.reservations.messages.loadFailed')}
        </Alert>
        <Box sx={{ mt: 2 }}>
          <Button startIcon={<ArrowBack />} onClick={toList}>{t('admin.reservations.details.back')}</Button>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ pt: 0, pb: 4 }}>
      <ReservationDetails key={reservation._id as string} reservation={reservation} onBack={goBack} onUpdated={setReservation} />
    </Container>
  );
};

export default ReservationDetailPage;
