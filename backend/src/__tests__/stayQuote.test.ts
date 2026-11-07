/**
 * Booking rules and per-night prices in Pilloto's own booking paths (plan Phase 4.5).
 * Pure `stayViolations`, `quoteStayFrom`, `publicOffersFrom` and `explainNight` — no database.
 * December 2026: Tue 1, Fri 4, Sat 5, Sun 6, Mon 7, Tue 8.
 */

import { stayViolations, describeStayViolation, DEFAULT_RESTRICTIONS, RestrictionDays } from '../services/restrictionRules';
import { checkStayFrom, quoteStayFrom, toStay, violationMessages, StayContext } from '../services/stayQuote';
import { publicOffersFrom, rateOptionsFrom } from '../services/ratePlanSelection';
import { resolveRatesFrom } from '../services/channex/rateResolver';
import { computeStayTaxes } from '../utils/pricing';
import { explainNight } from '../services/channex/inventory.service';
import { fromChannexDate as D } from '../services/channex/dates';

const dec = (d: number) => `2026-12-${String(d).padStart(2, '0')}`;
const stay = (from: number, to: number) => ({ checkIn: dec(from), checkOut: dec(to) });

// ─── stayViolations ──────────────────────────────────────────────────────────

describe('stayViolations', () => {
  const days = (over: Record<number, Partial<typeof DEFAULT_RESTRICTIONS>>): RestrictionDays =>
    Object.fromEntries(Object.entries(over).map(([d, v]) => [dec(Number(d)), { ...DEFAULT_RESTRICTIONS, ...v }]));

  it('no rules → bookable', () => {
    expect(stayViolations({}, dec(4), dec(6))).toEqual([]);
  });

  it('stop sell on any night of the stay (not on the departure date)', () => {
    expect(stayViolations(days({ 5: { stopSell: true } }), dec(4), dec(6))).toEqual([{ code: 'stop_sell', dates: [dec(5)], nights: 2 }]);
    expect(stayViolations(days({ 6: { stopSell: true } }), dec(4), dec(6))).toEqual([]);
  });

  it('no arrivals: only on the arrival date — a stay that started before is unaffected', () => {
    expect(stayViolations(days({ 4: { closedToArrival: true } }), dec(4), dec(6))).toMatchObject([{ code: 'closed_to_arrival', dates: [dec(4)] }]);
    expect(stayViolations(days({ 5: { closedToArrival: true } }), dec(4), dec(7))).toEqual([]);
  });

  it('no departures: only on the departure date', () => {
    expect(stayViolations(days({ 6: { closedToDeparture: true } }), dec(4), dec(6))).toMatchObject([{ code: 'closed_to_departure', dates: [dec(6)] }]);
    expect(stayViolations(days({ 5: { closedToDeparture: true } }), dec(4), dec(6))).toEqual([]);
  });

  it('minimum and maximum stay are read on the arrival date only', () => {
    const rules = days({ 4: { minStayArrival: 3 }, 5: { minStayArrival: 5 } });
    expect(stayViolations(rules, dec(4), dec(6))).toEqual([{ code: 'min_stay', limit: 3, nights: 2 }]);
    expect(stayViolations(rules, dec(4), dec(7))).toEqual([]);           // 3 nights from Fri: ok, Sat's 5 is ignored
    expect(stayViolations(days({ 4: { maxStay: 2 } }), dec(4), dec(7))).toEqual([{ code: 'max_stay', limit: 2, nights: 3 }]);
    expect(stayViolations(days({ 4: { maxStay: 0 } }), dec(4), dec(30))).toEqual([]); // 0 = no maximum
  });

  it('describes each violation in Spanish and English', () => {
    expect(describeStayViolation({ code: 'stop_sell', dates: [dec(5)], nights: 2 }, 'es')).toBe('Cerrado a la venta: 5 dic 2026.');
    expect(describeStayViolation({ code: 'closed_to_arrival', dates: [dec(4)], nights: 2 }, 'en')).toBe('No arrivals allowed on 4 Dec 2026.');
    expect(describeStayViolation({ code: 'closed_to_departure', dates: [dec(6)], nights: 2 }, 'es')).toBe('No se permiten salidas el 6 dic 2026.');
    expect(describeStayViolation({ code: 'min_stay', limit: 3, nights: 2 }, 'es')).toBe('Llegando ese día la estancia mínima es de 3 noches (esta reserva tiene 2 noches).');
    expect(describeStayViolation({ code: 'max_stay', limit: 2, nights: 3 }, 'en')).toBe('Arriving that day, the maximum stay is 2 nights (this booking has 3 nights).');
    expect(describeStayViolation({ code: 'stop_sell', dates: [1, 2, 3, 4, 5].map(dec), nights: 6 }, 'en')).toBe('Closed to sale: 1 Dec 2026, 2 Dec 2026, 3 Dec 2026 and 2 more.');
  });
});

