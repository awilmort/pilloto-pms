/**
 * Booking rules (services/restrictionRules.ts + RateResolver integration), plan Phase 4.2.
 * 2026-11-02 is a Monday.
 */

import {
  resolveRestrictionsOn, ruleCoversPlan, sortNewestFirst, restrictionRuleProblems, summarizeRestrictionRule,
  RestrictionRuleLike, DEFAULT_RESTRICTIONS,
} from '../services/restrictionRules';
import { resolveRatesFrom } from '../services/channex/rateResolver';
import RestrictionRule from '../models/RestrictionRule';

let seq = 0;
const rule = (over: Partial<RestrictionRuleLike>): RestrictionRuleLike => ({
  _id: `rr${++seq}`, name: `rule ${seq}`, scope: 'property', roomTypeIds: [], ratePlanIds: [], days: [],
  dateStart: '2026-11-01', dateEnd: '2026-11-30', isActive: true, updatedAt: new Date(Date.UTC(2026, 9, 1, 0, seq)),
  ...over,
});

const TWIN = { ratePlanId: 'bar-twin', roomTypeId: 'rt-twin' };
const TWIN_BB = { ratePlanId: 'bb-twin', roomTypeId: 'rt-twin' };
const DOUBLE = { ratePlanId: 'bar-double', roomTypeId: 'rt-double' };

/** Resolve one plan/date the way RateResolver does: scope filter, newest first. */
const resolveFor = (rules: RestrictionRuleLike[], target: typeof TWIN, date: string) =>
  resolveRestrictionsOn(sortNewestFirst(rules.filter((r) => ruleCoversPlan(r, target))), date);

describe('scope', () => {
  const rules = [
    rule({ name: 'house', scope: 'property', minStayArrival: 2 }),
    rule({ name: 'twins', scope: 'room_types', roomTypeIds: ['rt-twin'], closedToArrival: true }),
    rule({ name: 'bb', scope: 'rate_plans', ratePlanIds: ['bb-twin'], stopSell: true }),
  ];

  it('property-scoped rules apply to every rate plan', () => {
    for (const t of [TWIN, TWIN_BB, DOUBLE]) expect(resolveFor(rules, t, '2026-11-04').values.minStayArrival).toBe(2);
  });

  it('room-type-scoped rules apply to every plan of that room type only', () => {
    expect(resolveFor(rules, TWIN, '2026-11-04').values.closedToArrival).toBe(true);
    expect(resolveFor(rules, TWIN_BB, '2026-11-04').values.closedToArrival).toBe(true);
    expect(resolveFor(rules, DOUBLE, '2026-11-04').values.closedToArrival).toBe(false);
  });

  it('rate-plan-scoped rules apply to that plan only', () => {
    expect(resolveFor(rules, TWIN_BB, '2026-11-04').values.stopSell).toBe(true);
    expect(resolveFor(rules, TWIN, '2026-11-04').values.stopSell).toBe(false);
  });
});

describe('dates and weekdays', () => {
  it('outside its range a rule has no effect (defaults)', () => {
    const r = [rule({ minStayArrival: 3, dateStart: '2026-11-10', dateEnd: '2026-11-12' })];
    expect(resolveFor(r, TWIN, '2026-11-09').values).toEqual(DEFAULT_RESTRICTIONS);
    expect(resolveFor(r, TWIN, '2026-11-10').values.minStayArrival).toBe(3);
    expect(resolveFor(r, TWIN, '2026-11-12').values.minStayArrival).toBe(3);
    expect(resolveFor(r, TWIN, '2026-11-13').values.minStayArrival).toBe(1);
  });

  it('weekday filters restrict a rule to those days', () => {
    const r = [rule({ name: 'weekend min 2', minStayArrival: 2, days: ['fr', 'sa'] })];
    const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
    expect(week.map((d) => resolveFor(r, TWIN, d).values.minStayArrival)).toEqual([1, 1, 1, 1, 2, 2, 1]);
  });

  it('inactive rules are ignored', () => {
    expect(resolveFor([rule({ stopSell: true, isActive: false })], TWIN, '2026-11-04').values.stopSell).toBe(false);
  });
});

