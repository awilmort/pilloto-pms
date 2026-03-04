/**
 * migrate-to-multitenant.ts
 *
 * One-time migration script that converts a single-tenant Pilloto database
 * to the multi-tenant schema.
 *
 * What it does:
 *   1. Creates a Tenant document for the existing property.
 *   2. Back-fills `tenantId` on every document in every collection.
 *   3. Drops the old global unique indexes and creates compound ones.
 *   4. Converts existing AppSettings to be scoped to the new tenant.
 *   5. Creates a superadmin user (platform owner) with no tenantId.
 *   6. Renames the flat uploads/ directory to uploads/<tenantId>/.
 *
 * Usage:
 *   # Set env vars first (copy from your .env or pass inline)
 *   MONGODB_URI=<uri> \
 *   FIRST_TENANT_NAME="Hotel Pilloto" \
 *   FIRST_TENANT_SLUG="pilloto" \
 *   FIRST_TENANT_OWNER_EMAIL="admin@pilloto.com" \
 *   SUPERADMIN_EMAIL="owner@yourcompany.com" \
 *   SUPERADMIN_PASSWORD="change-me-in-prod" \
 *   npx ts-node src/scripts/migrate-to-multitenant.ts
 *
 * ⚠️  Run against a backup/staging first. Test thoroughly before production.
 */

import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';
const FIRST_TENANT_NAME  = process.env.FIRST_TENANT_NAME  || 'Pilloto';
const FIRST_TENANT_SLUG  = process.env.FIRST_TENANT_SLUG  || 'pilloto';
const FIRST_TENANT_OWNER = process.env.FIRST_TENANT_OWNER_EMAIL || 'admin@pilloto.com';
const SUPERADMIN_EMAIL   = process.env.SUPERADMIN_EMAIL    || 'superadmin@pilloto.com';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'change-me-now!';

