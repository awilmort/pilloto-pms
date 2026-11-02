import {
  addDays, eachDate, weekdayOf, stageEdit, stagedCount, stagedToChanges, emptyBulkRow, bulkRowNights, bulkRowToChange,
  sourceMark, Staged, BulkRow,
} from '../rateCalendar';

// December 2026: Tue 1, Fri 4, Sat 5, Sun 6, Mon 7
const dec = (d: number) => `2026-12-${String(d).padStart(2, '0')}`;
const TODAY = '2026-11-01';

describe('dates', () => {
  it('adds days across months and lists ranges', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(eachDate(dec(30), '2027-01-01')).toEqual([dec(30), dec(31), '2027-01-01']);
    expect([1, 4, 5, 6, 7].map((d) => weekdayOf(dec(d)))).toEqual(['tu', 'fr', 'sa', 'su', 'mo']);
  });
});

describe('staged edits', () => {
  it('typing back the value the server shows removes the edit', () => {
    let s: Staged = {};
    s = stageEdit(s, 'bar', dec(4), 'price', 333, 100);
    expect(stagedCount(s)).toBe(1);
    s = stageEdit(s, 'bar', dec(4), 'price', 100, 100);
    expect(s).toEqual({});
  });

  it('reset is always staged, even when the value would not change', () => {
    expect(stageEdit({}, 'bar', dec(4), 'price', 'reset', 100)).toEqual({ [`bar|${dec(4)}`]: { price: 'reset' } });
  });
});

describe('stagedToChanges: one Save → the fewest rows', () => {
  const stage = (edits: [string, number, string, any][]) =>
    edits.reduce<Staged>((s, [plan, d, field, value]) => stageEdit(s, plan, dec(d), field as any, value), {});

  it('certification test 2: one cell → one row', () => {
    expect(stagedToChanges(stage([['bar', 4, 'price', 333]]))).toEqual([
      { ratePlanIds: ['bar'], dateFrom: dec(4), dateTo: dec(4), set: { price: 333 } },
    ]);
  });

  it('certification test 3: three single-date prices on three plans → one row each, one request', () => {
    const rows = stagedToChanges(stage([['bar', 4, 'price', 333], ['bb', 5, 'price', 444], ['dbl', 6, 'price', 456.23]]));
    expect(rows).toEqual([
      { ratePlanIds: ['bar'], dateFrom: dec(4), dateTo: dec(4), set: { price: 333 } },
      { ratePlanIds: ['bb'], dateFrom: dec(5), dateTo: dec(5), set: { price: 444 } },
      { ratePlanIds: ['dbl'], dateFrom: dec(6), dateTo: dec(6), set: { price: 456.23 } },
    ]);
  });

  it('consecutive dates with the same edits become a range; a different value splits it', () => {
    const rows = stagedToChanges(stage([
      ['bar', 4, 'price', 150], ['bar', 5, 'price', 150], ['bar', 6, 'price', 150], ['bar', 7, 'price', 180], ['bar', 9, 'price', 180],
    ]));
    expect(rows.map((r) => [r.dateFrom, r.dateTo, r.set?.price])).toEqual([[dec(4), dec(6), 150], [dec(7), dec(7), 180], [dec(9), dec(9), 180]]);
  });

  it('plans with the same range and edits share one row; restrictions and resets travel together', () => {
    const rows = stagedToChanges(stage([
      ['bar', 4, 'stopSell', true], ['bb', 4, 'stopSell', true],
      ['bar', 5, 'minStayArrival', 2], ['bar', 5, 'closedToArrival', true],
      ['bb', 6, 'price', 'reset'], ['bb', 6, 'minStayArrival', 'reset'],
    ]));
    expect(rows).toEqual([
      { ratePlanIds: ['bar', 'bb'], dateFrom: dec(4), dateTo: dec(4), set: { stopSell: true } },
      { ratePlanIds: ['bar'], dateFrom: dec(5), dateTo: dec(5), set: { minStayArrival: 2, closedToArrival: true } },
      { ratePlanIds: ['bb'], dateFrom: dec(6), dateTo: dec(6), reset: ['minStayArrival', 'price'] },
    ]);
  });
});

