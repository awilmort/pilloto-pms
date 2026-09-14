/**
 * migrate-app-roles.ts
 *
 * One-off, idempotent backfill for the `User.appRoles` / `User.isSuperAdmin`
 * fields.
 *
 * Pilloto's pre-existing role assignment is a flat `role: string` on User,
 * matched by name against a tenant-scoped `Role` document (see
 * `middleware/auth.ts`'s `authorizePermission`). Every such role predates
 * the Accounting app, so it maps 1:1 onto one `{app:'pms', role: <Role _id>}`
 * `appRoles` entry.
 *
 * `isSuperAdmin` (a *tenant-level* owner bypass, distinct from the
 * platform-level `role:'superadmin'` / `isPlatformRequest` concept) is set
 * for every user whose `role === 'admin'` — today's "full admin" — because
 * `authorizePermission` already treats that role as a full-access bypass
 * within its tenant.
 *
 * Platform users (`role: 'superadmin'`, no `tenantId`) are left untouched:
 * they don't belong to any tenant's Role collection, and their access is
 * already governed entirely by `authorize('superadmin')` /
 * `isPlatformRequest`, outside the per-app appRoles system.
 *
 * Safe to run twice: users that already have a non-empty `appRoles` array
 * are left untouched.
 *
 * Usage:
 *   MONGODB_URI=<uri> npx ts-node src/scripts/migrate-app-roles.ts
 */

import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');
  const db = mongoose.connection.db!;
  const users = db.collection('users');
  const roles = db.collection('roles');

  const candidates = await users
    .find({
      tenantId: { $exists: true, $ne: null },
      $or: [{ appRoles: { $exists: false } }, { appRoles: { $size: 0 } }],
    })
    .toArray();

  console.log(`\n📦 Tenant users missing 'appRoles': ${candidates.length}`);

  let migrated = 0;
  let skippedNoRole = 0;

  for (const user of candidates) {
    const roleName = String(user.role || '').toLowerCase();
    const roleDoc = await roles.findOne({
      tenantId: user.tenantId,
      app: 'pms',
      name: roleName,
    });

    if (!roleDoc) {
      console.warn(
        `  ⚠️  No matching pms Role for user ${user.email} (role: '${user.role}', tenantId: ${user.tenantId}) — skipped`
      );
      skippedNoRole++;
      continue;
    }

    const update: Record<string, unknown> = {
      appRoles: [{ app: 'pms', role: roleDoc._id }],
    };
    if (roleName === 'admin') {
      update.isSuperAdmin = true;
    }

    await users.updateOne({ _id: user._id }, { $set: update });
    migrated++;
  }

  console.log(`  ✅ Migrated ${migrated} user(s)`);
  if (skippedNoRole > 0) {
    console.warn(`  ⚠️  Skipped ${skippedNoRole} user(s) with no matching Role — investigate before proceeding.`);
  }

  const totalTenantUsers = await users.countDocuments({ tenantId: { $exists: true, $ne: null } });
  const withAppRoles = await users.countDocuments({
    tenantId: { $exists: true, $ne: null },
    appRoles: { $exists: true, $not: { $size: 0 } },
  });
  console.log(`\n🔍 Verification: ${withAppRoles}/${totalTenantUsers} tenant users have a non-empty 'appRoles' array`);
  if (withAppRoles !== totalTenantUsers) {
    console.warn('  ⚠️  Some tenant users still lack appRoles — investigate before proceeding.');
  }

  await mongoose.disconnect();
  console.log('\n🎉 Migration complete.');
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
