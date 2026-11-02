/**
 * RateResolver core (services/channex/rateResolver.ts, plan Phase 4.1).
 * Pure `resolveRatesFrom` — no database. Dates are YYYY-MM-DD; 2026-11-02 is a Monday.
 */

import { resolveRatesFrom, ResolveRatesInput, toCents, exclusiveNightTaxes } from '../services/channex/rateResolver';
import { compareRules, selectBestRule } from '../utils/pricing';

const D = (s: string) => new Date(`${s}T12:00:00.000Z`);

const twin = { _id: 'rt-twin', capacity: 2, isActive: true };
const family = { _id: 'rt-fam', capacity: 4, isActive: true };
const bar = { _id: 'bar', name: 'BAR', roomTypeId: 'rt-twin', basePrice: 100, isActive: true, occupancyTiers: [] as any[] };
const famPlan = {
  _id: 'fam', name: 'Family', roomTypeId: 'rt-fam', basePrice: 150, isActive: true,
  occupancyTiers: [
    { guestType: 'adult' as const, guestNumber: 1, price: 0 },
    { guestType: 'adult' as const, guestNumber: 2, price: 20 },
    { guestType: 'adult' as const, guestNumber: 3, price: 30 },
    { guestType: 'child' as const, guestNumber: 1, price: 10 },
  ],
};

let seq = 0;
const promo = (over: Record<string, any>): any => ({
  _id: `pr${++seq}`, name: `rule ${seq}`, ratePlanId: 'bar', ruleTarget: 'promotional', periodPattern: 'all_days',
  isActive: true, origin: 'manual', ...over,
});

function run(over: Partial<ResolveRatesInput> = {}, dateFrom = '2026-11-02', dateTo = '2026-11-08') {
  return resolveRatesFrom({
    dateFrom, dateTo,
    ratePlans: [bar, famPlan],
    roomTypes: [twin, family],
    pricingRules: [],
    restrictionRules: [],
    ...over,
  });
}

