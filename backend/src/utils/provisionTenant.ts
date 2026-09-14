/**
 * Tenant Provisioning Service
 *
 * Called when a super admin creates a new tenant.
 * Atomically sets up everything the tenant needs to start operating:
 *   1. Tenant document
 *   2. Default roles (admin, staff, customer, maintenance)
 *   3. Default AppSettings
 *   4. Initial admin user for the tenant
 *
 * The function runs inside the AsyncLocalStorage tenant context so that
 * the Mongoose plugin automatically scopes all created documents.
 */

import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import Tenant, { ITenantSettings, ITenantPlans } from '../models/Tenant';
import Role from '../models/Role';
import AppSettings from '../models/AppSettings';
import User from '../models/User';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { AppCode } from '../constants/apps';
import { seedDefaultChartOfAccounts } from './seedChartOfAccounts';

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  plan?: 'basic' | 'pro' | 'enterprise';
  ownerEmail: string;
  adminFirstName: string;
  adminLastName: string;
  /** Plain-text; hashed before saving */
  adminPassword: string;
  settings?: ITenantSettings;
  /** Products this tenant is provisioned with. Defaults to `['pms']` (the schema default) if omitted. */
  products?: AppCode[];
  /** Per-product plan tiers (currently only `accounting` has its own ladder — see `config/accountingPlans.ts`). */
  plans?: ITenantPlans;
}

export interface ProvisionTenantResult {
  tenant: InstanceType<typeof Tenant>;
  adminUser: { _id: string; email: string; role: string };
}

// Default PMS roles provisioned for every new tenant
const DEFAULT_ROLES = [
  { name: 'admin',       description: 'Full access',                  permissions: ['admin.access'] },
  { name: 'customer',    description: 'No admin access',               permissions: [] },
  { name: 'maintenance', description: 'Access only to Accommodations', permissions: ['accommodations.manage'] },
  { name: 'staff',       description: 'Access only to Schedule',       permissions: ['schedule.view'] },
];

// Default Accounting roles — only seeded when 'accounting' is in the tenant's
// products at provisioning time (Phase 2.2).
const DEFAULT_ACCOUNTING_ROLES = [
  { name: 'admin', description: 'Full access to Accounting', permissions: ['accounting.access'] },
  {
    name: 'staff',
    description: 'View-only access to invoices, bills, and reports',
    permissions: ['accounting.invoices.view', 'accounting.quotes.view', 'accounting.creditNotes.view', 'accounting.debitNotes.view', 'accounting.bills.view', 'accounting.reports.view', 'accounting.cityLedger.view'],
  },
];

export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  const { name, slug, plan = 'basic', ownerEmail, adminFirstName, adminLastName, adminPassword, settings, products, plans } = input;

  // Default plans.accounting to 'starter' when the tenant is being provisioned with
  // the accounting product but no explicit tier was chosen — mirrors `plan`'s own
  // `= 'basic'` default above, per Phase 10.2.
  const resolvedPlans: ITenantPlans = { ...plans };
  if (products?.includes('accounting') && !resolvedPlans.accounting) {
    resolvedPlans.accounting = 'starter';
  }

  // ── 1. Create the Tenant document (unscoped — Tenant is not tenant-scoped) ─
  const tenant = await Tenant.create({
    name, slug, plan, ownerEmail, isActive: true,
    settings: settings ?? {},
    ...(products ? { products } : {}),
    plans: resolvedPlans,
  });
  const tenantId = (tenant._id as any).toString();

  // ── 2. Run all subsequent operations inside the tenant's async context ──────
  return tenantLocalStorage.run({ tenantId }, async () => {
    // ── 3. Seed default PMS roles ────────────────────────────────────────────────
    const seededRoles = new Map<string, InstanceType<typeof Role>>();
    for (const r of DEFAULT_ROLES) {
      const role = await Role.create({ ...r, app: 'pms', isSystem: true, tenantId });
      seededRoles.set(r.name, role);
    }

    // ── 3b. Seed default Accounting roles + Chart of Accounts, only for tenants that bought it ──
    if (tenant.products.includes('accounting')) {
      for (const r of DEFAULT_ACCOUNTING_ROLES) {
        await Role.create({ ...r, app: 'accounting', isSystem: true, tenantId });
      }
      await seedDefaultChartOfAccounts();
    }

    // ── 4. Seed default AppSettings ────────────────────────────────────────────
    await AppSettings.create({
      tenantId,
      key: 'global',
      services: { daypass: true, accommodation: true, pasatarde: true, event: true },
      sections: {
        dashboard: true, revenue: true, commissions: true,
        schedule: true, accommodations: true, rooms: true,
        amenities: true, 'event-types': true, wristbands: true,
        pricing: true, reservations: true, users: true,
        roles: true, media: true, analytics: true,
        companies: true, guests: true, 'cashier-closures': true,
      },
      checkoutTime: '11:00',
    });

    // ── 5. Create the initial admin user ───────────────────────────────────────
    const adminRole = seededRoles.get('admin')!;
    const adminUser = await User.create({
      firstName: adminFirstName,
      lastName:  adminLastName,
      email:     ownerEmail,
      password:  adminPassword,  // pre-save hook in User schema hashes it
      role:      'admin',
      appRoles:  [{ app: 'pms', role: adminRole._id }],
      isSuperAdmin: true, // tenant-owner bypass across this tenant's own apps
      isActive:  true,
      emailVerified: true,
      tenantId,
    });

    // ── 6. Create uploads directory for this tenant ────────────────────────────
    try {
      const uploadsBase = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
      const tenantUploadsDir = path.join(uploadsBase, tenantId);
      if (!fs.existsSync(tenantUploadsDir)) {
        fs.mkdirSync(tenantUploadsDir, { recursive: true });
      }
    } catch (e) {
      console.warn(`Could not create uploads directory for tenant ${tenantId}:`, e);
    }

    return {
      tenant,
      adminUser: {
        _id:   (adminUser._id as any).toString(),
        email: adminUser.email,
        role:  adminUser.role,
      },
    };
  });
}

/**
 * Adds the Accounting product to an already-provisioned tenant (the "existing
 * PMS tenant adds Accounting" rollout path from Phase 10.2 — the counterpart to
 * `provisionTenant`'s own accounting branch, which only runs for brand-new
 * tenants). Idempotent: safe to call even if some/all of this was already
 * seeded (e.g. re-running after a partial failure, or calling it twice).
 *
 * Does not touch `Tenant.products`/`Tenant.plans` — the caller (the superadmin
 * `PATCH /tenants/:id` route) owns that write; this only seeds the Accounting
 * app's default roles and Chart of Accounts, exactly mirroring step 3b of
 * `provisionTenant` above.
 */
export async function ensureAccountingProvisioned(tenantId: string): Promise<void> {
  return tenantLocalStorage.run({ tenantId }, async () => {
    const existingRoleNames = new Set(
      (await Role.find({ app: 'accounting', isSystem: true }).select('name').lean()).map((r: any) => r.name)
    );
    for (const r of DEFAULT_ACCOUNTING_ROLES) {
      if (!existingRoleNames.has(r.name)) {
        await Role.create({ ...r, app: 'accounting', isSystem: true, tenantId });
      }
    }
    await seedDefaultChartOfAccounts();
  });
}