// ─── Stay quotes ─────────────────────────────────────────────────────────────

const twin = { _id: 'rt-twin', name: 'Twin', capacity: 2, isActive: true };
const tiers = [
  { guestType: 'adult' as const, guestNumber: 1, price: 0 },
  { guestType: 'adult' as const, guestNumber: 2, price: 20 },
  { guestType: 'child' as const, guestNumber: 1, price: 10 },
];
const bar = { _id: 'bar', name: 'BAR', roomTypeId: 'rt-twin', basePrice: 100, isActive: true, occupancyTiers: tiers };
const bb = { _id: 'bb', name: 'B&B', roomTypeId: 'rt-twin', basePrice: 120, isActive: true, occupancyTiers: [] as any[] };

let seq = 0;
const promo = (over: Record<string, any>): any => ({
  _id: `pr${++seq}`, name: `rule ${seq}`, ratePlanId: 'bar', ruleTarget: 'promotional', periodPattern: 'all_days',
  isActive: true, origin: 'manual', updatedAt: new Date(2026, 0, 1), ...over,
});
const booking = (over: Record<string, any>): any => ({
  _id: `br${++seq}`, name: `booking rule ${seq}`, scope: 'property', days: [], isActive: true, updatedAt: new Date(2026, 0, 1), ...over,
});
const ctx = (over: Partial<StayContext> = {}): StayContext => ({
  ratePlans: [bar, bb], roomTypes: [twin], pricingRules: [], restrictionRules: [], taxes: [], ...over,
});
const party = (adults = 2, children = 0, rooms = 1) => ({ adults, children, rooms });