// Collections that need tenantId back-filled
const TENANT_COLLECTIONS = [
  'users', 'roles', 'rooms', 'reservations', 'guests',
  'media', 'amenities', 'eventtypes', 'appSettings',
  'pricings', 'companies', 'creditaccounts',
  'folios', 'payments', 'charges', 'wristbanddeliveries', 'cashierclosures',
];

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');
  const db = mongoose.connection.db!;

  // ── 1. Create the first tenant ──────────────────────────────────────────────
  console.log(`\n📦 Creating tenant: ${FIRST_TENANT_NAME} (${FIRST_TENANT_SLUG})`);
  const tenants = db.collection('tenants');
  let tenant = await tenants.findOne({ slug: FIRST_TENANT_SLUG });
  if (!tenant) {
    const result = await tenants.insertOne({
      name: FIRST_TENANT_NAME,
      slug: FIRST_TENANT_SLUG,
      plan: 'pro',
      isActive: true,
      ownerEmail: FIRST_TENANT_OWNER,
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tenant = await tenants.findOne({ _id: result.insertedId });
    console.log(`  ✅ Tenant created: ${tenant!._id}`);
  } else {
    console.log(`  ℹ️  Tenant already exists: ${tenant._id}`);
  }

  const tenantObjectId = tenant!._id;

  // ── 2. Back-fill tenantId on all collections ────────────────────────────────
  console.log('\n🔄 Back-filling tenantId on all collections...');
  for (const collName of TENANT_COLLECTIONS) {
    const coll = db.collection(collName);
    const result = await coll.updateMany(
      { tenantId: { $exists: false } },
      { $set: { tenantId: tenantObjectId } }
    );
    if (result.modifiedCount > 0) {
      console.log(`  ✅ ${collName}: ${result.modifiedCount} documents updated`);
    } else {
      console.log(`  ⏭️  ${collName}: no update needed`);
    }
  }

  // ── 3. Drop old global unique indexes and create compound ones ──────────────
  console.log('\n🗂️  Rebuilding indexes...');

  async function reindex(
    collName: string,
    oldIndex: string,
    newIndex: Record<string, any>,
    options: Record<string, any> = { unique: true }
  ) {
    const coll = db.collection(collName);
    try {
      await coll.dropIndex(oldIndex);
      console.log(`  ✅ ${collName}: dropped old index '${oldIndex}'`);
    } catch (e: any) {
      if (e.codeName !== 'IndexNotFound') console.warn(`  ⚠️  ${collName}: could not drop '${oldIndex}': ${e.message}`);
    }
    await coll.createIndex(newIndex, options);
    console.log(`  ✅ ${collName}: created compound index ${JSON.stringify(newIndex)}`);
  }

  await reindex('users',       'email_1',                         { email: 1, tenantId: 1 });
  await reindex('roles',       'name_1',                          { name: 1, tenantId: 1 });
  await reindex('guests',      'email_1',                         { email: 1, tenantId: 1 });
  await reindex('eventtypes',  'type_1',                          { type: 1, tenantId: 1 });
  await reindex('appsettings', 'key_1',                           { tenantId: 1 }, { unique: true });
  await reindex('media',       'filename_1',                      { filename: 1, tenantId: 1 });
  await reindex('media',       'url_1',                           { url: 1, tenantId: 1 });
  await reindex('creditaccounts', 'scope_1_referenceId_1',        { scope: 1, referenceId: 1, tenantId: 1 });
  await reindex('cashierclosures', 'user_1_periodStart_1_periodEnd_1', { user: 1, periodStart: 1, periodEnd: 1, tenantId: 1 });

  // ── 4. AppSettings: ensure key is not globally unique any more ──────────────
  // (already handled by the 'key_1' drop above)

  // ── 5. Create superadmin user ───────────────────────────────────────────────
  console.log('\n👤 Creating superadmin user...');
  const users = db.collection('users');
  const existingSA = await users.findOne({ email: SUPERADMIN_EMAIL, role: 'superadmin' });
  if (!existingSA) {
    const hashed = await bcrypt.hash(SUPERADMIN_PASSWORD, 12);
    await users.insertOne({
      firstName: 'Super',
      lastName:  'Admin',
      email: SUPERADMIN_EMAIL,
      password: hashed,
      role: 'superadmin',
      isActive: true,
      emailVerified: true,
      loginAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      // intentionally no tenantId — superadmin is platform-wide
    });
    console.log(`  ✅ Superadmin created: ${SUPERADMIN_EMAIL}`);
    console.log(`  ⚠️  Change the password immediately! (SUPERADMIN_PASSWORD env var)`);
  } else {
    console.log(`  ℹ️  Superadmin already exists`);
  }

  // ── 6. Namespace existing uploads directory ────────────────────────────────
  console.log('\n📁 Namespacing uploads directory...');
  const uploadsBase = process.env.UPLOADS_DIR || path.join(__dirname, '../../../uploads');
  const tenantUploadsDir = path.join(uploadsBase, tenantObjectId.toString());
  if (fs.existsSync(uploadsBase) && !fs.existsSync(tenantUploadsDir)) {
    fs.mkdirSync(tenantUploadsDir, { recursive: true });
    const files = fs.readdirSync(uploadsBase).filter(f => {
      const fp = path.join(uploadsBase, f);
      return fs.statSync(fp).isFile();
    });
    for (const file of files) {
      fs.renameSync(path.join(uploadsBase, file), path.join(tenantUploadsDir, file));
    }
    console.log(`  ✅ Moved ${files.length} file(s) to uploads/${tenantObjectId}/`);

    // Update media documents to use new URLs
    const media = db.collection('media');
    const mediaResult = await media.updateMany(
      { url: /^\/uploads\/[^/]+$/ },  // matches /uploads/filename (no sub-dir)
      [{ $set: { url: { $concat: [`/uploads/${tenantObjectId}/`, { $arrayElemAt: [{ $split: ['$url', '/'] }, -1] }] } } }]
    );
    console.log(`  ✅ Updated ${mediaResult.modifiedCount} media URL(s) to tenant sub-path`);
  } else {
    console.log('  ⏭️  Skipped (already namespaced or uploads dir not found)');
  }

  await mongoose.disconnect();
  console.log('\n🎉 Migration complete! Please restart the server and verify everything works.');
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
