/**
 * Booking insights — how guests book stays arriving in a range: booking window (lead time) and
 * how cancellations rise with it, length of stay, demand and rate by day of week, cancellations
 * by source, no-shows, party size and repeat guests. Feeds cancellation / deposit policy,
 * minimum-stay rules and weekday vs weekend pricing.
 */
import React, { useMemo, useState } from 'react';
import { Grid } from '@mui/material';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { useTranslation } from 'react-i18next';
import { reportsService } from '../../../services/api';
import { BookingInsightsData } from '../../../types/reports';
import { axisTooltip, barSeries, categoryAxis, valueAxis } from '../../charts/EChart';
import { SERIES } from '../../charts/chartTheme';
import {
  ChartCard, Column, KpiTile, RangeFilter, RangePreset, ReportShell,
  downloadCsv, fmtInt, fmtMoney, fmtNum, fmtPct, shiftIso, todayIso, useReportData,
} from './kit';

type LeadRow = BookingInsightsData['leadTime'][number];
type LosRow = BookingInsightsData['lengthOfStay'][number];
type DowRow = BookingInsightsData['dayOfWeek'][number];
type SourceRow = BookingInsightsData['cancellationsBySource'][number];

const pctMax = (e: { max: number }) => Math.max(10, Math.ceil(e.max / 10) * 10);

