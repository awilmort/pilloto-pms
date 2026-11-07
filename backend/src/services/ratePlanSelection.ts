/**
 * Which rate plan a room is booked on — one rule for every Pilloto booking path.
 *
 * A room type can have several plans (Best Available Rate, Bed & Breakfast, a non-refundable
 * rate, a company's contract rate…). Staff see every active plan for the stay and choose; the
 * booking engine shows guests every public plan (and private plans unlocked by a promo code)
 * and the guest chooses. When nobody has chosen yet, the plan is pre-selected in this order:
 *
 *   1. contract   — a plan whose guest or company rule prices the stay (staff quotes only;
 *                   guest rules beat company rules)
 *   2. promo      — a private plan unlocked by the promo code given
 *   3. default    — the room type's default plan (RatePlan.isDefault)
 *   4. cheapest   — the cheapest plan the stay can be booked on
 *   5. restricted — no plan is open for the stay (booking rules): staff may still book, on
 *                   the default plan or else the cheapest, with warnings. Never for guests.
 *
 * Only plans the stay can be booked on (no booking-rule violation) qualify for 1–4. Ties are
 * broken by price, then name, so the result never depends on storage order.
 *
 * OTA bookings never come through here: the OTA chose the plan and its price
 * (services/channex/bookingMapper.ts).
 */

import mongoose from 'mongoose';
import Room from '../models/Room';
import { normalizeAccessCode } from '../models/RatePlan';
import type { RateSelectionReason } from '../models/Reservation';
import { loadStayContext, quoteStayFrom, toStay, Stay, StayContext, StayParty, StayQuote } from './stayQuote';
import { describeStayViolation } from './restrictionRules';
import { eachNight } from './channex/dates';
import type { TaxBreakdown } from '../utils/pricing';

export type RateAudience = 'staff' | 'public';
export type AutoSelectionReason = Exclude<RateSelectionReason, 'manual'>;

type ContextPlan = StayContext['ratePlans'][number];

export interface RateOption {
  ratePlanId: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  isDefault: boolean;
  /** Unlocked by the promo code given */
  promoMatch: boolean;
  /** A guest or company rule prices at least one night of the stay */
  contract: 'guest' | 'company' | null;
  /** The stay breaks none of the plan's booking rules */
  bookable: boolean;
  quote: StayQuote;
}

