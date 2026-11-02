/**
 * Forecast & pace — what is on the books for each coming night, how fast it is filling (pickup
 * in the last 7 days) and how that compares with the same time last year (STLY). Flags
 * compression nights (rates can go up) and soft nights in the next two weeks (needs demand).
 */
import React, { useMemo, useState } from 'react';
import { Alert, AlertTitle, Box, Chip, Grid, Paper, Stack, Typography } from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import { useTranslation } from 'react-i18next';
import { reportsService } from '../../../services/api';
import { ForecastRow } from '../../../types/reports';
import { axisTooltip, barSeries, categoryAxis, lineSeries, valueAxis } from '../../charts/EChart';
import { OTHER, SERIES } from '../../charts/chartTheme';
import {
  ChartCard, Column, DataTable, KpiTile, RangeFilter, RangePreset, ReportShell,
  downloadCsv, fmtInt, fmtMoney, fmtPct, pctChange, shiftIso, todayIso, useReportData,
} from './kit';

const COMPRESSION_PCT = 90;
const SOFT_PCT = 40;
const SOFT_WITHIN_DAYS = 14;

const ForecastReport: React.FC = () => {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.reports.forecast.${key}`, opts);

  const presets: RangePreset[] = useMemo(() => [30, 60, 90, 180].map((n) => ({
    id: `next${n}`, label: t('admin.reports.kit.nextDays', { count: n }), from: todayIso, to: () => shiftIso(todayIso(), n - 1),
  })), [t]);
  const [range, setRange] = useState({ preset: 'next90', from: todayIso(), to: shiftIso(todayIso(), 89) });

  const { data, loading, error, reload } = useReportData(
    async () => (await reportsService.getForecast({ from: range.from, to: range.to })).data.data!,
    [range.from, range.to],
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const labels = useMemo(() => rows.map((r) => r.date.slice(5)), [rows]);
  const stlyLabel = t('admin.reports.kit.stly');

  const paceOption = useMemo(() => ({
    legend: {},
    tooltip: axisTooltip((v) => `${v.toFixed(0)}%`),
    xAxis: categoryAxis(labels),
    yAxis: valueAxis((v) => `${v}%`, { min: 0, max: (e: { max: number }) => Math.max(100, Math.ceil(e.max / 10) * 10) }),
    series: [
      lineSeries(k('onTheBooks'), rows.map((r) => r.occupancyPct), SERIES[0], { area: true }),
      lineSeries(stlyLabel, rows.map((r) => r.stlyOccupancyPct), OTHER, { dashed: true }),
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, labels]);
  const pickupOption = useMemo(() => ({
    grid: { top: 12 },
    tooltip: axisTooltip(fmtInt, 'shadow'),
    xAxis: categoryAxis(labels),
    yAxis: valueAxis(fmtInt, { minInterval: 1 }),
    series: [barSeries(k('pickup7'), rows.map((r) => r.pickup7), SERIES[0])],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, labels]);
  // Grouped bars stay readable for a month; longer ranges read better as lines
  const movementOption = useMemo(() => {
    const dense = rows.length > 31;
    const series = (name: string, data: number[], color: string) => (dense ? lineSeries(name, data, color) : barSeries(name, data, color));
    return {
      legend: {},
      tooltip: axisTooltip(fmtInt, dense ? 'line' : 'shadow'),
      xAxis: categoryAxis(labels, dense ? { boundaryGap: false } : {}),
      yAxis: valueAxis(fmtInt, { minInterval: 1 }),
      series: [
        series(k('arrivals'), rows.map((r) => r.arrivals), SERIES[0]),
        series(k('departures'), rows.map((r) => r.departures), SERIES[1]),
      ],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, labels]);

  const columns: Column<ForecastRow>[] = [
    { key: 'date', label: t('admin.reports.kit.night') },
    { key: 'roomsSold', label: t('admin.reports.kit.roomsOnBooks'), align: 'right', render: (r) => `${fmtInt(r.roomsSold)} / ${fmtInt(r.roomsAvailable)}`, value: (r) => r.roomsSold },
    { key: 'roomsAvailable', label: t('admin.reports.kit.available'), align: 'right' },
    { key: 'occupancyPct', label: t('admin.reports.kit.occupancy'), align: 'right', render: (r) => fmtPct(r.occupancyPct) },
    { key: 'stlyOccupancyPct', label: stlyLabel, align: 'right', render: (r) => fmtPct(r.stlyOccupancyPct) },
    { key: 'pace', label: k('pace'), align: 'right', render: (r) => { const d = r.occupancyPct - r.stlyOccupancyPct; return `${d > 0 ? '+' : ''}${d.toFixed(1)} pts`; }, value: (r) => (r.occupancyPct - r.stlyOccupancyPct).toFixed(2) },
    { key: 'pickup7', label: k('pickup7'), align: 'right' },
    { key: 'roomRevenue', label: t('admin.reports.kit.roomRevenue'), align: 'right', render: (r) => fmtMoney(r.roomRevenue) },
    { key: 'adr', label: 'ADR', align: 'right', render: (r) => fmtMoney(r.adr) },
    { key: 'arrivals', label: k('arrivals'), align: 'right' },
    { key: 'departures', label: k('departures'), align: 'right' },
  ];

  const s = data?.summary;
  const vsStly = t('admin.reports.kit.vs', { what: t('admin.reports.kit.stlyShort') });
  const compression = rows.filter((r) => r.occupancyPct >= COMPRESSION_PCT);
  const softLimit = shiftIso(data?.asOf ?? todayIso(), SOFT_WITHIN_DAYS - 1);
  const soft = rows.filter((r) => r.date <= softLimit && r.roomsAvailable > 0 && r.occupancyPct < SOFT_PCT);
  const dateChips = (list: ForecastRow[]) => (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap mt={1}>
      {list.slice(0, 14).map((r) => <Chip key={r.date} size="small" variant="outlined" label={`${r.date.slice(5)} · ${fmtPct(r.occupancyPct, 0)}`} />)}
      {list.length > 14 && <Chip size="small" label={`+${list.length - 14}`} />}
    </Stack>
  );

  return (
    <ReportShell
      icon={<InsightsIcon />}
      title={k('title')}
      subtitle={k('subtitle')}
      loading={loading}
      error={error}
      hasData={!!data}
      onRefresh={reload}
      onCsv={() => data && downloadCsv(`forecast-${range.from}-${range.to}.csv`, columns, rows)}
      printTitle={`forecast-${range.from}-${range.to}`}
      filters={<RangeFilter presets={presets} {...range} onChange={setRange} />}
    >
      {data && s && (
        <>
          <Grid container spacing={2} mb={3}>
            <Grid item xs={6} md={2.4}><KpiTile label={k('otbOccupancy')} value={fmtPct(s.occupancyPct)} delta={{ value: s.occupancyPct - s.stly.occupancyPct, unit: 'pts', label: vsStly }} /></Grid>
            <Grid item xs={6} md={2.4}><KpiTile label={k('otbRevenue')} value={fmtMoney(s.roomRevenue)} delta={{ value: pctChange(s.roomRevenue, s.stly.roomRevenue), label: vsStly }} /></Grid>
            <Grid item xs={6} md={2.4}><KpiTile label={k('otbRoomNights')} value={fmtInt(s.roomsSold)} delta={{ value: pctChange(s.roomsSold, s.stly.roomsSold), label: vsStly }} /></Grid>
            <Grid item xs={6} md={2.4}><KpiTile label={k('otbAdr')} value={fmtMoney(s.adr)} delta={{ value: pctChange(s.adr, s.stly.adr), label: vsStly }} /></Grid>
            <Grid item xs={12} md={2.4}><KpiTile label={k('pickup7')} value={fmtInt(s.pickup7)} caption={k('pickup7Caption')} /></Grid>
          </Grid>

          {(compression.length > 0 || soft.length > 0) && (
            <Grid container spacing={2} mb={3}>
              {compression.length > 0 && (
                <Grid item xs={12} md={soft.length ? 6 : 12}>
                  <Alert severity="success" variant="outlined" sx={{ height: '100%' }}>
                    <AlertTitle>{k('compressionTitle', { count: compression.length, pct: COMPRESSION_PCT })}</AlertTitle>
                    {k('compressionHelp')}
                    {dateChips(compression)}
                  </Alert>
                </Grid>
              )}
              {soft.length > 0 && (
                <Grid item xs={12} md={compression.length ? 6 : 12}>
                  <Alert severity="warning" variant="outlined" sx={{ height: '100%' }}>
                    <AlertTitle>{k('softTitle', { count: soft.length, pct: SOFT_PCT, days: SOFT_WITHIN_DAYS })}</AlertTitle>
                    {k('softHelp')}
                    {dateChips(soft)}
                  </Alert>
                </Grid>
              )}
            </Grid>
          )}

          <Grid container spacing={2} mb={3}>
            <Grid item xs={12}>
              <ChartCard title={k('paceTitle')} subtitle={k('paceHelp')} option={paceOption} columns={columns} rows={rows} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('pickupTitle')} subtitle={k('pickupHelp')} option={pickupOption} height={240} columns={columns} rows={rows} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('movementTitle')} subtitle={k('movementHelp')} option={movementOption} height={240} columns={columns} rows={rows} />
            </Grid>
          </Grid>

          <Paper variant="outlined">
            <Box px={2.5} pt={2} pb={1}>
              <Typography variant="subtitle1" fontWeight={700}>{k('tableTitle')}</Typography>
              <Typography variant="caption" color="text.secondary">{k('stlyHelp')}</Typography>
            </Box>
            <DataTable columns={columns} rows={rows} maxHeight={560} />
          </Paper>
        </>
      )}
    </ReportShell>
  );
};

export default ForecastReport;
