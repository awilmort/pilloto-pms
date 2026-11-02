/**
 * Home panel — the property's day at a glance, modelled on enterprise PMS home dashboards:
 * tonight's KPIs against last year, today's movement and room status, the front-desk worklist
 * with check-in / check-out shortcuts, what needs attention, the next 14 nights and booking
 * activity. One request (GET /admin/dashboard); refreshes itself every few minutes.
 * Rates, revenue and balances only appear for users who may see revenue.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Grid, IconButton, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { adminService } from '../../services/api';
import AdminLayout from '../../components/admin/AdminLayout';
import type { DashboardData } from '../../types/dashboard';
import { KpiTile, fmtInt, fmtMoney, fmtPct, pctChange } from '../../components/admin/reports/kit';
import {
  ActivityCard, AttentionPanel, DayVisitorsStrip, MovementCard, MovementIcons, OutlookChart, RoomStatusCard, Worklist, WorklistTab, useDayFormat,
} from '../../components/admin/dashboard/DashboardPanels';

const REFRESH_MS = 5 * 60 * 1000;

/** Hour of day in the property's time zone */
function localHour(timeZone: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}

const AdminDashboard: React.FC = () => {
  const { user, permissions } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.dashboard.${key}`, opts);
  const day = useDayFormat();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<WorklistTab>('arrivals');

  const perms = permissions || [];
  const can = (perm: string) => user?.role === 'admin' || perms.includes(perm) || perms.includes('admin.access');
  const allowed = !!user && can('admin.dashboard');

  // Users without the dashboard go to the first admin section they can open
  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (allowed) return;
    const permToPath: { key: string; path: string }[] = [
      { key: 'admin.schedule', path: '/admin/booking-calendar' },
      { key: 'admin.reservations', path: '/admin/reservations' },
      { key: 'admin.accommodations', path: '/admin/accommodations' },
      { key: 'admin.rooms', path: '/admin/rooms' },
      { key: 'admin.guests', path: '/admin/guests' },
      { key: 'admin.media', path: '/admin/media' },
      { key: 'admin.users', path: '/admin/users' },
      { key: 'admin.roles', path: '/admin/roles' },
      { key: 'admin.eventTypes', path: '/admin/event-types' },
      { key: 'admin.pricing', path: '/admin/pricing' },
      { key: 'admin.settings', path: '/admin/settings' },
    ];
    const first = permToPath.find(p => perms.includes(p.key));
    navigate(first ? first.path : '/login');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, permissions, navigate, allowed]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminService.getDashboard();
      setData(res.data.data ?? null);
      setError(false);
    } catch (err) {
      console.error('Error loading dashboard:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return undefined;
    load();
    // Keep the panel current while it is on screen; skip refreshes in background tabs
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [allowed, load]);

  if (!allowed) return null;

  const hour = data ? localHour(data.timezone) : new Date().getHours();
  const greeting = k(`greeting.${hour < 12 ? 'morning' : hour < 19 ? 'afternoon' : 'evening'}`, { name: user?.firstName || '' });
  const updated = data && new Date(data.generatedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: data.timezone });

  const header = (
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'flex-end' }} spacing={2} mb={3}>
      <Box>
        <Typography variant="h5" fontWeight={700}>{greeting}</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" color="text.secondary">
            {data ? day(data.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ' '}
            {updated ? ` · ${k('updated', { time: updated })}` : ''}
          </Typography>
          <Tooltip title={k('refresh')}>
            <span>
              <IconButton size="small" onClick={load} disabled={loading} aria-label={k('refresh')}>
                <RefreshIcon fontSize="small" sx={{ animation: loading ? 'spin 1s linear infinite' : 'none', '@keyframes spin': { to: { transform: 'rotate(360deg)' } } }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {can('admin.schedule') && (
          <Button variant="outlined" startIcon={<CalendarMonthOutlinedIcon />} onClick={() => navigate('/admin/booking-calendar')}>{k('actions.calendar')}</Button>
        )}
        {can('admin.reservations') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/admin/reservations?new=1')}>{k('actions.newReservation')}</Button>
        )}
      </Stack>
    </Stack>
  );

  if (!data) {
    return (
      <AdminLayout title={k('title')}>
        <Box sx={{ pb: 4 }}>
          {header}
          {error ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>{k('retry')}</Button>}>{k('loadFailed')}</Alert>
          ) : (
            <Grid container spacing={2}>
              {[0, 1, 2, 3, 4].map((i) => <Grid item xs={6} md={12 / 5} key={i}><Skeleton variant="rounded" height={112} /></Grid>)}
              {[0, 1, 2, 3].map((i) => <Grid item xs={6} md={3} key={`m${i}`}><Skeleton variant="rounded" height={140} /></Grid>)}
              <Grid item xs={12} lg={8}><Skeleton variant="rounded" height={380} /></Grid>
              <Grid item xs={12} lg={4}><Skeleton variant="rounded" height={380} /></Grid>
            </Grid>
          )}
        </Box>
      </AdminLayout>
    );
  }

  const { tonight, tomorrow, mtd, movement: mv } = data;
  const vsLy = t('admin.reports.kit.vs', { what: t('admin.reports.kit.lastYear') });
  const next14 = data.outlook.reduce((n, r) => n + r.roomsSold, 0) / Math.max(1, data.outlook.reduce((n, r) => n + r.roomsAvailable, 0)) * 100;
  const occTile = (
    <KpiTile
      label={k('kpi.occTonight')}
      value={fmtPct(tonight.current.occupancyPct, 0)}
      delta={{ value: tonight.current.occupancyPct - tonight.lastYear.occupancyPct, unit: 'pts', label: vsLy }}
      caption={t('admin.reports.kit.roomsSoldOf', { sold: tonight.current.roomsSold, available: tonight.current.roomsAvailable })}
    />
  );
  const tomorrowTile = (
    <KpiTile label={k('kpi.occTomorrow')} value={fmtPct(tomorrow.occupancyPct, 0)} caption={k('kpi.onTheBooks', { sold: tomorrow.roomsSold, available: tomorrow.roomsAvailable })} />
  );
  const tiles = data.showMoney ? [
    occTile,
    <KpiTile label={k('kpi.adrTonight')} value={fmtMoney(tonight.current.adr)} delta={{ value: pctChange(tonight.current.adr, tonight.lastYear.adr), label: vsLy }} help={t('admin.reports.kit.help.adr')} />,
    <KpiTile label={k('kpi.revparTonight')} value={fmtMoney(tonight.current.revpar)} delta={{ value: pctChange(tonight.current.revpar, tonight.lastYear.revpar), label: vsLy }} help={t('admin.reports.kit.help.revpar')} />,
    <KpiTile label={k('kpi.revenueMtd')} value={fmtMoney(mtd.current.roomRevenue)} delta={{ value: pctChange(mtd.current.roomRevenue, mtd.lastYear.roomRevenue), label: vsLy }} caption={k('kpi.occMtdCaption', { pct: fmtPct(mtd.current.occupancyPct, 0) })} />,
    tomorrowTile,
  ] : [
    occTile,
    tomorrowTile,
    <KpiTile label={k('kpi.occMtd')} value={fmtPct(mtd.current.occupancyPct, 0)} delta={{ value: mtd.current.occupancyPct - mtd.lastYear.occupancyPct, unit: 'pts', label: vsLy }} />,
    <KpiTile label={k('kpi.next14')} value={fmtPct(next14, 0)} caption={k('kpi.next14Caption')} />,
  ];

  return (
    <AdminLayout title={k('title')}>
      <Box sx={{ pb: 4 }}>
        {header}
        {error && <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>{k('retry')}</Button>}>{k('staleData')}</Alert>}

        {/* Tonight */}
        <Grid container spacing={2} mb={2}>
          {tiles.map((tile, i) => <Grid item xs={6} sm={4} md={12 / tiles.length} key={i}>{tile}</Grid>)}
        </Grid>

        {/* Today's movement and rooms */}
        <Grid container spacing={2} mb={2}>
          <Grid item xs={6} md={3}>
            <MovementCard
              icon={MovementIcons.arrivals}
              label={k('movement.arrivals')}
              value={mv.arrivals.rooms}
              done={mv.arrivals.done}
              progressText={k('movement.checkedIn', { done: mv.arrivals.done, total: mv.arrivals.rooms })}
              onClick={() => setTab('arrivals')}
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <MovementCard
              icon={MovementIcons.departures}
              label={k('movement.departures')}
              value={mv.departures.rooms}
              done={mv.departures.done}
              progressText={k('movement.checkedOut', { done: mv.departures.done, total: mv.departures.rooms })}
              onClick={() => setTab('departures')}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <MovementCard
              icon={MovementIcons.inHouse}
              label={k('movement.inHouse')}
              value={mv.inHouse.rooms}
              caption={k('movement.inHouseCaption', { guests: fmtInt(mv.inHouse.guests), stayovers: fmtInt(mv.inHouse.stayovers) })}
              onClick={() => setTab('inHouse')}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <RoomStatusCard status={data.roomStatus} onManage={can('admin.rooms') ? () => navigate('/admin/rooms') : undefined} />
          </Grid>
          {data.dayVisits && (
            <Grid item xs={12}><DayVisitorsStrip visits={data.dayVisits} /></Grid>
          )}
        </Grid>

        {/* Work */}
        <Grid container spacing={2} mb={2}>
          <Grid item xs={12} lg={8}>
            <Worklist data={data} tab={tab} onTab={setTab} canCheckIn={can('admin.reservations.checkin')} canOpen={can('admin.reservations')} />
          </Grid>
          <Grid item xs={12} lg={4}>
            <AttentionPanel items={data.attention} canOpen={can('admin.reservations')} canViewRooms={can('admin.rooms')} />
          </Grid>
        </Grid>

        {/* Ahead */}
        <Grid container spacing={2}>
          <Grid item xs={12} lg={8}>
            <OutlookChart data={data} onForecast={can('admin.ecf.view') ? () => navigate('/admin/reports/forecast') : undefined} />
          </Grid>
          <Grid item xs={12} lg={4}>
            <ActivityCard data={data} canOpen={can('admin.reservations')} />
          </Grid>
        </Grid>
      </Box>
    </AdminLayout>
  );
};

export default AdminDashboard;