export interface PlanChoice {
  option: RateOption;
  reason: AutoSelectionReason;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Pure core ───────────────────────────────────────────────────────────────

/** Whether a plan is unlocked by a promo code (codes compare upper case). */
export function planMatchesCode(plan: Pick<ContextPlan, 'accessCodes'>, code?: string | null): boolean {
  const c = normalizeAccessCode(code);
  return !!c && (plan.accessCodes ?? []).includes(c);
}

/** Staff see every active plan; guests see active public plans and private plans their code unlocks. */
export function planVisibleTo(plan: ContextPlan, audience: RateAudience, code?: string | null): boolean {
  if (!plan.isActive) return false;
  if (audience === 'staff') return true;
  return plan.visibility !== 'private' || planMatchesCode(plan, code);
}

/** Cheapest first; then name and id, so equal prices always order the same way. */
export function compareOptions(a: RateOption, b: RateOption): number {
  if (a.quote.finalTotal !== b.quote.finalTotal) return a.quote.finalTotal - b.quote.finalTotal;
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : a.ratePlanId.localeCompare(b.ratePlanId);
}

/** Every plan of the room type the audience may book, quoted for the stay (bookable first, then by price). */
export function rateOptionsFrom(
  ctx: StayContext,
  roomTypeId: string,
  stay: Stay,
  party: StayParty,
  opts: { audience: RateAudience; promoCode?: string | null },
): RateOption[] {
  const options: RateOption[] = [];
  for (const plan of ctx.ratePlans) {
    if (String(plan.roomTypeId) !== roomTypeId || !planVisibleTo(plan, opts.audience, opts.promoCode)) continue;
    const quote = quoteStayFrom(ctx, String(plan._id), stay, party);
    if (!quote) continue;
    options.push({
      ratePlanId: String(plan._id),
      name: plan.name,
      description: plan.description ?? '',
      visibility: plan.visibility === 'private' ? 'private' : 'public',
      isDefault: plan.isDefault === true,
      promoMatch: planMatchesCode(plan, opts.promoCode),
      contract: quote.contract,
      bookable: quote.violations.length === 0,
      quote,
    });
  }
  return options.sort((a, b) => (a.bookable !== b.bookable ? (a.bookable ? -1 : 1) : compareOptions(a, b)));
}

/** The pre-selected plan (see the order at the top of this file), or null when there is no plan. */
export function choosePlan(options: RateOption[], audience: RateAudience = 'staff'): PlanChoice | null {
  const cheapest = (list: RateOption[]) => [...list].sort(compareOptions)[0];
  const open = options.filter((o) => o.bookable);

  const contracts = open.filter((o) => o.contract);
  if (contracts.length) {
    const guest = contracts.filter((o) => o.contract === 'guest');
    return { option: cheapest(guest.length ? guest : contracts), reason: 'contract' };
  }
  const promo = open.filter((o) => o.promoMatch);
  if (promo.length) return { option: cheapest(promo), reason: 'promo' };
  const byDefault = open.filter((o) => o.isDefault);
  if (byDefault.length) return { option: cheapest(byDefault), reason: 'default' };
  if (open.length) return { option: cheapest(open), reason: 'cheapest' };

  if (audience === 'public' || options.length === 0) return null;
  const closedDefault = options.filter((o) => o.isDefault);
  return { option: cheapest(closedDefault.length ? closedDefault : options), reason: 'restricted' };
}

/**
 * What the booking engine offers for one room type: the plans the stay can be booked on,
 * promo-code plans first, then by price.
 */
export function publicOffersFrom(ctx: StayContext, roomTypeId: string, stay: Stay, party: StayParty, promoCode?: string | null): RateOption[] {
  return rateOptionsFrom(ctx, roomTypeId, stay, party, { audience: 'public', promoCode })
    .filter((o) => o.bookable)
    .sort((a, b) => (a.promoMatch !== b.promoMatch ? (a.promoMatch ? -1 : 1) : compareOptions(a, b)));
}

export type PublicPlanResult =
  | { ok: true; option: RateOption; reason: RateSelectionReason }
  | { ok: false; code: 'not_found' | 'restricted'; option?: RateOption };

/**
 * The plan a guest books: the one they chose (must be visible to them and open for the stay),
 * or the pre-selection when the request names none.
 */
export function resolvePublicPlan(
  ctx: StayContext, roomTypeId: string, stay: Stay, party: StayParty, promoCode?: string | null, ratePlanId?: string | null,
): PublicPlanResult {
  const options = rateOptionsFrom(ctx, roomTypeId, stay, party, { audience: 'public', promoCode });
  if (ratePlanId) {
    const option = options.find((o) => o.ratePlanId === String(ratePlanId));
    if (!option) return { ok: false, code: 'not_found' };
    if (!option.bookable) return { ok: false, code: 'restricted', option };
    return { ok: true, option, reason: 'manual' };
  }
  const choice = choosePlan(options, 'public');
  if (choice) return { ok: true, option: choice.option, reason: choice.reason };
  return options.length ? { ok: false, code: 'restricted', option: options[0] } : { ok: false, code: 'not_found' };
}

/** Guests go to the smallest rooms first, each room up to its capacity (as staff pricing always did). */
export function distributeParty<T extends { capacity: number }>(rooms: T[], adults: number, children: number) {
  let remainingAdults = Math.max(0, adults);
  let remainingChildren = Math.max(0, children);
  const lines = rooms.map((room) => {
    const capacity = Math.max(1, room.capacity);
    const roomAdults = Math.min(remainingAdults, capacity);
    const roomChildren = Math.min(remainingChildren, Math.max(0, capacity - roomAdults));
    remainingAdults -= roomAdults;
    remainingChildren -= roomChildren;
    return { room, adults: roomAdults, children: roomChildren };
  });
  return { lines, unassignedAdults: remainingAdults, unassignedChildren: remainingChildren };
}

// ─── Staff quotes for selected rooms ─────────────────────────────────────────

export interface RoomRatesInput {
  roomIds: string[];
  /** Property-local `YYYY-MM-DD` (or Dates at noon UTC) */
  checkIn: string | Date;
  checkOut: string | Date;
  adults: number;
  children: number;
  /** Negotiated prices of this company (staff only) */
  companyId?: string | null;
  /** Negotiated prices for this guest e-mail (staff only) */
  guestEmail?: string | null;
  promoCode?: string | null;
  /** roomId → ratePlanId the user chose */
  selections?: Record<string, string> | null;
  audience: RateAudience;
  /**
   * true (creating a reservation): every room needs a plan and a chosen plan must be valid,
   * otherwise RateSelectionError. false (previews): invalid choices fall back to the pre-selection.
   */
  strict?: boolean;
}

export interface RoomRateLine {
  roomId: string;
  roomName: string;
  roomTypeId: string | null;
  roomTypeName: string;
  capacity: number;
  adults: number;
  children: number;
  options: RateOption[];
  recommended: { ratePlanId: string; reason: AutoSelectionReason } | null;
  selected: { ratePlanId: string; reason: RateSelectionReason } | null;
  /** Quote of the selected plan */
  quote: StayQuote | null;
  error?: 'no_room_type' | 'no_rate_plan';
}

export interface RoomRatesResult {
  stay: Stay;
  nights: number;
  lines: RoomRateLine[];
  totals: {
    basePrice: number;
    occupancyCost: number;
    subtotal: number;
    adjustedSubtotal: number;
    taxes: TaxBreakdown[];
    totalTaxes: number;
    finalTotal: number;
  };
  unassignedAdults: number;
  unassignedChildren: number;
  promo: { code: string; matched: boolean } | null;
}

export class RateSelectionError extends Error {
  status = 400;
}

/** Sum of taxes by name (rooms of one reservation share the tax lines). */
export function mergeTaxes(lists: TaxBreakdown[][]): TaxBreakdown[] {
  const merged: TaxBreakdown[] = [];
  for (const list of lists) {
    for (const tax of list) {
      const existing = merged.find((t) => t.name === tax.name && t.isInclusive === tax.isInclusive);
      if (existing) existing.amount = round2(existing.amount + tax.amount);
      else merged.push({ ...tax });
    }
  }
  return merged;
}

/** Every room's plan options and its selected plan, priced night by night. */
export async function quoteRooms(input: RoomRatesInput): Promise<RoomRatesResult> {
  const stay = toStay(input.checkIn, input.checkOut);
  if (stay.checkOut <= stay.checkIn) throw new RateSelectionError('Check-out must be after check-in.');
  const ids = [...new Set(input.roomIds.map(String))];
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) throw new RateSelectionError('Invalid room id.');

