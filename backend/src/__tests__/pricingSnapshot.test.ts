/**
 * Behaviour lock for calculateTieredPrice() (CHANNEX_IMPLEMENTATION_PLAN.md Phase 4.1).
 *
 * The snapshot was recorded against the implementation BEFORE the per-night computation was
 * extracted for RateResolver; it must keep matching. Models are faked in memory: the rule
 * query is evaluated by a small Mongo-filter matcher, so the real candidate filter
 * (validity window, channel targeting) is exercised.
 *
 * All fixture dates are noon UTC (how Pilloto stores calendar dates), so the result does not
 * depend on the machine's timezone.
 */

type Doc = Record<string, any>;

// ── Minimal Mongo filter matcher (operators used by calculateTieredPrice) ────
function get(doc: Doc, path: string) {
  return path.split('.').reduce((v: any, k) => (v == null ? undefined : v[k]), doc);
}
function eq(a: any, b: any) {
  if (a instanceof Date || b instanceof Date) return a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
  return String(a) === String(b);
}
function matchValue(value: any, cond: any): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date || typeof cond !== 'object' || cond?._bsontype === 'ObjectId' || typeof cond?.toHexString === 'function') {
    return eq(value, cond);
  }
  return Object.entries(cond).every(([op, arg]: [string, any]) => {
    switch (op) {
      case '$exists': return (value !== undefined) === arg;
      case '$lte': return value != null && new Date(value) <= new Date(arg);
      case '$gte': return value != null && new Date(value) >= new Date(arg);
      case '$in': return (arg as any[]).some((x) => eq(value, x));
      default: throw new Error(`matcher: unsupported operator ${op}`);
    }
  });
}
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return (cond as Doc[]).some((f) => matches(doc, f));
    if (key === '$and') return (cond as Doc[]).every((f) => matches(doc, f));
    return matchValue(get(doc, key), cond);
  });
}

// ── In-memory fixtures ────────────────────────────────────────────────────────
const D = (s: string) => new Date(`${s}T12:00:00.000Z`);

const roomTypes: Doc = {
  rt1: { _id: 'rt1', name: 'Twin', capacity: 2 },
  rt2: { _id: 'rt2', name: 'Family', capacity: 4 },
};

const ratePlans: Doc[] = [
  { _id: 'rp1', name: 'BAR Twin', roomTypeId: 'rt1', basePrice: 100, isActive: true, occupancyTiers: [] },
  {
    _id: 'rp2', name: 'Family Flex', roomTypeId: 'rt2', basePrice: 150, isActive: true,
    occupancyTiers: [
      { guestType: 'adult', guestNumber: 1, price: 0 },
      { guestType: 'adult', guestNumber: 2, price: 20 },
      { guestType: 'adult', guestNumber: 3, price: 35 },
      { guestType: 'child', guestNumber: 1, price: 10 },
      { guestType: 'child', guestNumber: 2, price: 15 },
    ],
  },
];

let pricingRules: Doc[] = [];
let taxes: Doc[] = [];

const rule = (over: Doc): Doc => ({
  _id: `rule-${pricingRules.length + 1}`, isActive: true, ruleTarget: 'promotional', periodPattern: 'all_days', ...over,
});

jest.mock('../models/RatePlan', () => {
  const populateRoomType = (plan: Doc | undefined) => (plan ? { ...plan, roomTypeId: roomTypes[plan.roomTypeId] } : null);
  const chain = (result: () => any) => {
    const q: any = { populate: () => q, sort: () => q, exec: async () => result() };
    return q;
  };
  return {
    __esModule: true,
    default: {
      findById: (id: string) => chain(() => populateRoomType(ratePlans.find((p) => p._id === id))),
      findOne: (f: Doc) => chain(() => populateRoomType(
        ratePlans.filter((p) => matches(p, f)).sort((a, b) => a.name.localeCompare(b.name))[0],
      )),
    },
  };
});

jest.mock('../models/PricingRule', () => {
  const actual = jest.requireActual('../models/PricingRule');
  return {
    __esModule: true,
    ...actual,
    default: { find: (f: Doc) => ({ exec: async () => pricingRules.filter((r) => matches(r, f)) }) },
  };
});

jest.mock('../models/Tax', () => ({
  __esModule: true,
  default: {
    find: (f: Doc) => ({
      sort: () => ({ exec: async () => taxes.filter((t) => matches(t, f)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)) }),
    }),
  },
}));

import { calculateTieredPrice, TieredPriceInput } from '../utils/pricing';

interface Scenario { name: string; rules?: Doc[]; taxes?: Doc[]; input: Omit<TieredPriceInput, 'date'> & { date: string } }

