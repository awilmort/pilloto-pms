/**
 * Which rate plan a room is booked on (services/ratePlanSelection.ts) — pure, no database.
 *
 *   - staff see every active plan; guests see public plans and private plans their promo code unlocks
 *   - pre-selection: contract (guest > company) → promo code → default plan → cheapest open plan
 *     → (staff only) restricted fallback; ties broken by price then name, never storage order
 *   - negotiated rules price staff quotes night by night (and mark the quote as a contract)
 *   - room items follow the stay when its dates change (realignRoomItems)
 *
 * December 2026: Fri 4, Sat 5, Sun 6.
 */

import { quoteStayFrom, StayContext } from '../services/stayQuote';
import {
  choosePlan, compareOptions, distributeParty, mergeTaxes, planMatchesCode, planVisibleTo, pricingSnapshotFrom,
  publicOffersFrom, rateOptionsFrom, resolvePublicPlan, roomItemFrom, RateOption,
} from '../services/ratePlanSelection';
import { normalizeAccessCodes } from '../models/RatePlan';
import { realignRoomItems } from '../services/reservationRecords';
import { ratePlanPayload } from '../routes/pricing';
import { fromChannexDate as D } from '../services/channex/dates';

const dec = (d: number) => `2026-12-${String(d).padStart(2, '0')}`;
const stay = (from: number, to: number) => ({ checkIn: dec(from), checkOut: dec(to) });
const party = (adults = 2, children = 0) => ({ adults, children, rooms: 1 });

const twin = { _id: 'rt-twin', name: 'Twin', capacity: 2, isActive: true };
const plan = (over: Record<string, any>): any => ({
  roomTypeId: 'rt-twin', isActive: true, occupancyTiers: [], visibility: 'public', accessCodes: [], isDefault: false, description: '', ...over,
});
const bar = plan({ _id: 'bar', name: 'Best Available Rate', basePrice: 100 });
const bb = plan({ _id: 'bb', name: 'Bed & Breakfast Rate', basePrice: 120, description: 'Breakfast for two' });
const nr = plan({ _id: 'nr', name: 'Non-refundable', basePrice: 90 });
const vip = plan({ _id: 'vip', name: 'Friends & Family', basePrice: 70, visibility: 'private', accessCodes: ['AMIGOS'] });
const corp = plan({ _id: 'corp', name: 'Corporate', basePrice: 110, visibility: 'private' });

let seq = 0;
const rule = (over: Record<string, any>): any => ({
  _id: `r${++seq}`, name: `rule ${seq}`, ruleTarget: 'promotional', periodPattern: 'all_days', isActive: true,
  origin: 'manual', updatedAt: new Date(2026, 0, 1), ...over,
});
const booking = (over: Record<string, any>): any => ({
  _id: `br${++seq}`, name: `booking rule ${seq}`, scope: 'property', days: [], isActive: true, updatedAt: new Date(2026, 0, 1), ...over,
});
// A staff context for a company / guest (negotiated rules apply)
const ctx = (over: Partial<StayContext> = {}): StayContext => ({
  ratePlans: [bar, bb], roomTypes: [twin], pricingRules: [], restrictionRules: [], taxes: [], negotiatedRules: true, ...over,
});
const staffOptions = (c: StayContext, opts: { promoCode?: string } = {}, s = stay(4, 6)) =>
  rateOptionsFrom(c, 'rt-twin', s, party(), { audience: 'staff', ...opts });
const pick = (c: StayContext, opts: { promoCode?: string } = {}, audience: 'staff' | 'public' = 'staff') =>
  choosePlan(rateOptionsFrom(c, 'rt-twin', stay(4, 6), party(), { audience, ...opts }), audience);

