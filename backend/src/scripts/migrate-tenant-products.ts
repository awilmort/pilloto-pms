/**
 * migrate-tenant-products.ts
 *
 * One-off, idempotent backfill for the new `Tenant.products` field
 * (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md §0.2). Every tenant created
 * before this field existed has no `products` array; this script gives
 * each of them `products: ['pms']` — the only product that existed prior
 * to Accounting.
 *
 * Safe to run twice: tenants that already have a `products` field
 * (non-empty array) are left untouched.
 *
 * Usage:
 *   MONGODB_URI=<uri> npx ts-node src/scripts/migrate-tenant-products.ts
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
  const tenants = db.collection('tenants');

  const missing = await tenants.countDocuments({
    $or: [{ products: { $exists: false } }, { products: { $size: 0 } }],
  });
  console.log(`\n📦 Tenants missing 'products': ${missing}`);

  if (missing > 0) {
    const result = await tenants.updateMany(
      { $or: [{ products: { $exists: false } }, { products: { $size: 0 } }] },
      { $set: { products: ['pms'] } }
    );
    console.log(`  ✅ Backfilled 'products: [\"pms\"]' on ${result.modifiedCount} tenant(s)`);
  } else {
    console.log('  ⏭️  Nothing to backfill');
  }

  const total = await tenants.countDocuments({});
  const withProducts = await tenants.countDocuments({ products: { $exists: true, $not: { $size: 0 } } });
  console.log(`\n🔍 Verification: ${withProducts}/${total} tenants have a non-empty 'products' array`);
  if (withProducts !== total) {
    console.warn('  ⚠️  Some tenants still lack a products array — investigate before proceeding.');
  }

  await mongoose.disconnect();
  console.log('\n🎉 Migration complete.');
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
