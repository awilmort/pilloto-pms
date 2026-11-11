/**
 * Pure logic behind the Accounting dashboard (no React, no router) so it can be unit-tested:
 * comparison deltas, aging bar segments, the prioritized "needs attention" list and the
 * empty-ledger check.
 */
import type { AccountingDashboardData, AgingBucketKey, AgingBuckets } from '../../../types';
import { STATUS, OTHER } from '../../charts/chartTheme';

export const AGING_ORDER: AgingBucketKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

/** Not-yet-due is neutral; colour escalates with age. Amounts are always labelled, never colour-only. */
export const AGING_COLORS: Record<AgingBucketKey, string> = {
  current: OTHER,
  d1_30: STATUS.warning,
  d31_60: STATUS.serious,
  d61_90: STATUS.critical,
  d90_plus: '#8E1F1F',
};

/** Change vs the comparison period, in percent of its magnitude; null when there is nothing to compare against. */
export function pctChange(current: number, previous: number): number | null {
  if (Math.abs(previous) < 0.005) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export interface AgingSegment { key: AgingBucketKey; amount: number; share: number }

/** Every bucket in order with its share of the total (0 when the total is 0). */
export function agingSegments(buckets: AgingBuckets): AgingSegment[] {
  const total = AGING_ORDER.reduce((s, k) => s + buckets[k], 0);
  return AGING_ORDER.map((key) => ({ key, amount: buckets[key], share: total > 0 ? buckets[key] / total : 0 }));
}

/** 1.2K / 3.4M style for axis labels and dense tiles. */
export function compactMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const fmt = (n: number, unit: string) => `${sign}${(Math.round(n * 10) / 10).toString().replace(/\.0$/, '')}${unit}`;
  if (abs >= 1_000_000) return fmt(abs / 1_000_000, 'M');
  if (abs >= 1_000) return fmt(abs / 1_000, 'K');
  return `${sign}${Math.round(abs)}`;
}

export type AttentionTone = 'error' | 'warning' | 'info';

export interface AttentionLink { path: string; state?: Record<string, unknown> }

export interface AttentionItem {
  key: 'arOverdue' | 'apOverdue' | 'apDueSoon' | 'ecfRejected' | 'cityLedger' | 'lowStock' | 'deadline';
  tone: AttentionTone;
  /** How many documents / days — what the sentence is about. */
  count: number;
  amount?: number;
  link?: AttentionLink;
}

const TONE_ORDER: Record<AttentionTone, number> = { error: 0, warning: 1, info: 2 };

/** Days before a DGII deadline from which it is worth interrupting the user. */
export const DEADLINE_ALERT_DAYS = 5;

export const deadlineTone = (daysLeft: number): 'error' | 'warning' | 'neutral' =>
  daysLeft <= 3 ? 'error' : daysLeft <= 7 ? 'warning' : 'neutral';

/** What needs action right now, most severe first. Blocks the user cannot see never produce an item. */
export function attentionItems(d: AccountingDashboardData): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { receivables: ar, payables: ap, ecf, attention } = d;

  if (ar && ar.overdueCount > 0) {
    const seriouslyLate = ar.buckets.d61_90 + ar.buckets.d90_plus > 0;
    items.push({ key: 'arOverdue', tone: seriouslyLate ? 'error' : 'warning', count: ar.overdueCount, amount: ar.overdue, link: { path: '/accounting/reports', state: { tab: 'arAging' } } });
  }
  if (ap && ap.overdueCount > 0) {
    items.push({ key: 'apOverdue', tone: 'error', count: ap.overdueCount, amount: ap.overdue, link: { path: '/accounting/reports', state: { tab: 'apAging' } } });
  }
  if (ap && ap.dueSoonCount > 0) {
    items.push({ key: 'apDueSoon', tone: 'warning', count: ap.dueSoonCount, amount: ap.dueSoon, link: { path: '/accounting/bills' } });
  }
  if (ecf && ecf.rejected > 0) {
    items.push({ key: 'ecfRejected', tone: 'error', count: ecf.rejected, link: { path: '/accounting/invoices' } });
  }
  if ((attention.cityLedgerPending ?? 0) > 0) {
    items.push({ key: 'cityLedger', tone: 'warning', count: attention.cityLedgerPending!, link: { path: '/accounting/city-ledger' } });
  }
  const nextDeadline = [...d.deadlines].sort((a, b) => a.daysLeft - b.daysLeft)[0];
  if (nextDeadline && nextDeadline.daysLeft <= DEADLINE_ALERT_DAYS) {
    items.push({ key: 'deadline', tone: nextDeadline.daysLeft <= 3 ? 'error' : 'warning', count: nextDeadline.daysLeft });
  }
  if ((attention.lowStock ?? 0) > 0) {
    items.push({ key: 'lowStock', tone: 'info', count: attention.lowStock!, link: { path: '/accounting/products' } });
  }
  // Array.sort is stable, so equal tones keep the order above.
  return items.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

/** True when the books have no activity yet — nothing to chart, so the dashboard shows a welcome instead. */
export function isLedgerEmpty(d: AccountingDashboardData): boolean {
  const { financial: f, receivables: ar, payables: ap } = d;
  if (!f && !ar && !ap) return false;
  const financialEmpty = !f || (Math.abs(f.cash.total) < 0.005 && f.trend.every((m) => m.revenue === 0 && m.expenses === 0 && m.cashIn === 0 && m.cashOut === 0));
  return financialEmpty && (!ar || ar.openCount === 0) && (!ap || ap.openCount === 0);
}

/** Whether the user can see at least one data block (otherwise the page explains why it is bare). */
export const hasAnyBlock = (d: AccountingDashboardData): boolean => !!(d.financial || d.receivables || d.payables);
