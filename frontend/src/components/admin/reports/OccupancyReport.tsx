import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
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
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import HotelIcon from '@mui/icons-material/Hotel';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import PercentIcon from '@mui/icons-material/Percent';
import DownloadIcon from '@mui/icons-material/Download';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { reportsService } from '../../../services/api';
import { formatMoney } from '../../../utils/currency';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OccupancyRow {
  date: string;
  roomsAvailable: number;
  roomsSold: number;
  occupancyPct: number;
  roomRevenue: number;
  adr: number;
  revpar: number;
}

interface OccupancySummary {
  occupancyPct: number;
  adr: number;
  revpar: number;
  roomRevenue: number;
  roomsSold: number;
  roomsAvailable: number;
}

interface OccupancyData {
  filters: {
    from: string;
    to: string;
    groupBy: string;
    compareTo: string | null;
  };
  summary: OccupancySummary;
  rows: OccupancyRow[];
  comparison: {
    summary: OccupancySummary;
    rows: OccupancyRow[];
  } | null;
}

type Preset = '7d' | '30d' | '90d' | 'custom';
type GroupBy = 'day' | 'week' | 'month';
type CompareTo = '' | 'prev_period' | 'prev_year';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function presetDates(preset: Preset): { from: string; to: string } {
  const to = todayStr();
  if (preset === '7d') return { from: daysAgoStr(6), to };
  if (preset === '30d') return { from: daysAgoStr(29), to };
  if (preset === '90d') return { from: daysAgoStr(89), to };
  return { from: daysAgoStr(29), to };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  comparisonValue?: string;
  changePct?: number | null;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, icon, color, comparisonValue, changePct }) => {
  const isPositive = changePct !== null && changePct !== undefined && changePct >= 0;
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {title}
            </Typography>
            <Typography variant="h4" fontWeight={700} color={color}>
              {value}
            </Typography>
            {comparisonValue !== undefined && (
              <Stack direction="row" alignItems="center" spacing={0.5} mt={0.5}>
                {changePct !== null && changePct !== undefined && (
                  <>
                    {isPositive ? (
                      <TrendingUpIcon sx={{ fontSize: 16, color: 'success.main' }} />
                    ) : (
                      <TrendingDownIcon sx={{ fontSize: 16, color: 'error.main' }} />
                    )}
                    <Typography
                      variant="caption"
                      color={isPositive ? 'success.main' : 'error.main'}
                      fontWeight={600}
                    >
                      {isPositive ? '+' : ''}{changePct.toFixed(1)}%
                    </Typography>
                  </>
                )}
                <Typography variant="caption" color="text.secondary">
                  vs {comparisonValue}
                </Typography>
              </Stack>
            )}
          </Box>
          <Box sx={{ color, opacity: 0.7, mt: 0.5 }}>{icon}</Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const OccupancyReport: React.FC = () => {
  const { t } = useTranslation();

  // Filters
  const [preset, setPreset] = useState<Preset>('30d');
  const [from, setFrom] = useState<string>(daysAgoStr(29));
  const [to, setTo] = useState<string>(todayStr());
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [compareTo, setCompareTo] = useState<CompareTo>('');

  // Print ref for PDF export
  const printRef = useRef<HTMLDivElement>(null);
  const handlePdfExport = useReactToPrint({
    contentRef: printRef,
    documentTitle: `occupancy-${from}-${to}`,
  });

  // Data
  const [data, setData] = useState<OccupancyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await reportsService.getOccupancy({
        from,
        to,
        groupBy,
        compareTo: compareTo || undefined,
      });
      setData(res.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || t('admin.reports.occupancy.errorLoading'));
    } finally {
      setLoading(false);
    }
  }, [from, to, groupBy, compareTo, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePresetChange = (_: React.MouseEvent<HTMLElement>, value: Preset | null) => {
    if (!value) return;
    setPreset(value);
    if (value !== 'custom') {
      const dates = presetDates(value);
      setFrom(dates.from);
      setTo(dates.to);
    }
  };

  const handleCsvExport = () => {
    const params = new URLSearchParams({ from, to, groupBy, format: 'csv' });
    if (compareTo) params.set('compareTo', compareTo);
    const token = localStorage.getItem('token');
    // Open CSV via the API directly — browser will prompt download
    const apiBase = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
    const url = `${apiBase}/admin/reports/occupancy?${params.toString()}`;
    // Use fetch to attach auth header, then trigger download
    fetch(url, { headers: { Authorization: `Bearer ${token || ''}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `occupancy-${from}-${to}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  // Merge rows for chart display (current + comparison side by side)
  const chartData = React.useMemo(() => {
    if (!data) return [];
    return data.rows.map((row, idx) => {
      const comp = data.comparison?.rows[idx];
      return {
        date: row.date,
        occupancyPct: row.occupancyPct,
        adr: row.adr,
        revpar: row.revpar,
        compOccupancyPct: comp?.occupancyPct,
        compAdr: comp?.adr,
        compRevpar: comp?.revpar,
      };
    });
  }, [data]);

  const summary = data?.summary;
  const compSummary = data?.comparison?.summary;

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
        <HotelIcon color="primary" sx={{ fontSize: 32 }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {t('admin.reports.occupancy.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.reports.occupancy.subtitle')}
          </Typography>
        </Box>
      </Stack>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack spacing={2}>
          {/* Preset buttons */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} flexWrap="wrap">
            <ToggleButtonGroup
              value={preset}
              exclusive
              onChange={handlePresetChange}
              size="small"
            >
              <ToggleButton value="7d">{t('admin.reports.occupancy.last7days')}</ToggleButton>
              <ToggleButton value="30d">{t('admin.reports.occupancy.last30days')}</ToggleButton>
              <ToggleButton value="90d">{t('admin.reports.occupancy.last90days')}</ToggleButton>
              <ToggleButton value="custom">{t('admin.reports.occupancy.custom')}</ToggleButton>
            </ToggleButtonGroup>

            {preset === 'custom' && (
              <Stack direction="row" spacing={1}>
                <TextField
                  label={t('admin.reports.occupancy.from')}
                  type="date"
                  size="small"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label={t('admin.reports.occupancy.to')}
                  type="date"
                  size="small"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Stack>
            )}
          </Stack>

          {/* Group by + Compare + Actions */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>{t('admin.reports.occupancy.groupBy')}</InputLabel>
              <Select
                value={groupBy}
                label={t('admin.reports.occupancy.groupBy')}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              >
                <MenuItem value="day">{t('admin.reports.occupancy.groupDay')}</MenuItem>
                <MenuItem value="week">{t('admin.reports.occupancy.groupWeek')}</MenuItem>
                <MenuItem value="month">{t('admin.reports.occupancy.groupMonth')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>{t('admin.reports.occupancy.compareTo')}</InputLabel>
              <Select
                value={compareTo}
                label={t('admin.reports.occupancy.compareTo')}
                onChange={(e) => setCompareTo(e.target.value as CompareTo)}
              >
                <MenuItem value="">{t('admin.reports.occupancy.noComparison')}</MenuItem>
                <MenuItem value="prev_period">{t('admin.reports.occupancy.prevPeriod')}</MenuItem>
                <MenuItem value="prev_year">{t('admin.reports.occupancy.prevYear')}</MenuItem>
              </Select>
            </FormControl>

            <Box flexGrow={1} />

            <ButtonGroup size="small" variant="outlined">
              <Tooltip title={t('admin.reports.occupancy.refresh')}>
                <Button onClick={fetchData} disabled={loading}>
                  <RefreshIcon fontSize="small" />
                </Button>
              </Tooltip>
              <Tooltip title={t('admin.reports.occupancy.exportCsv')}>
                <Button onClick={handleCsvExport} disabled={loading || !data} startIcon={<DownloadIcon />}>
                  CSV
                </Button>
              </Tooltip>
              <Tooltip title={t('admin.reports.occupancy.exportPdf')}>
                <Button onClick={() => handlePdfExport()} disabled={loading || !data} startIcon={<PictureAsPdfIcon />}>
                  PDF
                </Button>
              </Tooltip>
            </ButtonGroup>
          </Stack>
        </Stack>
      </Paper>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      )}

      {!loading && data && (
        <div ref={printRef} style={{ padding: 0 }}>
          {/* KPI Summary Cards */}
          <Grid container spacing={2} mb={3}>
            <Grid item xs={12} sm={4}>
              <KpiCard
                title={t('admin.reports.occupancy.kpiOccupancy')}
                value={`${summary?.occupancyPct.toFixed(1)}%`}
                icon={<PercentIcon sx={{ fontSize: 36 }} />}
                color="#1976d2"
                comparisonValue={compSummary ? `${compSummary.occupancyPct.toFixed(1)}%` : undefined}
                changePct={
                  compSummary != null
                    ? pctChange(summary!.occupancyPct, compSummary.occupancyPct)
                    : undefined
                }
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <KpiCard
                title={t('admin.reports.occupancy.kpiAdr')}
                value={formatMoney(summary?.adr)}
                icon={<AttachMoneyIcon sx={{ fontSize: 36 }} />}
                color="#2e7d32"
                comparisonValue={compSummary ? formatMoney(compSummary.adr) : undefined}
                changePct={
                  compSummary != null ? pctChange(summary!.adr, compSummary.adr) : undefined
                }
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <KpiCard
                title={t('admin.reports.occupancy.kpiRevpar')}
                value={formatMoney(summary?.revpar)}
                icon={<TrendingUpIcon sx={{ fontSize: 36 }} />}
                color="#7b1fa2"
                comparisonValue={compSummary ? formatMoney(compSummary.revpar) : undefined}
                changePct={
                  compSummary != null
                    ? pctChange(summary!.revpar, compSummary.revpar)
                    : undefined
                }
              />
            </Grid>
          </Grid>

          {/* Trend Charts */}
          <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" fontWeight={600} mb={2}>
              {t('admin.reports.occupancy.chartTitle')}
            </Typography>

            {/* Occupancy % chart */}
            <Typography variant="subtitle2" color="text.secondary" mb={1}>
              {t('admin.reports.occupancy.kpiOccupancy')} (%)
            </Typography>
            <Box height={220} mb={3}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis unit="%" width={48} tick={{ fontSize: 11 }} tickLine={false} />
                  <ChartTooltip formatter={(v: any) => [`${Number(v).toFixed(1)}%`]} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="occupancyPct"
                    name={t('admin.reports.occupancy.kpiOccupancy')}
                    stroke="#1976d2"
                    strokeWidth={2}
                    dot={false}
                  />
                  {data.comparison && (
                    <Line
                      type="monotone"
                      dataKey="compOccupancyPct"
                      name={t('admin.reports.occupancy.comparison')}
                      stroke="#90caf9"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </Box>

            <Divider sx={{ mb: 3 }} />

            {/* ADR chart */}
            <Typography variant="subtitle2" color="text.secondary" mb={1}>
              {t('admin.reports.occupancy.kpiAdr')}
            </Typography>
            <Box height={220} mb={3}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis width={60} tick={{ fontSize: 11 }} tickLine={false} />
                  <ChartTooltip formatter={(v: any) => [formatMoney(Number(v))]} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="adr"
                    name={t('admin.reports.occupancy.kpiAdr')}
                    stroke="#2e7d32"
                    strokeWidth={2}
                    dot={false}
                  />
                  {data.comparison && (
                    <Line
                      type="monotone"
                      dataKey="compAdr"
                      name={t('admin.reports.occupancy.comparison')}
                      stroke="#a5d6a7"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </Box>

            <Divider sx={{ mb: 3 }} />

            {/* RevPAR chart */}
            <Typography variant="subtitle2" color="text.secondary" mb={1}>
              {t('admin.reports.occupancy.kpiRevpar')}
            </Typography>
            <Box height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis width={60} tick={{ fontSize: 11 }} tickLine={false} />
                  <ChartTooltip formatter={(v: any) => [formatMoney(Number(v))]} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revpar"
                    name={t('admin.reports.occupancy.kpiRevpar')}
                    stroke="#7b1fa2"
                    strokeWidth={2}
                    dot={false}
                  />
                  {data.comparison && (
                    <Line
                      type="monotone"
                      dataKey="compRevpar"
                      name={t('admin.reports.occupancy.comparison')}
                      stroke="#ce93d8"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </Paper>

          {/* Detail Table */}
          <Paper variant="outlined">
            <Box px={3} pt={2} pb={1}>
              <Typography variant="h6" fontWeight={600}>
                {t('admin.reports.occupancy.tableTitle')}
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.reports.occupancy.colDate')}</TableCell>
                    <TableCell align="right">{t('admin.reports.occupancy.colRoomsAvailable')}</TableCell>
                    <TableCell align="right">{t('admin.reports.occupancy.colRoomsSold')}</TableCell>
                    <TableCell align="right">{t('admin.reports.occupancy.kpiOccupancy')}</TableCell>
                    <TableCell align="right">{t('admin.reports.occupancy.colRevenue')}</TableCell>
                    <TableCell align="right">{t('admin.reports.occupancy.kpiAdr')}</TableCell>
                    <TableCell align="right">{t('admin.reports.occupancy.kpiRevpar')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography variant="body2" color="text.secondary" py={3}>
                          {t('admin.reports.occupancy.noData')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row) => (
                      <TableRow key={row.date} hover>
                        <TableCell>{row.date}</TableCell>
                        <TableCell align="right">{row.roomsAvailable}</TableCell>
                        <TableCell align="right">{row.roomsSold}</TableCell>
                        <TableCell align="right">
                          <Box
                            component="span"
                            sx={{
                              fontWeight: 600,
                              color:
                                row.occupancyPct >= 80
                                  ? 'success.main'
                                  : row.occupancyPct >= 50
                                  ? 'warning.main'
                                  : 'text.primary',
                            }}
                          >
                            {row.occupancyPct.toFixed(1)}%
                          </Box>
                        </TableCell>
                        <TableCell align="right">{formatMoney(row.roomRevenue)}</TableCell>
                        <TableCell align="right">{formatMoney(row.adr)}</TableCell>
                        <TableCell align="right">{formatMoney(row.revpar)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </div>
      )}
    </Box>
  );
};

export default OccupancyReport;
