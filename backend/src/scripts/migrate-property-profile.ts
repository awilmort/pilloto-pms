/**
 * migrate-property-profile.ts
 *
 * One-off, idempotent move of the property's own details into the property profile
 * (`Tenant.profile`, services/propertyProfile.ts). Before it, the same data lived in three
 * places:
 *   - AppSettings.bookingSettings.contactPhone / contactEmail / contactAddress (booking engine)
 *   - AppSettings.channelManager.contact.* and channelManager.propertyType (channel manager)
 *   - Tenant.ecfConfig.rnc / razonSocial / nombreComercial / phone (e-invoicing)
 *
 * Per field, the first non-empty source wins: channel manager → booking engine → e-invoicing
 * (the channel-manager contact is the only structured address). A value already in the
 * profile is never overwritten. Sources that disagree are listed so someone can check them.
 * `ecfConfig.nombreComercial` is not copied (the commercial name is the tenant name); it is
 * reported when it differs.
 *
 * Dry run (default) prints, per tenant, what would be set and every conflict; writes nothing.
 * `--apply` sets the profile fields, then `$unset`s the old fields.
 *
 * Safe to run twice: a second run finds nothing to copy or unset.
 * Uses the raw driver, so the tenant plugin does not scope any query (all tenants are migrated).
 *
 * Usage:
 *   MONGODB_URI=<uri> npm run migrate:property-profile              # dry run
 *   MONGODB_URI=<uri> npm run migrate:property-profile -- --apply
 */

import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

type Str = string | undefined | null;
const PROFILE_FIELDS = ['legalName', 'rnc', 'email', 'phone', 'address', 'city', 'state', 'country', 'zipCode'] as const;
type ProfileField = typeof PROFILE_FIELDS[number];

export interface LegacySources {
  tenant: { name: string; profile?: Partial<Record<ProfileField, Str>>; ecfConfig?: { rnc?: Str; razonSocial?: Str; nombreComercial?: Str; phone?: Str } | null };
  settings?: {
    bookingSettings?: { contactPhone?: Str; contactEmail?: Str; contactAddress?: Str } | null;
    channelManager?: { contact?: Partial<Record<'email' | 'phone' | 'address' | 'city' | 'state' | 'country' | 'zipCode', Str>> | null; propertyType?: Str } | null;
  } | null;
}

export interface ProfileMigration {
  /** `$set` on the Tenant (`profile.<field>`) */
  set: Record<string, string>;
  /** Old Tenant paths to `$unset` */
  unsetTenant: string[];
  /** Old AppSettings paths to `$unset` */
  unsetSettings: string[];
  /** Human-readable notes on sources that disagree */
  conflicts: string[];
}

const clean = (v: Str) => (typeof v === 'string' ? v.trim() : '');
const same = (field: ProfileField, a: string, b: string) =>
  field === 'email' || field === 'country' ? a.toLowerCase() === b.toLowerCase() : a.replace(/\s+/g, ' ') === b.replace(/\s+/g, ' ');

