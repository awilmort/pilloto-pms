/**
 * One-off migration for the move to per-property reservation numbers (RES-000123).
 *
 * What it does (dry run by default; pass --apply to write):
 *   1. Drops the old global unique index on `reservationCode`. Numbers are now unique per property, and while
 *      that index exists the second property's first reservation is rejected. (The server also does this at
 *      startup, so deploy order does not matter; running it here just makes it explicit.)
 *   2. Builds the replacement index, unique on {tenantId, reservationCode}.
 *   3. Gives every reservation that has no code (or an empty one) the next number of its property, oldest first,
 *      through the same allocator the app uses.
 *
 * What it does NOT touch: reservations that already have a code. Codes are immutable — guests have them on
 * confirmations and emails — so the original B26X7KQ-style codes stay exactly as they are and keep working.
 *
 * Safe to run more than once: a second run finds nothing to do.
 *
 * Usage (from backend/):  npm run migrate:reservation-codes            # dry run
 *                         npm run migrate:reservation-codes -- --apply
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import type { Db } from 'mongodb';
import { allocateReservationCode } from '../services/reservationCode';
import { dropLegacyReservationCodeIndex, hasLegacyReservationCodeIndex } from '../services/reservationIndexes';
import { tenantLocalStorage } from '../middleware/tenantContext';
import '../models/Reservation';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export interface ReservationCodeReport {
  applied: boolean;
  legacyIndexPresent: boolean;
  withoutCode: number;
  withoutTenant: number;
  perTenant: Record<string, number>;
  backfilled: number;
}

const MISSING_CODE = { $or: [{ reservationCode: { $exists: false } }, { reservationCode: null }, { reservationCode: '' }] };

export async function migrateReservationCodes(db: Db, apply: boolean): Promise<ReservationCodeReport> {
  const reservations = db.collection('reservations');
  const counts = await reservations.aggregate<{ _id: unknown; n: number }>([
    { $match: MISSING_CODE },
    { $group: { _id: '$tenantId', n: { $sum: 1 } } },
  ]).toArray();

  const report: ReservationCodeReport = {
    applied: apply,
    legacyIndexPresent: await hasLegacyReservationCodeIndex(db),
    withoutCode: counts.reduce((sum, c) => sum + c.n, 0),
    withoutTenant: counts.filter((c) => !c._id).reduce((sum, c) => sum + c.n, 0),
    perTenant: Object.fromEntries(counts.filter((c) => c._id).map((c) => [String(c._id), c.n])),
    backfilled: 0,
  };
  if (!apply) return report;

  await dropLegacyReservationCodeIndex(db);
  await mongoose.model('Reservation').init(); // builds {tenantId, reservationCode}

  for (const tenantId of Object.keys(report.perTenant)) {
    // Oldest first, so numbers follow the order the reservations were made in.
    const cursor = reservations.find({ tenantId: new mongoose.Types.ObjectId(tenantId), ...MISSING_CODE }, { projection: { _id: 1 } }).sort({ createdAt: 1, _id: 1 });
    for await (const doc of cursor) {
      const code = await tenantLocalStorage.run({ tenantId }, () => allocateReservationCode());
      const res = await reservations.updateOne({ _id: doc._id, ...MISSING_CODE }, { $set: { reservationCode: code } });
      if (res.modifiedCount) report.backfilled += 1;
    }
  }
  return report;
}

function print(report: ReservationCodeReport) {
  console.log(`\n${report.applied ? 'APPLIED' : 'DRY RUN'}`);
  console.log(`  Old global reservationCode index to drop ... ${report.legacyIndexPresent ? 'yes' : 'no'}`);
  console.log(`  Reservations without a code ................ ${report.withoutCode}`);
  for (const [tenantId, n] of Object.entries(report.perTenant)) console.log(`    property ${tenantId} ......... ${n}`);
  if (report.withoutTenant) console.log(`  ⚠️  Reservations without a property (skipped) ... ${report.withoutTenant}`);
  if (report.applied) console.log(`  Codes assigned ............................. ${report.backfilled}`);
  else console.log('\nℹ️  Nothing was written. Re-run with --apply to execute.');
}

async function run() {
  const apply = process.argv.slice(2).includes('--apply');
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;
  console.log(`✅ Connected to MongoDB (${db.databaseName})`);
  print(await migrateReservationCodes(db, apply));
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
}
