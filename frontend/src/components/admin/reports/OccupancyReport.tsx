/**
 * Occupancy metrics — occupancy %, ADR, RevPAR and room revenue for any range (past nights are
 * actuals, today onwards what is on the books), grouped by day / week / month, optionally
 * against the previous period or the previous year.
 */
import React, { useMemo, useState } from 'react';
import { FormControl, Grid, InputLabel, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import { useTranslation } from 'react-i18next';
import { reportsService } from '../../../services/api';
import { NightRow } from '../../../types/reports';
import { axisTooltip, barSeries, categoryAxis, lineSeries, valueAxis } from '../../charts/EChart';
import { OTHER, SERIES } from '../../charts/chartTheme';
import {
  ChartCard, Column, DataTable, KpiTile, RangeFilter, RangePreset, ReportShell,
  downloadCsv, fmtInt, fmtMoney, fmtPct, pctChange, shiftIso, todayIso, useReportData,
} from './kit';

type GroupBy = 'day' | 'week' | 'month';
type CompareTo = '' | 'prev_period' | 'prev_year';

const OccupancyReport: React.FC = () => {
  const { t } = useTranslation();
  const k = (key: string) => t(`admin.reports.occupancy.${key}`);

  const presets: RangePreset[] = useMemo(() => [
    { id: '7d', label: k('last7days'), from: () => shiftIso(todayIso(), -6), to: todayIso },
    { id: '30d', label: k('last30days'), from: () => shiftIso(todayIso(), -29), to: todayIso },
    { id: '90d', label: k('last90days'), from: () => shiftIso(todayIso(), -89), to: todayIso },
    { id: 'mtd', label: t('admin.reports.kit.monthToDate'), from: () => `${todayIso().slice(0, 8)}01`, to: todayIso },
    { id: 'next30', label: t('admin.reports.kit.next30days'), from: todayIso, to: () => shiftIso(todayIso(), 29) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t]);

  const [range, setRange] = useState({ preset: '30d', from: shiftIso(todayIso(), -29), to: todayIso() });
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [compareTo, setCompareTo] = useState<CompareTo>('prev_year');

  const { data, loading, error, reload } = useReportData(
    async () => (await reportsService.getOccupancy({ from: range.from, to: range.to, groupBy, compareTo: compareTo || undefined })).data.data!,
    [range.from, range.to, groupBy, compareTo],
  );

  const comp = data?.comparison;
  const compLabel = compareTo === 'prev_year' ? k('prevYear') : k('prevPeriod');
  const dates = useMemo(() => data?.rows.map((r) => r.date) ?? [], [data]);
  const compSeries = (pick: (r: NightRow) => number) => (comp ? dates.map((_, i) => (comp.rows[i] ? pick(comp.rows[i]) : null)) : []);

  const lineOption = (name: string, pick: (r: NightRow) => number, color: string, format: (v: number) => string) => ({
    legend: comp ? {} : undefined,
    grid: { top: comp ? 36 : 12 },
    tooltip: axisTooltip(format),
    xAxis: categoryAxis(dates),
    yAxis: valueAxis(format),
    series: [
      lineSeries(name, data?.rows.map(pick) ?? [], color, { area: true }),
      ...(comp ? [lineSeries(compLabel, compSeries(pick), OTHER, { dashed: true })] : []),
    ],
  });

  const occupancyOption = useMemo(() => ({
    ...lineOption(k('kpiOccupancy'), (r) => r.occupancyPct, SERIES[0], (v) => `${v.toFixed(0)}%`),
    yAxis: valueAxis((v) => `${v}%`, { min: 0, max: (e: { max: number }) => Math.max(100, Math.ceil(e.max / 10) * 10) }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, compLabel]);
  const adrOption = useMemo(() => lineOption(k('kpiAdr'), (r) => r.adr, SERIES[0], fmtMoney), [data, compLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const revparOption = useMemo(() => lineOption(k('kpiRevpar'), (r) => r.revpar, SERIES[0], fmtMoney), [data, compLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const revenueOption = useMemo(() => ({
    legend: comp ? {} : undefined,
    grid: { top: comp ? 36 : 12 },
    tooltip: axisTooltip(fmtMoney, 'shadow'),
    xAxis: categoryAxis(dates),
    yAxis: valueAxis(fmtMoney),
    series: [
      barSeries(k('colRevenue'), data?.rows.map((r) => r.roomRevenue) ?? [], SERIES[0]),
      ...(comp ? [barSeries(compLabel, compSeries((r) => r.roomRevenue), OTHER)] : []),
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, compLabel]);

  const columns: Column<NightRow>[] = [
    { key: 'date', label: k('colDate') },
    { key: 'roomsAvailable', label: k('colRoomsAvailable'), align: 'right', render: (r) => fmtInt(r.roomsAvailable) },
    { key: 'roomsOutOfOrder', label: t('admin.reports.kit.outOfService'), align: 'right', render: (r) => fmtInt(r.roomsOutOfOrder) },
    { key: 'roomsSold', label: k('colRoomsSold'), align: 'right', render: (r) => fmtInt(r.roomsSold) },
    { key: 'occupancyPct', label: k('kpiOccupancy'), align: 'right', render: (r) => fmtPct(r.occupancyPct) },
    { key: 'roomRevenue', label: k('colRevenue'), align: 'right', render: (r) => fmtMoney(r.roomRevenue) },
    { key: 'adr', label: k('kpiAdr'), align: 'right', render: (r) => fmtMoney(r.adr) },
    { key: 'revpar', label: k('kpiRevpar'), align: 'right', render: (r) => fmtMoney(r.revpar) },
  ];
  const s = data?.summary;
  const cs = comp?.summary;
  const footer: NightRow | undefined = s && { date: t('admin.reports.kit.total'), roomsOutOfOrder: data!.rows.reduce((n, r) => n + r.roomsOutOfOrder, 0), ...s };
  const delta = (cur: number, prev: number | undefined, unit: '%' | 'pts' = '%') =>
    prev === undefined ? null : { value: unit === 'pts' ? cur - prev : pctChange(cur, prev), unit, label: t('admin.reports.kit.vs', { what: compLabel.toLowerCase() }) };

  return (
    <ReportShell
      icon={<HotelIcon />}
      title={k('title')}
      subtitle={k('subtitle')}
      loading={loading}
      error={error}
      hasData={!!data}
      onRefresh={reload}
      onCsv={() => data && downloadCsv(`occupancy-${range.from}-${range.to}.csv`, columns, data.rows)}
      printTitle={`occupancy-${range.from}-${range.to}`}
      filters={
        <>
          <RangeFilter presets={presets} {...range} onChange={setRange} />
          <Stack direction="row" spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>{k('groupBy')}</InputLabel>
              <Select value={groupBy} label={k('groupBy')} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <MenuItem value="day">{k('groupDay')}</MenuItem>
                <MenuItem value="week">{k('groupWeek')}</MenuItem>
                <MenuItem value="month">{k('groupMonth')}</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>{k('compareTo')}</InputLabel>
              <Select value={compareTo} label={k('compareTo')} onChange={(e) => setCompareTo(e.target.value as CompareTo)}>
                <MenuItem value="">{k('noComparison')}</MenuItem>
                <MenuItem value="prev_period">{k('prevPeriod')}</MenuItem>
                <MenuItem value="prev_year">{k('prevYear')}</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </>
      }
    >
      {data && s && (
        <>
          <Grid container spacing={2} mb={3}>
            <Grid item xs={6} md={2.4}><KpiTile label={k('kpiOccupancy')} value={fmtPct(s.occupancyPct)} delta={delta(s.occupancyPct, cs?.occupancyPct, 'pts')} help={t('admin.reports.kit.help.occupancy')} /></Grid>
            <Grid item xs={6} md={2.4}><KpiTile label={k('kpiAdr')} value={fmtMoney(s.adr)} delta={delta(s.adr, cs?.adr)} help={t('admin.reports.kit.help.adr')} /></Grid>
            <Grid item xs={6} md={2.4}><KpiTile label={k('kpiRevpar')} value={fmtMoney(s.revpar)} delta={delta(s.revpar, cs?.revpar)} help={t('admin.reports.kit.help.revpar')} /></Grid>
            <Grid item xs={6} md={2.4}><KpiTile label={k('colRevenue')} value={fmtMoney(s.roomRevenue)} delta={delta(s.roomRevenue, cs?.roomRevenue)} /></Grid>
            <Grid item xs={12} md={2.4}><KpiTile label={k('colRoomsSold')} value={fmtInt(s.roomsSold)} delta={delta(s.roomsSold, cs?.roomsSold)} caption={t('admin.reports.kit.ofAvailable', { count: s.roomsAvailable })} /></Grid>
          </Grid>

          <Grid container spacing={2} mb={3}>
            <Grid item xs={12}>
              <ChartCard title={k('kpiOccupancy')} subtitle={t('admin.reports.kit.actualsAndOtb')} option={occupancyOption} columns={columns} rows={data.rows} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('kpiAdr')} subtitle={t('admin.reports.kit.help.adr')} option={adrOption} height={240} columns={columns} rows={data.rows} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('kpiRevpar')} subtitle={t('admin.reports.kit.help.revpar')} option={revparOption} height={240} columns={columns} rows={data.rows} />
            </Grid>
            <Grid item xs={12}>
              <ChartCard title={k('colRevenue')} option={revenueOption} height={240} columns={columns} rows={data.rows} />
            </Grid>
          </Grid>

          <Paper variant="outlined">
            <Typography variant="subtitle1" fontWeight={700} px={2.5} pt={2} pb={1}>{k('tableTitle')}</Typography>
            <DataTable columns={columns} rows={data.rows} footer={footer} emptyText={k('noData')} maxHeight={560} />
          </Paper>
        </>
      )}
    </ReportShell>
  );
};

export default OccupancyReport;