const BookingInsightsReport: React.FC = () => {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => t(`admin.reports.insights.${key}`, opts);

  const presets: RangePreset[] = useMemo(() => [
    { id: '90d', label: t('admin.reports.kit.lastDays', { count: 90 }), from: () => shiftIso(todayIso(), -89), to: todayIso },
    { id: 'ytd', label: t('admin.reports.kit.yearToDate'), from: () => `${todayIso().slice(0, 4)}-01-01`, to: todayIso },
    { id: '12m', label: t('admin.reports.kit.last12Months'), from: () => shiftIso(todayIso(), -364), to: todayIso },
    { id: 'next90', label: t('admin.reports.kit.nextDays', { count: 90 }), from: todayIso, to: () => shiftIso(todayIso(), 89) },
  ], [t]);
  const [range, setRange] = useState({ preset: '12m', from: shiftIso(todayIso(), -364), to: todayIso() });

  const { data, loading, error, reload } = useReportData(
    async () => (await reportsService.getBookingInsights({ from: range.from, to: range.to })).data.data!,
    [range.from, range.to],
  );

  const leadLabel = (key: string) => k('days', { range: key });
  const dowLabel = (dow: number) => t(`admin.reports.kit.weekdays.${dow}`);
  const losLabel = (key: string) => k('nights', { range: key });
  const sourceLabel = (r: SourceRow) => (['front_desk', 'booking_engine', 'corporate'].includes(r.key) ? t(`admin.reports.segmentation.sources.${r.key}`) : r.label);

  const bars = <R,>(rows: R[], label: (r: R) => string, pick: (r: R) => number, name: string, format: (v: number) => string, color: string = SERIES[0], yExtra: Record<string, unknown> = {}) => ({
    grid: { top: 12 },
    tooltip: axisTooltip(format, 'shadow'),
    xAxis: categoryAxis(rows.map(label)),
    yAxis: valueAxis(format, yExtra),
    series: [barSeries(name, rows.map(pick), color)],
  });

  const opts = useMemo(() => {
    if (!data) return null;
    return {
      lead: bars(data.leadTime, (r) => leadLabel(r.key), (r) => r.reservations, k('reservations'), fmtInt, SERIES[0], { minInterval: 1 }),
      leadCancel: bars(data.leadTime, (r) => leadLabel(r.key), (r) => r.cancellationRatePct, k('cancellationRate'), (v) => fmtPct(v, 0), SERIES[0], { min: 0, max: pctMax }),
      los: bars(data.lengthOfStay, (r) => losLabel(r.key), (r) => r.reservations, k('reservations'), fmtInt, SERIES[0], { minInterval: 1 }),
      dowOcc: bars(data.dayOfWeek, (r) => dowLabel(r.dow), (r) => r.occupancyPct, t('admin.reports.kit.occupancy'), (v) => fmtPct(v, 0), SERIES[0], { min: 0, max: (e: { max: number }) => Math.max(100, Math.ceil(e.max / 10) * 10) }),
      dowAdr: bars(data.dayOfWeek, (r) => dowLabel(r.dow), (r) => r.adr, 'ADR', fmtMoney, SERIES[0]),
      source: {
        ...bars([...data.cancellationsBySource].reverse(), sourceLabel, (r) => r.cancellationRatePct, k('cancellationRate'), (v) => fmtPct(v, 0), SERIES[0]),
        grid: { top: 8, right: 48 },
        xAxis: valueAxis((v) => fmtPct(v, 0), { min: 0, max: pctMax }),
        yAxis: categoryAxis([...data.cancellationsBySource].reverse().map(sourceLabel), { axisLabel: { color: '#5B6278', fontSize: 11, width: 120, overflow: 'truncate' } }),
        series: [{ ...barSeries(k('cancellationRate'), [...data.cancellationsBySource].reverse().map((r) => r.cancellationRatePct), SERIES[0], { horizontal: true }), label: { show: true, position: 'right', formatter: (p: { value: number }) => fmtPct(p.value, 0), color: '#5B6278', fontSize: 11 } }],
      },
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const leadColumns: Column<LeadRow>[] = [
    { key: 'key', label: k('leadTime'), render: (r) => leadLabel(r.key), value: (r) => r.key },
    { key: 'reservations', label: k('reservations'), align: 'right' },
    { key: 'cancellations', label: k('cancellations'), align: 'right' },
    { key: 'cancellationRatePct', label: k('cancellationRate'), align: 'right', render: (r) => fmtPct(r.cancellationRatePct) },
    { key: 'adr', label: 'ADR', align: 'right', render: (r) => fmtMoney(r.adr) },
  ];
  const losColumns: Column<LosRow>[] = [
    { key: 'key', label: k('lengthOfStay'), render: (r) => losLabel(r.key), value: (r) => r.key },
    { key: 'reservations', label: k('reservations'), align: 'right' },
    { key: 'roomNights', label: t('admin.reports.kit.roomNights'), align: 'right' },
  ];
  const dowColumns: Column<DowRow>[] = [
    { key: 'dow', label: k('weekday'), render: (r) => dowLabel(r.dow), value: (r) => dowLabel(r.dow) },
    { key: 'arrivals', label: k('arrivals'), align: 'right' },
    { key: 'occupancyPct', label: t('admin.reports.kit.occupancy'), align: 'right', render: (r) => fmtPct(r.occupancyPct) },
    { key: 'adr', label: 'ADR', align: 'right', render: (r) => fmtMoney(r.adr) },
  ];
  const sourceColumns: Column<SourceRow>[] = [
    { key: 'label', label: t('admin.reports.segmentation.by.source'), render: sourceLabel, value: sourceLabel },
    { key: 'reservations', label: k('reservations'), align: 'right' },
    { key: 'cancellations', label: k('cancellations'), align: 'right' },
    { key: 'cancellationRatePct', label: k('cancellationRate'), align: 'right', render: (r) => fmtPct(r.cancellationRatePct) },
  ];

  return (
    <ReportShell
      icon={<EventNoteIcon />}
      title={k('title')}
      subtitle={k('subtitle')}
      loading={loading}
      error={error}
      hasData={!!data}
      onRefresh={reload}
      onCsv={() => data && downloadCsv(`booking-insights-lead-time-${range.from}-${range.to}.csv`, leadColumns, data.leadTime)}
      printTitle={`booking-insights-${range.from}-${range.to}`}
      filters={<RangeFilter presets={presets} {...range} onChange={setRange} />}
    >
      {data && opts && (
        <>
          <Grid container spacing={2} mb={3}>
            {[
              { label: k('arrivals'), value: fmtInt(data.arrivals) },
              { label: k('avgLead'), value: k('daysValue', { value: fmtNum(data.avgLeadDays) }) },
              { label: k('avgLos'), value: k('nightsValue', { value: fmtNum(data.avgLos) }) },
              { label: k('cancellationRate'), value: fmtPct(data.cancellationRatePct) },
              { label: k('noShowRate'), value: fmtPct(data.noShowRatePct), caption: k('noShowCaption', { count: data.noShows }) },
              { label: k('repeatGuests'), value: fmtPct(data.repeatGuestPct) },
              { label: k('partySize'), value: fmtNum(data.avgPartySize) },
            ].map((tile) => <Grid item xs={6} sm={4} md={12 / 7} key={tile.label}><KpiTile {...tile} /></Grid>)}
          </Grid>

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('leadTitle')} subtitle={k('leadHelp')} option={opts.lead} height={240} columns={leadColumns} rows={data.leadTime} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('leadCancelTitle')} subtitle={k('leadCancelHelp')} option={opts.leadCancel} height={240} columns={leadColumns} rows={data.leadTime} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('dowOccTitle')} subtitle={k('dowHelp')} option={opts.dowOcc} height={240} columns={dowColumns} rows={data.dayOfWeek} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('dowAdrTitle')} subtitle={k('dowHelp')} option={opts.dowAdr} height={240} columns={dowColumns} rows={data.dayOfWeek} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('losTitle')} subtitle={k('losHelp')} option={opts.los} height={240} columns={losColumns} rows={data.lengthOfStay} />
            </Grid>
            <Grid item xs={12} md={6}>
              <ChartCard title={k('sourceCancelTitle')} subtitle={k('sourceCancelHelp')} option={opts.source} height={Math.max(200, data.cancellationsBySource.length * 34 + 30)} columns={sourceColumns} rows={data.cancellationsBySource} />
            </Grid>
          </Grid>
        </>
      )}
    </ReportShell>
  );
};

export default BookingInsightsReport;
