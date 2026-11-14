/**
 * The admin page of one reservation. The URL carries the human reservation code (e.g. B26X7KQ) — what staff
 * read out on the phone and see on confirmations — falling back to the database id for the few reservations
 * that have no code. The page accepts either and rewrites an id URL to the code one once it has loaded.
 */
export const reservationHref = (r: { _id: string; reservationCode?: string | null }): string =>
  `/admin/reservations/${encodeURIComponent(r.reservationCode || r._id)}`;

/** Same reservation? — `ref` is whatever the URL holds (id or code, any case). */
export const matchesReservationRef = (r: { _id: string; reservationCode?: string | null }, ref: string): boolean =>
  String(r._id) === ref || (!!r.reservationCode && r.reservationCode.toUpperCase() === ref.trim().toUpperCase());