/** Pure: what to copy, unset and report for one tenant. */
export function buildProfileMigration({ tenant, settings }: LegacySources): ProfileMigration {
  const cm = settings?.channelManager?.contact ?? {};
  const bs = settings?.bookingSettings ?? {};
  const ecf = tenant.ecfConfig ?? {};
  const sources: Record<ProfileField, Array<[string, Str]>> = {
    legalName: [['e-invoicing', ecf.razonSocial]],
    rnc: [['e-invoicing', ecf.rnc]],
    email: [['channel manager', cm.email], ['booking engine', bs.contactEmail]],
    phone: [['channel manager', cm.phone], ['booking engine', bs.contactPhone], ['e-invoicing', ecf.phone]],
    address: [['channel manager', cm.address], ['booking engine', bs.contactAddress]],
    city: [['channel manager', cm.city]],
    state: [['channel manager', cm.state]],
    country: [['channel manager', cm.country]],
    zipCode: [['channel manager', cm.zipCode]],
  };

  const out: ProfileMigration = { set: {}, unsetTenant: [], unsetSettings: [], conflicts: [] };
  for (const field of PROFILE_FIELDS) {
    const present = sources[field].map(([from, v]) => [from, clean(v)] as const).filter(([, v]) => v);
    const current = clean(tenant.profile?.[field]);
    const chosen = current || present[0]?.[1] || '';
    if (!current && chosen) {
      let value = chosen;
      if (field === 'country') value = chosen.toUpperCase();
      if (field === 'email') value = chosen.toLowerCase();
      if (field === 'rnc') value = chosen.replace(/-/g, '');
      out.set[`profile.${field}`] = value;
    }
    for (const [from, v] of present) {
      if (!same(field, v, chosen)) out.conflicts.push(`${field}: profile keeps "${chosen}", ${from} had "${v}"`);
    }
  }
  const nombreComercial = clean(ecf.nombreComercial);
  if (nombreComercial && nombreComercial !== tenant.name.trim()) {
    out.conflicts.push(`name: the property name stays "${tenant.name}", e-invoicing used the commercial name "${nombreComercial}"`);
  }

  for (const k of ['rnc', 'razonSocial', 'nombreComercial', 'phone'] as const) {
    if (ecf[k] !== undefined && ecf[k] !== null) out.unsetTenant.push(`ecfConfig.${k}`);
  }
  for (const k of ['contactPhone', 'contactEmail', 'contactAddress'] as const) {
    if (bs[k] !== undefined && bs[k] !== null) out.unsetSettings.push(`bookingSettings.${k}`);
  }
  if (settings?.channelManager?.contact) out.unsetSettings.push('channelManager.contact');
  if (settings?.channelManager?.propertyType !== undefined && settings?.channelManager?.propertyType !== null) out.unsetSettings.push('channelManager.propertyType');
  return out;
}

const isEmpty = (m: ProfileMigration) => !Object.keys(m.set).length && !m.unsetTenant.length && !m.unsetSettings.length;

async function run() {
  const apply = process.argv.slice(2).includes('--apply');
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;
  console.log(`✅ Connected to MongoDB (${db.databaseName}) — ${apply ? 'APPLY' : 'DRY RUN'}`);

  const tenants = await db.collection('tenants').find({}).project({ name: 1, slug: 1, profile: 1, ecfConfig: 1 }).toArray();
  let pending = 0;
  for (const t of tenants) {
    const settings = await db.collection('appsettings').findOne({ tenantId: t._id }, { projection: { bookingSettings: 1, channelManager: 1 } });
    const m = buildProfileMigration({ tenant: t as any, settings: settings as any });
    if (isEmpty(m) && !m.conflicts.length) continue;
    console.log(`\n🏨 ${t.name} [${t.slug}]`);
    for (const [k, v] of Object.entries(m.set)) console.log(`  + ${k} = "${v}"`);
    for (const k of m.unsetTenant) console.log(`  - tenant.${k}`);
    for (const k of m.unsetSettings) console.log(`  - appsettings.${k}`);
    for (const c of m.conflicts) console.log(`  ⚠️  ${c}`);
    if (isEmpty(m)) continue;
    pending++;
    if (!apply) continue;

    if (Object.keys(m.set).length || m.unsetTenant.length) {
      await db.collection('tenants').updateOne({ _id: t._id }, {
        ...(Object.keys(m.set).length ? { $set: m.set } : {}),
        ...(m.unsetTenant.length ? { $unset: Object.fromEntries(m.unsetTenant.map((k) => [k, ''])) } : {}),
      });
    }
    if (m.unsetSettings.length && settings) {
      await db.collection('appsettings').updateOne({ _id: settings._id }, { $unset: Object.fromEntries(m.unsetSettings.map((k) => [k, ''])) });
    }
  }

  if (!pending) console.log('\n✅ Nothing to migrate.');
  else if (!apply) console.log(`\nℹ️  Dry run — ${pending} tenant(s) to migrate, nothing written. Re-run with --apply to execute.`);
  else console.log(`\n🎉 ${pending} tenant(s) migrated.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
}