describe('what each audience sees', () => {
  it('staff see every active plan, private ones included; inactive plans are never offered', () => {
    const c = ctx({ ratePlans: [bar, bb, vip, corp, plan({ _id: 'old', name: 'Old', basePrice: 50, isActive: false })] });
    expect(staffOptions(c).map((o) => o.ratePlanId).sort()).toEqual(['bar', 'bb', 'corp', 'vip']);
  });

  it('guests see public plans, plus a private plan only with one of its codes (any case, spaces trimmed)', () => {
    const c = ctx({ ratePlans: [bar, bb, vip, corp] });
    expect(publicOffersFrom(c, 'rt-twin', stay(4, 6), party()).map((o) => o.ratePlanId)).toEqual(['bar', 'bb']);
    const withCode = publicOffersFrom(c, 'rt-twin', stay(4, 6), party(), '  amigos ');
    expect(withCode.map((o) => o.ratePlanId)).toEqual(['vip', 'bar', 'bb']); // promo plans first
    expect(withCode[0].promoMatch).toBe(true);
    expect(publicOffersFrom(c, 'rt-twin', stay(4, 6), party(), 'WRONG').map((o) => o.ratePlanId)).toEqual(['bar', 'bb']);
    // a private plan without codes is staff-only
    expect(planVisibleTo(corp, 'public', 'CORP')).toBe(false);
    expect(planVisibleTo(corp, 'staff')).toBe(true);
    expect(planMatchesCode(vip, 'Amigos')).toBe(true);
    expect(planMatchesCode(vip, '')).toBe(false);
  });

  it('plans of other room types are not options', () => {
    const family = plan({ _id: 'fam', name: 'Family', basePrice: 80, roomTypeId: 'rt-family' });
    expect(staffOptions(ctx({ ratePlans: [bar, family] })).map((o) => o.ratePlanId)).toEqual(['bar']);
  });
});

describe('pre-selection order', () => {
  it('without a default the cheapest open plan is pre-selected — never storage order', () => {
    expect(pick(ctx({ ratePlans: [bb, bar] }))).toMatchObject({ option: { ratePlanId: 'bar' }, reason: 'cheapest' });
    expect(pick(ctx({ ratePlans: [bar, bb] }))).toMatchObject({ option: { ratePlanId: 'bar' }, reason: 'cheapest' });
  });

  it('the default plan beats a cheaper plan', () => {
    const c = ctx({ ratePlans: [bar, { ...bb, isDefault: true }, nr] });
    expect(pick(c)).toMatchObject({ option: { ratePlanId: 'bb' }, reason: 'default' });
  });

  it('a promo code plan beats the default plan', () => {
    const c = ctx({ ratePlans: [{ ...bar, isDefault: true }, vip] });
    expect(pick(c, { promoCode: 'AMIGOS' })).toMatchObject({ option: { ratePlanId: 'vip' }, reason: 'promo' });
    expect(pick(c, { promoCode: 'AMIGOS' }, 'public')).toMatchObject({ option: { ratePlanId: 'vip' }, reason: 'promo' });
    expect(pick(c)).toMatchObject({ option: { ratePlanId: 'bar' }, reason: 'default' });
  });

  it('a negotiated (company) price beats the promo code and the default plan', () => {
    const companyRule = rule({ ruleTarget: 'company', companyId: 'co1', ratePlanId: 'corp', ruleModel: 'percentage', direction: 'discount', value: 10, scope: 'both' });
    const c = ctx({ ratePlans: [{ ...bar, isDefault: true }, vip, corp], pricingRules: [companyRule] });
    const choice = pick(c, { promoCode: 'AMIGOS' });
    expect(choice).toMatchObject({ option: { ratePlanId: 'corp', contract: 'company' }, reason: 'contract' });
    expect(choice!.option.quote.nightly.map((n) => n.price)).toEqual([99, 99]); // 110 − 10 %
  });

  it('a guest rule beats a cheaper company rule', () => {
    const companyRule = rule({ ruleTarget: 'company', companyId: 'co1', ratePlanId: 'bar', ruleModel: 'custom', customBasePrice: 60 });
    const guestRule = rule({ ruleTarget: 'guest', guestEmail: 'ana@example.com', ratePlanId: 'bb', ruleModel: 'custom', customBasePrice: 95 });
    const choice = pick(ctx({ pricingRules: [companyRule, guestRule] }));
    expect(choice).toMatchObject({ option: { ratePlanId: 'bb', contract: 'guest' }, reason: 'contract' });
  });

  it('a contract that does not price these dates is not a contract for the stay', () => {
    const later = rule({ ruleTarget: 'company', companyId: 'co1', ratePlanId: 'bb', ruleModel: 'custom', customBasePrice: 50, dateStart: D('2027-01-10'), dateEnd: D('2027-01-20') });
    expect(pick(ctx({ pricingRules: [later] }))).toMatchObject({ option: { ratePlanId: 'bar' }, reason: 'cheapest' });
  });

  it('only open plans qualify: a closed default or contract plan is skipped', () => {
    const closeBB = booking({ scope: 'rate_plans', ratePlanIds: ['bb'], stopSell: true, dateStart: dec(4), dateEnd: dec(5) });
    const companyRule = rule({ ruleTarget: 'company', companyId: 'co1', ratePlanId: 'bb', ruleModel: 'custom', customBasePrice: 50 });
    const c = ctx({ ratePlans: [bar, { ...bb, isDefault: true }], restrictionRules: [closeBB], pricingRules: [companyRule] });
    expect(pick(c)).toMatchObject({ option: { ratePlanId: 'bar' }, reason: 'cheapest' });
  });

  it('nothing open: staff get the default (or cheapest) plan as "restricted"; guests get none', () => {
    const closeAll = booking({ stopSell: true, dateStart: dec(4), dateEnd: dec(5) });
    const c = ctx({ ratePlans: [bar, { ...bb, isDefault: true }], restrictionRules: [closeAll] });
    expect(pick(c)).toMatchObject({ option: { ratePlanId: 'bb' }, reason: 'restricted' });
    expect(pick(ctx({ ratePlans: [bb, bar], restrictionRules: [closeAll] }))).toMatchObject({ option: { ratePlanId: 'bar' }, reason: 'restricted' });
    expect(pick(c, {}, 'public')).toBeNull();
    expect(choosePlan([])).toBeNull();
  });

  it('equal prices order by name, then id', () => {
    const a = plan({ _id: 'z1', name: 'Alpha', basePrice: 100 });
    const b = plan({ _id: 'a1', name: 'Beta', basePrice: 100 });
    const options = staffOptions(ctx({ ratePlans: [b, a] }));
    expect([...options].sort(compareOptions).map((o) => o.name)).toEqual(['Alpha', 'Beta']);
  });
});

