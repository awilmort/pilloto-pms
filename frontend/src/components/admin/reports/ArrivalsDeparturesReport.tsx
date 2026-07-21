import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import FlightLandIcon from '@mui/icons-material/FlightLand';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import PrintIcon from '@mui/icons-material/Print';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { reportsService } from '../../../services/api';
import { formatMoney } from '../../../utils/currency';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArrivalRow {
  reservationId: string;
  reservationCode: string;
  guestName: string;
  guestEmail: string;
  roomName: string | null;
  type: string;
  checkInDate: string;
  checkOutDate: string | null;
  totalGuests: number;
  balanceDue: number;
  folioStatus: 'open' | 'in_ar' | 'closed' | 'none';
  specialRequests: string | null;
  status: string;
  isCorporate: boolean;
}

interface DepartureRow {
  reservationId: string;
  reservationCode: string;
  guestName: string;
  guestEmail: string;
  roomName: string | null;
  type: string;
  checkInDate: string;
  checkOutDate: string | null;
  totalGuests: number;
  balanceRemaining: number;
  folioStatus: 'open' | 'in_ar' | 'closed' | 'none';
  paymentStatus: 'paid' | 'partial' | 'unpaid';
  isFolioClosed: boolean;
  specialRequests: string | null;
  status: string;
  isCorporate: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Status chip colours ──────────────────────────────────────────────────────

type StatusColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

function reservationStatusColor(status: string): StatusColor {
  switch (status) {
    case 'confirmed':   return 'primary';
    case 'checked-in':  return 'success';
    case 'completed':   return 'secondary';
    case 'pending':     return 'warning';
    default:            return 'default';
  }
}

function paymentStatusColor(ps: string): StatusColor {
  switch (ps) {
    case 'paid':    return 'success';
    case 'partial': return 'warning';
    case 'unpaid':  return 'error';
    default:        return 'default';
  }
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

type ArrivalSortField = 'guestName' | 'roomName' | 'balanceDue' | 'checkInDate';
type DepartureSortField = 'guestName' | 'roomName' | 'balanceRemaining' | 'checkOutDate';
type SortDir = 'asc' | 'desc';

function sortArrivals(rows: ArrivalRow[], field: ArrivalSortField, dir: SortDir): ArrivalRow[] {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (field === 'guestName') cmp = a.guestName.localeCompare(b.guestName);
    else if (field === 'roomName') cmp = (a.roomName ?? '').localeCompare(b.roomName ?? '');
    else if (field === 'balanceDue') cmp = a.balanceDue - b.balanceDue;
    else if (field === 'checkInDate') cmp = a.checkInDate.localeCompare(b.checkInDate);
    return dir === 'asc' ? cmp : -cmp;
  });
}

