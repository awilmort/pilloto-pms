/**
 * Small pieces every reservation-creating path shares: front desk (routes/reservations.ts),
 * booking engine (routes/booking.ts) and channel bookings (services/channex/bookingMapper.ts).
 */
import crypto from 'crypto';
import Folio from '../models/Folio';

/** The folio of a reservation, created on first use. */
export async function ensureFolio(reservationId: unknown) {
  return Folio.findOneAndUpdate(
    { reservationId },
    { $setOnInsert: { reservationId, status: 'open' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/** Human-friendly reservation code: B + YY + 4 alphanumeric uppercase (e.g. B26X7KQ). */
export function generateReservationCode(): string {
  const prefix = 'B';
  const year = new Date().getFullYear().toString().slice(-2);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `${prefix}${year}${code}`;
}

/** The email format `Reservation.contactInfo.email` accepts. */
export const RESERVATION_EMAIL_RE = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

/**
 * Booking-engine reservations carry a 32-byte hex confirmation token (routes/booking.ts);
 * front-desk ones a `<timestamp>-<random>` token. Used to tell the two sources apart.
 */
export const BOOKING_ENGINE_TOKEN_RE = /^[0-9a-f]{64}$/;

type DatedItem = { kind: string; checkIn?: Date | null; checkOut?: Date | null; subtotal?: number; total?: number; totalTaxes?: number; unitPrice?: number; taxes?: Array<{ amount: number }> };

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (d: Date) => Math.floor(new Date(d).getTime() / DAY_MS);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Keep room items on the stay when staff change its dates (edit or drag in the booking
 * calendar). InventoryService counts a room item on its own nights, so items left on the old
 * dates would hold rooms there. An item that covered the whole old stay covers the whole new
 * one; any other item moves with the check-in and is kept inside the new stay. With
 * `rescaleAmounts`, a changed number of nights scales the item's amounts per night (the way
 * the reservation total is recalculated), so reports keep the booked value per night.
 */
export function realignRoomItems<T extends DatedItem>(
  items: T[] | undefined | null,
  oldStay: { checkIn: Date; checkOut: Date },
  newStay: { checkIn: Date; checkOut: Date },
  opts: { rescaleAmounts?: boolean } = {},
): T[] {
  if (!items?.length) return items ?? [];
  const shift = dayOf(newStay.checkIn) - dayOf(oldStay.checkIn);
  const newIn = newStay.checkIn.getTime();
  const newOut = newStay.checkOut.getTime();
  return items.map((item) => {
    if (item.kind !== 'room') return item;
    const nightsOf = (a?: Date | null, b?: Date | null) => (a && b ? Math.max(1, dayOf(b) - dayOf(a)) : Math.max(1, dayOf(oldStay.checkOut) - dayOf(oldStay.checkIn)));
    const before = nightsOf(item.checkIn, item.checkOut);
    const wholeStay = !item.checkIn || !item.checkOut
      || (dayOf(item.checkIn) === dayOf(oldStay.checkIn) && dayOf(item.checkOut) === dayOf(oldStay.checkOut));
    let checkIn: Date;
    let checkOut: Date;
    if (wholeStay) {
      checkIn = new Date(newIn);
      checkOut = new Date(newOut);
    } else {
      const from = Math.min(Math.max(new Date(item.checkIn!).getTime() + shift * DAY_MS, newIn), newOut - DAY_MS);
      const to = Math.max(Math.min(new Date(item.checkOut!).getTime() + shift * DAY_MS, newOut), from + DAY_MS);
      checkIn = new Date(from);
      checkOut = new Date(to);
    }
    const next: any = { ...((item as any).toObject ? (item as any).toObject() : item), checkIn, checkOut };
    const after = Math.max(1, dayOf(checkOut) - dayOf(checkIn));
    if (opts.rescaleAmounts && after !== before) {
      const f = after / before;
      if (typeof next.subtotal === 'number') next.subtotal = round2(next.subtotal * f);
      if (typeof next.totalTaxes === 'number') next.totalTaxes = round2(next.totalTaxes * f);
      if (typeof next.total === 'number') next.total = round2(next.total * f);
      if (Array.isArray(next.taxes)) next.taxes = next.taxes.map((t: any) => ({ ...t, amount: round2(Number(t.amount || 0) * f) }));
    }
    return next as T;
  });
}
