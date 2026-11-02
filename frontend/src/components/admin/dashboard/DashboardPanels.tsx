/**
 * Building blocks of the home panel (pages/admin/AdminDashboard.tsx): movement cards, room
 * status, the front-desk worklist, the attention queue, the 14-night outlook and booking
 * activity. Each takes the slice of DashboardData it shows.
 */
import React, { useMemo, useState } from 'react';
import {
  Box, Button, Card, CardContent, Chip, Collapse, Divider, LinearProgress, List, ListItemButton,
  Paper, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Tooltip, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import FlightLandIcon from '@mui/icons-material/FlightLand';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import HotelIcon from '@mui/icons-material/Hotel';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import BusinessCenterOutlinedIcon from '@mui/icons-material/BusinessCenterOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { AttentionItem, DashboardData, PanelStay } from '../../../types/dashboard';
import { axisTooltip, barSeries, categoryAxis, valueAxis } from '../../charts/EChart';
import { OTHER, SERIES, STATUS } from '../../charts/chartTheme';
import { ChartCard, Column, fmtInt, fmtMoney, fmtPct } from '../reports/kit';

// ─── Shared ──────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` → localized label (dates are calendar days, formatted in UTC) */
export function useDayFormat() {
  const { i18n } = useTranslation();
  return (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(i18n.language, { timeZone: 'UTC', ...opts });
}

export const reservationPath = (id: string, action?: 'checkin' | 'checkout') => `/admin/reservations?id=${id}${action ? `&action=${action}` : ''}`;

const STATUS_CHIP: Record<string, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  pending: 'warning', confirmed: 'info', 'checked-in': 'success', completed: 'default', cancelled: 'error',
};

export const StatusChip: React.FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation();
  return <Chip size="small" variant="outlined" color={STATUS_CHIP[status] ?? 'default'} label={t(`admin.reservations.statusLabels.${status}`)} sx={{ fontWeight: 600 }} />;
};

export function useSourceLabel() {
  const { t } = useTranslation();
  return (s: { source: string; sourceLabel: string }) =>
    (['front_desk', 'booking_engine', 'corporate'].includes(s.source) ? t(`admin.reports.segmentation.sources.${s.source}`) : s.sourceLabel);
}

const SectionTitle: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} mb={1.5}>
    <Box minWidth={0}>
      <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
      {subtitle && <Typography variant="caption" color="text.secondary" display="block">{subtitle}</Typography>}
    </Box>
    {action}
  </Stack>
);

// ─── Movement ────────────────────────────────────────────────────────────────

export const MovementCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  done?: number;
  progressText?: string;
  caption?: string;
  onClick?: () => void;
}> = ({ icon, label, value, done, progressText, caption, onClick }) => {
  const pct = value > 0 && done != null ? (done / value) * 100 : 0;
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent
        onClick={onClick}
        sx={{ '&:last-child': { pb: 2 }, cursor: onClick ? 'pointer' : 'default', height: '100%', '&:hover': onClick ? { bgcolor: 'action.hover' } : undefined }}
      >
        <Stack direction="row" spacing={1} alignItems="center" mb={1}>
          <Box sx={{ color: 'primary.main', display: 'flex', bgcolor: (th) => alpha(th.palette.primary.main, 0.08), borderRadius: 2, p: 0.75 }}>{icon}</Box>
          <Typography variant="body2" color="text.secondary" fontWeight={600}>{label}</Typography>
        </Stack>
        <Typography variant="h4" fontWeight={700} lineHeight={1.1}>{fmtInt(value)}</Typography>
        {done != null && (
          <>
            <LinearProgress variant="determinate" value={pct} sx={{ mt: 1.5, height: 6, borderRadius: 3, bgcolor: 'action.hover' }} aria-label={progressText} />
            <Typography variant="caption" color="text.secondary" display="block" mt={0.75}>{progressText}</Typography>
          </>
        )}
        {caption && <Typography variant="caption" color="text.secondary" display="block" mt={done != null ? 0 : 1.5}>{caption}</Typography>}
      </CardContent>
    </Card>
  );
};