describe('newest wins, per field', () => {
  it('a newer "open again" rule overrides an older "closed" rule', () => {
    const closed = rule({ name: 'closed', stopSell: true, updatedAt: new Date('2026-10-01') });
    const reopen = rule({ name: 'open again', stopSell: false, dateStart: '2026-11-04', dateEnd: '2026-11-05', updatedAt: new Date('2026-10-02') });
    const r = [closed, reopen];
    expect(resolveFor(r, TWIN, '2026-11-03').values.stopSell).toBe(true);
    expect(resolveFor(r, TWIN, '2026-11-04').values.stopSell).toBe(false);
    expect(resolveFor(r, TWIN, '2026-11-04').sources.stopSell?.name).toBe('open again');
    expect(resolveFor(r, TWIN, '2026-11-06').values.stopSell).toBe(true);
  });

  it('…but an older "open" does not override a newer "closed"', () => {
    const reopen = rule({ stopSell: false, updatedAt: new Date('2026-10-01') });
    const closed = rule({ stopSell: true, updatedAt: new Date('2026-10-02') });
    expect(resolveFor([reopen, closed], TWIN, '2026-11-04').values.stopSell).toBe(true);
  });

  it('field independence: a newer min-stay rule does not reset a CTA from an older rule', () => {
    const cta = rule({ name: 'no arrivals', closedToArrival: true, updatedAt: new Date('2026-10-01') });
    const minStay = rule({ name: 'min 3', minStayArrival: 3, updatedAt: new Date('2026-10-05') });
    const { values, sources } = resolveFor([cta, minStay], TWIN, '2026-11-04');
    expect(values).toMatchObject({ closedToArrival: true, minStayArrival: 3, maxStay: 0, closedToDeparture: false, stopSell: false });
    expect(sources.closedToArrival?.name).toBe('no arrivals');
    expect(sources.minStayArrival?.name).toBe('min 3');
    expect(sources.maxStay).toBeUndefined();
  });

  it('a narrow-scope newer rule beats a property rule for its plan only', () => {
    const house = rule({ minStayArrival: 2, updatedAt: new Date('2026-10-01') });
    const twinRule = rule({ scope: 'room_types', roomTypeIds: ['rt-twin'], minStayArrival: 4, updatedAt: new Date('2026-10-02') });
    expect(resolveFor([house, twinRule], TWIN, '2026-11-04').values.minStayArrival).toBe(4);
    expect(resolveFor([house, twinRule], DOUBLE, '2026-11-04').values.minStayArrival).toBe(2);
  });

  it('all five fields from separate rules combine', () => {
    const r = [
      rule({ minStayArrival: 2 }), rule({ maxStay: 7 }), rule({ closedToArrival: true }),
      rule({ closedToDeparture: true }), rule({ stopSell: true }),
    ];
    expect(resolveFor(r, TWIN, '2026-11-04').values).toEqual({ minStayArrival: 2, maxStay: 7, closedToArrival: true, closedToDeparture: true, stopSell: true });
  });
});

describe('RateResolver integration', () => {
  const plans = [
    { _id: 'bar-twin', name: 'BAR', roomTypeId: 'rt-twin', basePrice: 100, isActive: true, occupancyTiers: [] },
    { _id: 'bar-double', name: 'BAR D', roomTypeId: 'rt-double', basePrice: 120, isActive: true, occupancyTiers: [] },
  ];
  const roomTypes = [{ _id: 'rt-twin', capacity: 2, isActive: true }, { _id: 'rt-double', capacity: 2, isActive: true }];
  const resolve = (restrictionRules: RestrictionRuleLike[], ratePlans: any[] = plans) => resolveRatesFrom({
    dateFrom: '2026-11-02', dateTo: '2026-11-08', ratePlans, roomTypes, pricingRules: [], restrictionRules,
  });

  it('resolves restrictions per plan and tags their source', () => {
    const r = resolve([
      rule({ name: 'Fines de semana mínimo 2', minStayArrival: 2, days: ['fr', 'sa'] }),
      rule({ name: 'Twin cerrado', scope: 'room_types', roomTypeIds: ['rt-twin'], stopSell: true, dateStart: '2026-11-04', dateEnd: '2026-11-04' }),
    ]);
    expect(r['bar-twin']['2026-11-06']).toMatchObject({ minStayArrival: 2, stopSell: false });
    expect(r['bar-twin']['2026-11-06'].restrictionSources.minStayArrival).toMatchObject({ kind: 'booking_rule', name: 'Fines de semana mínimo 2' });
    expect(r['bar-twin']['2026-11-06'].restrictionSources.maxStay).toEqual({ kind: 'default' });
    expect(r['bar-twin']['2026-11-04'].stopSell).toBe(true);
    expect(r['bar-double']['2026-11-04'].stopSell).toBe(false);
  });

  it('an "open for sale" booking rule cannot lift a forced stop sell', () => {
    const r = resolve([rule({ stopSell: false })], [{ ...plans[0], isActive: false }]);
    expect(r['bar-twin']['2026-11-04']).toMatchObject({ stopSell: true, forcedStopSell: 'rate_plan_inactive' });
  });
});

