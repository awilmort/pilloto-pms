/**
 * Reservation numbers (the human-facing `reservationCode`, e.g. RES-000123).
 *
 * Why a counter and not random characters: a random code can only be made unique by hoping and retrying, and the
 * odds worsen with every reservation (4 random characters collide around ~1,300 reservations a year). A
 * per-property atomic counter hands out each number exactly once, so a duplicate cannot happen however many
 * reservations are made or how many are created at the same moment. It is the same primitive that numbers
 * invoices and journal entries, and the same model PMS products use: an opaque internal id for the system
 * (`_id`), a sequential confirmation number for people.
 *
 * Properties of the number:
 *   - unique per property (each starts at 1); the database also enforces it with {tenantId, reservationCode} unique
 *   - immutable once assigned, and never reused
 *   - NOT secret: it only identifies a reservation to staff. Whoever needs to see a reservation without logging
 *     in (the guest) proves it with the unguessable `confirmationToken`, never with this number
 *   - may have gaps (a reservation that fails to save after its number was taken); gaps are harmless here
 *   - grows past six digits on its own (RES-999999 → RES-1000000), so there is no ceiling
 * Codes issued before this scheme (B26X7KQ) stay valid exactly as they are.
 */
import mongoose from 'mongoose';
import { nextSequence } from '../models/Counter';
import { getTenantId } from '../middleware/tenantContext';

export const RESERVATION_COUNTER_KEY = 'reservationNumber';
const PREFIX = 'RES';
/** Far more skipped numbers than any real drift (a restored backup, a bulk import) could leave behind. */
const MAX_SKIPPED = 1000;

export const formatReservationCode = (sequence: number): string => `${PREFIX}-${String(sequence).padStart(6, '0')}`;

/**
 * The next reservation number for the property in the current tenant context.
 *
 * It also checks that the number is free before returning it. That is not needed in normal operation (the counter
 * never repeats), but it makes the counter self-healing if it ever falls behind the data — restored from an older
 * backup, or reservations imported with numbers of this format — by skipping forward past the taken ones.
 */
export async function allocateReservationCode(): Promise<string> {
  if (!getTenantId()) throw new Error('Cannot number a reservation without a tenant context');
  const Reservation = mongoose.model('Reservation');
  for (let skipped = 0; skipped < MAX_SKIPPED; skipped++) {
    const code = formatReservationCode(await nextSequence(RESERVATION_COUNTER_KEY));
    if (!(await Reservation.exists({ reservationCode: code }))) return code;
  }
  throw new Error(`Could not find a free reservation number after skipping ${MAX_SKIPPED}`);
}
