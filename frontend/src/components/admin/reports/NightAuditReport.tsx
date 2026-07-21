import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import HotelIcon from '@mui/icons-material/Hotel';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import RefreshIcon from '@mui/icons-material/Refresh';
import TableChartIcon from '@mui/icons-material/TableChart';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { useTranslation } from 'react-i18next';
import { reportsService } from '../../../services/api';
import { formatMoney } from '../../../utils/currency';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NightAuditRoomStats {
  totalRooms: number;
  occupied: number;
  arrivals: number;
  arrivalsDone: number;
  departures: number;
  departuresDone: number;
  noShows: number;
  stayOvers: number;
}

interface NightAuditRevenue {
  room: number;
  service: number;
  lateFee: number;
  damage: number;
  adjustment: number;
  other: number;
  total: number;
}

interface NightAuditPayments {
  cash: number;
  card: number;
  transfer: number;
  check: number;
  credit: number;
  total: number;
}

interface NightAuditOutstanding {
  openFoliosCount: number;
  totalOutstanding: number;
}

interface CashierClosureSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalCash: number;
  totalCard: number;
  totalTransfer: number;
  totalCheck: number;
  total: number;
}

interface NightAuditData {
  date: string;
  roomStats: NightAuditRoomStats;
  revenue: NightAuditRevenue;
  payments: NightAuditPayments;
  outstanding: NightAuditOutstanding;
  cashierClosures: CashierClosureSummary[];
}

