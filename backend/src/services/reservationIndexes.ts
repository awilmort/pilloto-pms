/**
 * Index housekeeping for `reservations.reservationCode`.
 *
 * Reservation numbers used to be unique across ALL properties (one global unique index on `reservationCode`).
 * They are now unique per property — every property numbers from RES-000001 — so that global index has to go:
 * while it exists, the second property's first reservation is rejected as a duplicate of the first property's.
 * Mongoose creates new indexes by itself but never drops old ones, so the swap is done here. Running it at
 * server start (and from the migration script) means deploy order cannot matter.
 */
import mongoose from 'mongoose';
import type { Db } from 'mongodb';

export const LEGACY_RESERVATION_CODE_INDEX = 'reservationCode_1';

type IndexInfo = { name?: string; key?: Record<string, unknown> };

/** The old index: unique on `reservationCode` alone. (The replacement is keyed {tenantId, reservationCode}.) */
const isLegacyIndex = (index: IndexInfo) =>
  index.name === LEGACY_RESERVATION_CODE_INDEX && Object.keys(index.key ?? {}).length === 1 && 'reservationCode' in (index.key ?? {});

export async function hasLegacyReservationCodeIndex(db: Db): Promise<boolean> {
  const indexes = await db.collection('reservations').indexes().catch(() => [] as IndexInfo[]); // no collection yet = no index
  return indexes.some(isLegacyIndex);
}

/** Drops the global index if it is there. Returns whether it was. */
export async function dropLegacyReservationCodeIndex(db: Db): Promise<boolean> {
  if (!(await hasLegacyReservationCodeIndex(db))) return false;
  await db.collection('reservations').dropIndex(LEGACY_RESERVATION_CODE_INDEX);
  return true;
}

/** Server start: remove the global index, then make sure the per-property one is built before traffic arrives. */
export async function ensureReservationIndexes(): Promise<{ droppedLegacyIndex: boolean }> {
  const droppedLegacyIndex = await dropLegacyReservationCodeIndex(mongoose.connection.db!);
  await mongoose.model('Reservation').init();
  return { droppedLegacyIndex };
}