describe('validation', () => {
  const today = '2026-10-28';
  const ok = { scope: 'property', dateStart: '2026-11-01', dateEnd: '2026-11-30', minStayArrival: 2 };

  it('accepts a valid rule', () => {
    expect(restrictionRuleProblems(ok, today)).toEqual([]);
  });

  it.each([
    ['end before start', { dateStart: '2026-11-30', dateEnd: '2026-11-01' }, /on or after the start/],
    ['bad date', { dateStart: '2026-02-30' }, /YYYY-MM-DD/],
    ['more than 730 days ahead', { dateEnd: '2028-10-28' }, /up to 730 days ahead \(until 2028-10-27\)/],
    ['no restriction set', { minStayArrival: undefined }, /at least one booking rule/],
    ['min stay 0', { minStayArrival: 0 }, /Minimum stay/],
    ['min stay fractional', { minStayArrival: 1.5 }, /Minimum stay/],
    ['max stay > 730', { maxStay: 800 }, /Maximum stay/],
    ['max shorter than min', { minStayArrival: 5, maxStay: 3 }, /cannot be shorter/],
    ['property scope with ids', { roomTypeIds: ['x'] }, /whole-property rule/],
    ['room-type scope without ids', { scope: 'room_types' }, /at least one room type/],
    ['rate-plan scope with room types', { scope: 'rate_plans', ratePlanIds: ['p'], roomTypeIds: ['x'] }, /at least one rate plan/],
    ['unknown weekday', { days: ['xx'] }, /Unknown weekday/],
    ['non-boolean flag', { closedToArrival: 'yes' as any }, /true or false/],
  ])('%s', (_name, over, message) => {
    expect(restrictionRuleProblems({ ...ok, ...over } as any, today).join(' ')).toMatch(message);
  });

  it('max stay 0 (no maximum) is valid with any minimum', () => {
    expect(restrictionRuleProblems({ ...ok, minStayArrival: 5, maxStay: 0 }, today)).toEqual([]);
  });

  it('the model enforces the same rules on save (validation hook)', async () => {
    const doc = new RestrictionRule({ name: 'x', dateStart: '2026-11-30', dateEnd: '2026-11-01', minStayArrival: 2 });
    await expect(doc.validate()).rejects.toThrow(/on or after the start/);
    await expect(new RestrictionRule({ name: 'ok', dateStart: '2026-11-01', dateEnd: '2026-11-30', stopSell: true }).validate()).resolves.toBeUndefined();
  });
});

