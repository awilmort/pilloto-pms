import React from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import type { DashboardTrendPoint } from '../../../types';
import { ChartCard } from '../../admin/reports/kit';
import type { Column } from '../../admin/reports/kit';
import { axisTooltip, barSeries, categoryAxis, lineSeries, valueAxis } from '../../charts/EChart';
import { INK, SERIES } from '../../charts/chartTheme';
import { compactMoney } from './dashboardLogic';
import { formatAccountingMoney } from '../../../utils/currency';

/** `2026-11` → "nov" in the UI language. */
export const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(i18n.language, { month: 'short' }).replace('.', '');
};

const money = (n: number) => formatAccountingMoney(n);

export const IncomeExpensesChart: React.FC<{ trend: DashboardTrendPoint[] }> = ({ trend }) => {
  const { t } = useTranslation();
  const months = trend.map((p) => monthLabel(p.month));
  const names = {
    revenue: t('accounting.dashboard.charts.incomeExpenses.revenue'),
    expenses: t('accounting.dashboard.charts.incomeExpenses.expenses'),
    net: t('accounting.dashboard.charts.incomeExpenses.net'),
  };
  const option = {
    legend: { data: [names.revenue, names.expenses, names.net] },
    tooltip: axisTooltip(money, 'shadow'),
    xAxis: categoryAxis(months),
    yAxis: valueAxis(compactMoney),
    series: [
      barSeries(names.revenue, trend.map((p) => p.revenue), SERIES[0]),
      barSeries(names.expenses, trend.map((p) => p.expenses), SERIES[1]),
      { ...lineSeries(names.net, trend.map((p) => p.net), INK.primary), showSymbol: true, symbolSize: 7 },
    ],
  };
  const columns: Column<DashboardTrendPoint>[] = [
    { key: 'month', label: t('accounting.dashboard.charts.monthColumn'), render: (r) => monthLabel(r.month) },
    { key: 'revenue', label: names.revenue, align: 'right', render: (r) => money(r.revenue) },
    { key: 'expenses', label: names.expenses, align: 'right', render: (r) => money(r.expenses) },
    { key: 'net', label: names.net, align: 'right', render: (r) => money(r.net) },
  ];
  return (
    <ChartCard
      title={t('accounting.dashboard.charts.incomeExpenses.title')}
      subtitle={t('accounting.dashboard.charts.incomeExpenses.subtitle')}
      option={option}
      height={260}
      columns={columns}
      rows={trend}
    />
  );
};

export const CashFlowChart: React.FC<{ trend: DashboardTrendPoint[] }> = ({ trend }) => {
  const { t } = useTranslation();
  const months = trend.map((p) => monthLabel(p.month));
  const names = {
    in: t('accounting.dashboard.charts.cashFlow.in'),
    out: t('accounting.dashboard.charts.cashFlow.out'),
    closing: t('accounting.dashboard.charts.cashFlow.closing'),
  };
  const option = {
    legend: { data: [names.in, names.out, names.closing] },
    tooltip: axisTooltip(money, 'shadow'),
    xAxis: categoryAxis(months),
    yAxis: valueAxis(compactMoney),
    series: [
      barSeries(names.in, trend.map((p) => p.cashIn), SERIES[2]),
      barSeries(names.out, trend.map((p) => p.cashOut), SERIES[1]),
      { ...lineSeries(names.closing, trend.map((p) => p.cashClosing), SERIES[0]), showSymbol: true, symbolSize: 7 },
    ],
  };
  const columns: Column<DashboardTrendPoint>[] = [
    { key: 'month', label: t('accounting.dashboard.charts.monthColumn'), render: (r) => monthLabel(r.month) },
    { key: 'cashIn', label: names.in, align: 'right', render: (r) => money(r.cashIn) },
    { key: 'cashOut', label: names.out, align: 'right', render: (r) => money(r.cashOut) },
    { key: 'cashClosing', label: names.closing, align: 'right', render: (r) => money(r.cashClosing) },
  ];
  return (
    <ChartCard
      title={t('accounting.dashboard.charts.cashFlow.title')}
      subtitle={t('accounting.dashboard.charts.cashFlow.subtitle')}
      option={option}
      height={260}
      columns={columns}
      rows={trend}
    />
  );
};