describe('the plan a guest books (resolvePublicPlan)', () => {
  const c = ctx({ ratePlans: [bar, bb, vip] });

  it('a chosen public plan is booked as the guest\'s choice', () => {
    expect(resolvePublicPlan(c, 'rt-twin', stay(4, 6), party(), null, 'bb')).toMatchObject({ ok: true, option: { ratePlanId: 'bb' }, reason: 'manual' });
  });

  it('a private plan needs its code; an unknown plan is not found', () => {
    expect(resolvePublicPlan(c, 'rt-twin', stay(4, 6), party(), null, 'vip')).toEqual({ ok: false, code: 'not_found' });
    expect(resolvePublicPlan(c, 'rt-twin', stay(4, 6), party(), 'amigos', 'vip')).toMatchObject({ ok: true, option: { ratePlanId: 'vip' } });
    expect(resolvePublicPlan(c, 'rt-twin', stay(4, 6), party(), null, 'nope')).toEqual({ ok: false, code: 'not_found' });
  });

  it('a plan closed by a booking rule is refused, with the quote to explain why', () => {
    const closeBB = booking({ scope: 'rate_plans', ratePlanIds: ['bb'], closedToArrival: true, dateStart: dec(4), dateEnd: dec(4) });
    const r = resolvePublicPlan(ctx({ ratePlans: [bar, bb], restrictionRules: [closeBB] }), 'rt-twin', stay(4, 6), party(), null, 'bb');
    expect(r).toMatchObject({ ok: false, code: 'restricted', option: { ratePlanId: 'bb' } });
  });

  it('without a choice the pre-selection applies', () => {
    expect(resolvePublicPlan(ctx({ ratePlans: [bar, { ...bb, isDefault: true }] }), 'rt-twin', stay(4, 6), party())).toMatchObject({ ok: true, reason: 'default', option: { ratePlanId: 'bb' } });
  });
});

