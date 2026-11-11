/**
 * Accounting dashboard logic (components/accounting/dashboard/dashboardLogic.ts): comparison
 * deltas, aging segments, compact money, the prioritized attention list and the empty-ledger check.
 */
import type { AccountingDashboardData } from '../../../../types';
import { pctChange, agingSegments, compactMoney, attentionItems, isLedgerEmpty, hasAnyBlock, deadlineTone } from '../dashboardLogic';

const buckets = (o: Partial<Record<'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus', number>> = {}) => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, ...o });

const base = (over: Partial<AccountingDashboardData> = {}): AccountingDashboardData => ({
  asOf: '2026-11-18T12:00:00Z',
  period: { key: 'month', from: '', to: '', prevFrom: '', prevTo: '' },
  access: { financial: true, receivables: true, payables: true, cityLedger: true, inventory: true, ecf: true },
  attention: {},
  deadlines: [{ key: 'informativeReturns', day: 15, date: '', daysLeft: 27 }, { key: 'itbisReturn', day: 20, date: '', daysLeft: 32 }],
  ...over,
});

const ar = (o: object = {}) => ({ total: 0, overdue: 0, overdueCount: 0, openCount: 0, dsoDays: null, buckets: buckets(), invoices: [], ...o });
const ap = (o: object = {}) => ({ total: 0, overdue: 0, overdueCount: 0, dueSoon: 0, dueSoonCount: 0, openCount: 0, buckets: buckets(), bills: [], ...o });
const fin = (o: object = {}) => ({
  cash: { total: 0, accounts: [] }, current: { revenue: 0, expenses: 0, netIncome: 0 }, previous: { revenue: 0, expenses: 0, netIncome: 0 },
  trend: [{ month: '2026-11', revenue: 0, expenses: 0, net: 0, cashIn: 0, cashOut: 0, cashNet: 0, cashClosing: 0 }], topExpenses: [], itbis: { sales: 0, purchases: 0, net: 0 }, ...o,
});

describe('pctChange', () => {
  it('is relative to the size of the previous figure', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
  });
  it('uses the magnitude when the previous figure was a loss, so recovering reads as an increase', () => {
    expect(pctChange(50, -100)).toBe(150);
  });
  it('is null when there is no baseline', () => {
    expect(pctChange(100, 0)).toBeNull();
  });
});

describe('agingSegments', () => {
  it('keeps every bucket in order with its share', () => {
    const s = agingSegments(buckets({ current: 50, d1_30: 390, d61_90: 100 }));
    expect(s.map((x) => x.key)).toEqual(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']);
    expect(s.map((x) => Math.round(x.share * 1000) / 10)).toEqual([9.3, 72.2, 0, 18.5, 0]);
  });
  it('has no NaN shares when nothing is open', () => {
    expect(agingSegments(buckets()).every((x) => x.share === 0)).toBe(true);
  });
});

describe('compactMoney', () => {
  it.each([[950, '950'], [1200, '1.2K'], [1000, '1K'], [-45300, '-45.3K'], [2_500_000, '2.5M'], [0, '0']])('%d → %s', (v, out) => {
    expect(compactMoney(v as number)).toBe(out);
  });
});

describe('attentionItems', () => {
  it('is empty when everything is in order', () => {
    expect(attentionItems(base({ receivables: ar(), payables: ap(), financial: fin() }))).toEqual([]);
  });

  it('orders by severity: errors, then warnings, then info', () => {
    const items = attentionItems(base({
      receivables: ar({ overdueCount: 2, overdue: 490, buckets: buckets({ d1_30: 390, d61_90: 100 }) }),
      payables: ap({ overdueCount: 1, overdue: 200, dueSoonCount: 1, dueSoon: 354 }),
      ecf: { accepted: 1, inProcess: 0, contingency: 0, rejected: 2, total: 3, windowDays: 30 },
      attention: { cityLedgerPending: 1, lowStock: 4 },
    }));
    expect(items.map((i) => [i.key, i.tone])).toEqual([
      ['arOverdue', 'error'], ['apOverdue', 'error'], ['ecfRejected', 'error'],
      ['apDueSoon', 'warning'], ['cityLedger', 'warning'],
      ['lowStock', 'info'],
    ]);
  });

  it('overdue receivables are only a warning until something is more than 60 days late', () => {
    const items = attentionItems(base({ receivables: ar({ overdueCount: 1, overdue: 390, buckets: buckets({ d1_30: 390 }) }) }));
    expect(items[0]).toMatchObject({ key: 'arOverdue', tone: 'warning', amount: 390, link: { path: '/accounting/reports', state: { tab: 'arAging' } } });
  });

  it('flags the next DGII deadline only when it is close, escalating at 3 days', () => {
    const near = (days: number) => attentionItems(base({ deadlines: [{ key: 'itbisReturn', day: 20, date: '', daysLeft: days }] }));
    expect(near(6)).toEqual([]);
    expect(near(5)).toEqual([{ key: 'deadline', tone: 'warning', count: 5 }]);
    expect(near(2)[0].tone).toBe('error');
  });

  it('never reports on blocks the user cannot see', () => {
    expect(attentionItems(base({ attention: {} }))).toEqual([]);
  });
});

describe('deadlineTone', () => {
  it.each([[0, 'error'], [3, 'error'], [4, 'warning'], [7, 'warning'], [8, 'neutral']])('%d days → %s', (d, tone) => {
    expect(deadlineTone(d as number)).toBe(tone);
  });
});

describe('isLedgerEmpty / hasAnyBlock', () => {
  it('a brand-new tenant is empty', () => {
    expect(isLedgerEmpty(base({ financial: fin(), receivables: ar(), payables: ap() }))).toBe(true);
  });
  it('any movement, balance or open document makes it non-empty', () => {
    expect(isLedgerEmpty(base({ financial: fin({ cash: { total: 10, accounts: [] } }), receivables: ar(), payables: ap() }))).toBe(false);
    expect(isLedgerEmpty(base({ financial: fin(), receivables: ar({ openCount: 1 }), payables: ap() }))).toBe(false);
    expect(isLedgerEmpty(base({ financial: fin({ trend: [{ month: '2026-11', revenue: 5, expenses: 0, net: 5, cashIn: 0, cashOut: 0, cashNet: 0, cashClosing: 0 }] }) }))).toBe(false);
  });
  it('a user who can see no data block is not told the books are empty', () => {
    expect(isLedgerEmpty(base())).toBe(false);
    expect(hasAnyBlock(base())).toBe(false);
    expect(hasAnyBlock(base({ payables: ap() }))).toBe(true);
  });
});
