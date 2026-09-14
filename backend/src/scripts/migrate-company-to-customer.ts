/**
 * migrate-company-to-customer.ts
 *
 * One-off, idempotent backfill for the `Customer` model. Before this change,
 * `Invoice.customer`/`Quote.customer`/`CreditNote.customer`/`DebitNote.customer`
 * referenced the PMS-side `Company` collection directly. Those refs now point
 * at a `customers` collection instead, so every `Company` document that was
 * ever actually used as an AR customer needs a matching `Customer` document.
 *
 * Strategy: for every distinct Company `_id` referenced by `customer` on an existing
 * invoice/quote/creditNote/debitNote, copy that Company document into `customers` **using the
 * same `_id`** — this means every existing `Invoice.customer` (etc.) ObjectId keeps resolving
 * correctly with zero document rewrites on the AR side. The new Customer document's
 * `linkedCompanyId` is set to its own id (self-link), marking that it originated from — and is
 * still the same real-world entity as — a PMS `Company`.
 *
 * Purely additive: no `Company` documents are modified or deleted, and no AR documents are
 * touched. Safe to run twice — Company ids that already have a matching Customer document are
 * skipped.
 *
 * Usage:
 *   MONGODB_URI=<uri> npx ts-node src/scripts/migrate-company-to-customer.ts
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
  const companies = db.collection('companies');
  const customers = db.collection('customers');
  const arCollections = ['invoices', 'quotes', 'creditnotes', 'debitnotes'];

  const referencedIds = new Set<string>();
  for (const collName of arCollections) {
    const coll = db.collection(collName);
    const ids = await coll.distinct('customer', { customer: { $exists: true, $ne: null } });
    for (const id of ids) referencedIds.add(String(id));
  }
  console.log(`\n📦 Distinct Company ids referenced as an AR customer: ${referencedIds.size}`);

  let migrated = 0;
  let skippedAlreadyPresent = 0;
  let skippedMissingCompany = 0;

  for (const idStr of referencedIds) {
    const objectId = new mongoose.Types.ObjectId(idStr);

    const alreadyExists = await customers.findOne({ _id: objectId }, { projection: { _id: 1 } });
    if (alreadyExists) {
      skippedAlreadyPresent++;
      continue;
    }

    const company = await companies.findOne({ _id: objectId });
    if (!company) {
      skippedMissingCompany++;
      console.warn(`  ⚠️  Company ${idStr} referenced by an AR document no longer exists — skipping`);
      continue;
    }

    const { _id, ...companyFields } = company;
    await customers.insertOne({
      _id,
      ...companyFields,
      linkedCompanyId: _id,
    });
    migrated++;
  }

  console.log(`\n✅ Migrated: ${migrated}`);
  console.log(`⏭️  Already present: ${skippedAlreadyPresent}`);
  if (skippedMissingCompany > 0) console.log(`⚠️  Referenced Company missing (dangling ref, unmigrated): ${skippedMissingCompany}`);

  // Verification: every referenced id should now resolve in `customers`.
  let stillMissing = 0;
  for (const idStr of referencedIds) {
    const objectId = new mongoose.Types.ObjectId(idStr);
    const exists = await customers.findOne({ _id: objectId }, { projection: { _id: 1 } });
    if (!exists) stillMissing++;
  }
  console.log(`\n🔍 Verification: ${referencedIds.size - stillMissing}/${referencedIds.size} referenced customer ids resolve in 'customers'`);
  if (stillMissing > 0) {
    console.warn(`  ⚠️  ${stillMissing} referenced id(s) still unresolved — investigate before proceeding (likely the dangling-Company case above).`);
  }

  await mongoose.disconnect();
  console.log('\n🎉 Migration complete.');
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