describe('negotiated prices in quotes', () => {
  it('a company rule beats a calendar price on its nights and marks the quote as a contract', () => {
    const cal = rule({ ratePlanId: 'bar', origin: 'calendar', ruleModel: 'custom', customBasePrice: 300, dateStart: D(dec(5)), dateEnd: D(dec(5)) });
    const company = rule({ ruleTarget: 'company', companyId: 'co1', ratePlanId: 'bar', ruleModel: 'custom', customBasePrice: 80, dateStart: D(dec(5)), dateEnd: D(dec(5)) });
    const q = quoteStayFrom(ctx({ pricingRules: [cal, company] }), 'bar', stay(4, 6), party(1))!;
    expect(q.nightly.map((n) => n.price)).toEqual([100, 80]);
    expect(q.contract).toBe('company');
    expect(quoteStayFrom(ctx({ pricingRules: [cal] }), 'bar', stay(4, 6), party(1))!.contract).toBeNull();
  });

  it('negotiated rules never price a guest-facing context, even if one holds them', () => {
    const company = rule({ ruleTarget: 'company', companyId: 'co1', ratePlanId: 'bar', ruleModel: 'custom', customBasePrice: 1 });
    const q = quoteStayFrom(ctx({ pricingRules: [company], negotiatedRules: false }), 'bar', stay(4, 6), party(1))!;
    expect(q.nightly.map((n) => n.price)).toEqual([100, 100]);
    expect(q.contract).toBeNull();
  });
});

describe('guests across rooms', () => {
  it('fills rooms up to capacity in the order given, keeping what does not fit', () => {
    const { lines, unassignedAdults, unassignedChildren } = distributeParty([{ capacity: 2 }, { capacity: 3 }], 4, 2);
    expect(lines.map((l) => [l.adults, l.children])).toEqual([[2, 0], [2, 1]]);
    expect([unassignedAdults, unassignedChildren]).toEqual([0, 1]);
  });
});

describe('what a reservation stores', () => {
  const c = ctx({ taxes: [{ name: 'ITBIS', type: 'percentage', value: 18, appliesTo: 'room', isInclusive: false }] });
  const qBar = quoteStayFrom(c, 'bar', stay(4, 6), party(1))!;
  const qBB = quoteStayFrom(c, 'bb', stay(4, 6), party(1))!;

  it('a room item carries the plan, its name, how it was chosen and the price', () => {
    const item = roomItemFrom({
      roomTypeId: '64b000000000000000000001', ratePlanId: '64b000000000000000000002', ratePlanName: qBar.ratePlan.name,
      rateSelection: 'default', checkIn: D(dec(4)), checkOut: D(dec(6)), adults: 1, children: 0, quote: qBar,
    });
    expect(item).toMatchObject({
      kind: 'room', ratePlanName: 'Best Available Rate', rateSelection: 'default', quantity: 1,
      unitPrice: 100, subtotal: 200, totalTaxes: 36, total: 236,
    });
    expect(String(item.ratePlanId)).toBe('64b000000000000000000002');
  });

  it('the snapshot of several rooms sums them and joins the plan names', () => {
    const snap = pricingSnapshotFrom([qBar, qBB])!;
    expect(snap).toMatchObject({
      ratePlanId: 'bar', ratePlanName: 'Best Available Rate + Bed & Breakfast Rate', roomTypeName: 'Twin',
      adjustedSubtotal: 440, totalTaxes: 79.2, finalTotal: 519.2, nights: 2,
    });
    expect(snap.taxes).toEqual([{ name: 'ITBIS', type: 'percentage', amount: 79.2, isInclusive: false }]);
    expect(pricingSnapshotFrom([qBar])!.ratePlanName).toBe('Best Available Rate');
    expect(pricingSnapshotFrom([])).toBeUndefined();
  });

  it('merges taxes by name', () => {
    expect(mergeTaxes([[{ name: 'A', type: 'fixed', amount: 1.1, isInclusive: false }], [{ name: 'A', type: 'fixed', amount: 2.2, isInclusive: false }]]))
      .toEqual([{ name: 'A', type: 'fixed', amount: 3.3, isInclusive: false }]);
  });
});