export const MovementIcons = { arrivals: <FlightLandIcon fontSize="small" />, departures: <FlightTakeoffIcon fontSize="small" />, inHouse: <HotelIcon fontSize="small" /> };

// ─── Room status ─────────────────────────────────────────────────────────────

export const RoomStatusCard: React.FC<{ status: DashboardData['roomStatus']; onManage?: () => void }> = ({ status, onManage }) => {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.dashboard.rooms.${key}`, opts);
  // State colours: occupied is information (brand blue); ready / to clean use the status
  // palette and always carry a label and count
  const parts = [
    { key: 'occupied', value: status.occupied, color: SERIES[0] },
    { key: 'vacantClean', value: status.vacantClean, color: STATUS.good },
    { key: 'vacantDirty', value: status.vacantDirty, color: STATUS.warning },
    { key: 'outOfService', value: status.outOfService, color: OTHER },
  ];
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="body2" color="text.secondary" fontWeight={600}>{k('title')}</Typography>
          {onManage && <Button size="small" onClick={onManage} sx={{ minWidth: 0, py: 0 }}>{k('manage')}</Button>}
        </Stack>
        <Stack direction="row" sx={{ height: 10, borderRadius: 5, overflow: 'hidden', bgcolor: 'action.hover', gap: '2px' }} role="img" aria-label={parts.map((p) => `${k(p.key)} ${p.value}`).join(', ')}>
          {parts.filter((p) => p.value > 0).map((p) => (
            <Tooltip key={p.key} title={`${k(p.key)}: ${p.value}`}><Box sx={{ flexGrow: p.value, bgcolor: p.color }} /></Tooltip>
          ))}
        </Stack>
        <Box sx={{ display: 'grid', rowGap: 0.25, mt: 1.5 }}>
          {parts.map((p) => (
            <Stack key={p.key} direction="row" spacing={0.75} alignItems="center" minWidth={0}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.color, flexShrink: 0 }} />
              <Typography variant="caption" color="text.secondary" noWrap sx={{ flexGrow: 1 }}>{k(p.key)}</Typography>
              <Typography variant="caption" fontWeight={700}>{p.value}</Typography>
            </Stack>
          ))}
        </Box>
        {status.occupiedDirty > 0 && (
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>{k('occupiedDirty', { count: status.occupiedDirty })}</Typography>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Front-desk worklist ─────────────────────────────────────────────────────

export type WorklistTab = 'arrivals' | 'departures' | 'inHouse';

export const Worklist: React.FC<{
  data: DashboardData;
  tab: WorklistTab;
  onTab: (tab: WorklistTab) => void;
  canCheckIn: boolean;
  canOpen: boolean;
}> = ({ data, tab, onTab, canCheckIn, canOpen }) => {
  const { t, i18n } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.dashboard.worklist.${key}`, opts);
  const navigate = useNavigate();
  const day = useDayFormat();
  const sourceLabel = useSourceLabel();
  const time = (ts: string) => new Date(ts).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: data.timezone });
  const rows = data.worklists[tab];
  const counts = { arrivals: data.worklists.arrivals.length, departures: data.worklists.departures.length, inHouse: data.worklists.inHouse.length };

  const action = (s: PanelStay) => {
    if (tab === 'arrivals' && (s.status === 'pending' || s.status === 'confirmed') && canCheckIn) {
      return { label: k('checkIn'), path: reservationPath(s.id, 'checkin') };
    }
    if (s.status === 'checked-in' && s.checkOut <= data.date && tab !== 'arrivals') {
      return { label: k('checkOut'), path: reservationPath(s.id, 'checkout') };
    }
    return null;
  };

  const roomCell = (s: PanelStay) => {
    if (!s.roomNames.length) return <Chip size="small" color="warning" variant="outlined" label={k('unassigned')} />;
    return (
      <Stack spacing={0.25}>
        <Typography variant="body2" fontWeight={600}>{s.roomNames.join(', ')}</Typography>
        {s.unassigned && <Typography variant="caption" color="warning.dark">{k('assignPartial', { assigned: s.roomNames.length, rooms: s.rooms })}</Typography>}
      </Stack>
    );
  };

  const stayCell = (s: PanelStay) => {
    const range = `${day(s.checkIn, { day: 'numeric', month: 'short' })} – ${day(s.checkOut, { day: 'numeric', month: 'short' })}`;
    let note = `${k('nights', { count: s.nights })} · ${k('guests', { count: s.adults + s.children })}`;
    if (s.status === 'checked-in' && s.checkOut < data.date) note = k('overdue');
    else if (tab === 'arrivals' && s.checkedInAt) note = k('arrivedAt', { time: time(s.checkedInAt) });
    else if (tab === 'departures' && s.checkedOutAt) note = k('leftAt', { time: time(s.checkedOutAt) });
    return (
      <Stack spacing={0.25}>
        <Typography variant="body2" noWrap>{range}</Typography>
        <Typography variant="caption" color={s.status === 'checked-in' && s.checkOut < data.date ? 'error.main' : 'text.secondary'} noWrap>{note}</Typography>
      </Stack>
    );
  };

  return (
    <Paper variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box px={2.5} pt={2}>
        <SectionTitle
          title={k('title')}
          action={canOpen ? <Button size="small" endIcon={<ChevronRightIcon />} onClick={() => navigate('/admin/reservations')}>{k('allReservations')}</Button> : undefined}
        />
      </Box>
      <Tabs value={tab} onChange={(_, v) => onTab(v)} sx={{ px: 1.5, borderBottom: 1, borderColor: 'divider', minHeight: 40 }} variant="scrollable" allowScrollButtonsMobile>
        {(['arrivals', 'departures', 'inHouse'] as WorklistTab[]).map((key) => (
          <Tab key={key} value={key} sx={{ minHeight: 40, textTransform: 'none', fontWeight: 600 }} label={
            <Stack direction="row" spacing={1} alignItems="center">
              <span>{k(`tabs.${key}`)}</span>
              <Chip size="small" label={counts[key]} sx={{ height: 20, fontSize: 12, fontWeight: 700 }} />
            </Stack>
          } />
        ))}
      </Tabs>
      {rows.length === 0 ? (
        <Stack alignItems="center" justifyContent="center" py={6} px={2} spacing={1} flexGrow={1}>
          <TaskAltIcon color="disabled" />
          <Typography variant="body2" color="text.secondary">{k(`empty.${tab}`)}</Typography>
        </Stack>
      ) : (
        <TableContainer sx={{ maxHeight: 440, flexGrow: 1 }}>
          <Table size="small" stickyHeader sx={{ '& th, & td': { px: 1.25 }, '& th:first-of-type, & td:first-of-type': { pl: 2.5 }, '& th:last-of-type, & td:last-of-type': { pr: 2 } }}>
            <TableHead>
              <TableRow>
                <TableCell>{k('guest')}</TableCell>
                <TableCell>{k('room')}</TableCell>
                <TableCell>{k('stay')}</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{k('status')}</TableCell>
                {data.showMoney && <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>{k('balance')}</TableCell>}
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((s) => {
                const act = action(s);
                return (
                  <TableRow
                    key={s.id}
                    hover={canOpen}
                    onClick={canOpen ? () => navigate(reservationPath(s.id)) : undefined}
                    sx={{ cursor: canOpen ? 'pointer' : 'default', '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell sx={{ maxWidth: 180 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" minWidth={0}>
                        <Typography variant="body2" fontWeight={600} noWrap>{s.guest || t('admin.dashboard.recentReservations.guestFallback')}</Typography>
                        {s.corporate && <Tooltip title={k('corporate')}><BusinessCenterOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} /></Tooltip>}
                        {s.specialRequests && <Tooltip title={k('requests', { text: s.specialRequests })}><ChatBubbleOutlineIcon sx={{ fontSize: 15, color: 'text.secondary' }} /></Tooltip>}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {[s.code, s.rooms > 1 ? k('roomsCount', { count: s.rooms }) : '', sourceLabel(s)].filter(Boolean).join(' · ')}
                      </Typography>
                    </TableCell>
                    <TableCell>{roomCell(s)}</TableCell>
                    <TableCell>{stayCell(s)}</TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}><StatusChip status={s.status} /></TableCell>
                    {data.showMoney && (
                      <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        <Typography variant="body2" fontWeight={(s.balance ?? 0) > 0 ? 600 : 400} color={(s.balance ?? 0) > 0 ? 'text.primary' : 'text.secondary'} noWrap>
                          {fmtMoney(s.balance)}
                        </Typography>
                      </TableCell>
                    )}
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {act && canOpen && (
                        <Button size="small" variant="outlined" sx={{ px: 1, minWidth: 0, whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); navigate(act.path); }}>{act.label}</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

// ─── Needs attention ─────────────────────────────────────────────────────────

const SEVERITY_ICON = {
  critical: <ErrorOutlineIcon sx={{ color: 'error.main' }} fontSize="small" />,
  warning: <WarningAmberIcon sx={{ color: 'warning.dark' }} fontSize="small" />,
  info: <InfoOutlinedIcon sx={{ color: 'info.main' }} fontSize="small" />,
};

export const AttentionPanel: React.FC<{ items: AttentionItem[]; canOpen: boolean; canViewRooms: boolean }> = ({ items, canOpen, canViewRooms }) => {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.dashboard.attention.${key}`, opts);
  const navigate = useNavigate();
  const day = useDayFormat();
  const [open, setOpen] = useState<string | null>(null);

  /** Where the whole item is worked */
  const listPath = (item: AttentionItem): string | null => {
    if (item.key === 'channelAlerts') return '/admin/channel-alerts';
    if (item.key === 'dirtyRooms') return canViewRooms ? '/admin/rooms' : null;
    return null;
  };
  const itemPath = (item: AttentionItem, id: string): string | null => {
    if (item.key === 'channelAlerts') return '/admin/channel-alerts';
    return canOpen ? reservationPath(id) : null;
  };

  return (
    <Paper variant="outlined" sx={{ height: '100%', p: 2.5 }}>
      <SectionTitle title={k('title')} subtitle={items.length ? k('subtitle', { count: items.reduce((n, i) => n + i.count, 0) }) : undefined} />
      {items.length === 0 ? (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderRadius: 2, bgcolor: (th) => alpha(th.palette.success.main, 0.06) }}>
          <TaskAltIcon sx={{ color: 'success.main' }} />
          <Typography variant="body2" color="text.secondary">{k('allClear')}</Typography>
        </Stack>
      ) : (
        <List disablePadding sx={{ mx: -1 }}>
          {items.map((item, idx) => {
            const expandable = item.items.length > 0;
            const path = listPath(item);
            const isOpen = open === item.key;
            const title = k(`${item.key}.title`, { count: item.count });
            const help = k(`${item.key}.help`, { count: item.count, amount: fmtMoney(item.amount), ...item.meta });
            return (
              <React.Fragment key={item.key}>
                {idx > 0 && <Divider component="li" sx={{ mx: 1 }} />}
                <ListItemButton
                  onClick={() => (expandable ? setOpen(isOpen ? null : item.key) : path && navigate(path))}
                  disabled={!expandable && !path}
                  sx={{ borderRadius: 2, alignItems: 'flex-start', py: 1.25, '&.Mui-disabled': { opacity: 1 } }}
                  aria-expanded={expandable ? isOpen : undefined}
                >
                  <Box mt={0.25} mr={1.5} display="flex">{SEVERITY_ICON[item.severity]}</Box>
                  <Box flexGrow={1} minWidth={0}>
                    <Typography variant="body2" fontWeight={600}>{title}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block">{help}</Typography>
                  </Box>
                  {expandable
                    ? <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', mt: 0.25 }} />
                    : path && <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.25 }} />}
                </ListItemButton>
                {expandable && (
                  <Collapse in={isOpen} unmountOnExit>
                    <List dense disablePadding sx={{ pl: 5, pr: 1, pb: 1 }}>
                      {item.items.map((it) => {
                        const p = itemPath(item, it.id);
                        return (
                          <ListItemButton key={it.id} disabled={!p} onClick={() => p && navigate(p)} sx={{ borderRadius: 1.5, py: 0.5, '&.Mui-disabled': { opacity: 1 } }}>
                            <Box flexGrow={1} minWidth={0}>
                              <Typography variant="body2" noWrap>{it.label}</Typography>
                              {(it.date || it.detail) && (
                                <Typography variant="caption" color="text.secondary" noWrap display="block">
                                  {[it.date && day(it.date, { weekday: 'short', day: 'numeric', month: 'short' }), item.key === 'channelAlerts' ? k(`severity.${it.detail}`) : it.detail].filter(Boolean).join(' · ')}
                                </Typography>
                              )}
                            </Box>
                            {p && <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />}
                          </ListItemButton>
                        );
                      })}
                      {item.count > item.items.length && (
                        <Typography variant="caption" color="text.secondary" sx={{ pl: 1.5 }}>
                          {path ? <Button size="small" onClick={() => navigate(path)} sx={{ p: 0, minWidth: 0 }}>{k('more', { count: item.count - item.items.length })}</Button> : k('more', { count: item.count - item.items.length })}
                        </Typography>
                      )}
                    </List>
                  </Collapse>
                )}
              </React.Fragment>
            );
          })}
        </List>
      )}
    </Paper>
  );
};

// ─── Next 14 nights ──────────────────────────────────────────────────────────

type OutlookRow = DashboardData['outlook'][number];

export const OutlookChart: React.FC<{ data: DashboardData; onForecast?: () => void }> = ({ data, onForecast }) => {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.dashboard.outlook.${key}`, opts);
  const day = useDayFormat();
  const label = (r: OutlookRow) => day(r.date, { weekday: 'short', day: 'numeric' });
  const option = useMemo(() => ({
    grid: { top: 16, left: 8, right: 8, bottom: 4, containLabel: true },
    tooltip: axisTooltip((v) => `${v.toFixed(0)}%`, 'shadow'),
    xAxis: categoryAxis(data.outlook.map(label), { axisLabel: { color: '#898781', fontSize: 11, interval: 0, hideOverlap: true } }),
    yAxis: valueAxis((v) => `${v}%`, { min: 0, max: (e: { max: number }) => Math.max(100, Math.ceil(e.max / 10) * 10) }),
    series: [barSeries(t('admin.reports.kit.occupancy'), data.outlook.map((r) => r.occupancyPct), SERIES[0])],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data]);
  const columns: Column<OutlookRow>[] = [
    { key: 'date', label: t('admin.reports.kit.night'), render: (r) => day(r.date, { weekday: 'short', day: 'numeric', month: 'short' }) },
    { key: 'occupancyPct', label: t('admin.reports.kit.occupancy'), align: 'right', render: (r) => fmtPct(r.occupancyPct, 0) },
    { key: 'roomsSold', label: t('admin.reports.kit.roomsOnBooks'), align: 'right', render: (r) => `${r.roomsSold} / ${r.roomsAvailable}` },
    { key: 'arrivals', label: k('arrivals'), align: 'right' },
    { key: 'departures', label: k('departures'), align: 'right' },
    ...(data.showMoney ? [
      { key: 'roomRevenue', label: t('admin.reports.kit.roomRevenue'), align: 'right' as const, render: (r: OutlookRow) => fmtMoney(r.roomRevenue) },
      { key: 'adr', label: 'ADR', align: 'right' as const, render: (r: OutlookRow) => fmtMoney(r.adr) },
    ] : []),
  ];
  const avg = data.outlook.reduce((n, r) => n + r.roomsSold, 0) / Math.max(1, data.outlook.reduce((n, r) => n + r.roomsAvailable, 0)) * 100;
  return (
    <ChartCard
      title={k('title')}
      subtitle={k('subtitle', { pct: fmtPct(avg, 0) })}
      option={option}
      height={300}
      columns={columns}
      rows={data.outlook}
      action={onForecast && <Button size="small" onClick={onForecast} endIcon={<ChevronRightIcon />}>{k('forecast')}</Button>}
    />
  );
};

// ─── Booking activity ────────────────────────────────────────────────────────

export const ActivityCard: React.FC<{ data: DashboardData; canOpen: boolean }> = ({ data, canOpen }) => {
  const { t, i18n } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.dashboard.activity.${key}`, opts);
  const navigate = useNavigate();
  const day = useDayFormat();
  const sourceLabel = useSourceLabel();
  const a = data.activity;
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }), [i18n.language]);
  const ago = (ts: string) => {
    const mins = Math.round((new Date(ts).getTime() - new Date(data.generatedAt).getTime()) / 60000);
    if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
    if (Math.abs(mins) < 60 * 24) return rtf.format(Math.round(mins / 60), 'hour');
    return rtf.format(Math.round(mins / 1440), 'day');
  };

  const stat = (label: string, value: number, caption: string) => (
    <Box flex={1} minWidth={0} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>{label}</Typography>
      <Typography variant="h5" fontWeight={700} lineHeight={1.2}>{fmtInt(value)}</Typography>
      <Typography variant="caption" color="text.secondary" display="block">{caption}</Typography>
    </Box>
  );

  return (
    <Paper variant="outlined" sx={{ height: '100%', p: 2.5, display: 'flex', flexDirection: 'column' }}>
      <SectionTitle title={k('title')} subtitle={k('subtitle')} />
      <Stack direction="row" spacing={1.5} mb={2}>
        {stat(k('newBookings'), a.newBookings, [k('roomNights', { count: a.newRoomNights }), data.showMoney && a.newBookings ? fmtMoney(a.newRevenue) : ''].filter(Boolean).join(' · '))}
        {stat(k('cancellations'), a.cancellations, k('roomNights', { count: a.cancelledRoomNights }))}
      </Stack>
      <Typography variant="overline" color="text.secondary" lineHeight={2}>{k('latest')}</Typography>
      {a.recent.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{k('empty')}</Typography>
      ) : (
        <List dense disablePadding sx={{ mx: -1 }}>
          {a.recent.map((r) => (
            <ListItemButton key={r.id} disabled={!canOpen} onClick={() => navigate(reservationPath(r.id))} sx={{ borderRadius: 1.5, '&.Mui-disabled': { opacity: 1 } }}>
              <Box flexGrow={1} minWidth={0}>
                <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ textDecoration: r.status === 'cancelled' ? 'line-through' : 'none' }}>
                    {r.guest || r.code || t('admin.dashboard.recentReservations.guestFallback')}
                  </Typography>
                  {r.status === 'cancelled' && <StatusChip status={r.status} />}
                </Stack>
                <Typography variant="caption" color="text.secondary" noWrap display="block">
                  {[sourceLabel(r), `${day(r.checkIn, { day: 'numeric', month: 'short' })} · ${k('nights', { count: r.nights })}`, ago(r.createdAt)].join(' · ')}
                </Typography>
              </Box>
              {data.showMoney && r.value != null && (
                <Typography variant="body2" fontWeight={600} sx={{ ml: 1, flexShrink: 0 }} noWrap>{fmtMoney(r.value)}</Typography>
              )}
            </ListItemButton>
          ))}
        </List>
      )}
    </Paper>
  );
};

/** Compact strip for day passes, pasadías and events arriving today */
export const DayVisitorsStrip: React.FC<{ visits: NonNullable<DashboardData['dayVisits']> }> = ({ visits }) => {
  const { t } = useTranslation();
  return (
    <Paper variant="outlined" sx={{ px: 2.5, py: 1.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} alignItems={{ sm: 'center' }}>
        <Typography variant="body2" fontWeight={700}>{t('admin.dashboard.dayVisits.title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('admin.dashboard.dayVisits.summary', { reservations: visits.reservations, guests: visits.guests })}
        </Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {Object.entries(visits.byType).map(([type, n]) => (
            <Chip key={type} size="small" variant="outlined" label={`${t(`admin.reservations.typeLabels.${type.toLowerCase()}`)} · ${n}`} />
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
};
