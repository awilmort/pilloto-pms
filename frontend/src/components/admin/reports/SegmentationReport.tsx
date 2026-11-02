/**
 * Revenue mix — where room revenue comes from, by source (OTA, booking engine, corporate,
 * front desk), room type or rate plan: room nights, revenue and share, ADR, OTA commission and
 * net revenue, booking window, length of stay and cancellation rate, plus the revenue trend
 * per segment. Answers "which channels pay best after commission" and "what to push or cap".
 */
import React, { useMemo, useState } from 'react';
import { Grid, Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import PieChartIcon from '@mui/icons-material/PieChart';
import { useTranslation } from 'react-i18next';
import { reportsService } from '../../../services/api';
import { SegmentBy, SegmentRow } from '../../../types/reports';
import { axisTooltip, barSeries, categoryAxis, valueAxis } from '../../charts/EChart';
import { OTHER, SERIES, seriesColor } from '../../charts/chartTheme';
import {
  ChartCard, Column, DataTable, KpiTile, RangeFilter, RangePreset, ReportShell,
  downloadCsv, fmtInt, fmtMoney, fmtNum, fmtPct, shiftIso, todayIso, useReportData,
} from './kit';

const SegmentationReport: React.FC = () => {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.reports.segmentation.${key}`, opts);

  const presets: RangePreset[] = useMemo(() => [
    { id: '30d', label: t('admin.reports.kit.lastDays', { count: 30 }), from: () => shiftIso(todayIso(), -29), to: todayIso },
    { id: '90d', label: t('admin.reports.kit.lastDays', { count: 90 }), from: () => shiftIso(todayIso(), -89), to: todayIso },
    { id: 'ytd', label: t('admin.reports.kit.yearToDate'), from: () => `${todayIso().slice(0, 4)}-01-01`, to: todayIso },
    { id: '12m', label: t('admin.reports.kit.last12Months'), from: () => shiftIso(todayIso(), -364), to: todayIso },
    { id: 'next90', label: t('admin.reports.kit.nextDays', { count: 90 }), from: todayIso, to: () => shiftIso(todayIso(), 89) },
  ], [t]);
  const [range, setRange] = useState({ preset: '90d', from: shiftIso(todayIso(), -89), to: todayIso() });
  const [by, setBy] = useState<SegmentBy>('source');

  const { data, loading, error, reload } = useReportData(
    async () => (await reportsService.getSegmentation({ from: range.from, to: range.to, by })).data.data!,
    [range.from, range.to, by],
  );

  /** Display label: translated for built-in sources, as stored otherwise */
  const labelOf = (row: Pick<SegmentRow, 'key' | 'label'>) =>
    ['front_desk', 'booking_engine', 'corporate'].includes(row.key) ? k(`sources.${row.key}`)
      : row.key === 'unknown' ? k('unknownType') : row.key === 'none' ? k('noRatePlan') : row.label;

  const segments = useMemo(() => data?.segments ?? [], [data]);
  // Stable colour per segment: its position in the revenue ranking of this result
  const colorOf = useMemo(() => new Map(segments.map((s, i) => [s.key, seriesColor(i)])), [segments]);
  const names = useMemo(() => [...segments].reverse().map(labelOf), [segments]); // eslint-disable-line react-hooks/exhaustive-deps

  const hbar = (pick: (s: SegmentRow) => number, format: (v: number) => string, name: string) => ({
    grid: { top: 8, right: 56 },
    tooltip: { ...axisTooltip(format, 'shadow'), axisPointer: { type: 'shadow' } },
    xAxis: valueAxis(format),
    yAxis: categoryAxis(names, { axisLabel: { color: '#5B6278', fontSize: 11, width: 120, overflow: 'truncate' } }),
    series: [{ ...barSeries(name, [...segments].reverse().map(pick), SERIES[0], { horizontal: true }), label: { show: true, position: 'right', formatter: (p: { value: number }) => format(p.value), color: '#5B6278', fontSize: 11 } }],
  });
  const chartHeight = Math.max(180, segments.length * 34 + 30);
  const revenueOption = useMemo(() => hbar((s) => s.revenue, fmtMoney, t('admin.reports.kit.roomRevenue')), [segments, names]); // eslint-disable-line react-hooks/exhaustive-deps
  const adrOption = useMemo(() => hbar((s) => s.adr, fmtMoney, 'ADR'), [segments, names]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancelOption = useMemo(() => hbar((s) => s.cancellationRatePct, (v) => fmtPct(v, 0), k('cancellationRate')), [segments, names]); // eslint-disable-line react-hooks/exhaustive-deps

  const trendOption = useMemo(() => {
    if (!data) return {};
    const keys = [...segments.slice(0, 7).map((s) => s.key), ...(data.trend.some((b) => b.values.other) ? ['other'] : [])];
    return {
      legend: {},
      tooltip: axisTooltip(fmtMoney, 'shadow'),
      xAxis: categoryAxis(data.trend.map((b) => b.bucket)),
      yAxis: valueAxis(fmtMoney),
      series: keys.map((key, i) => barSeries(
        key === 'other' ? k('other') : labelOf(segments.find((s) => s.key === key)!),
        data.trend.map((b) => b.values[key] ?? 0),
        key === 'other' ? OTHER : colorOf.get(key)!,
        { stack: 'rev', last: i === keys.length - 1 },
      )),
    };
  }, [data, segments, colorOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: Column<SegmentRow>[] = [
    { key: 'label', label: k(`by.${by}`), render: labelOf, value: labelOf },
    { key: 'reservations', label: k('reservations'), align: 'right', render: (r) => fmtNum(r.reservations) },
    { key: 'roomNights', label: t('admin.reports.kit.roomNights'), align: 'right', render: (r) => fmtNum(r.roomNights) },
    { key: 'revenue', label: t('admin.reports.kit.roomRevenue'), align: 'right', render: (r) => fmtMoney(r.revenue) },
    { key: 'revenueSharePct', label: k('share'), align: 'right', render: (r) => fmtPct(r.revenueSharePct) },
    { key: 'adr', label: 'ADR', align: 'right', render: (r) => fmtMoney(r.adr) },
    { key: 'commission', label: k('commission'), align: 'right', render: (r) => fmtMoney(r.commission) },
    { key: 'netRevenue', label: k('netRevenue'), align: 'right', render: (r) => fmtMoney(r.netRevenue) },
    { key: 'avgLeadDays', label: k('avgLead'), align: 'right', render: (r) => fmtNum(r.avgLeadDays) },
    { key: 'avgLos', label: k('avgLos'), align: 'right', render: (r) => fmtNum(r.avgLos) },
    { key: 'cancellationRatePct', label: k('cancellationRate'), align: 'right', render: (r) => `${fmtPct(r.cancellationRatePct, 0)} (${fmtNum(r.cancellations)})` },
  ];
  const tot = data?.totals;
  const footer: SegmentRow | undefined = tot && {
    key: 'total', label: t('admin.reports.kit.total'), reservations: tot.reservations, roomNights: tot.roomNights, revenue: tot.revenue,
    revenueSharePct: 100, adr: tot.adr, commission: tot.commission, netRevenue: tot.netRevenue, avgLeadDays: NaN, avgLos: NaN,
    cancellations: segments.reduce((n, s) => n + s.cancellations, 0), cancellationRatePct: NaN,
  };
  const footerColumns = columns.map((c) => (['avgLeadDays', 'avgLos', 'cancellationRatePct'].includes(c.key) ? { ...c, render: (r: SegmentRow) => (r.key === 'total' ? '' : c.render!(r)) } : c));

  return (
    <ReportShell
      icon={<PieChartIcon />}
      title={k('title')}
      subtitle={k('subtitle')}
      loading={loading}
      error={error}
      hasData={!!data}
      onRefresh={reload}
      onCsv={() => data && downloadCsv(`revenue-mix-${by}-${range.from}-${range.to}.csv`, columns, segments)}
      printTitle={`revenue-mix-${by}-${range.from}-${range.to}`}
      filters={
        <>
          <RangeFilter presets={presets} {...range} onChange={setRange} />
          <ToggleButtonGroup size="small" exclusive value={by} onChange={(_, v) => v && setBy(v)}>
            {(['source', 'roomType', 'ratePlan'] as SegmentBy[]).map((b) => <ToggleButton key={b} value={b}>{k(`by.${b}`)}</ToggleButton>)}
          </ToggleButtonGroup>
        </>
      }
    >
      {data && tot && (
        <>
          <Grid container spacing={2} mb={3}>
            <Grid item xs={6} md={2.4}><KpiTile label={t('admin.reports.kit.roomRevenue')} value={fmtMoney(tot.revenue)} /></Grid>
            <Grid item xs={6} md={2.4}><KpiTile label={t('admin.reports.kit.roomNights')} value={fmtInt(tot.roomNights)} /></Grid>
            <Grid item xs={6} md={2.4}><KpiTile label="ADR" value={fmtMoney(tot.adr)} /></Grid>
            <Grid item xs={6} md={2.4}><KpiTile label={k('commission')} value={fmtMoney(tot.commission)} caption={tot.revenue > 0 ? k('ofRevenue', { pct: fmtPct((tot.commission / tot.revenue) * 100) }) : undefined} /></Grid>
            <Grid item xs={12} md={2.4}><KpiTile label={k('netRevenue')} value={fmtMoney(tot.netRevenue)} help={k('netHelp')} /></Grid>
          </Grid>

          <Grid container spacing={2} mb={3}>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('revenueBySegment')} subtitle={k(`by.${by}`)} option={revenueOption} height={chartHeight} columns={columns} rows={segments} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('trendTitle')} subtitle={k(`bucket.${data.bucket}`)} option={trendOption} height={chartHeight} columns={columns} rows={segments} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('adrBySegment')} subtitle={k('adrHelp')} option={adrOption} height={chartHeight} columns={columns} rows={segments} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('cancelBySegment')} subtitle={k('cancelHelp')} option={cancelOption} height={chartHeight} columns={columns} rows={segments} />
            </Grid>
          </Grid>

          <Paper variant="outlined">
            <Typography variant="subtitle1" fontWeight={700} px={2.5} pt={2} pb={1}>{k('tableTitle')}</Typography>
            <DataTable columns={footerColumns} rows={segments} footer={footer} />
          </Paper>
        </>
      )}
    </ReportShell>
  );
};

export default SegmentationReport;