describe('quoteStayFrom: night-by-night prices', () => {
  it('no rules → plan price × nights, with the nightly breakdown', () => {
    const q = quoteStayFrom(ctx(), 'bar', stay(4, 7), party())!;
    expect(q.nightly.map((n) => n.price)).toEqual([120, 120, 120]);
    expect(q).toMatchObject({ nights: 3, adjustedSubtotal: 360, finalTotal: 360, totalTaxes: 0, violations: [], appliedRule: null });
    expect(q.ratePlan).toEqual({ _id: 'bar', name: 'BAR', roomTypeId: 'rt-twin', roomTypeName: 'Twin' });
  });

  it('a calendar price on one night changes only that night of the stay', () => {
    const cal = promo({ origin: 'calendar', ruleModel: 'custom', customBasePrice: 333, dateStart: D(dec(5)), dateEnd: D(dec(5)) });
    const q = quoteStayFrom(ctx({ pricingRules: [cal] }), 'bar', stay(4, 7), party())!;
    expect(q.nightly.map((n) => n.price)).toEqual([120, 353, 120]); // 333 + 2nd-adult tier
    expect(q.nightly[1].source).toMatchObject({ kind: 'rule', origin: 'calendar' });
    expect(q.adjustedSubtotal).toBe(593);
  });

  it('a calendar adjustment beats a season on its night; the season applies on the others', () => {
    const season = promo({ ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'base', dateStart: D(dec(1)), dateEnd: D(dec(31)) });
    const cal = promo({ origin: 'calendar', ruleModel: 'custom', customBasePrice: 200, dateStart: D(dec(5)), dateEnd: D(dec(5)) });
    const q = quoteStayFrom(ctx({ pricingRules: [season, cal] }), 'bar', stay(4, 6), party())!;
    expect(q.nightly.map((n) => n.price)).toEqual([110, 220]);
  });

  it('for one room without children, each night equals the rate OTAs receive for that occupancy', () => {
    const rules = [
      promo({ ruleModel: 'percentage', direction: 'discount', value: 15, scope: 'both', periodPattern: 'weekends', dateStart: D(dec(1)), dateEnd: D(dec(31)) }),
      promo({ origin: 'calendar', ruleModel: 'custom', customBasePrice: 99.99, dateStart: D(dec(7)), dateEnd: D(dec(8)) }),
    ];
    const c = ctx({ pricingRules: rules });
    const channel = resolveRatesFrom({ dateFrom: dec(1), dateTo: dec(9), ...c });
    for (const adults of [1, 2]) {
      const q = quoteStayFrom(c, 'bar', stay(1, 10), party(adults))!;
      expect(q.nightly.map((n) => Math.round(n.price * 100))).toEqual(q.nightly.map((n) => channel.bar[n.date].rates[adults]));
    }
  });

  it('children and several rooms are priced with the plan tiers and guest split', () => {
    expect(quoteStayFrom(ctx(), 'bar', stay(4, 5), party(2, 1))!.adjustedSubtotal).toBe(130);
    expect(quoteStayFrom(ctx(), 'bar', stay(4, 5), party(2, 0, 2))!.adjustedSubtotal).toBe(200); // 1 adult per room
  });

  it('a long-stay rule applies only to stays long enough (OTAs never receive it)', () => {
    const weekly = promo({ ruleModel: 'percentage', direction: 'discount', value: 50, scope: 'both', minimumNights: 3 });
    const c = ctx({ pricingRules: [weekly] });
    expect(quoteStayFrom(c, 'bar', stay(4, 6), party())!.adjustedSubtotal).toBe(240);
    expect(quoteStayFrom(c, 'bar', stay(4, 7), party())!.adjustedSubtotal).toBe(180);
    expect(resolveRatesFrom({ dateFrom: dec(4), dateTo: dec(4), ...c }).bar[dec(4)].rates[2]).toBe(12000);
  });

  it('guest and company rules never reach the booking engine', () => {
    const company = promo({ ruleTarget: 'company', ruleModel: 'custom', customBasePrice: 1 });
    expect(quoteStayFrom(ctx({ pricingRules: [company] }), 'bar', stay(4, 5), party())!.adjustedSubtotal).toBe(120);
  });

  it('taxes are computed on the stay the same way as calculateTieredPrice', () => {
    const taxes = [
      { name: 'ITBIS', type: 'percentage', value: 18, appliesTo: 'room', isInclusive: false },
      { name: 'Servicio', type: 'percentage', value: 10, appliesTo: 'room', isInclusive: false },
      { name: 'Incluido', type: 'percentage', value: 5, appliesTo: 'room', isInclusive: true },
      { name: 'Tasa', type: 'fixed', value: 2, appliesTo: 'guest', isInclusive: false },
    ];
    const q = quoteStayFrom(ctx({ taxes }), 'bar', stay(4, 6), party())!;
    const expected = computeStayTaxes(taxes, { adjustedSubtotal: 240, adults: 2, children: 0, rooms: 1, nights: 2 });
    expect(q.taxes.map((t) => t.amount)).toEqual([43.2, 24, 12, 8]);
    expect(q.totalTaxes).toBeCloseTo(expected.totalExclusive, 10); // rounded to cents
    expect(q.totalTaxes).toBe(75.2);
    expect(q.finalTotal).toBe(315.2);
  });
});