  const docs: any[] = await Room.find({ _id: { $in: ids } }).populate('roomTypeId', 'name capacity').lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const rooms = ids
    .map((id, index) => ({ id, index, doc: byId.get(id) }))
    .filter((r) => r.doc)
    .map((r) => ({
      ...r,
      roomTypeId: r.doc.roomTypeId?._id ? String(r.doc.roomTypeId._id) : r.doc.roomTypeId ? String(r.doc.roomTypeId) : null,
      roomTypeName: r.doc.roomTypeId?.name ?? '',
      capacity: Number(r.doc.roomTypeId?.capacity ?? 1) || 1,
    }))
    // Smallest rooms first; equal capacities keep the order they were picked in
    .sort((a, b) => a.capacity - b.capacity || a.index - b.index);
  if (input.strict && rooms.length !== ids.length) throw new RateSelectionError('Room not found.');

  const staff = input.audience === 'staff';
  const typeIds = [...new Set(rooms.map((r) => r.roomTypeId).filter((t): t is string => !!t))];
  const ctx = typeIds.length
    ? await loadStayContext({
      ...stay,
      roomTypeIds: typeIds,
      companyId: staff && input.companyId ? input.companyId : undefined,
      guestEmail: staff && input.guestEmail ? input.guestEmail : undefined,
    })
    : null;

  const { lines: parts, unassignedAdults, unassignedChildren } = distributeParty(rooms, input.adults, input.children);
  const lines: RoomRateLine[] = parts.map(({ room, adults, children }) => {
    const base = {
      roomId: room.id, roomName: room.doc.name ?? '', roomTypeId: room.roomTypeId, roomTypeName: room.roomTypeName,
      capacity: room.capacity, adults, children,
    };
    if (!room.roomTypeId || !ctx) {
      if (input.strict) throw new RateSelectionError(`${base.roomName} has no room type.`);
      return { ...base, options: [], recommended: null, selected: null, quote: null, error: 'no_room_type' as const };
    }
    const options = rateOptionsFrom(ctx, room.roomTypeId, stay, { adults, children, rooms: 1 }, {
      audience: input.audience, promoCode: input.promoCode,
    });
    const choice = choosePlan(options, input.audience);
    if (!choice) {
      if (input.strict) {
        throw new RateSelectionError(options.length
          ? `No rate plan of ${room.roomTypeName || base.roomName} can be booked for these dates.`
          : `${room.roomTypeName || base.roomName} has no active rate plan.`);
      }
      return { ...base, options, recommended: null, selected: null, quote: null, error: 'no_rate_plan' as const };
    }
    const recommended = { ratePlanId: choice.option.ratePlanId, reason: choice.reason };

    const wanted = input.selections?.[room.id];
    let selected: RateOption = choice.option;
    let reason: RateSelectionReason = choice.reason;
    if (wanted) {
      const picked = options.find((o) => o.ratePlanId === String(wanted));
      if (picked && (staff || picked.bookable)) {
        selected = picked;
        reason = picked.ratePlanId === choice.option.ratePlanId ? choice.reason : 'manual';
      } else if (input.strict) {
        throw new RateSelectionError(picked
          ? `The ${picked.name} rate cannot be booked for these dates.`
          : `That rate plan is not available for ${base.roomName}.`);
      }
    }
    return { ...base, options, recommended, selected: { ratePlanId: selected.ratePlanId, reason }, quote: selected.quote };
  });