describe('RateResolver: prices', () => {
  it('no rules → plan price for every occupancy 1..capacity, in cents, default restrictions', () => {
    const r = run();
    expect(r.bar['2026-11-02']).toMatchObject({
      rates: { 1: 10000, 2: 10000 },
      priceSource: { kind: 'plan' },
      minStayArrival: 1, maxStay: 0, closedToArrival: false, closedToDeparture: false, stopSell: false,
    });
    expect(r.bar['2026-11-02'].forcedStopSell).toBeUndefined();
    expect(Object.keys(r.bar)).toHaveLength(7);
  });

  it('occupancy tiers give one rate per adult count (last tier repeats past the defined ones)', () => {
    expect(run().fam['2026-11-02'].rates).toEqual({ 1: 15000, 2: 17000, 3: 20000, 4: 23000 });
  });

  it.each([
    ['percentage discount on base', { ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base' }, { 1: 13500, 2: 15500, 3: 18500, 4: 21500 }],
    ['percentage surcharge on occupancy', { ruleModel: 'percentage', direction: 'surcharge', value: 50, scope: 'occupancy' }, { 1: 15000, 2: 18000, 3: 22500, 4: 27000 }],
    ['percentage discount on both', { ruleModel: 'percentage', direction: 'discount', value: 20, scope: 'both' }, { 1: 12000, 2: 13600, 3: 16000, 4: 18400 }],
    ['fixed discount on base', { ruleModel: 'fixed', direction: 'discount', value: 25, scope: 'base' }, { 1: 12500, 2: 14500, 3: 17500, 4: 20500 }],
    ['fixed surcharge on occupancy', { ruleModel: 'fixed', direction: 'surcharge', value: 5, scope: 'occupancy' }, { 1: 15500, 2: 17500, 3: 20500, 4: 23500 }],
    ['fixed discount on both', { ruleModel: 'fixed', direction: 'discount', value: 10, scope: 'both' }, { 1: 13000, 2: 15000, 3: 18000, 4: 21000 }],
    ['custom base price, plan tiers kept', { ruleModel: 'custom', customBasePrice: 90 }, { 1: 9000, 2: 11000, 3: 14000, 4: 17000 }],
    ['custom base + custom tiers', { ruleModel: 'custom', customBasePrice: 90, customOccupancyTiers: [{ guestType: 'adult', guestNumber: 1, price: 0 }, { guestType: 'adult', guestNumber: 2, price: 5 }] }, { 1: 9000, 2: 9500, 3: 10000, 4: 10500 }],
  ])('%s', (_name, rule, expected) => {
    const r = run({ pricingRules: [promo({ ratePlanId: 'fam', ...rule })] });
    expect(r.fam['2026-11-03'].rates).toEqual(expected);
    expect(r.fam['2026-11-03'].priceSource).toMatchObject({ kind: 'rule', origin: 'manual' });
  });

  it('weekday-pattern rules apply only on their days', () => {
    const r = run({
      pricingRules: [
        promo({ name: 'Weekend +20%', ruleModel: 'percentage', direction: 'surcharge', value: 20, scope: 'base', periodPattern: 'weekends' }),
        promo({ name: 'Wed only', ruleModel: 'fixed', direction: 'discount', value: 10, scope: 'base', periodPattern: 'specific_days', specificDays: [3] }),
      ],
    });
    expect(r.bar['2026-11-02'].rates[2]).toBe(10000); // Mon
    expect(r.bar['2026-11-04'].rates[2]).toBe(9000);  // Wed
    expect(r.bar['2026-11-07'].rates[2]).toBe(12000); // Sat
    expect(r.bar['2026-11-08'].rates[2]).toBe(12000); // Sun
  });

  it('blackout dates switch a season off for those nights', () => {
    const r = run({
      pricingRules: [promo({
        name: 'Season -10%', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base',
        dateStart: D('2026-11-01'), dateEnd: D('2026-11-30'), blackoutDates: [{ start: D('2026-11-04'), end: D('2026-11-05') }],
      })],
    });
    expect(['02', '03', '04', '05', '06'].map((d) => r.bar[`2026-11-${d}`].rates[2])).toEqual([9000, 9000, 10000, 10000, 9000]);
  });

  it('validity windows bound a rule', () => {
    const r = run({ pricingRules: [promo({ ruleModel: 'fixed', direction: 'discount', value: 20, scope: 'base', dateStart: D('2026-11-04'), dateEnd: D('2026-11-05') })] });
    expect(['03', '04', '05', '06'].map((d) => r.bar[`2026-11-${d}`].rates[1])).toEqual([10000, 8000, 8000, 10000]);
  });

  it('a calendar adjustment beats a seasonal promotion on the same date', () => {
    const r = run({
      pricingRules: [
        promo({ name: 'High season', ruleModel: 'percentage', direction: 'surcharge', value: 50, scope: 'base', dateStart: D('2026-11-01'), dateEnd: D('2026-11-30') }),
        promo({ name: 'Calendar', origin: 'calendar', ruleModel: 'custom', customBasePrice: 333, dateStart: D('2026-11-04'), dateEnd: D('2026-11-04'), updatedAt: D('2026-10-01') }),
      ],
    });
    expect(r.bar['2026-11-04'].rates).toEqual({ 1: 33300, 2: 33300 });
    expect(r.bar['2026-11-04'].priceSource).toMatchObject({ kind: 'rule', name: 'Calendar', origin: 'calendar' });
    expect(r.bar['2026-11-05'].rates[1]).toBe(15000);
    expect(r.bar['2026-11-05'].priceSource).toMatchObject({ name: 'High season' });
  });

  it('a calendar adjustment beats an even more specific named promotion', () => {
    const r = run({
      pricingRules: [
        promo({ name: 'Flash', ruleModel: 'custom', customBasePrice: 50, dateStart: D('2026-11-04'), dateEnd: D('2026-11-04') }),
        promo({ name: 'Calendar', origin: 'calendar', ruleModel: 'custom', customBasePrice: 120, dateStart: D('2026-11-01'), dateEnd: D('2026-11-30') }),
      ],
    });
    expect(r.bar['2026-11-04'].rates[1]).toBe(12000);
  });

  it('two overlapping calendar adjustments: the newer wins', () => {
    const r = run({
      pricingRules: [
        promo({ name: 'Old', origin: 'calendar', ruleModel: 'custom', customBasePrice: 200, dateStart: D('2026-11-02'), dateEnd: D('2026-11-06'), updatedAt: D('2026-10-01') }),
        promo({ name: 'New', origin: 'calendar', ruleModel: 'custom', customBasePrice: 250, dateStart: D('2026-11-04'), dateEnd: D('2026-11-08'), updatedAt: D('2026-10-02') }),
      ],
    });
    expect(['03', '04', '06', '07'].map((d) => r.bar[`2026-11-${d}`].rates[1])).toEqual([20000, 25000, 25000, 25000]);
  });

  it('guest and company rules never affect channel prices', () => {
    const r = run({
      pricingRules: [
        promo({ name: 'ACME', ruleTarget: 'company', companyId: 'co1', ruleModel: 'percentage', direction: 'discount', value: 30, scope: 'base' }),
        promo({ name: 'VIP', ruleTarget: 'guest', guestEmail: 'vip@example.com', ruleModel: 'custom', customBasePrice: 1 }),
      ],
    });
    expect(r.bar['2026-11-04'].rates).toEqual({ 1: 10000, 2: 10000 });
    expect(r.bar['2026-11-04'].priceSource).toEqual({ kind: 'plan' });
  });

  it('rules needing a minimum stay > 1 night are left out of nightly prices', () => {
    const r = run({ pricingRules: [promo({ name: 'Stay 3', ruleModel: 'percentage', direction: 'discount', value: 15, scope: 'base', minimumNights: 3 })] });
    expect(r.bar['2026-11-04'].rates[1]).toBe(10000);
    const r1 = run({ pricingRules: [promo({ name: 'Stay 1', ruleModel: 'percentage', direction: 'discount', value: 15, scope: 'base', minimumNights: 1 })] });
    expect(r1.bar['2026-11-04'].rates[1]).toBe(8500);
  });

  it('inactive rules are ignored', () => {
    const r = run({ pricingRules: [promo({ ruleModel: 'custom', customBasePrice: 1, isActive: false })] });
    expect(r.bar['2026-11-04'].rates[1]).toBe(10000);
  });

  it('inactive plan → stop sell on every date', () => {
    const r = run({ ratePlans: [{ ...bar, isActive: false }] });
    expect(Object.values(r.bar).every((d) => d.stopSell && d.forcedStopSell === 'rate_plan_inactive')).toBe(true);
  });

  it('inactive room type → stop sell', () => {
    const r = run({ roomTypes: [{ ...twin, isActive: false }, family] });
    expect(r.bar['2026-11-02']).toMatchObject({ stopSell: true, forcedStopSell: 'room_type_inactive' });
    expect(r.fam['2026-11-02'].stopSell).toBe(false);
  });

  it('a computed rate ≤ 0 → stop sell for that date only', () => {
    const r = run({ pricingRules: [promo({ ruleModel: 'fixed', direction: 'discount', value: 500, scope: 'base', dateStart: D('2026-11-04'), dateEnd: D('2026-11-04') })] });
    expect(r.bar['2026-11-04']).toMatchObject({ stopSell: true, forcedStopSell: 'no_price', rates: { 1: 0, 2: 0 } });
    expect(r.bar['2026-11-05'].stopSell).toBe(false);
  });

  it('one non-positive occupancy is enough to stop selling the date', () => {
    const freeSingle = { ...famPlan, basePrice: 0 }; // 1 adult = 0, 2+ adults > 0
    const r = run({ ratePlans: [freeSingle] });
    expect(r.fam['2026-11-02']).toMatchObject({ stopSell: true, forcedStopSell: 'no_price' });
    expect(r.fam['2026-11-02'].rates[2]).toBe(2000);
  });

  it('tax-inclusive mode adds exclusive taxes per night (per-stay taxes cannot be per night)', () => {
    const taxes = [
      { name: 'ITBIS', type: 'percentage', value: 18, appliesTo: 'total', isInclusive: false },
      { name: 'Service', type: 'percentage', value: 10, appliesTo: 'total', isInclusive: true },
      { name: 'Eco', type: 'fixed', value: 2, appliesTo: 'guest', isInclusive: false },
      { name: 'Levy', type: 'fixed', value: 3, appliesTo: 'room', isInclusive: false },
      { name: 'Booking fee', type: 'fixed', value: 7, appliesTo: 'total', isInclusive: false },
    ];
    expect(run({ taxes, includeTaxes: false }).bar['2026-11-02'].rates).toEqual({ 1: 10000, 2: 10000 });
    // 100 + 18 + 2/guest + 3/room
    expect(run({ taxes, includeTaxes: true }).bar['2026-11-02'].rates).toEqual({ 1: 12300, 2: 12500 });
  });

  it('a room type of capacity 1 gets a single occupancy', () => {
    const r = run({ roomTypes: [{ ...twin, capacity: 1 }, family] });
    expect(r.bar['2026-11-02'].rates).toEqual({ 1: 10000 });
  });
});

describe('rule ordering (shared with calculateTieredPrice)', () => {
  const base: any = { ruleModel: 'percentage', value: 10 };
  it('target tier first; calendar first among promotional; newest calendar first', () => {
    const company = { ...base, ruleTarget: 'company', name: 'company' };
    const named = { ...base, ruleTarget: 'promotional', name: 'named', dateStart: D('2026-11-04'), dateEnd: D('2026-11-04') };
    const calOld = { ...base, ruleTarget: 'promotional', origin: 'calendar', name: 'calOld', updatedAt: D('2026-01-01') };
    const calNew = { ...base, ruleTarget: 'promotional', origin: 'calendar', name: 'calNew', updatedAt: D('2026-02-01') };
    expect([named, calOld, company, calNew].sort(compareRules).map((r) => r.name)).toEqual(['company', 'calNew', 'calOld', 'named']);
    expect(selectBestRule([])).toBeNull();
  });
});

describe('helpers', () => {
  it('toCents rounds float noise', () => {
    expect(toCents(89.99999999)).toBe(9000);
    expect(toCents(123.455)).toBe(12346);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('exclusiveNightTaxes skips inclusive and per-stay taxes', () => {
    expect(exclusiveNightTaxes(100, 2, [
      { type: 'percentage', value: 10, appliesTo: 'total', isInclusive: true },
      { type: 'fixed', value: 5, appliesTo: 'total', isInclusive: false },
    ])).toBe(0);
  });
});
