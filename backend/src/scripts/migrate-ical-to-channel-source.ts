/**
 * migrate-ical-to-channel-source.ts
 *
 * One-off, idempotent retirement of the iCal OTA sync data (CHANNEX_ARCHITECTURE.md §12).
 *
 * Dry run (default) prints, without writing anything:
 *   - per tenant: active iCal mappings, their OTAs and last sync time (the tenants to notify
 *     that OTA calendar sync stops until their Channex onboarding);
 *   - document counts that `--apply` would export, convert, drop or unset.
 *
 * `--apply`:
 *   1. Exports the four OTA collections, every reservation's `otaSource`, every
 *      `AppSettings.otaSettings` and `PlatformSettings.otaSync` to EJSON files in the
 *      output directory (`--out <dir>`, default `./ical-export-<timestamp>`).
 *   2. Converts `Reservation.otaSource` → `channelSource { provider: 'ical_legacy', otaName,
 *      importedAt }` (an existing `channelSource` is kept) and `$unset`s `otaSource`.
 *   3. Drops `otalistingmappings`, `otaexternalevents`, `otasyncruns`, `otaconflicts`.
 *   4. `$unset`s `otaSettings` from `appsettings` and `otaSync` from `platformsettings`.
 *
 * Safe to run twice: a second run finds nothing to export, convert, drop or unset.
 * Uses the raw driver, so the tenant plugin does not scope any query (all tenants are migrated).
 *
 * Usage:
 *   MONGODB_URI=<uri> npm run migrate:ical-to-channel-source              # dry run
 *   MONGODB_URI=<uri> npm run migrate:ical-to-channel-source -- --apply [--out <dir>]
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export const OTA_COLLECTIONS = ['otalistingmappings', 'otaexternalevents', 'otasyncruns', 'otaconflicts'] as const;

export interface LegacyOtaSource {
  provider?: string;
  importedAt?: Date;
  [key: string]: unknown;
}

export interface LegacyChannelSource {
  provider: 'ical_legacy';
  otaName?: string;
  importedAt?: Date;
}

/** `otaSource` → `channelSource` for an iCal-imported reservation. */
export function toChannelSource(otaSource: LegacyOtaSource): LegacyChannelSource {
  const channelSource: LegacyChannelSource = { provider: 'ical_legacy' };
  if (typeof otaSource.provider === 'string' && otaSource.provider) channelSource.otaName = otaSource.provider;
  if (otaSource.importedAt instanceof Date) channelSource.importedAt = otaSource.importedAt;
  return channelSource;
}

/**
 * The update for one reservation still carrying `otaSource`. An existing `channelSource`
 * (e.g. a Channex booking) is never overwritten; `otaSource` is removed either way.
 */