  const quotes = lines.map((l) => l.quote).filter((q): q is StayQuote => !!q);
  const sum = (f: (q: StayQuote) => number) => round2(quotes.reduce((s, q) => s + f(q), 0));
  const code = normalizeAccessCode(input.promoCode);
  return {
    stay,
    nights: Math.max(1, eachNight(stay.checkIn, stay.checkOut).length),
    lines,
    totals: {
      basePrice: sum((q) => q.basePrice),
      occupancyCost: sum((q) => q.occupancyCost),
      subtotal: sum((q) => q.subtotal),
      adjustedSubtotal: sum((q) => q.adjustedSubtotal),
      taxes: mergeTaxes(quotes.map((q) => q.taxes)),
      totalTaxes: sum((q) => q.totalTaxes),
      finalTotal: sum((q) => q.finalTotal),
    },
    unassignedAdults,
    unassignedChildren,
    promo: code ? { code, matched: lines.some((l) => l.options.some((o) => o.promoMatch)) } : null,
  };
}

// ─── What a reservation stores ───────────────────────────────────────────────

export interface RoomItemInput {
  roomTypeId: string;
  ratePlanId: string;
  ratePlanName: string;
  rateSelection: RateSelectionReason;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  quote: StayQuote;
}

/** A reservation room line: the plan it was booked on, how it was chosen and its price. */
export function roomItemFrom(i: RoomItemInput) {
  return {
    kind: 'room' as const,
    roomTypeId: new mongoose.Types.ObjectId(i.roomTypeId),
    ratePlanId: new mongoose.Types.ObjectId(i.ratePlanId),
    ratePlanName: i.ratePlanName,
    rateSelection: i.rateSelection,
    checkIn: i.checkIn,
    checkOut: i.checkOut,
    adults: i.adults,
    children: i.children,
    quantity: 1,
    // Average nightly price, as on OTA bookings
    unitPrice: round2(i.quote.adjustedSubtotal / Math.max(1, i.quote.nights)),
    subtotal: i.quote.adjustedSubtotal,
    taxes: i.quote.taxes.map((t) => ({ name: t.name, type: t.type, amount: t.amount, isInclusive: t.isInclusive })),
    totalTaxes: i.quote.totalTaxes,
    total: i.quote.finalTotal,
  };
}

/** Room items of a staff quote (lines without a selected plan are skipped). */
export function roomItemsFromQuote(result: RoomRatesResult, checkIn: Date, checkOut: Date) {
  return result.lines
    .filter((l) => l.selected && l.quote && l.roomTypeId)
    .map((l) => roomItemFrom({
      roomTypeId: l.roomTypeId!,
      ratePlanId: l.selected!.ratePlanId,
      ratePlanName: l.quote!.ratePlan.name,
      rateSelection: l.selected!.reason,
      checkIn,
      checkOut,
      adults: l.adults,
      children: l.children,
      quote: l.quote!,
    }));
}

/**
 * The reservation's pricing snapshot from its room quotes. One plan → its id; several plans
 * (multi-room on different rates) → the first room's id, names joined.
 */
export function pricingSnapshotFrom(quotes: StayQuote[]) {
  if (quotes.length === 0) return undefined;
  const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const sum = (f: (q: StayQuote) => number) => round2(quotes.reduce((s, q) => s + f(q), 0));
  return {
    ratePlanId: quotes[0].ratePlan._id,
    ratePlanName: unique(quotes.map((q) => q.ratePlan.name)).join(' + ').slice(0, 200),
    roomTypeName: unique(quotes.map((q) => q.ratePlan.roomTypeName)).join(', ').slice(0, 200),
    basePrice: sum((q) => q.basePrice),
    occupancyCost: sum((q) => q.occupancyCost),
    subtotal: sum((q) => q.subtotal),
    adjustedSubtotal: sum((q) => q.adjustedSubtotal),
    taxes: mergeTaxes(quotes.map((q) => q.taxes)),
    totalTaxes: sum((q) => q.totalTaxes),
    finalTotal: sum((q) => q.finalTotal),
    nights: Math.max(...quotes.map((q) => q.nights)),
  };
}

