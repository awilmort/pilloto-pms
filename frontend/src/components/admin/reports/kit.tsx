/**
 * Building blocks shared by the management reports: header, filter bar (range presets, refresh,
 * CSV, print), KPI tiles with a delta against a comparison period, chart cards that switch
 * between the chart and its data table, and a client-side CSV export.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import i18n from '../../../i18n';
import { useReactToPrint } from 'react-to-print';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CircularProgress,
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
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RemoveIcon from '@mui/icons-material/Remove';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import PrintIcon from '@mui/icons-material/Print';
import InsertChartOutlinedIcon from '@mui/icons-material/InsertChartOutlined';
import TableRowsIcon from '@mui/icons-material/TableRows';
import { useTranslation } from 'react-i18next';
import EChart, { ChartOption } from '../../charts/EChart';
import { formatMoney } from '../../../utils/currency';

// ─── Formatting ───────────────────────────────────────────────────────────────

export const fmtPct = (v?: number | null, digits = 1) => (v == null ? '–' : `${v.toFixed(digits)}%`);
export const fmtInt = (v?: number | null) => (v == null ? '–' : Math.round(v).toLocaleString(i18n.language));
export const fmtNum = (v?: number | null, digits = 1) => (v == null ? '–' : v.toLocaleString(i18n.language, { maximumFractionDigits: digits }));
export const fmtMoney = (v?: number | null) => formatMoney(v ?? 0);

/** Relative change in %, null when there is no base */
export const pctChange = (current: number, previous: number): number | null =>
  previous === 0 ? null : ((current - previous) / previous) * 100;

// ─── Dates ────────────────────────────────────────────────────────────────────

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayIso = () => iso(new Date());
export const shiftIso = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return iso(new Date(y, m - 1, d + days));
};

export interface RangePreset { id: string; label: string; from: () => string; to: () => string }

// ─── Data loading ─────────────────────────────────────────────────────────────

export function useReportData<T>(load: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await run());
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || i18n.t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export interface Column<R> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Display value */
  render?: (row: R) => React.ReactNode;
  /** Raw value for CSV (defaults to row[key]) */
  value?: (row: R) => string | number | null | undefined;
}

export function downloadCsv<R>(filename: string, columns: Column<R>[], rows: R[]) {
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map((c) => cell(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => cell(c.value ? c.value(r) : (r as any)[c.key])).join(',')),
  ];
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Layout ───────────────────────────────────────────────────────────────────

interface ReportShellProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  /** Filters shown in the bar above the report */
  filters?: React.ReactNode;
  loading: boolean;
  error: string | null;
  hasData: boolean;
  onRefresh: () => void;
  onCsv?: () => void;
  printTitle: string;
  children: React.ReactNode;
}

export const ReportShell: React.FC<ReportShellProps> = ({ icon, title, subtitle, filters, loading, error, hasData, onRefresh, onCsv, printTitle, children }) => {
  const { t } = useTranslation();
  const printRef = useRef<HTMLDivElement>(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: printTitle });
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
        <Box sx={{ color: 'primary.main', display: 'flex', '& svg': { fontSize: 32 } }}>{icon}</Box>
        <Box>
          <Typography variant="h5" fontWeight={700}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
        </Box>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} flexWrap="wrap" useFlexGap>
          {filters}
          <Box flexGrow={1} />
          <ButtonGroup size="small" variant="outlined">
            <Button onClick={onRefresh} disabled={loading} aria-label={t('admin.reports.kit.refresh')} title={t('admin.reports.kit.refresh')}><RefreshIcon fontSize="small" /></Button>
            {onCsv && (
              <Button onClick={onCsv} disabled={loading || !hasData} startIcon={<DownloadIcon />}>CSV</Button>
            )}
            <Button onClick={() => print()} disabled={loading || !hasData} startIcon={<PrintIcon />}>{t('admin.reports.kit.print')}</Button>
          </ButtonGroup>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
      {loading && !hasData && (
        <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>
      )}
      {hasData && (
        <Box ref={printRef} sx={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.2s', '@media print': { p: 2 } }}>
          {children}
        </Box>
      )}
    </Box>
  );
};

/** Range presets as a toggle row, with from / to fields for a custom range */
export const RangeFilter: React.FC<{
  presets: RangePreset[];
  preset: string;
  from: string;
  to: string;
  onChange: (next: { preset: string; from: string; to: string }) => void;
}> = ({ presets, preset, from, to, onChange }) => {
  const { t } = useTranslation();
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} flexWrap="wrap" useFlexGap>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={preset}
        onChange={(_, v: string | null) => {
          if (!v) return;
          const p = presets.find((x) => x.id === v);
          onChange(p ? { preset: v, from: p.from(), to: p.to() } : { preset: v, from, to });
        }}
        sx={{ flexWrap: 'wrap' }}
      >
        {presets.map((p) => <ToggleButton key={p.id} value={p.id}>{p.label}</ToggleButton>)}
        <ToggleButton value="custom">{t('admin.reports.kit.custom')}</ToggleButton>
      </ToggleButtonGroup>
      {preset === 'custom' && (
        <Stack direction="row" spacing={1}>
          <TextField label={t('admin.reports.kit.from')} type="date" size="small" value={from} onChange={(e) => onChange({ preset, from: e.target.value, to })} InputLabelProps={{ shrink: true }} />
          <TextField label={t('admin.reports.kit.to')} type="date" size="small" value={to} onChange={(e) => onChange({ preset, from, to: e.target.value })} InputLabelProps={{ shrink: true }} />
        </Stack>
      )}
    </Stack>
  );
};