interface NightAuditRangeRow {
  date: string;
  totalRooms: number;
  occupied: number;
  arrivals: number;
  departures: number;
  noShows: number;
  totalRevenue: number;
  totalPayments: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function yesterdayStr(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function addDaysToStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  subLabel?: string;
  color?: string;
  icon?: React.ReactNode;
  highlight?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subLabel,
  color = 'text.primary',
  icon,
  highlight,
}) => (
  <Card
    variant="outlined"
    sx={{
      height: '100%',
      ...(highlight && { borderColor: 'primary.main', borderWidth: 2 }),
    }}
  >
    <CardContent sx={{ pb: '12px !important' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="caption" color="text.secondary" fontWeight={500}>
            {label}
          </Typography>
          <Typography variant="h4" fontWeight={700} color={color} lineHeight={1.2} mt={0.5}>
            {value}
          </Typography>
          {subLabel && (
            <Typography variant="caption" color="text.secondary">
              {subLabel}
            </Typography>
          )}
        </Box>
        {icon && (
          <Box sx={{ color, opacity: 0.6, mt: 0.5 }}>{icon}</Box>
        )}
      </Stack>
    </CardContent>
  </Card>
);

// ─── Main Component ───────────────────────────────────────────────────────────

type ViewMode = 'detail' | 'range';

const NightAuditReport: React.FC = () => {
  const { t } = useTranslation();

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('detail');

  // Detail view state
  const [date, setDate] = useState<string>(yesterdayStr());
  const [detailData, setDetailData] = useState<NightAuditData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Range view state
  const [rangeFrom, setRangeFrom] = useState<string>(daysAgoStr(7));
  const [rangeTo, setRangeTo] = useState<string>(yesterdayStr());
  const [rangeData, setRangeData] = useState<NightAuditRangeRow[] | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Print ref for PDF export
  const printRef = useRef<HTMLDivElement>(null);
  const handlePdfExport = useReactToPrint({
    contentRef: printRef,
    documentTitle: `night-audit-${date}`,
  });

  // ── Fetch detail ──────────────────────────────────────────────────────────
  const fetchDetail = useCallback(async () => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await reportsService.getNightAudit({ date });
      setDetailData(res.data.data);
    } catch (err: any) {
      setDetailError(
        err?.response?.data?.message || t('admin.reports.nightAudit.errorLoading'),
      );
    } finally {
      setDetailLoading(false);
    }
  }, [date, t]);

  // ── Fetch range ───────────────────────────────────────────────────────────
  const fetchRange = useCallback(async () => {
    setRangeLoading(true);
    setRangeError(null);
    try {
      const res = await reportsService.getNightAuditRange({
        from: rangeFrom,
        to: rangeTo,
      });
      setRangeData(res.data.data.rows);
    } catch (err: any) {
      setRangeError(
        err?.response?.data?.message || t('admin.reports.nightAudit.errorLoading'),
      );
    } finally {
      setRangeLoading(false);
    }
  }, [rangeFrom, rangeTo, t]);

  useEffect(() => {
    if (viewMode === 'detail') fetchDetail();
  }, [viewMode, fetchDetail]);

  useEffect(() => {
    if (viewMode === 'range') fetchRange();
  }, [viewMode, fetchRange]);

  const handlePrevDay = () => setDate((d) => addDaysToStr(d, -1));
  const handleNextDay = () => {
    const next = addDaysToStr(date, 1);
    if (next <= todayStr()) setDate(next);
  };

  // ── Occupancy % for detail view ───────────────────────────────────────────
  const occupancyPct =
    detailData && detailData.roomStats.totalRooms > 0
      ? (
          (detailData.roomStats.occupied / detailData.roomStats.totalRooms) *
          100
        ).toFixed(1)
      : '—';

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
        <NightsStayIcon color="primary" sx={{ fontSize: 32 }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {t('admin.reports.nightAudit.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.reports.nightAudit.subtitle')}
          </Typography>
        </Box>
      </Stack>

      {/* Controls */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ sm: 'center' }}
          flexWrap="wrap"
        >
          {/* View toggle */}
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            size="small"
          >
            <ToggleButton value="detail">
              <CalendarTodayIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('admin.reports.nightAudit.detailView')}
            </ToggleButton>
            <ToggleButton value="range">
              <TableChartIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('admin.reports.nightAudit.rangeView')}
            </ToggleButton>
          </ToggleButtonGroup>

          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />

          {viewMode === 'detail' ? (
            /* Date navigation */
            <Stack direction="row" alignItems="center" spacing={1}>
              <Tooltip title={t('admin.reports.nightAudit.prevDay')}>
                <IconButton size="small" onClick={handlePrevDay}>
                  <ArrowBackIosNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <TextField
                type="date"
                size="small"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                inputProps={{ max: todayStr() }}
                InputLabelProps={{ shrink: true }}
                label={t('admin.reports.nightAudit.auditDate')}
                sx={{ width: 170 }}
              />
              <Tooltip title={t('admin.reports.nightAudit.nextDay')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={handleNextDay}
                    disabled={date >= todayStr()}
                  >
                    <ArrowForwardIosIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          ) : (
            /* Range date pickers */
            <Stack direction="row" spacing={1}>
              <TextField
                label={t('admin.reports.nightAudit.from')}
                type="date"
                size="small"
                value={rangeFrom}
                onChange={(e) => e.target.value && setRangeFrom(e.target.value)}
                inputProps={{ max: rangeTo }}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label={t('admin.reports.nightAudit.to')}
                type="date"
                size="small"
                value={rangeTo}
                onChange={(e) => e.target.value && setRangeTo(e.target.value)}
                inputProps={{ max: todayStr() }}
                InputLabelProps={{ shrink: true }}
              />
            </Stack>
          )}

          <Box flexGrow={1} />

          {/* Actions */}
          <ButtonGroup size="small" variant="outlined">
            <Tooltip title={t('admin.reports.nightAudit.refresh')}>
              <Button
                onClick={viewMode === 'detail' ? fetchDetail : fetchRange}
                disabled={detailLoading || rangeLoading}
              >
                <RefreshIcon fontSize="small" />
              </Button>
            </Tooltip>
            {viewMode === 'detail' && (
              <Tooltip title={t('admin.reports.nightAudit.exportPdf')}>
                <Button
                  onClick={() => handlePdfExport()}
                  disabled={detailLoading || !detailData}
                  startIcon={<PictureAsPdfIcon />}
                >
                  PDF
                </Button>
              </Tooltip>
            )}
          </ButtonGroup>
        </Stack>
      </Paper>

      {/* ── Detail View ── */}
      {viewMode === 'detail' && (
        <>
          {detailError && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {detailError}
            </Alert>
          )}

          {detailLoading && (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          )}

          {!detailLoading && detailData && (
            <div ref={printRef}>
              {/* Print header */}
              <Box
                sx={{
                  display: 'none',
                  '@media print': { display: 'block', mb: 3 },
                }}
              >
                <Typography variant="h5" fontWeight={700}>
                  {t('admin.reports.nightAudit.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('admin.reports.nightAudit.auditDate')}: {detailData.date}
                </Typography>
                <Divider sx={{ mt: 1, mb: 2 }} />
              </Box>

              {/* Date badge */}
              <Stack direction="row" alignItems="center" spacing={1} mb={3}>
                <Chip
                  label={detailData.date}
                  color="primary"
                  icon={<CalendarTodayIcon />}
                  sx={{ fontWeight: 700, fontSize: '0.95rem', height: 32 }}
                />
                <Typography variant="body2" color="text.secondary">
                  {t('admin.reports.nightAudit.generatedAt')}{' '}
                  {new Date().toLocaleTimeString()}
                </Typography>
              </Stack>

              {/* ── Section 1: Room Statistics ── */}
              <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                  <HotelIcon color="primary" fontSize="small" />
                  <Typography variant="h6" fontWeight={700}>
                    {t('admin.reports.nightAudit.sectionRooms')}
                  </Typography>
                </Stack>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={4} md={2}>
                    <StatCard
                      label={t('admin.reports.nightAudit.statOccupancy')}
                      value={`${occupancyPct}%`}
                      subLabel={`${detailData.roomStats.occupied}/${detailData.roomStats.totalRooms}`}
                      color="primary.main"
                      highlight
                    />
                  </Grid>
                  <Grid item xs={6} sm={4} md={2}>
                    <StatCard
                      label={t('admin.reports.nightAudit.statOccupied')}
                      value={detailData.roomStats.occupied}
                    />
                  </Grid>
                  <Grid item xs={6} sm={4} md={2}>
                    <StatCard
                      label={t('admin.reports.nightAudit.statArrivals')}
                      value={detailData.roomStats.arrivals}
                      subLabel={`${detailData.roomStats.arrivalsDone} ${t('admin.reports.nightAudit.done')}`}
                      color="success.main"
                    />
                  </Grid>
                  <Grid item xs={6} sm={4} md={2}>
                    <StatCard
                      label={t('admin.reports.nightAudit.statDepartures')}
                      value={detailData.roomStats.departures}
                      subLabel={`${detailData.roomStats.departuresDone} ${t('admin.reports.nightAudit.done')}`}
                      color="warning.main"
                    />
                  </Grid>
                  <Grid item xs={6} sm={4} md={2}>
                    <StatCard
                      label={t('admin.reports.nightAudit.statStayOvers')}
                      value={detailData.roomStats.stayOvers}
                    />
                  </Grid>
                  <Grid item xs={6} sm={4} md={2}>
                    <StatCard
                      label={t('admin.reports.nightAudit.statNoShows')}
                      value={detailData.roomStats.noShows}
                      color={detailData.roomStats.noShows > 0 ? 'error.main' : 'text.primary'}
                    />
                  </Grid>
                </Grid>
              </Paper>

              {/* ── Section 2: Revenue Summary ── */}
              <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                  <AttachMoneyIcon color="success" fontSize="small" />
                  <Typography variant="h6" fontWeight={700}>
                    {t('admin.reports.nightAudit.sectionRevenue')}
                  </Typography>
                </Stack>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>
                          {t('admin.reports.nightAudit.colDepartment')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('admin.reports.nightAudit.colAmount')}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailData.revenue.room > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.revRoom')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.revenue.room)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.revenue.service > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.revService')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.revenue.service)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.revenue.lateFee > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.revLateFee')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.revenue.lateFee)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.revenue.damage > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.revDamage')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.revenue.damage)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.revenue.adjustment !== 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.revAdjustment')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.revenue.adjustment)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.revenue.other > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.revOther')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.revenue.other)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.revenue.total === 0 && (
                        <TableRow>
                          <TableCell colSpan={2} align="center">
                            <Typography variant="body2" color="text.secondary" py={1}>
                              {t('admin.reports.nightAudit.noChargesPosted')}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                    <TableBody>
                      <TableRow sx={{ bgcolor: 'action.selected' }}>
                        <TableCell sx={{ fontWeight: 700 }}>
                          {t('admin.reports.nightAudit.total')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {formatMoney(detailData.revenue.total)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>

              {/* ── Section 3: Payment Summary ── */}
              <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                  <AccountBalanceWalletIcon color="info" fontSize="small" />
                  <Typography variant="h6" fontWeight={700}>
                    {t('admin.reports.nightAudit.sectionPayments')}
                  </Typography>
                </Stack>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>
                          {t('admin.reports.nightAudit.colMethod')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {t('admin.reports.nightAudit.colAmount')}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailData.payments.cash > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.pmtCash')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.payments.cash)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.payments.card > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.pmtCard')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.payments.card)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.payments.transfer > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.pmtTransfer')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.payments.transfer)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.payments.check > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.pmtCheck')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.payments.check)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.payments.credit > 0 && (
                        <TableRow>
                          <TableCell>{t('admin.reports.nightAudit.pmtCredit')}</TableCell>
                          <TableCell align="right">
                            {formatMoney(detailData.payments.credit)}
                          </TableCell>
                        </TableRow>
                      )}
                      {detailData.payments.total === 0 && (
                        <TableRow>
                          <TableCell colSpan={2} align="center">
                            <Typography variant="body2" color="text.secondary" py={1}>
                              {t('admin.reports.nightAudit.noPaymentsPosted')}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                    <TableBody>
                      <TableRow sx={{ bgcolor: 'action.selected' }}>
                        <TableCell sx={{ fontWeight: 700 }}>
                          {t('admin.reports.nightAudit.total')}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {formatMoney(detailData.payments.total)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>

              {/* ── Section 4: Outstanding Balances ── */}
              <Paper
                variant="outlined"
                sx={{
                  p: 3,
                  mb: 3,
                  ...(detailData.outstanding.totalOutstanding > 0 && {
                    borderColor: 'warning.main',
                  }),
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                  <WarningAmberIcon
                    sx={{
                      fontSize: 20,
                      color:
                        detailData.outstanding.totalOutstanding > 0
                          ? 'warning.main'
                          : 'text.secondary',
                    }}
                  />
                  <Typography variant="h6" fontWeight={700}>
                    {t('admin.reports.nightAudit.sectionOutstanding')}
                  </Typography>
                </Stack>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <StatCard
                      label={t('admin.reports.nightAudit.outstandingFolios')}
                      value={detailData.outstanding.openFoliosCount}
                      color={
                        detailData.outstanding.openFoliosCount > 0
                          ? 'warning.main'
                          : 'success.main'
                      }
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <StatCard
                      label={t('admin.reports.nightAudit.outstandingTotal')}
                      value={formatMoney(detailData.outstanding.totalOutstanding)}
                      color={
                        detailData.outstanding.totalOutstanding > 0
                          ? 'warning.main'
                          : 'success.main'
                      }
                    />
                  </Grid>
                </Grid>
              </Paper>

              {/* ── Section 5: Cashier Closures ── */}
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                  <Typography variant="h6" fontWeight={700}>
                    {t('admin.reports.nightAudit.sectionCashier')}
                  </Typography>
                  <Chip
                    label={detailData.cashierClosures.length}
                    size="small"
                    color={detailData.cashierClosures.length > 0 ? 'success' : 'default'}
                  />
                </Stack>
                {detailData.cashierClosures.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {t('admin.reports.nightAudit.noClosures')}
                  </Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>
                            {t('admin.reports.nightAudit.colPeriodStart')}
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>
                            {t('admin.reports.nightAudit.colPeriodEnd')}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {t('admin.reports.nightAudit.pmtCash')}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {t('admin.reports.nightAudit.pmtCard')}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {t('admin.reports.nightAudit.pmtTransfer')}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {t('admin.reports.nightAudit.pmtCheck')}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, color: 'primary.main' }}>
                            {t('admin.reports.nightAudit.total')}
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detailData.cashierClosures.map((c) => (
                          <TableRow key={c.id} hover>
                            <TableCell>{formatDateTime(c.periodStart)}</TableCell>
                            <TableCell>{formatDateTime(c.periodEnd)}</TableCell>
                            <TableCell align="right">{formatMoney(c.totalCash)}</TableCell>
                            <TableCell align="right">{formatMoney(c.totalCard)}</TableCell>
                            <TableCell align="right">{formatMoney(c.totalTransfer)}</TableCell>
                            <TableCell align="right">{formatMoney(c.totalCheck)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>
                              {formatMoney(c.total)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Paper>
            </div>
          )}
        </>
      )}

      {/* ── Range View ── */}
      {viewMode === 'range' && (
        <>
          {rangeError && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {rangeError}
            </Alert>
          )}

          {rangeLoading && (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          )}

          {!rangeLoading && rangeData && (
            <Paper variant="outlined">
              <Box px={3} pt={2} pb={1}>
                <Typography variant="h6" fontWeight={600}>
                  {t('admin.reports.nightAudit.rangeTableTitle')}
                </Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>
                        {t('admin.reports.nightAudit.colDate')}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {t('admin.reports.nightAudit.colOccupied')}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {t('admin.reports.nightAudit.colOccPct')}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {t('admin.reports.nightAudit.statArrivals')}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {t('admin.reports.nightAudit.statDepartures')}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {t('admin.reports.nightAudit.statNoShows')}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {t('admin.reports.nightAudit.colRevenue')}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {t('admin.reports.nightAudit.colPayments')}
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rangeData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} align="center">
                          <Typography variant="body2" color="text.secondary" py={3}>
                            {t('admin.reports.nightAudit.noData')}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      rangeData.map((row) => {
                        const occ =
                          row.totalRooms > 0
                            ? ((row.occupied / row.totalRooms) * 100).toFixed(1)
                            : '—';
                        return (
                          <TableRow
                            key={row.date}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() => {
                              setDate(row.date);
                              setViewMode('detail');
                            }}
                          >
                            <TableCell sx={{ fontWeight: 600 }}>{row.date}</TableCell>
                            <TableCell align="right">{row.occupied}</TableCell>
                            <TableCell align="right">
                              <Box
                                component="span"
                                sx={{
                                  fontWeight: 600,
                                  color:
                                    Number(occ) >= 80
                                      ? 'success.main'
                                      : Number(occ) >= 50
                                      ? 'warning.main'
                                      : 'text.primary',
                                }}
                              >
                                {occ}%
                              </Box>
                            </TableCell>
                            <TableCell align="right">{row.arrivals}</TableCell>
                            <TableCell align="right">{row.departures}</TableCell>
                            <TableCell align="right">
                              {row.noShows > 0 ? (
                                <Box component="span" sx={{ color: 'error.main', fontWeight: 600 }}>
                                  {row.noShows}
                                </Box>
                              ) : (
                                row.noShows
                              )}
                            </TableCell>
                            <TableCell align="right">
                              {formatMoney(row.totalRevenue)}
                            </TableCell>
                            <TableCell align="right">
                              {formatMoney(row.totalPayments)}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
};

export default NightAuditReport;