describe('bulk dialog rows', () => {
  const row = (over: Partial<BulkRow>): BulkRow => ({ ...emptyBulkRow(TODAY, ['bar']), dateFrom: dec(1), dateTo: dec(31), ...over });

  it('counts the nights on the chosen weekdays ("applies to N nights")', () => {
    expect(bulkRowNights(row({}))).toBe(31);
    expect(bulkRowNights(row({ days: ['fr', 'sa'] }))).toBe(8);
    expect(bulkRowNights(row({ dateTo: dec(3), days: ['sa'] }))).toBe(0);
  });

  it('every day selected → no weekday filter; some days → the filter', () => {
    expect(bulkRowToChange(row({ price: '120' }), TODAY).change).toEqual({ ratePlanIds: ['bar'], dateFrom: dec(1), dateTo: dec(31), set: { price: 120 } });
    expect(bulkRowToChange(row({ minStayArrival: '2', days: ['sa', 'fr'] }), TODAY).change)
      .toEqual({ ratePlanIds: ['bar'], dateFrom: dec(1), dateTo: dec(31), days: ['fr', 'sa'], set: { minStayArrival: 2 } });
  });

  it('certification test 7: CTA / CTD / min / max stay in one row', () => {
    const r = bulkRowToChange(row({ closedToArrival: 'on', closedToDeparture: 'off', minStayArrival: '3', maxStay: '7' }), TODAY);
    expect(r.change?.set).toEqual({ closedToArrival: true, closedToDeparture: false, minStayArrival: 3, maxStay: 7 });
  });

  it('resets: price back to plan; Calendar booking rules removed except the fields being set', () => {
    expect(bulkRowToChange(row({ resetPrice: true, resetRestrictions: true, stopSell: 'on' }), TODAY).change).toMatchObject({
      set: { stopSell: true }, reset: ['price', 'minStayArrival', 'maxStay', 'closedToArrival', 'closedToDeparture'],
    });
  });

  it.each<[string, Partial<BulkRow>, string]>([
    ['no plan', { ratePlanIds: [], price: '1' }, 'plans'],
    ['end before start', { dateTo: '2026-11-30', price: '1' }, 'dates'],
    ['past dates', { dateFrom: '2026-10-30', price: '1' }, 'past'],
    ['beyond two years', { dateTo: '2029-01-01', price: '1' }, 'horizon'],
    ['no weekday', { days: [], price: '1' }, 'days'],
    ['weekday outside range', { dateTo: dec(3), days: ['sa'], price: '1' }, 'noNights'],
    ['zero price', { price: '0' }, 'price'],
    ['three decimals', { price: '10.555' }, 'price'],
    ['min stay 0', { minStayArrival: '0' }, 'minStay'],
    ['max below min', { minStayArrival: '3', maxStay: '2' }, 'maxBelowMin'],
    ['nothing to change', {}, 'nothing'],
  ])('%s → error', (_n, over, error) => {
    const r = bulkRowToChange(row(over), TODAY);
    expect(r.errors).toContain(error);
    expect(r.change).toBeUndefined();
  });
});

describe('sourceMark', () => {
  it('marks named rules and Calendar edits, not plan prices or defaults', () => {
    expect(sourceMark({ kind: 'plan' })).toBe('none');
    expect(sourceMark({ kind: 'default' })).toBe('none');
    expect(sourceMark({ kind: 'rule', ruleId: 'r', origin: 'manual', name: 'Temporada alta' })).toBe('named');
    expect(sourceMark({ kind: 'booking_rule', ruleId: 'r', origin: 'calendar' })).toBe('calendar');
  });
});