// ─── KPI tile ─────────────────────────────────────────────────────────────────

export interface KpiTileProps {
  label: string;
  value: string;
  /** Change vs the comparison; `unit` 'pts' for percentage-point deltas */
  delta?: { value: number | null; unit?: '%' | 'pts'; label: string } | null;
  /** Whether an increase is good news (false for e.g. cancellations) */
  goodWhenUp?: boolean;
  caption?: string;
  help?: string;
}

export const KpiTile: React.FC<KpiTileProps> = ({ label, value, delta, goodWhenUp = true, caption, help }) => {
  const d = delta?.value;
  const flat = d == null || Math.abs(d) < 0.05;
  const good = !flat && (d! > 0) === goodWhenUp;
  const color = flat ? 'text.secondary' : good ? 'success.dark' : 'error.main';
  const Icon = flat ? RemoveIcon : d! > 0 ? ArrowUpwardIcon : ArrowDownwardIcon;
  const tile = (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Typography variant="body2" color="text.secondary" gutterBottom noWrap>{label}</Typography>
        <Typography variant="h5" fontWeight={700} color="text.primary" sx={{ lineHeight: 1.2 }}>{value}</Typography>
        {delta && (
          <Stack direction="row" alignItems="center" spacing={0.5} mt={0.75}>
            <Icon sx={{ fontSize: 15, color }} />
            <Typography variant="caption" fontWeight={600} color={color} noWrap sx={{ flexShrink: 0 }}>
              {d == null ? '–' : `${d > 0 ? '+' : ''}${d.toFixed(1)}${delta.unit === 'pts' ? ' pts' : '%'}`}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{delta.label}</Typography>
          </Stack>
        )}
        {caption && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: delta ? 0.25 : 0.75 }}>{caption}</Typography>}
      </CardContent>
    </Card>
  );
  return help ? <Tooltip title={help} arrow placement="top">{tile}</Tooltip> : tile;
};

// ─── Tables & chart cards ─────────────────────────────────────────────────────

export function DataTable<R>({ columns, rows, maxHeight = 420, footer, emptyText }: {
  columns: Column<R>[];
  rows: R[];
  maxHeight?: number;
  footer?: R;
  emptyText?: string;
}) {
  const { t } = useTranslation();
  const cellValue = (c: Column<R>, r: R) => (c.render ? c.render(r) : String((r as any)[c.key] ?? '–'));
  return (
    <TableContainer sx={{ maxHeight, '@media print': { maxHeight: 'none' } }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map((c) => <TableCell key={c.key} align={c.align ?? 'left'} sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.label}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} align="center">
                <Typography variant="body2" color="text.secondary" py={3}>{emptyText ?? t('admin.reports.kit.noData')}</Typography>
              </TableCell>
            </TableRow>
          ) : rows.map((r, i) => (
            <TableRow key={i} hover>
              {columns.map((c) => <TableCell key={c.key} align={c.align ?? 'left'} sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{cellValue(c, r)}</TableCell>)}
            </TableRow>
          ))}
          {footer && rows.length > 0 && (
            <TableRow sx={{ '& td': { fontWeight: 700, borderTop: 2, borderColor: 'divider', position: 'sticky', bottom: 0, bgcolor: 'background.paper' } }}>
              {columns.map((c) => <TableCell key={c.key} align={c.align ?? 'left'} sx={{ fontVariantNumeric: 'tabular-nums' }}>{cellValue(c, footer)}</TableCell>)}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function ChartCard<R>({ title, subtitle, option, height = 280, ariaLabel, columns, rows, footer, action }: {
  title: string;
  subtitle?: string;
  option: ChartOption;
  height?: number;
  ariaLabel?: string;
  columns: Column<R>[];
  rows: R[];
  footer?: R;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%', breakInside: 'avoid' }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2} mb={1.5}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
          {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" className="no-print">
          {action}
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="chart" aria-label={t('admin.reports.kit.chart')}><InsertChartOutlinedIcon fontSize="small" /></ToggleButton>
            <ToggleButton value="table" aria-label={t('admin.reports.kit.table')}><TableRowsIcon fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>
      {view === 'chart'
        ? <EChart option={option} height={height} ariaLabel={ariaLabel ?? title} />
        : <DataTable columns={columns} rows={rows} footer={footer} maxHeight={height + 40} />}
    </Paper>
  );
}
