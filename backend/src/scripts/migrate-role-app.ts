/**
 * migrate-role-app.ts
 *
 * One-off, idempotent backfill for the `Role.app` / `Role.isSystem`
 * fields. Every Role document created before this change predates the
 * Accounting app, so it
 * is unambiguously a `pms` role. The four roles seeded by
 * `provisionTenant.ts` (`admin`, `customer`, `maintenance`, `staff`) are
 * additionally marked `isSystem: true`, matching the new delete-guard in
 * `routes/roles.ts`.
 *
 * Also drops the pre-0.3 unique index `{name, tenantId}`, superseded by the
 * schema's `{tenantId, app, name}` compound index — Mongoose's `autoIndex`
 * creates missing indexes but never drops extras, so the old one survives
 * deployment. Left in place, it collides the moment two roles share a name
 * across apps for the same tenant (e.g. an `accounting` `admin` role once a
 * `pms` `admin` role already exists).
 *
 * Safe to run twice: roles that already have an `app` field are left
 * untouched, and dropping an already-absent index is a no-op.
 *
 * Usage:
 *   MONGODB_URI=<uri> npx ts-node src/scripts/migrate-role-app.ts
 */

import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';

const SYSTEM_ROLE_NAMES = ['admin', 'customer', 'maintenance', 'staff'];

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');
  const db = mongoose.connection.db!;
  const roles = db.collection('roles');

  const missing = await roles.countDocuments({ app: { $exists: false } });
  console.log(`\n📦 Roles missing 'app': ${missing}`);

  if (missing > 0) {
    const backfillResult = await roles.updateMany(
      { app: { $exists: false } },
      { $set: { app: 'pms' } }
    );
    console.log(`  ✅ Backfilled 'app: "pms"' on ${backfillResult.modifiedCount} role(s)`);

    const systemResult = await roles.updateMany(
      { name: { $in: SYSTEM_ROLE_NAMES }, app: 'pms', isSystem: { $ne: true } },
      { $set: { isSystem: true } }
    );
    console.log(`  ✅ Marked ${systemResult.modifiedCount} core role(s) as 'isSystem: true'`);
  } else {
    console.log('  ⏭️  Nothing to backfill');
  }

  const total = await roles.countDocuments({});
  const withApp = await roles.countDocuments({ app: { $exists: true } });
  console.log(`\n🔍 Verification: ${withApp}/${total} roles have an 'app' field`);
  if (withApp !== total) {
    console.warn('  ⚠️  Some roles still lack an app field — investigate before proceeding.');
  }

  const existingIndexes = await roles.indexes();
  const staleIndex = existingIndexes.find((idx) => idx.name === 'name_1_tenantId_1');
  if (staleIndex) {
    await roles.dropIndex('name_1_tenantId_1');
    console.log("  ✅ Dropped stale pre-0.3 unique index 'name_1_tenantId_1'");
  } else {
    console.log("  ⏭️  Stale index 'name_1_tenantId_1' already absent");
  }

  await mongoose.disconnect();
  console.log('\n🎉 Migration complete.');
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