const scenarios: Scenario[] = [
  { name: 'no rules, base only', input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04' } },
  { name: 'no rules, occupancy tiers, 3 nights', input: { ratePlanId: 'rp2', adults: 3, children: 2, date: '2026-11-04', nights: 3 } },
  { name: 'tier fallback beyond the last defined tier', input: { ratePlanId: 'rp2', adults: 5, children: 3, date: '2026-11-04' } },
  { name: 'multi-room guest distribution', input: { ratePlanId: 'rp2', adults: 5, children: 1, date: '2026-11-04', rooms: 2, nights: 2 } },
  { name: 'plan resolved from room type', input: { roomTypeId: 'rt2', adults: 2, children: 0, date: '2026-11-04' } },
  { name: 'unknown plan', input: { ratePlanId: 'nope', adults: 2, children: 0, date: '2026-11-04' } },
  {
    name: 'percentage discount on base',
    rules: [rule({ name: '10% off base', ratePlanId: 'rp2', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base' })],
    input: { ratePlanId: 'rp2', adults: 3, children: 1, date: '2026-11-04', nights: 2 },
  },
  {
    name: 'percentage surcharge on occupancy',
    rules: [rule({ name: '+50% occ', ratePlanId: 'rp2', ruleModel: 'percentage', direction: 'surcharge', value: 50, scope: 'occupancy' })],
    input: { ratePlanId: 'rp2', adults: 3, children: 1, date: '2026-11-04' },
  },
  {
    name: 'percentage discount on both',
    rules: [rule({ name: '20% off', ratePlanId: 'rp2', ruleModel: 'percentage', direction: 'discount', value: 20, scope: 'both' })],
    input: { ratePlanId: 'rp2', adults: 2, children: 2, date: '2026-11-04' },
  },
  {
    name: 'fixed discount on base and occupancy',
    rules: [rule({ name: '-15 both', ratePlanId: 'rp2', ruleModel: 'fixed', direction: 'discount', value: 15, scope: 'both' })],
    input: { ratePlanId: 'rp2', adults: 2, children: 0, date: '2026-11-04', rooms: 2 },
  },
  {
    name: 'fixed surcharge on occupancy',
    rules: [rule({ name: '+5 occ', ratePlanId: 'rp2', ruleModel: 'fixed', direction: 'surcharge', value: 5, scope: 'occupancy' })],
    input: { ratePlanId: 'rp2', adults: 3, children: 0, date: '2026-11-04' },
  },
  {
    name: 'fixed discount larger than the price clamps to 0',
    rules: [rule({ name: '-500', ratePlanId: 'rp1', ruleModel: 'fixed', direction: 'discount', value: 500, scope: 'base' })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04' },
  },
  {
    name: 'custom base + custom adult tiers (child tiers fall back to plan)',
    rules: [rule({
      name: 'Custom', ratePlanId: 'rp2', ruleModel: 'custom', customBasePrice: 90,
      customOccupancyTiers: [{ guestType: 'adult', guestNumber: 1, price: 0 }, { guestType: 'adult', guestNumber: 2, price: 5 }],
    })],
    input: { ratePlanId: 'rp2', adults: 3, children: 1, date: '2026-11-04', rooms: 1, nights: 2 },
  },
  {
    name: 'weekend rule on a Saturday',
    rules: [rule({ name: 'Weekend +20%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'surcharge', value: 20, scope: 'base', periodPattern: 'weekends' })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-07' },
  },
  {
    name: 'weekend rule on a Wednesday (not applied)',
    rules: [rule({ name: 'Weekend +20%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'surcharge', value: 20, scope: 'base', periodPattern: 'weekends' })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04' },
  },
  {
    name: 'weekday rule on a Wednesday',
    rules: [rule({ name: 'Midweek -10', ratePlanId: 'rp1', ruleModel: 'fixed', direction: 'discount', value: 10, scope: 'base', periodPattern: 'weekdays' })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04' },
  },
  {
    name: 'specific days (Fri) on a Friday',
    rules: [rule({ name: 'Fri', ratePlanId: 'rp1', ruleModel: 'fixed', direction: 'surcharge', value: 30, scope: 'base', periodPattern: 'specific_days', specificDays: [5] })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-06' },
  },
  {
    name: 'blackout date skips the rule',
    rules: [rule({
      name: 'Season -10%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base',
      dateStart: D('2026-11-01'), dateEnd: D('2026-11-30'), blackoutDates: [{ start: D('2026-11-03'), end: D('2026-11-05') }],
    })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04' },
  },
  {
    name: 'blackout ends: rule applies the day after',
    rules: [rule({
      name: 'Season -10%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base',
      dateStart: D('2026-11-01'), dateEnd: D('2026-11-30'), blackoutDates: [{ start: D('2026-11-03'), end: D('2026-11-05') }],
    })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-06' },
  },
  {
    name: 'outside the validity window',
    rules: [rule({ name: 'Dec', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base', dateStart: D('2026-12-01'), dateEnd: D('2026-12-31') })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04' },
  },
  {
    name: 'minimum nights not met',
    rules: [rule({ name: 'Stay 3', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 15, scope: 'base', minimumNights: 3 })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04', nights: 2 },
  },
  {
    name: 'minimum nights met',
    rules: [rule({ name: 'Stay 3', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 15, scope: 'base', minimumNights: 3 })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04', nights: 3 },
  },
  {
    name: 'more specific (shorter) window wins over a season',
    rules: [
      rule({ name: 'Season -10%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base', dateStart: D('2026-11-01'), dateEnd: D('2026-11-30') }),
      rule({ name: 'Week -5%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 5, scope: 'base', dateStart: D('2026-11-02'), dateEnd: D('2026-11-08') }),
    ],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04' },
  },
  {
    name: 'same window: higher value wins, custom beats all',
    rules: [
      rule({ name: 'A -10%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base' }),
      rule({ name: 'B -20%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 20, scope: 'base' }),
      rule({ name: 'C custom', ratePlanId: 'rp1', ruleModel: 'custom', customBasePrice: 95 }),
    ],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04' },
  },
  {
    name: 'company rule ignored on the public channel',
    rules: [
      rule({ name: 'Promo -10%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base' }),
      rule({ name: 'ACME -30%', ratePlanId: 'rp1', ruleTarget: 'company', companyId: 'co1', ruleModel: 'percentage', direction: 'discount', value: 30, scope: 'base' }),
    ],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04', companyId: 'co1', channel: 'public' },
  },
  {
    name: 'company rule wins on the admin channel',
    rules: [
      rule({ name: 'Promo -10%', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base' }),
      rule({ name: 'ACME -30%', ratePlanId: 'rp1', ruleTarget: 'company', companyId: 'co1', ruleModel: 'percentage', direction: 'discount', value: 30, scope: 'base' }),
    ],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04', companyId: 'co1', channel: 'admin' },
  },
  {
    name: 'guest rule beats company rule on the admin channel',
    rules: [
      rule({ name: 'ACME -30%', ratePlanId: 'rp1', ruleTarget: 'company', companyId: 'co1', ruleModel: 'percentage', direction: 'discount', value: 30, scope: 'base' }),
      rule({ name: 'VIP -5', ratePlanId: 'rp1', ruleTarget: 'guest', guestEmail: 'vip@example.com', ruleModel: 'fixed', direction: 'discount', value: 5, scope: 'base' }),
    ],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04', companyId: 'co1', guestEmail: 'VIP@example.com', channel: 'admin' },
  },
  {
    name: 'inactive rule ignored',
    rules: [rule({ name: 'Off', ratePlanId: 'rp1', ruleModel: 'percentage', direction: 'discount', value: 50, scope: 'base', isActive: false })],
    input: { ratePlanId: 'rp1', adults: 2, children: 0, date: '2026-11-04' },
  },
  {
    name: 'taxes: exclusive percentage + inclusive + fixed per guest / room / total',
    taxes: [
      { name: 'ITBIS', type: 'percentage', value: 18, appliesTo: 'total', isInclusive: false, priority: 2, isActive: true },
      { name: 'Servicio', type: 'percentage', value: 10, appliesTo: 'total', isInclusive: true, priority: 1, isActive: true },
      { name: 'Eco fee', type: 'fixed', value: 2, appliesTo: 'guest', isInclusive: false, priority: 0, isActive: true },
      { name: 'Room levy', type: 'fixed', value: 3, appliesTo: 'room', isInclusive: false, priority: 0, isActive: true },
      { name: 'Booking fee', type: 'fixed', value: 7, appliesTo: 'total', isInclusive: false, priority: 0, isActive: true },
      { name: 'Old tax', type: 'percentage', value: 99, appliesTo: 'total', isInclusive: false, priority: 0, isActive: false },
    ],
    rules: [rule({ name: '10% off base', ratePlanId: 'rp2', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base' })],
    input: { ratePlanId: 'rp2', adults: 3, children: 1, date: '2026-11-04', nights: 2, rooms: 2 },
  },
];

describe('calculateTieredPrice behaviour lock (snapshot from before the RateResolver refactor)', () => {
  it.each(scenarios.map((s) => [s.name, s] as const))('%s', async (_name, s) => {
    pricingRules = s.rules ?? [];
    taxes = s.taxes ?? [];
    const result = await calculateTieredPrice({ ...s.input, date: D(s.input.date) });
    expect(result).toMatchSnapshot();
  });
});
