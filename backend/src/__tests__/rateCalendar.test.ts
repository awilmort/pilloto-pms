/**
 * Rate calendar pure logic (services/rateCalendar.ts, plan Phase 4.3): segment subtraction for
 * resets, shadowed-rule detection, PricingRule ↔ segment mapping, bulk-change validation.
 * 2026-12-07 is a Monday.
 */

import {
  subtractSegment, segmentDates, findShadowed, pricingRuleSegment, parseBulkChanges, Segment,
} from '../services/rateCalendar';

const seg = (dateStart: string, dateEnd: string, days: any[] = []): Segment => ({ dateStart, dateEnd, days });
const dates = (s: Segment[]) => s.flatMap(segmentDates).sort();
const all = (a: string, b: string) => segmentDates(seg(a, b));

describe('subtractSegment', () => {
  it('no overlap → rule kept whole, nothing hit', () => {
    expect(subtractSegment(seg('2026-12-01', '2026-12-05'), seg('2026-12-10', '2026-12-12'))).toEqual({ kept: [seg('2026-12-01', '2026-12-05')], hit: null });
  });

  it('reset in the middle splits the rule in two', () => {
    const { kept, hit } = subtractSegment(seg('2026-12-01', '2026-12-10'), seg('2026-12-04', '2026-12-06'));
    expect(kept).toEqual([seg('2026-12-01', '2026-12-03'), seg('2026-12-07', '2026-12-10')]);
    expect(hit).toEqual(seg('2026-12-04', '2026-12-06'));
  });

  it('reset at an edge trims', () => {
    expect(subtractSegment(seg('2026-12-01', '2026-12-10'), seg('2026-11-20', '2026-12-03')).kept).toEqual([seg('2026-12-04', '2026-12-10')]);
    expect(subtractSegment(seg('2026-12-01', '2026-12-10'), seg('2026-12-09', '2026-12-31')).kept).toEqual([seg('2026-12-01', '2026-12-08')]);
  });

  it('reset covering the whole rule removes it', () => {
    expect(subtractSegment(seg('2026-12-03', '2026-12-04'), seg('2026-12-01', '2026-12-10')).kept).toEqual([]);
  });

  it('weekday reset inside an every-day rule keeps the other weekdays', () => {
    const rule = seg('2026-12-01', '2026-12-14');
    const reset = seg('2026-12-01', '2026-12-14', ['sa']);
    const { kept, hit } = subtractSegment(rule, reset);
    expect(dates(kept)).toEqual(all('2026-12-01', '2026-12-14').filter((d) => !['2026-12-05', '2026-12-12'].includes(d)));
    expect(segmentDates(hit!)).toEqual(['2026-12-05', '2026-12-12']);
  });

  it('exactness: kept ∪ hit = rule dates, disjoint, for weekday rules and partial overlaps', () => {
    const rule = seg('2026-12-01', '2026-12-31', ['fr', 'sa', 'su']);
    const reset = seg('2026-12-10', '2026-12-20', ['sa', 'mo']);
    const { kept, hit } = subtractSegment(rule, reset);
    const ruleDates = segmentDates(rule);
    const keptDates = dates(kept);
    const hitDates = segmentDates(hit!);
    expect([...keptDates, ...hitDates].sort()).toEqual(ruleDates);
    expect(keptDates.filter((d) => hitDates.includes(d))).toEqual([]);
    expect(hitDates).toEqual(['2026-12-12', '2026-12-19']);
  });

  it('weekdays of the reset that the rule does not have → nothing hit', () => {
    expect(subtractSegment(seg('2026-12-01', '2026-12-31', ['fr']), seg('2026-12-01', '2026-12-31', ['mo'])).hit).toBeNull();
  });
});

describe('findShadowed', () => {
  const c = (id: string, at: number, s: Segment, fields = ['price']) => ({ id, updatedAt: new Date(at), segment: s, fields });

  it('an older rule fully covered by newer ones is shadowed; partially covered is kept', () => {
    expect(findShadowed([
      c('old', 1, seg('2026-12-03', '2026-12-04')),
      c('mid', 2, seg('2026-12-01', '2026-12-03')),
      c('new', 3, seg('2026-12-04', '2026-12-06')),
      c('partly', 0, seg('2026-12-05', '2026-12-08')),
    ])).toEqual(['old']);
  });

  it('a newer rule is never shadowed by an older one', () => {
    expect(findShadowed([c('new', 2, seg('2026-12-03', '2026-12-03')), c('old', 1, seg('2026-12-01', '2026-12-10'))])).toEqual([]);
  });

  it('per field: covered only when every field it sets is covered', () => {
    expect(findShadowed([
      c('both', 1, seg('2026-12-01', '2026-12-02'), ['minStayArrival', 'stopSell']),
      c('minOnly', 2, seg('2026-12-01', '2026-12-02'), ['minStayArrival']),
    ])).toEqual([]);
    expect(findShadowed([
      c('both', 1, seg('2026-12-01', '2026-12-02'), ['minStayArrival', 'stopSell']),
      c('min', 2, seg('2026-12-01', '2026-12-02'), ['minStayArrival']),
      c('stop', 3, seg('2026-12-01', '2026-12-05'), ['stopSell']),
    ])).toEqual(['both']);
  });

  it('weekday-filtered newer rules only cover their weekdays', () => {
    expect(findShadowed([
      c('weekend', 1, seg('2026-12-01', '2026-12-31', ['sa', 'su'])),
      c('saturdays', 2, seg('2026-12-01', '2026-12-31', ['sa'])),
    ])).toEqual([]);
  });
});