function sortDepartures(rows: DepartureRow[], field: DepartureSortField, dir: SortDir): DepartureRow[] {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (field === 'guestName') cmp = a.guestName.localeCompare(b.guestName);
    else if (field === 'roomName') cmp = (a.roomName ?? '').localeCompare(b.roomName ?? '');
    else if (field === 'balanceRemaining') cmp = a.balanceRemaining - b.balanceRemaining;
    else if (field === 'checkOutDate') cmp = (a.checkOutDate ?? '').localeCompare(b.checkOutDate ?? '');
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

type TabValue = 'arrivals' | 'departures' | 'combined';

const ArrivalsDeparturesReport: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [date, setDate] = useState<string>(toDateStr(new Date()));
  const [tab, setTab] = useState<TabValue>('arrivals');

  const [arrivalsData, setArrivalsData] = useState<ArrivalRow[]>([]);
  const [departuresData, setDeparturesData] = useState<DepartureRow[]>([]);

  const [loadingArrivals, setLoadingArrivals] = useState(false);
  const [loadingDepartures, setLoadingDepartures] = useState(false);
  const [errorArrivals, setErrorArrivals] = useState<string | null>(null);
  const [errorDepartures, setErrorDepartures] = useState<string | null>(null);

  // Filters
  const [balanceOnlyArrivals, setBalanceOnlyArrivals] = useState(false);
  const [balanceOnlyDepartures, setBalanceOnlyDepartures] = useState(false);

  // Sorting — arrivals
  const [arrivalSortField, setArrivalSortField] = useState<ArrivalSortField>('checkInDate');
  const [arrivalSortDir, setArrivalSortDir] = useState<SortDir>('asc');

  // Sorting — departures
  const [departureSortField, setDepartureSortField] = useState<DepartureSortField>('checkOutDate');
  const [departureSortDir, setDepartureSortDir] = useState<SortDir>('asc');

  const printRef = useRef<HTMLDivElement>(null);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchArrivals = useCallback(async () => {
    setLoadingArrivals(true);
    setErrorArrivals(null);
    try {
      const res = await reportsService.getArrivals({ date });
      setArrivalsData(res.data?.data?.rows ?? []);
    } catch (err: any) {
      setErrorArrivals(
        err?.response?.data?.message || t('admin.reports.arrivalsDepartures.errorLoading'),
      );
    } finally {
      setLoadingArrivals(false);
    }
  }, [date, t]);

  const fetchDepartures = useCallback(async () => {
    setLoadingDepartures(true);
    setErrorDepartures(null);
    try {
      const res = await reportsService.getDepartures({ date });
      setDeparturesData(res.data?.data?.rows ?? []);
    } catch (err: any) {
      setErrorDepartures(
        err?.response?.data?.message || t('admin.reports.arrivalsDepartures.errorLoading'),
      );
    } finally {
      setLoadingDepartures(false);
    }
  }, [date, t]);

  useEffect(() => {
    fetchArrivals();
    fetchDepartures();
  }, [fetchArrivals, fetchDepartures]);

  // ── Print ───────────────────────────────────────────────────────────────────

  const handlePrint = useReactToPrint({ contentRef: printRef });

  // ── Navigation ──────────────────────────────────────────────────────────────

  function prevDay() {
    setDate(toDateStr(addDays(new Date(date), -1)));
  }
  function nextDay() {
    setDate(toDateStr(addDays(new Date(date), 1)));
  }

  // ── Sort toggle ─────────────────────────────────────────────────────────────

  function toggleArrivalSort(field: ArrivalSortField) {
    if (arrivalSortField === field) {
      setArrivalSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setArrivalSortField(field);
      setArrivalSortDir('asc');
    }
  }

  function toggleDepartureSort(field: DepartureSortField) {
    if (departureSortField === field) {
      setDepartureSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setDepartureSortField(field);
      setDepartureSortDir('asc');
    }
  }

  // ── Derived data ────────────────────────────────────────────────────────────

  const filteredArrivals = sortArrivals(
    balanceOnlyArrivals ? arrivalsData.filter((r) => r.balanceDue > 0) : arrivalsData,
    arrivalSortField,
    arrivalSortDir,
  );

  const filteredDepartures = sortDepartures(
    balanceOnlyDepartures ? departuresData.filter((r) => r.balanceRemaining > 0) : departuresData,
    departureSortField,
    departureSortDir,
  );

  // ── Sort header cell ────────────────────────────────────────────────────────

  function SortHeaderA({ field, label }: { field: ArrivalSortField; label: string }) {
    const active = arrivalSortField === field;
    return (
      <TableCell
        onClick={() => toggleArrivalSort(field)}
        sx={{ cursor: 'pointer', fontWeight: active ? 700 : 600, whiteSpace: 'nowrap' }}
      >
        {label} {active ? (arrivalSortDir === 'asc' ? '↑' : '↓') : ''}
      </TableCell>
    );
  }

  function SortHeaderD({ field, label }: { field: DepartureSortField; label: string }) {
    const active = departureSortField === field;
    return (
      <TableCell
        onClick={() => toggleDepartureSort(field)}
        sx={{ cursor: 'pointer', fontWeight: active ? 700 : 600, whiteSpace: 'nowrap' }}
      >
        {label} {active ? (departureSortDir === 'asc' ? '↑' : '↓') : ''}
      </TableCell>
    );
  }

  // ── Arrivals table ──────────────────────────────────────────────────────────

  const ArrivalsTable = () => (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Typography variant="subtitle1" fontWeight={700}>
          {t('admin.reports.arrivalsDepartures.arrivalsTab')} ({filteredArrivals.length})
        </Typography>
        <Button
          size="small"
          variant={balanceOnlyArrivals ? 'contained' : 'outlined'}
          color="warning"
          startIcon={<WarningAmberIcon />}
          onClick={() => setBalanceOnlyArrivals((v) => !v)}
        >
          {t('admin.reports.arrivalsDepartures.filterBalanceDue')}
        </Button>
      </Stack>

      {loadingArrivals && (
        <Box textAlign="center" py={4}>
          <CircularProgress size={28} />
        </Box>
      )}
      {errorArrivals && <Alert severity="error" sx={{ mb: 2 }}>{errorArrivals}</Alert>}
      {!loadingArrivals && !errorArrivals && filteredArrivals.length === 0 && (
        <Typography color="text.secondary" textAlign="center" py={4}>
          {t('admin.reports.arrivalsDepartures.noArrivals')}
        </Typography>
      )}

      {!loadingArrivals && filteredArrivals.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colCode')}</TableCell>
                <SortHeaderA field="guestName" label={t('admin.reports.arrivalsDepartures.colGuest')} />
                <SortHeaderA field="roomName" label={t('admin.reports.arrivalsDepartures.colRoom')} />
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colType')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colCheckIn')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colCheckOut')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">{t('admin.reports.arrivalsDepartures.colGuests')}</TableCell>
                <SortHeaderA field="balanceDue" label={t('admin.reports.arrivalsDepartures.colBalanceDue')} />
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colStatus')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colNotes')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredArrivals.map((row) => (
                <TableRow
                  key={row.reservationId}
                  hover
                  sx={row.balanceDue > 0 ? { bgcolor: 'warning.50' } : {}}
                >
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {row.reservationCode || '—'}
                  </TableCell>
                  <TableCell>
                    <Box>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {row.guestName || '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {row.guestEmail}
                      </Typography>
                      {row.isCorporate && (
                        <Chip label={t('admin.reports.arrivalsDepartures.corporate')} size="small" color="info" sx={{ ml: 0.5 }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{row.roomName ?? '—'}</TableCell>
                  <TableCell>
                    <Chip label={row.type} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {fmtShortDate(row.checkInDate)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {row.checkOutDate ? fmtShortDate(row.checkOutDate) : '—'}
                  </TableCell>
                  <TableCell align="right">{row.totalGuests}</TableCell>
                  <TableCell>
                    {row.balanceDue > 0 ? (
                      <Typography variant="body2" color="warning.dark" fontWeight={700}>
                        {formatMoney(row.balanceDue)}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={t(`admin.reservations.status.${row.status}`, { defaultValue: row.status })}
                      size="small"
                      color={reservationStatusColor(row.status)}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 160 }}>
                    {row.specialRequests ? (
                      <Tooltip title={row.specialRequests}>
                        <Typography variant="caption" noWrap sx={{ display: 'block', maxWidth: 140 }}>
                          {row.specialRequests}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Tooltip title={t('admin.reports.arrivalsDepartures.openReservation')}>
                      <IconButton
                        size="small"
                        onClick={() => navigate(`/admin/reservations?id=${row.reservationId}`)}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );

  // ── Departures table ────────────────────────────────────────────────────────

  const DeparturesTable = () => (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Typography variant="subtitle1" fontWeight={700}>
          {t('admin.reports.arrivalsDepartures.departuresTab')} ({filteredDepartures.length})
        </Typography>
        <Button
          size="small"
          variant={balanceOnlyDepartures ? 'contained' : 'outlined'}
          color="warning"
          startIcon={<WarningAmberIcon />}
          onClick={() => setBalanceOnlyDepartures((v) => !v)}
        >
          {t('admin.reports.arrivalsDepartures.filterBalanceDue')}
        </Button>
      </Stack>

      {loadingDepartures && (
        <Box textAlign="center" py={4}>
          <CircularProgress size={28} />
        </Box>
      )}
      {errorDepartures && <Alert severity="error" sx={{ mb: 2 }}>{errorDepartures}</Alert>}
      {!loadingDepartures && !errorDepartures && filteredDepartures.length === 0 && (
        <Typography color="text.secondary" textAlign="center" py={4}>
          {t('admin.reports.arrivalsDepartures.noDepartures')}
        </Typography>
      )}

      {!loadingDepartures && filteredDepartures.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colCode')}</TableCell>
                <SortHeaderD field="guestName" label={t('admin.reports.arrivalsDepartures.colGuest')} />
                <SortHeaderD field="roomName" label={t('admin.reports.arrivalsDepartures.colRoom')} />
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colType')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colCheckIn')}</TableCell>
                <SortHeaderD field="checkOutDate" label={t('admin.reports.arrivalsDepartures.colCheckOut')} />
                <TableCell sx={{ fontWeight: 600 }} align="right">{t('admin.reports.arrivalsDepartures.colGuests')}</TableCell>
                <SortHeaderD field="balanceRemaining" label={t('admin.reports.arrivalsDepartures.colBalance')} />
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colPaymentStatus')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colFolio')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colStatus')}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t('admin.reports.arrivalsDepartures.colNotes')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDepartures.map((row) => (
                <TableRow
                  key={row.reservationId}
                  hover
                  sx={row.balanceRemaining > 0 ? { bgcolor: 'warning.50' } : {}}
                >
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {row.reservationCode || '—'}
                  </TableCell>
                  <TableCell>
                    <Box>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {row.guestName || '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {row.guestEmail}
                      </Typography>
                      {row.isCorporate && (
                        <Chip label={t('admin.reports.arrivalsDepartures.corporate')} size="small" color="info" sx={{ ml: 0.5 }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{row.roomName ?? '—'}</TableCell>
                  <TableCell>
                    <Chip label={row.type} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {fmtShortDate(row.checkInDate)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {row.checkOutDate ? fmtShortDate(row.checkOutDate) : '—'}
                  </TableCell>
                  <TableCell align="right">{row.totalGuests}</TableCell>
                  <TableCell>
                    {row.balanceRemaining > 0 ? (
                      <Typography variant="body2" color="warning.dark" fontWeight={700}>
                        {formatMoney(row.balanceRemaining)}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="success.main">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={t(`admin.reports.arrivalsDepartures.payment.${row.paymentStatus}`, { defaultValue: row.paymentStatus })}
                      size="small"
                      color={paymentStatusColor(row.paymentStatus)}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={row.isFolioClosed
                        ? t('admin.reports.arrivalsDepartures.folioClosed')
                        : t('admin.reports.arrivalsDepartures.folioOpen')}
                      size="small"
                      color={row.isFolioClosed ? 'success' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={t(`admin.reservations.status.${row.status}`, { defaultValue: row.status })}
                      size="small"
                      color={reservationStatusColor(row.status)}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 160 }}>
                    {row.specialRequests ? (
                      <Tooltip title={row.specialRequests}>
                        <Typography variant="caption" noWrap sx={{ display: 'block', maxWidth: 140 }}>
                          {row.specialRequests}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Tooltip title={t('admin.reports.arrivalsDepartures.openReservation')}>
                      <IconButton
                        size="small"
                        onClick={() => navigate(`/admin/reservations?id=${row.reservationId}`)}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box>
      {/* ── Header ── */}
      <Stack direction="row" alignItems="center" spacing={1.5} mb={2}>
        <FlightLandIcon color="primary" sx={{ fontSize: 32 }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {t('admin.reports.arrivalsDepartures.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.reports.arrivalsDepartures.subtitle')}
          </Typography>
        </Box>
      </Stack>

      {/* ── Controls ── */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        mb={2}
        flexWrap="wrap"
      >
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Tooltip title={t('admin.reports.arrivalsDepartures.prevDay')}>
            <IconButton size="small" onClick={prevDay}>
              <ArrowBackIosNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <TextField
            type="date"
            size="small"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            inputProps={{ style: { fontWeight: 600 } }}
            sx={{ width: 150 }}
          />
          <Tooltip title={t('admin.reports.arrivalsDepartures.nextDay')}>
            <IconButton size="small" onClick={nextDay}>
              <ArrowForwardIosIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => { fetchArrivals(); fetchDepartures(); }}
        >
          {t('admin.reports.arrivalsDepartures.refresh')}
        </Button>

        <Button
          size="small"
          variant="outlined"
          startIcon={<PrintIcon />}
          onClick={() => handlePrint()}
        >
          {t('admin.reports.arrivalsDepartures.print')}
        </Button>
      </Stack>

      {/* ── Summary badges ── */}
      <Stack direction="row" spacing={2} mb={2}>
        <Chip
          icon={<FlightLandIcon />}
          label={`${arrivalsData.length} ${t('admin.reports.arrivalsDepartures.arrivalsTab')}`}
          color="primary"
          variant="outlined"
        />
        <Chip
          icon={<FlightTakeoffIcon />}
          label={`${departuresData.length} ${t('admin.reports.arrivalsDepartures.departuresTab')}`}
          color="secondary"
          variant="outlined"
        />
        {arrivalsData.filter((r) => r.balanceDue > 0).length > 0 && (
          <Chip
            icon={<WarningAmberIcon />}
            label={`${arrivalsData.filter((r) => r.balanceDue > 0).length} ${t('admin.reports.arrivalsDepartures.withBalance')}`}
            color="warning"
            variant="outlined"
          />
        )}
      </Stack>

      {/* ── Tabs ── */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          value="arrivals"
          icon={<FlightLandIcon fontSize="small" />}
          iconPosition="start"
          label={`${t('admin.reports.arrivalsDepartures.arrivalsTab')} (${arrivalsData.length})`}
        />
        <Tab
          value="departures"
          icon={<FlightTakeoffIcon fontSize="small" />}
          iconPosition="start"
          label={`${t('admin.reports.arrivalsDepartures.departuresTab')} (${departuresData.length})`}
        />
        <Tab
          value="combined"
          label={t('admin.reports.arrivalsDepartures.combinedTab')}
        />
      </Tabs>

      {/* ── Printable area ── */}
      <Box ref={printRef}>
        {/* Print header */}
        <Box sx={{ display: 'none', '@media print': { display: 'block' }, mb: 2 }}>
          <Typography variant="h6" fontWeight={700}>
            {t('admin.reports.arrivalsDepartures.title')} — {fmtShortDate(new Date(date).toISOString())}
          </Typography>
          <Divider sx={{ my: 1 }} />
        </Box>

        {tab === 'arrivals' && <ArrivalsTable />}
        {tab === 'departures' && <DeparturesTable />}
        {tab === 'combined' && (
          <Stack spacing={4}>
            <ArrivalsTable />
            <Divider />
            <DeparturesTable />
          </Stack>
        )}
      </Box>

      {/* ── Print styles ── */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          [data-print-area], [data-print-area] * { visibility: visible; }
          .no-print { display: none !important; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 4px 8px; font-size: 11px; }
        }
      `}</style>
    </Box>
  );
};

export default ArrivalsDeparturesReport;