export function buildReservationUpdate(doc: { otaSource?: LegacyOtaSource; channelSource?: unknown }) {
  const update: { $unset: { otaSource: '' }; $set?: { channelSource: LegacyChannelSource } } = {
    $unset: { otaSource: '' },
  };
  if (!doc.channelSource && doc.otaSource) update.$set = { channelSource: toChannelSource(doc.otaSource) };
  return update;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 && argv[outIdx + 1]
    ? path.resolve(argv[outIdx + 1])
    : path.resolve(`ical-export-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  return { apply, outDir };
}

async function run() {
  const { apply, outDir } = parseArgs(process.argv.slice(2));
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;
  console.log(`✅ Connected to MongoDB (${db.databaseName}) — ${apply ? 'APPLY' : 'DRY RUN'}`);

  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const otaCollections = OTA_COLLECTIONS.filter((name) => existing.has(name));
  const reservations = db.collection('reservations');
  const appSettings = db.collection('appsettings');
  const platformSettings = db.collection('platformsettings');

  // ── Report: tenants with active iCal mappings ─────────────────────────────
  if (otaCollections.includes('otalistingmappings')) {
    const perTenant = await db.collection('otalistingmappings').aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$tenantId', mappings: { $sum: 1 }, otas: { $addToSet: '$provider' }, lastSync: { $max: '$lastSyncedAt' } } },
      { $lookup: { from: 'tenants', localField: '_id', foreignField: '_id', as: 'tenant' } },
      { $sort: { lastSync: -1 } },
    ]).toArray();
    console.log(`\n📋 Tenants with active iCal mappings: ${perTenant.length}`);
    for (const row of perTenant) {
      const t = row.tenant?.[0];
      const lastSync = row.lastSync ? new Date(row.lastSync).toISOString() : 'never';
      console.log(`  - ${t?.name ?? '(unknown tenant)'} [${t?.slug ?? row._id}] — ${row.mappings} mapping(s), OTAs: ${(row.otas || []).join(', ') || '-'}, last sync: ${lastSync}`);
    }
  }

  // ── Counts ────────────────────────────────────────────────────────────────
  const otaSourceFilter = { otaSource: { $exists: true } };
  const counts: Record<string, number> = {};
  for (const name of otaCollections) counts[name] = await db.collection(name).countDocuments();
  const reservationCount = await reservations.countDocuments(otaSourceFilter);
  const appSettingsCount = await appSettings.countDocuments({ otaSettings: { $exists: true } });
  const platformSettingsCount = await platformSettings.countDocuments({ otaSync: { $exists: true } });

  console.log('\n📦 To export and drop:');
  if (otaCollections.length === 0) console.log('  (no OTA collections present)');
  for (const name of otaCollections) console.log(`  - ${name}: ${counts[name]} document(s)`);
  console.log(`🔁 Reservations with otaSource to convert: ${reservationCount}`);
  console.log(`🧹 AppSettings with otaSettings to unset: ${appSettingsCount}`);
  console.log(`🧹 PlatformSettings with otaSync to unset: ${platformSettingsCount}`);

  const nothingToDo = otaCollections.length === 0 && reservationCount === 0 && appSettingsCount === 0 && platformSettingsCount === 0;
  if (nothingToDo) {
    console.log('\n✅ Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }
  if (!apply) {
    console.log('\nℹ️  Dry run — nothing written. Re-run with --apply to execute.');
    await mongoose.disconnect();
    return;
  }

  // ── 1. Export ─────────────────────────────────────────────────────────────
  const { EJSON } = mongoose.mongo.BSON;
  fs.mkdirSync(outDir, { recursive: true });
  const writeExport = (file: string, docs: unknown[]) => {
    fs.writeFileSync(path.join(outDir, file), EJSON.stringify(docs, undefined, 2, { relaxed: false }));
    console.log(`  💾 ${file}: ${docs.length} document(s)`);
  };
  console.log(`\n💾 Exporting to ${outDir}`);
  for (const name of otaCollections) writeExport(`${name}.json`, await db.collection(name).find().toArray());
  writeExport('reservations.otaSource.json', await reservations.find(otaSourceFilter, { projection: { tenantId: 1, reservationCode: 1, otaSource: 1 } }).toArray());
  writeExport('appsettings.otaSettings.json', await appSettings.find({ otaSettings: { $exists: true } }, { projection: { tenantId: 1, otaSettings: 1 } }).toArray());
  writeExport('platformsettings.otaSync.json', await platformSettings.find({ otaSync: { $exists: true } }, { projection: { key: 1, otaSync: 1 } }).toArray());

  // ── 2. Convert reservations ───────────────────────────────────────────────
  let converted = 0;
  let batch: any[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const res = await reservations.bulkWrite(batch, { ordered: false });
    converted += res.modifiedCount;
    batch = [];
  };
  const cursor = reservations.find(otaSourceFilter, { projection: { otaSource: 1, channelSource: 1 } });
  for await (const doc of cursor) {
    batch.push({ updateOne: { filter: { _id: doc._id }, update: buildReservationUpdate(doc as any) } });
    if (batch.length >= 500) await flush();
  }
  await flush();
  console.log(`\n🔁 Reservations converted: ${converted}`);

  // ── 3. Drop collections ───────────────────────────────────────────────────
  for (const name of otaCollections) {
    await db.dropCollection(name);
    console.log(`🗑️  Dropped ${name}`);
  }

  // ── 4. Unset settings ─────────────────────────────────────────────────────
  const appRes = await appSettings.updateMany({ otaSettings: { $exists: true } }, { $unset: { otaSettings: '' } });
  const platRes = await platformSettings.updateMany({ otaSync: { $exists: true } }, { $unset: { otaSync: '' } });
  console.log(`🧹 AppSettings otaSettings unset: ${appRes.modifiedCount}`);
  console.log(`🧹 PlatformSettings otaSync unset: ${platRes.modifiedCount}`);

  const remaining = await reservations.countDocuments(otaSourceFilter);
  console.log(`\n🔍 Verification: reservations still carrying otaSource: ${remaining}`);

  await mongoose.disconnect();
  console.log('\n🎉 Migration complete. Keep the export directory for 90 days.');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
}
