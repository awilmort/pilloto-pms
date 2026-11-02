/**
 * Thin React wrapper around Apache ECharts (tree-shaken, SVG renderer so charts print crisply).
 *
 * Defaults every chart shares: the validated palette, the UI font, recessive axes and grid,
 * a crosshair tooltip on axis charts, ARIA description. Build options with the helpers below
 * (`categoryAxis`, `valueAxis`, `lineSeries`, `barSeries`) so marks stay consistent:
 * 2px lines, ≥8px hover markers, 4px rounded bar ends on the data side, 2px gaps between fills.
 */
import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart, HeatmapChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { CHART_FONT, INK, SERIES } from './chartTheme';

echarts.use([LineChart, BarChart, PieChart, HeatmapChart, AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, SVGRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

const BASE: ChartOption = {
  color: [...SERIES],
  aria: { enabled: true },
  textStyle: { fontFamily: CHART_FONT, color: INK.secondary, fontSize: 12 },
  grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
  legend: { type: 'scroll', top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: INK.secondary } },
  tooltip: {
    backgroundColor: INK.surface,
    borderColor: INK.grid,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: INK.primary, fontFamily: CHART_FONT, fontSize: 12 },
    extraCssText: 'box-shadow: 0 6px 18px rgba(18,26,51,0.12); border-radius: 8px;',
  },
  animationDuration: 400,
};

interface EChartProps {
  option: ChartOption;
  height?: number;
  /** Screen-reader summary of what the chart shows */
  ariaLabel?: string;
}

const EChart: React.FC<EChartProps> = ({ option, height = 280, ariaLabel }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const instance = echarts.init(ref.current, undefined, { renderer: 'svg' });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const merged: ChartOption = {
      ...BASE,
      ...option,
      aria: { enabled: true, ...(ariaLabel ? { label: { description: ariaLabel } } : {}) },
      grid: { ...(BASE.grid as object), ...((option.grid as object) ?? {}) },
      tooltip: { ...(BASE.tooltip as object), ...((option.tooltip as object) ?? {}) },
      legend: option.legend === undefined ? { show: false } : { ...(BASE.legend as object), ...(option.legend as object) },
    };
    chart.current?.setOption(merged, { notMerge: true });
  }, [option, ariaLabel]);

  return <Box ref={ref} role="img" aria-label={ariaLabel} sx={{ width: '100%', height }} />;
};

export default EChart;

// ─── Option helpers ───────────────────────────────────────────────────────────

const axisLabel = { color: INK.muted, fontSize: 11 };

export const categoryAxis = (data: string[], extra: Record<string, unknown> = {}) => ({
  type: 'category',
  data,
  boundaryGap: true,
  axisLine: { lineStyle: { color: INK.baseline } },
  axisTick: { show: false },
  axisLabel: { ...axisLabel, hideOverlap: true },
  ...extra,
});

export const valueAxis = (formatter?: (v: number) => string, extra: Record<string, unknown> = {}) => ({
  type: 'value',
  splitLine: { lineStyle: { color: INK.grid } },
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { ...axisLabel, ...(formatter ? { formatter } : {}) },
  ...extra,
});

/** Crosshair tooltip for line / area charts; value formatter applied to every row */
export const axisTooltip = (format: (v: number) => string, pointer: 'line' | 'shadow' = 'line') => ({
  trigger: 'axis',
  axisPointer: pointer === 'line'
    ? { type: 'line', lineStyle: { color: INK.baseline, width: 1 } }
    : { type: 'shadow', shadowStyle: { color: 'rgba(61,123,245,0.06)' } },
  valueFormatter: (v: unknown) => (v == null || v === '-' ? '–' : format(Number(v))),
});

export const lineSeries = (name: string, data: (number | null)[], color: string, opts: { dashed?: boolean; area?: boolean; endLabel?: boolean } = {}) => ({
  type: 'line',
  name,
  data,
  color,
  smooth: false,
  showSymbol: data.length <= 2,
  symbol: 'circle',
  symbolSize: 8,
  lineStyle: { width: 2, type: opts.dashed ? [5, 4] : 'solid', opacity: opts.dashed ? 0.75 : 1 },
  emphasis: { focus: 'series', scale: true },
  ...(opts.area ? { areaStyle: { opacity: 0.08 } } : {}),
  ...(opts.endLabel ? { endLabel: { show: true, formatter: '{a}', color: INK.secondary, fontSize: 11, distance: 6 } } : {}),
});

export const barSeries = (name: string, data: (number | null)[], color: string, opts: { stack?: string; horizontal?: boolean; last?: boolean } = {}) => ({
  type: 'bar',
  name,
  data,
  color,
  ...(opts.stack ? { stack: opts.stack } : {}),
  barMaxWidth: 36,
  barGap: '8%',
  itemStyle: {
    // Rounded data end only: the top of a column (or the last segment of a stack)
    borderRadius: opts.stack && !opts.last ? 0 : opts.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
    borderColor: INK.surface,
    borderWidth: opts.stack ? 1 : 0,
  },
  emphasis: { focus: 'series' },
});
