/**
 * Manager's flash — the one-page daily brief: the day, month-to-date and year-to-date against
 * the same dates last year, the day's operations (arrivals, departures, in house, no-shows,
 * bookings and cancellations taken), and what is on the books for the next 30 nights.
 */
import React, { useMemo, useState } from 'react';
import { Button, Grid, Paper, Stack, TextField, Typography } from '@mui/material';
import SpeedIcon from '@mui/icons-material/Speed';
import TodayIcon from '@mui/icons-material/Today';
import { useTranslation } from 'react-i18next';
import { reportsService } from '../../../services/api';
import { FlashPeriod, NightRow } from '../../../types/reports';
import { axisTooltip, barSeries, categoryAxis, valueAxis } from '../../charts/EChart';
import { INK, SERIES } from '../../charts/chartTheme';
import { ChartCard, Column, DataTable, KpiTile, ReportShell, downloadCsv, fmtInt, fmtMoney, fmtPct, pctChange, todayIso, useReportData } from './kit';

interface PeriodRow { label: string; period: FlashPeriod }

const ManagerFlashReport: React.FC = () => {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.reports.flash.${key}`, opts);
  const [date, setDate] = useState(todayIso());

  const { data, loading, error, reload } = useReportData(
    async () => (await reportsService.getManagerFlash({ date })).data.data!,
    [date],
  );

  const vsLy = t('admin.reports.kit.vs', { what: t('admin.reports.kit.lastYear') });
  const delta = (cur: number, ly: number, unit: '%' | 'pts' = '%') => ({ value: unit === 'pts' ? cur - ly : pctChange(cur, ly), unit, label: vsLy });

  const periods: PeriodRow[] = data ? [
    { label: k('day'), period: data.periods.day },
    { label: k('mtd'), period: data.periods.mtd },
    { label: k('ytd'), period: data.periods.ytd },
  ] : [];
  const change = (cur: number, ly: number) => {
    const c = pctChange(cur, ly);
    return c == null ? '–' : `${c > 0 ? '+' : ''}${c.toFixed(1)}%`;
  };
  const periodColumns: Column<PeriodRow>[] = [
    { key: 'label', label: k('period') },
    { key: 'occ', label: t('admin.reports.kit.occupancy'), align: 'right', render: (r) => fmtPct(r.period.current.occupancyPct), value: (r) => r.period.current.occupancyPct },
    { key: 'occLy', label: k('ly'), align: 'right', render: (r) => fmtPct(r.period.lastYear.occupancyPct), value: (r) => r.period.lastYear.occupancyPct },
    { key: 'adr', label: 'ADR', align: 'right', render: (r) => fmtMoney(r.period.current.adr), value: (r) => r.period.current.adr },
    { key: 'adrLy', label: k('ly'), align: 'right', render: (r) => fmtMoney(r.period.lastYear.adr), value: (r) => r.period.lastYear.adr },
    { key: 'revpar', label: 'RevPAR', align: 'right', render: (r) => fmtMoney(r.period.current.revpar), value: (r) => r.period.current.revpar },
    { key: 'revparChg', label: k('change'), align: 'right', render: (r) => change(r.period.current.revpar, r.period.lastYear.revpar) },
    { key: 'rev', label: t('admin.reports.kit.roomRevenue'), align: 'right', render: (r) => fmtMoney(r.period.current.roomRevenue), value: (r) => r.period.current.roomRevenue },
    { key: 'revLy', label: k('ly'), align: 'right', render: (r) => fmtMoney(r.period.lastYear.roomRevenue), value: (r) => r.period.lastYear.roomRevenue },
    { key: 'revChg', label: k('change'), align: 'right', render: (r) => change(r.period.current.roomRevenue, r.period.lastYear.roomRevenue) },
  ];

  const outlookColumns: Column<NightRow>[] = [
    { key: 'date', label: t('admin.reports.kit.night') },
    { key: 'roomsSold', label: t('admin.reports.kit.roomsOnBooks'), align: 'right', render: (r) => `${fmtInt(r.roomsSold)} / ${fmtInt(r.roomsAvailable)}` },
    { key: 'occupancyPct', label: t('admin.reports.kit.occupancy'), align: 'right', render: (r) => fmtPct(r.occupancyPct) },
    { key: 'roomRevenue', label: t('admin.reports.kit.roomRevenue'), align: 'right', render: (r) => fmtMoney(r.roomRevenue) },
    { key: 'adr', label: 'ADR', align: 'right', render: (r) => fmtMoney(r.adr) },
  ];
  const outlookOption = useMemo(() => {
    if (!data) return {};
    const avg = data.outlook.summary.occupancyPct;
    return {
      grid: { top: 16 },
      tooltip: axisTooltip((v) => `${v.toFixed(0)}%`, 'shadow'),
      xAxis: categoryAxis(data.outlook.rows.map((r) => r.date.slice(5))),
      yAxis: valueAxis((v) => `${v}%`, { min: 0, max: (e: { max: number }) => Math.max(100, Math.ceil(e.max / 10) * 10) }),
      series: [{
        ...barSeries(t('admin.reports.kit.occupancy'), data.outlook.rows.map((r) => r.occupancyPct), SERIES[0]),
        markLine: {
          symbol: 'none',
          silent: true,
          lineStyle: { color: INK.secondary, type: [4, 4], width: 1 },
          label: { formatter: k('average', { pct: avg.toFixed(0) }), color: INK.secondary, fontSize: 11, position: 'insideEndTop' },
          data: [{ yAxis: avg }],
        },
      }],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const day = data?.periods.day;
  const ops = data?.operations;

  return (
    <ReportShell
      icon={<SpeedIcon />}
      title={k('title')}
      subtitle={k('subtitle')}
      loading={loading}
      error={error}
      hasData={!!data}
      onRefresh={reload}
      onCsv={() => data && downloadCsv(`manager-flash-${date}.csv`, periodColumns, periods)}
      printTitle={`manager-flash-${date}`}
      filters={
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField label={k('businessDate')} type="date" size="small" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Button size="small" startIcon={<TodayIcon />} onClick={() => setDate(todayIso())} disabled={date === todayIso()}>{t('admin.reports.kit.today')}</Button>
        </Stack>
      }
    >
      {data && day && ops && (
        <>
          <Typography variant="overline" color="text.secondary">{k('theDay', { date: data.date })}</Typography>
          <Grid container spacing={2} mb={3}>
            <Grid item xs={6} md={3}><KpiTile label={t('admin.reports.kit.occupancy')} value={fmtPct(day.current.occupancyPct)} delta={delta(day.current.occupancyPct, day.lastYear.occupancyPct, 'pts')} caption={t('admin.reports.kit.roomsSoldOf', { sold: day.current.roomsSold, available: day.current.roomsAvailable })} /></Grid>
            <Grid item xs={6} md={3}><KpiTile label="ADR" value={fmtMoney(day.current.adr)} delta={delta(day.current.adr, day.lastYear.adr)} help={t('admin.reports.kit.help.adr')} /></Grid>
            <Grid item xs={6} md={3}><KpiTile label="RevPAR" value={fmtMoney(day.current.revpar)} delta={delta(day.current.revpar, day.lastYear.revpar)} help={t('admin.reports.kit.help.revpar')} /></Grid>
            <Grid item xs={6} md={3}><KpiTile label={t('admin.reports.kit.roomRevenue')} value={fmtMoney(day.current.roomRevenue)} delta={delta(day.current.roomRevenue, day.lastYear.roomRevenue)} /></Grid>
          </Grid>

          <Typography variant="overline" color="text.secondary">{k('operations')}</Typography>
          <Grid container spacing={2} mb={3}>
            {[
              { label: k('arrivals'), value: fmtInt(ops.arrivals) },
              { label: k('departures'), value: fmtInt(ops.departures) },
              { label: k('inHouse'), value: fmtInt(ops.inHouse) },
              { label: t('admin.reports.kit.outOfService'), value: fmtInt(ops.outOfOrder) },
              { label: k('noShows'), value: fmtInt(ops.noShows) },
              { label: k('newBookings'), value: fmtInt(ops.newBookings), caption: k('newBookingsCaption', { nights: ops.newRoomNights, revenue: fmtMoney(ops.newRevenue) }) },
              { label: k('cancellations'), value: fmtInt(ops.cancellations), caption: k('cancellationsCaption', { nights: ops.cancelledRoomNights }) },
            ].map((tile) => (
              <Grid item xs={6} sm={4} md={12 / 7} key={tile.label}><KpiTile {...tile} /></Grid>
            ))}
          </Grid>

          <Paper variant="outlined" sx={{ mb: 3 }}>
            <Typography variant="subtitle1" fontWeight={700} px={2.5} pt={2}>{k('periodsTitle')}</Typography>
            <Typography variant="caption" color="text.secondary" px={2.5} display="block" pb={1}>{k('periodsHelp')}</Typography>
            <DataTable columns={periodColumns} rows={periods} />
          </Paper>

          <ChartCard
            title={k('outlookTitle')}
            subtitle={k('outlookHelp', { occ: fmtPct(data.outlook.summary.occupancyPct), revenue: fmtMoney(data.outlook.summary.roomRevenue), adr: fmtMoney(data.outlook.summary.adr) })}
            option={outlookOption}
            height={260}
            columns={outlookColumns}
            rows={data.outlook.rows}
          />
        </>
      )}
    </ReportShell>
  );
};

export default ManagerFlashReport;
