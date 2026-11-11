/**
 * One-off cleanup after the move from Citrus to BillingSoft for e-CF.
 *
 * What it does (dry run by default; pass --apply to write):
 *   1. Deletes every ElectronicInvoice. They are Citrus test-environment records: they have no
 *      BillingSoft document, so none of them could be refreshed, printed or referenced by a note.
 *   2. Clears the `electronicInvoiceId` link on invoices, credit notes and debit notes that pointed
 *      at them (the documents themselves are untouched).
 *   3. Removes the Citrus fields from every tenant's `ecfConfig` (token, base URL, environment,
 *      active flag, branch), keeping `defaultItbisRate`.
 *   4. Drops the old `{tenantId, eNCF}` unique index, which was sparse and so rejected two
 *      unconfirmed documents of one company; the app builds the partial replacement at startup.
 *
 * What it does NOT touch: journal entries. A posted entry is immutable; entries that came from a
 * deleted e-CF keep their reference, and are only counted here so the number is known.
 *
 * Usage (from backend/):  npm run migrate:citrus-to-billingsoft            # dry run
 *                         npm run migrate:citrus-to-billingsoft -- --apply
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import type { Db } from 'mongodb';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const CITRUS_TENANT_FIELDS = ['citrusToken', 'citrusBaseUrl', 'citrusTokenExpiresAt', 'ambiente', 'isActive', 'sucursal'];
const LINKED_COLLECTIONS = ['invoices', 'creditnotes', 'debitnotes'];
const OLD_INDEX = 'tenantId_1_eNCF_1';

export interface CleanupReport {
  applied: boolean;
  electronicInvoices: number;
  links: Record<string, number>;
  tenantsWithCitrusConfig: number;
  oldIndexPresent: boolean;
  journalEntriesKept: number;
}

/** True for the pre-BillingSoft index: unique and sparse (the replacement is partial, not sparse). */
const isOldIndex = (index: { name?: string; sparse?: boolean; partialFilterExpression?: unknown }) =>
  index.name === OLD_INDEX && index.sparse === true && !index.partialFilterExpression;

export async function cleanupCitrus(db: Db, apply: boolean): Promise<CleanupReport> {
  const electronicInvoices = db.collection('electronicinvoices');

  const links: Record<string, number> = {};
  for (const name of LINKED_COLLECTIONS) {
    links[name] = await db.collection(name).countDocuments({ electronicInvoiceId: { $exists: true } });
  }
  const citrusFilter = { $or: CITRUS_TENANT_FIELDS.map((f) => ({ [`ecfConfig.${f}`]: { $exists: true } })) };
  const indexes = await electronicInvoices.indexes().catch(() => [] as any[]);
  const report: CleanupReport = {
    applied: apply,
    electronicInvoices: await electronicInvoices.countDocuments({}),
    links,
    tenantsWithCitrusConfig: await db.collection('tenants').countDocuments(citrusFilter),
    oldIndexPresent: indexes.some(isOldIndex),
    journalEntriesKept: await db.collection('journalentries').countDocuments({ sourceModel: 'ElectronicInvoice' }),
  };
  if (!apply) return report;

  for (const name of LINKED_COLLECTIONS) {
    await db.collection(name).updateMany({ electronicInvoiceId: { $exists: true } }, { $unset: { electronicInvoiceId: '' } });
  }
  await electronicInvoices.deleteMany({});
  await db.collection('tenants').updateMany(
    citrusFilter,
    { $unset: Object.fromEntries(CITRUS_TENANT_FIELDS.map((f) => [`ecfConfig.${f}`, ''])) },
  );
  if (report.oldIndexPresent) await electronicInvoices.dropIndex(OLD_INDEX);
  return report;
}

function print(report: CleanupReport) {
  const mode = report.applied ? 'APPLIED' : 'DRY RUN';
  console.log(`\n${mode}`);
  console.log(`  ElectronicInvoice records to delete ........ ${report.electronicInvoices}`);
  for (const [name, count] of Object.entries(report.links)) console.log(`  ${name.padEnd(15)} links to clear ............. ${count}`);
  console.log(`  Tenants with Citrus fields in ecfConfig ..... ${report.tenantsWithCitrusConfig}`);
  console.log(`  Old sparse eNCF index to drop ............... ${report.oldIndexPresent ? 'yes' : 'no'}`);
  console.log(`  Journal entries that reference them (kept) .. ${report.journalEntriesKept}`);
  if (!report.applied) console.log('\nℹ️  Nothing was written. Re-run with --apply to execute.');
}

async function run() {
  const apply = process.argv.slice(2).includes('--apply');
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;
  console.log(`✅ Connected to MongoDB (${db.databaseName})`);
  print(await cleanupCitrus(db, apply));
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Cleanup failed:', err);
    process.exit(1);
  });
}
