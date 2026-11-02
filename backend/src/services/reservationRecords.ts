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