describe('pricingRuleSegment', () => {
  const D = (s: string) => new Date(`${s}T12:00:00.000Z`);
  it('maps period patterns to weekdays', () => {
    expect(pricingRuleSegment({ dateStart: D('2026-12-01'), dateEnd: D('2026-12-10'), periodPattern: 'all_days' } as any)).toEqual(seg('2026-12-01', '2026-12-10'));
    expect(pricingRuleSegment({ dateStart: D('2026-12-01'), dateEnd: D('2026-12-10'), periodPattern: 'specific_days', specificDays: [6, 5] } as any))
      .toEqual(seg('2026-12-01', '2026-12-10', ['fr', 'sa']));
    expect(pricingRuleSegment({ dateStart: D('2026-12-01'), dateEnd: D('2026-12-10'), periodPattern: 'weekends' } as any)!.days).toEqual(['sa', 'su']);
    expect(pricingRuleSegment({ periodPattern: 'all_days' } as any)).toBeNull();
  });
});

describe('parseBulkChanges', () => {
  const ctx = { today: '2026-10-28', ratePlanIds: new Set(['p1', 'p2']) };
  const row = (over: Record<string, unknown> = {}) => ({ ratePlanIds: ['p1'], dateFrom: '2026-12-01', dateTo: '2026-12-10', set: { price: 150 }, ...over });
  const errorsOf = (body: unknown) => { const r = parseBulkChanges(body, ctx); return 'errors' in r ? r.errors.join(' | ') : ''; };

  it('normalizes a valid request', () => {
    const r = parseBulkChanges({ changes: [row({ days: ['sa', 'fr'], set: { minStayArrival: 3, closedToArrival: true }, reset: ['price', 'price'] })] }, ctx);
    expect(r).toEqual({ changes: [{ ratePlanIds: ['p1'], dateStart: '2026-12-01', dateEnd: '2026-12-10', days: ['fr', 'sa'], set: { minStayArrival: 3, closedToArrival: true }, reset: ['price'] }] });
  });

  it('all seven weekdays = no filter', () => {
    const r = parseBulkChanges({ changes: [row({ days: ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] })] }, ctx) as any;
    expect(r.changes[0].days).toEqual([]);
  });

  it.each([
    ['no changes', {}, /at least one change/],
    ['unknown plan', { changes: [row({ ratePlanIds: ['zz'] })] }, /Change 1: one of the rate plans was not found/],
    ['no plan', { changes: [row({ ratePlanIds: [] })] }, /at least one rate plan/],
    ['past dates', { changes: [row({ dateFrom: '2026-10-27' })] }, /past dates cannot be changed \(today is 2026-10-28\)/],
    ['beyond 730 days', { changes: [row({ dateTo: '2028-12-01' })] }, /up to 730 days ahead/],
    ['reversed', { changes: [row({ dateFrom: '2026-12-10', dateTo: '2026-12-01' })] }, /on or after dateFrom/],
    ['zero price', { changes: [row({ set: { price: 0 } })] }, /positive amount/],
    ['3 decimals', { changes: [row({ set: { price: 10.555 } })] }, /at most 2 decimals/],
    ['bad min stay', { changes: [row({ set: { minStayArrival: 0 } })] }, /minStayArrival must be/],
    ['max < min', { changes: [row({ set: { minStayArrival: 5, maxStay: 2 } })] }, /cannot be shorter/],
    ['non-boolean', { changes: [row({ set: { stopSell: 'yes' } })] }, /stopSell must be true or false/],
    ['unknown field', { changes: [row({ set: { colour: 'red' } })] }, /unknown field "colour"/],
    ['set and reset same field', { changes: [row({ reset: ['price'] })] }, /price cannot be both set and reset/],
    ['unknown reset field', { changes: [row({ reset: ['colour'] })] }, /reset must list fields/],
    ['nothing to do', { changes: [row({ set: {} })] }, /nothing to change/],
    ['weekdays outside the range', { changes: [row({ dateFrom: '2026-12-07', dateTo: '2026-12-07', days: ['sa'] })] }, /do not fall within the dates/],
  ])('%s', (_name, body, message) => {
    expect(errorsOf(body)).toMatch(message);
  });

  it('reports every bad row, numbered', () => {
    expect(errorsOf({ changes: [row(), row({ ratePlanIds: ['zz'] }), row({ set: { price: -1 } })] }))
      .toBe('Change 2: one of the rate plans was not found. | Change 3: price must be a positive amount with at most 2 decimals (to close dates use stopSell).');
  });
});
