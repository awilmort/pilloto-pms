import React, { useEffect, useMemo, useState } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  ToggleButtonGroup,
  ToggleButton,
  Grid,
  Card,
  CardContent,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Divider,
} from '@mui/material';
import AdminLayout from '../../components/admin/AdminLayout';
import SectionTitle from '../../components/admin/SectionTitle';
import { reservationsService, settingsService } from '../../services/api';
import { AppSettings } from '../../services/api';
import { Reservation } from '../../types';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

const ScheduleSummary: React.FC = () => {
  const { t } = useTranslation();
  // Using unified admin.schedule.* keys
  const [period, setPeriod] = useState<'today' | 'tomorrow'>('today');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [services, setServices] = useState<AppSettings['services']>({ daypass: true, accommodation: true, pasatarde: true, event: true });

  useEffect(() => {
    settingsService.getSettings()
      .then(res => { if (res.data.data?.services) setServices(res.data.data.services); })
      .catch(() => {});
  }, []);

  const selectedDate = useMemo(() => period === 'tomorrow' ? dayjs().add(1, 'day') : dayjs(), [period]);
  const dayStr = useMemo(() => selectedDate.format('YYYY-MM-DD'), [selectedDate]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        // Backend expects local YYYY-MM-DD to avoid timezone drift
        const res = await reservationsService.getReservations({ dateFrom: dayStr, dateTo: dayStr, limit: 200 });
        setReservations(res.data.data || []);
      } catch (e) {
        console.error('Failed to load schedule summary', e);
        setReservations([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [dayStr]);

  const activeReservations = useMemo(() => reservations.filter(r => r.status !== 'cancelled'), [reservations]);
  // Only include reservations displayed on this page: room, daypass, event
  const displayedReservations = useMemo(
    () => activeReservations.filter(r => {
      if (r.type === 'room') return services.accommodation;
      if (r.type === 'daypass') return services.daypass;
      if (r.type === 'event') return services.event;
      if (r.type === 'PasaTarde') return services.pasatarde;
      return false;
    }),
    [activeReservations, services]
  );

  const totals = useMemo(() => {
    let adults = 0;
    let children = 0;
    let infants = 0;
    displayedReservations.forEach(r => {
      adults += r.guestDetails?.adults || 0;
      children += r.guestDetails?.children || 0;
      infants += r.guestDetails?.infants || 0;
    });
    const totalPeople = adults + children + infants;
    return { adults, children, infants, totalPeople };
  }, [displayedReservations]);

  // Helper functions used in category calculations and rendering
  const getGuestName = (r: Reservation) => r.guestName?.firstName
    ? `${r.guestName.firstName} ${r.guestName.lastName || ''}`.trim()
    : (typeof r.user === 'object' ? `${(r.user as any).firstName} ${(r.user as any).lastName}` : t('admin.dashboard.recentReservations.guestFallback'));

  const getTotalGuests = (r: Reservation) => (r.guestDetails?.adults || 0) + (r.guestDetails?.children || 0) + (r.guestDetails?.infants || 0);

  const categorized = useMemo(() => {
    const rooms = displayedReservations.filter(r => r.type === 'room');
    const daypass = displayedReservations.filter(r => r.type === 'daypass');
    const events = displayedReservations.filter(r => r.type === 'event');
    return { rooms, daypass, events };
  }, [displayedReservations]);
  const categoryGuestTotals = useMemo(() => {
    const sumGuests = (list: Reservation[]) => list.reduce((sum, r) => sum + getTotalGuests(r), 0);
    return {
      rooms: sumGuests(categorized.rooms),
      daypass: sumGuests(categorized.daypass),
      events: sumGuests(categorized.events),
    };
  }, [categorized]);

  const formatDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <AdminLayout>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <SectionTitle
          title={t('admin.schedule.title')}
          right={
            <ToggleButtonGroup value={period} exclusive onChange={(_, val) => val && setPeriod(val)}>
              <ToggleButton value="today">{t('admin.schedule.today')}</ToggleButton>
              <ToggleButton value="tomorrow">{t('admin.schedule.tomorrow')}</ToggleButton>
            </ToggleButtonGroup>
          }
        />

        <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 2 }}>
          {formatDate(selectedDate.toDate())}
        </Typography>

        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary">{t('admin.schedule.cards.totalPeople')}</Typography>
                <Typography variant="h5">{totals.totalPeople}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary">{t('admin.schedule.cards.adults')}</Typography>
                <Typography variant="h5">{totals.adults}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary">{t('admin.schedule.cards.children')}</Typography>
                <Typography variant="h5">{totals.children}</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        <Grid container spacing={3}>
          {/* Left side: DayPass table */}
          {services.daypass && (
          <Grid item xs={12} md={6}>
            <Paper>
              <Box sx={{ p: 2 }}>
                <Typography variant="h6">{t('admin.schedule.sections.daypass', { count: categoryGuestTotals.daypass })}</Typography>
              </Box>
              <Divider />
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.schedule.table.guest')}</TableCell>
                    <TableCell align="right">{t('admin.schedule.table.totalGuests')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {categorized.daypass.map(r => (
                    <TableRow key={r._id}>
                      <TableCell>{getGuestName(r)}</TableCell>
                      <TableCell align="right">{getTotalGuests(r)}</TableCell>
                    </TableRow>
                  ))}
                  {categorized.daypass.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={2} align="center">{t('admin.schedule.empty.daypass')}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </Grid>
          )}

          {/* Right side: Accommodations (Room reservations), Events below */}
          {(services.accommodation || services.event) && (
          <Grid item xs={12} md={6}>
            <Box sx={{ display: 'grid', gap: 3 }}>
              {services.accommodation && <Paper>
                <Box sx={{ p: 2 }}>
                    <Typography variant="h6">{t('admin.schedule.sections.accommodations', { count: categoryGuestTotals.rooms })}</Typography>
                </Box>
                <Divider />
                <Table>
                  <TableHead>
                    <TableRow>
                        <TableCell>{t('admin.schedule.table.guest')}</TableCell>
                        <TableCell>{t('admin.schedule.table.room')}</TableCell>
                        <TableCell align="right">{t('admin.schedule.table.totalGuests')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {categorized.rooms.map(r => {
                      const roomName = r.room && typeof r.room === 'object' ? (r.room as any).name : '';
                      return (
                        <TableRow key={r._id}>
                          <TableCell>{getGuestName(r)}</TableCell>
                            <TableCell>{roomName || t('admin.schedule.notAssigned')}</TableCell>
                          <TableCell align="right">{getTotalGuests(r)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {categorized.rooms.length === 0 && !loading && (
                      <TableRow>
                          <TableCell colSpan={3} align="center">{t('admin.schedule.empty.rooms')}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Paper>}

              {services.event && <Paper>
                <Box sx={{ p: 2 }}>
                    <Typography variant="h6">{t('admin.schedule.sections.events', { count: categoryGuestTotals.events })}</Typography>
                </Box>
                <Divider />
                <Table>
                  <TableHead>
                    <TableRow>
                        <TableCell>{t('admin.schedule.table.guest')}</TableCell>
                        <TableCell align="right">{t('admin.schedule.table.totalGuests')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {categorized.events.map(r => (
                      <TableRow key={r._id}>
                        <TableCell>{getGuestName(r)}</TableCell>
                        <TableCell align="right">{getTotalGuests(r)}</TableCell>
                      </TableRow>
                    ))}
                    {categorized.events.length === 0 && !loading && (
                      <TableRow>
                          <TableCell colSpan={2} align="center">{t('admin.schedule.empty.events')}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Paper>}
            </Box>
          </Grid>
          )}
        </Grid>
      </Container>
    </AdminLayout>
  );
};

export default ScheduleSummary;