describe('booking rules hide plans in the booking engine', () => {
  const offers = (c: StayContext, s = stay(4, 6)) => publicOffersFrom(c, 'rt-twin', s, party());
  const closed = (c: StayContext, s = stay(4, 6)) =>
    rateOptionsFrom(c, 'rt-twin', s, party(), { audience: 'public' }).filter((o) => !o.bookable);

  it('with no rules every plan is offered, cheapest first', () => {
    // Same total (BAR 100 + 20 for the 2nd adult = B&B 120): ties are ordered by name
    expect(offers(ctx()).map((o) => [o.name, o.quote.finalTotal])).toEqual([['B&B', 240], ['BAR', 240]]);
  });

  it.each([
    ['stop sell on a night', { stopSell: true, dateStart: dec(5), dateEnd: dec(5) }, 'stop_sell'],
    ['no arrivals on the arrival date', { closedToArrival: true, dateStart: dec(4), dateEnd: dec(4) }, 'closed_to_arrival'],
    ['no departures on the departure date', { closedToDeparture: true, dateStart: dec(6), dateEnd: dec(6) }, 'closed_to_departure'],
    ['minimum stay longer than the stay', { minStayArrival: 3, dateStart: dec(1), dateEnd: dec(31) }, 'min_stay'],
    ['maximum stay shorter than the stay', { maxStay: 1, dateStart: dec(1), dateEnd: dec(31) }, 'max_stay'],
  ])('%s hides that plan; the other plan is still offered', (_n, rule, code) => {
    const onBB = booking({ scope: 'rate_plans', ratePlanIds: ['bb'], ...rule });
    const c = ctx({ restrictionRules: [onBB] });
    expect(offers(c).map((o) => o.ratePlanId)).toEqual(['bar']);
    expect(closed(c).map((o) => [o.ratePlanId, o.quote.violations.map((v) => v.code)])).toEqual([['bb', [code]]]);

    const everywhere = booking({ ...rule });
    const none = ctx({ restrictionRules: [everywhere] });
    expect(offers(none)).toEqual([]);
    expect(closed(none)).toHaveLength(2);
    expect(violationMessages(closed(none)[0].quote.violations)?.en).toBeTruthy();
  });

  it('a newer "open again" rule makes the plan bookable again', () => {
    const closed = booking({ stopSell: true, dateStart: dec(1), dateEnd: dec(31), updatedAt: new Date(2026, 0, 1) });
    const open = booking({ stopSell: false, dateStart: dec(5), dateEnd: dec(5), updatedAt: new Date(2026, 0, 2) });
    expect(offers(ctx({ restrictionRules: [closed, open] }), stay(5, 6)).map((o) => o.name)).toEqual(['B&B', 'BAR']);
    expect(offers(ctx({ restrictionRules: [closed, open] }), stay(4, 6))).toEqual([]);
  });

  it('inactive plans and zero prices are never offered', () => {
    const c = ctx({ ratePlans: [{ ...bar, isActive: false }, { ...bb, basePrice: 0 }] });
    expect(offers(c)).toEqual([]);
    expect(checkStayFrom(c, 'bar', stay(4, 6))).toMatchObject([{ code: 'stop_sell' }]); // staff see why
  });

  it('a stay given as Dates (noon UTC) or ISO strings maps to the same calendar dates', () => {
    expect(toStay(D(dec(4)), D(dec(6)))).toEqual(stay(4, 6));
    expect(toStay('2026-12-04', '2026-12-06T00:00:00.000Z')).toEqual(stay(4, 6));
  });
});

// ─── explainNight ("why?" in the Calendar) ───────────────────────────────────

describe('explainNight', () => {
  const rooms = [
    { _id: 't1', roomTypeId: 'TWIN', status: 'active' },
    { _id: 't2', roomTypeId: 'TWIN', status: 'active' },
    { _id: 't3', roomTypeId: 'TWIN', status: 'active' },
    { _id: 't4', roomTypeId: 'TWIN', status: 'inactive' },
    { _id: 'd1', roomTypeId: 'DOUBLE', status: 'active' },
  ];
  const r = (id: string, over: Record<string, any>) => ({ _id: id, status: 'confirmed', checkInDate: D(dec(4)), checkOutDate: D(dec(6)), ...over });

  it('lists each active room as free, out of service or booked, and bookings waiting for a room', () => {
    const data = {
      rooms,
      blocks: [{ _id: 'b1', roomId: 't1', startDate: D(dec(5)), endDate: D(dec(7)) }],
      reservations: [
        r('assigned', { room: 't2', items: [{ kind: 'room', roomTypeId: 'TWIN' }] }),
        r('waiting', { items: [{ kind: 'room', roomTypeId: 'TWIN', quantity: 2 }] }),
        r('upgrade', { room: 'd1', items: [{ kind: 'room', roomTypeId: 'TWIN' }] }), // Twin booking in the Double
        r('cancelled', { status: 'cancelled', items: [{ kind: 'room', roomTypeId: 'TWIN' }] }),
      ],
    };
    const why = explainNight(data as any, 'TWIN', dec(5));
    expect(why.rooms).toEqual([
      { roomId: 't1', state: 'blocked', blockId: 'b1' },
      { roomId: 't2', state: 'assigned', reservationId: 'assigned' },
      { roomId: 't3', state: 'free' },
    ]);
    expect(why.unassigned).toEqual([{ reservationId: 'waiting', count: 2 }]);
    // The night before the block, t1 is free; after check-out, nothing is held
    expect(explainNight(data as any, 'TWIN', dec(4)).rooms[0]).toEqual({ roomId: 't1', state: 'free' });
    expect(explainNight(data as any, 'TWIN', dec(6)).unassigned).toEqual([]);
  });
});
