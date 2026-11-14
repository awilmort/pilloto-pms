/**
 * What lets a guest — someone who is not logged in — see or cancel a reservation: the `confirmationToken`.
 *
 * The reservation number (RES-000123) is deliberately not a credential. It is sequential, printed on paperwork
 * and read out over the phone, so anyone can guess the next one. The token is 256 bits of randomness and is
 * only ever sent to the guest (confirmation email link), so possessing it is the proof.
 */
import crypto from 'crypto';

/**
 * Token for a reservation created at the front desk. Same strength as the booking engine's, but with an `fd-`
 * prefix so it never matches BOOKING_ENGINE_TOKEN_RE — that pattern is how "booking engine" and "direct"
 * reservations are told apart in the list filters.
 */
export const newFrontDeskToken = (): string => `fd-${crypto.randomBytes(32).toString('hex')}`;

/**
 * Constant-time token comparison. Both sides are hashed first so the comparison always sees equal-length input
 * (timingSafeEqual requires it) and its duration does not depend on how much of a wrong guess was right.
 */
export function tokensMatch(expected: string | null | undefined, provided: unknown): boolean {
  if (typeof expected !== 'string' || !expected || typeof provided !== 'string' || !provided) return false;
  const digest = (v: string) => crypto.createHash('sha256').update(v).digest();
  return crypto.timingSafeEqual(digest(expected), digest(provided));
}