// ─── API shapes ──────────────────────────────────────────────────────────────

/** A rate option as the admin and booking-engine APIs return it. */
export function optionView(o: RateOption, lang: 'es' | 'en' = 'en') {
  return {
    ratePlanId: o.ratePlanId,
    name: o.name,
    description: o.description,
    visibility: o.visibility,
    isDefault: o.isDefault,
    promoMatch: o.promoMatch,
    contract: o.contract,
    bookable: o.bookable,
    violations: o.quote.violations,
    restrictionMessages: o.quote.violations.map((v) => ({ es: describeStayViolation(v, 'es'), en: describeStayViolation(v, 'en') })),
    restrictionMessage: o.quote.violations.length ? describeStayViolation(o.quote.violations[0], lang) : null,
    pricing: {
      basePrice: o.quote.basePrice,
      occupancyCost: o.quote.occupancyCost,
      subtotal: o.quote.subtotal,
      adjustedSubtotal: o.quote.adjustedSubtotal,
      taxes: o.quote.taxes,
      totalTaxes: o.quote.totalTaxes,
      finalTotal: o.quote.finalTotal,
      nights: o.quote.nights,
      perNight: o.quote.nights > 0 ? round2(o.quote.adjustedSubtotal / o.quote.nights) : 0,
      nightly: o.quote.nightly.map((n) => ({ date: n.date, price: n.price })),
    },
  };
}

/** The plan each room would be priced on for a stay (booking-rule checks without a choice). */
export async function recommendedPlanIdsForRooms(roomIds: string[], stay: Stay): Promise<string[]> {
  if (roomIds.length === 0) return [];
  const result = await quoteRooms({
    roomIds, checkIn: stay.checkIn, checkOut: stay.checkOut, adults: roomIds.length, children: 0, audience: 'staff',
  });
  return [...new Set(result.lines.map((l) => l.selected?.ratePlanId).filter((id): id is string => !!id))];
}

/**
 * Re-price a reservation's room items with a company's (and guest's) negotiated rules — used
 * when a corporate rate request is approved. A room moves to the plan that carries the
 * company's contract when there is one for its type and dates; otherwise it stays on its plan,
 * re-priced. Items whose plan no longer exists are left as they are.
 */
export async function requoteRoomItems(
  items: any[],
  opts: { companyId?: string | null; guestEmail?: string | null },
): Promise<{ items: any[]; quotes: StayQuote[]; changed: boolean }> {
  const out: any[] = [];
  const quotes: StayQuote[] = [];
  let changed = false;
  for (const raw of items) {
    const item = raw?.toObject ? raw.toObject() : raw;
    if (item.kind !== 'room' || !item.roomTypeId || !item.checkIn || !item.checkOut) { out.push(item); continue; }
    const stay = toStay(item.checkIn, item.checkOut);
    const ctx = await loadStayContext({
      ...stay, roomTypeIds: [String(item.roomTypeId)], companyId: opts.companyId ?? undefined, guestEmail: opts.guestEmail ?? undefined,
    });
    const party = { adults: Number(item.adults ?? 1) || 1, children: Number(item.children ?? 0) || 0, rooms: 1 };
    const options = rateOptionsFrom(ctx, String(item.roomTypeId), stay, party, { audience: 'staff' });
    const choice = choosePlan(options, 'staff');
    const current = options.find((o) => o.ratePlanId === String(item.ratePlanId ?? ''));
    const target = choice?.reason === 'contract' ? choice.option : current;
    if (!target) { out.push(item); continue; }
    const next = roomItemFrom({
      roomTypeId: String(item.roomTypeId),
      ratePlanId: target.ratePlanId,
      ratePlanName: target.name,
      rateSelection: choice?.reason === 'contract' ? 'contract' : (item.rateSelection ?? 'manual'),
      checkIn: item.checkIn,
      checkOut: item.checkOut,
      adults: party.adults,
      children: party.children,
      quote: target.quote,
    });
    changed = changed || next.total !== item.total || String(next.ratePlanId) !== String(item.ratePlanId);
    out.push(next);
    quotes.push(target.quote);
  }
  return { items: out, quotes, changed };
}