describe('promo codes on rate plans', () => {
  it('normalizes codes: upper case, distinct, invalid ones dropped', () => {
    expect(normalizeAccessCodes([' verano26 ', 'VERANO26', 'ab', 'amigos-2026', 'no spaces'])).toEqual(['VERANO26', 'AMIGOS-2026']);
    expect(normalizeAccessCodes('a1b, c2d; e3f')).toEqual(['A1B', 'C2D', 'E3F']);
  });

  it('the rate plan payload refuses invalid codes and clears codes of public plans', () => {
    expect(ratePlanPayload({ visibility: 'private', accessCodes: 'verano26, x' })).toEqual({ error: expect.stringMatching(/X/) });
    expect(ratePlanPayload({ visibility: 'private', accessCodes: ['verano26', 'VERANO26'] })).toEqual({ data: { visibility: 'private', accessCodes: ['VERANO26'] } });
    expect(ratePlanPayload({ visibility: 'public', accessCodes: ['VERANO26'] })).toEqual({ data: { visibility: 'public', accessCodes: [] } });
    // switching an existing private plan to public drops its codes
    expect(ratePlanPayload({ visibility: 'public' }, { visibility: 'private', accessCodes: ['A1B'] })).toEqual({ data: { visibility: 'public', accessCodes: [] } });
    expect(ratePlanPayload({ visibility: 'secret' })).toEqual({ error: expect.any(String) });
    // only editable fields pass
    expect(ratePlanPayload({ name: 'X', tenantId: 'other', isDefault: 'yes' })).toEqual({ data: { name: 'X', isDefault: false } });
  });
});

describe('room items follow the stay (realignRoomItems)', () => {
  const item = (from: string, to: string, extra: Record<string, any> = {}) => ({
    kind: 'room', checkIn: D(from), checkOut: D(to), subtotal: 300, totalTaxes: 54, total: 354, unitPrice: 100,
    taxes: [{ name: 'ITBIS', type: 'percentage', amount: 54, isInclusive: false }], ...extra,
  });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const old = { checkIn: D('2026-12-10'), checkOut: D('2026-12-13') };

  it('an item on the whole stay moves to the whole new stay (moved, same nights)', () => {
    const [moved] = realignRoomItems([item('2026-12-10', '2026-12-13')], old, { checkIn: D('2026-12-20'), checkOut: D('2026-12-23') });
    expect([iso(moved.checkIn!), iso(moved.checkOut!)]).toEqual(['2026-12-20', '2026-12-23']);
    expect(moved.total).toBe(354);
  });

  it('a longer stay rescales the item per night when asked', () => {
    const [longer] = realignRoomItems([item('2026-12-10', '2026-12-13')], old, { checkIn: D('2026-12-10'), checkOut: D('2026-12-15') }, { rescaleAmounts: true });
    expect([iso(longer.checkIn!), iso(longer.checkOut!)]).toEqual(['2026-12-10', '2026-12-15']);
    expect([longer.subtotal, longer.totalTaxes, longer.total, longer.unitPrice]).toEqual([500, 90, 590, 100]);
    expect(longer.taxes![0].amount).toBe(90);
  });

  it('a partial item shifts with the check-in and stays inside the new stay; services are untouched', () => {
    const service = { kind: 'service', total: 20 };
    const [partial, svc] = realignRoomItems([item('2026-12-11', '2026-12-13'), service] as any[], old, { checkIn: D('2026-12-12'), checkOut: D('2026-12-14') });
    expect([iso(partial.checkIn!), iso(partial.checkOut!)]).toEqual(['2026-12-13', '2026-12-14']);
    expect(svc).toBe(service);
  });

  it('nothing to do without items', () => {
    expect(realignRoomItems(undefined, old, old)).toEqual([]);
  });
});

// Keep the option type exercised for the compiler
export const _options: RateOption[] = [];