describe('plain-language summaries', () => {
  const names = { roomTypes: { 'rt-twin': 'Twin', 'rt-double': 'Double' }, ratePlans: { bar: 'BAR', bb: 'Bed & Breakfast' } };
  const base = { dateStart: '2026-12-15', dateEnd: '2027-04-15' };

  it('the architecture example', () => {
    expect(summarizeRestrictionRule({ ...base, minStayArrival: 2, days: ['sa', 'fr'] }, 'es'))
      .toBe('Mínimo 2 noches para llegadas viernes y sábado, 15 dic 2026 – 15 abr 2027, todas las habitaciones');
    expect(summarizeRestrictionRule({ ...base, minStayArrival: 2, days: ['fr', 'sa'] }, 'en'))
      .toBe('Minimum 2 nights for arrivals on Friday and Saturday, 15 Dec 2026 – 15 Apr 2027, all rooms');
  });

  it.each([
    ['min stay 1', { minStayArrival: 1 }, 'Sin mínimo de noches', 'No minimum stay'],
    ['max stay', { maxStay: 7 }, 'Máximo 7 noches', 'Maximum 7 nights'],
    ['max stay 1', { maxStay: 1 }, 'Máximo 1 noche', 'Maximum 1 night'],
    ['no max stay', { maxStay: 0 }, 'Sin máximo de noches', 'No maximum stay'],
    ['CTA', { closedToArrival: true }, 'Sin llegadas', 'No arrivals'],
    ['CTA off', { closedToArrival: false }, 'Llegadas permitidas', 'Arrivals allowed'],
    ['CTD', { closedToDeparture: true }, 'Sin salidas', 'No departures'],
    ['CTD off', { closedToDeparture: false }, 'Salidas permitidas', 'Departures allowed'],
    ['stop sell', { stopSell: true }, 'Cerrado a la venta', 'Closed to sale'],
    ['open', { stopSell: false }, 'Abierto a la venta', 'Open for sale'],
  ])('%s', (_name, over, es, en) => {
    const r = { dateStart: '2026-11-04', dateEnd: '2026-11-04', ...over };
    expect(summarizeRestrictionRule(r, 'es')).toBe(`${es}, 4 nov 2026, todas las habitaciones`);
    expect(summarizeRestrictionRule(r, 'en')).toBe(`${en}, 4 Nov 2026, all rooms`);
  });

  it('weekdays on non-stay restrictions, same-year ranges, several restrictions', () => {
    const r = { dateStart: '2026-11-01', dateEnd: '2026-11-30', closedToArrival: true, stopSell: true, days: ['su' as const] };
    expect(summarizeRestrictionRule(r, 'es')).toBe('Sin llegadas los domingos; cerrado a la venta los domingos, 1 nov – 30 nov 2026, todas las habitaciones');
    expect(summarizeRestrictionRule(r, 'en')).toBe('No arrivals on Sundays; closed to sale on Sundays, 1 Nov – 30 Nov 2026, all rooms');
  });

  it('scopes name the room types and rate plans', () => {
    expect(summarizeRestrictionRule({ ...base, stopSell: true, scope: 'room_types', roomTypeIds: ['rt-twin', 'rt-double'] }, 'es', names))
      .toBe('Cerrado a la venta, 15 dic 2026 – 15 abr 2027, habitaciones Twin y Double');
    expect(summarizeRestrictionRule({ ...base, stopSell: true, scope: 'rate_plans', ratePlanIds: ['bb'] }, 'en', names))
      .toBe('Closed to sale, 15 Dec 2026 – 15 Apr 2027, Bed & Breakfast rate');
    expect(summarizeRestrictionRule({ ...base, stopSell: true, scope: 'rate_plans', ratePlanIds: ['bar', 'bb'] }, 'es', names))
      .toBe('Cerrado a la venta, 15 dic 2026 – 15 abr 2027, tarifas BAR y Bed & Breakfast');
    expect(summarizeRestrictionRule({ ...base, stopSell: true, scope: 'room_types', roomTypeIds: ['a', 'b'] }, 'en'))
      .toBe('Closed to sale, 15 Dec 2026 – 15 Apr 2027, 2 room types');
  });

  it('recurring weekdays use the plural (los viernes y sábados)', () => {
    expect(summarizeRestrictionRule({ dateStart: '2026-11-04', dateEnd: '2026-11-04', closedToDeparture: true, days: ['fr', 'sa'] }, 'es'))
      .toBe('Sin salidas los viernes y sábados, 4 nov 2026, todas las habitaciones');
  });

  it('every weekday selected reads as no weekday filter', () => {
    expect(summarizeRestrictionRule({ dateStart: '2026-11-04', dateEnd: '2026-11-04', minStayArrival: 3, days: ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] }, 'es'))
      .toBe('Mínimo 3 noches, 4 nov 2026, todas las habitaciones');
  });
});
