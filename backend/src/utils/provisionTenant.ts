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
import Tenant, { ITenantSettings } from '../models/Tenant';
import Role from '../models/Role';
import AppSettings from '../models/AppSettings';
import User from '../models/User';
import { tenantLocalStorage } from '../middleware/tenantContext';

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
}

export interface ProvisionTenantResult {
  tenant: InstanceType<typeof Tenant>;
  adminUser: { _id: string; email: string; role: string };
}

// Default roles provisioned for every new tenant
const DEFAULT_ROLES = [
  { name: 'admin',       description: 'Full access',                  permissions: ['admin.access'] },
  { name: 'customer',    description: 'No admin access',               permissions: [] },
  { name: 'maintenance', description: 'Access only to Accommodations', permissions: ['accommodations.manage'] },
  { name: 'staff',       description: 'Access only to Schedule',       permissions: ['schedule.view'] },
];

export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  const { name, slug, plan = 'basic', ownerEmail, adminFirstName, adminLastName, adminPassword, settings } = input;

  // ── 1. Create the Tenant document (unscoped — Tenant is not tenant-scoped) ─
  const tenant = await Tenant.create({ name, slug, plan, ownerEmail, isActive: true, settings: settings ?? {} });
  const tenantId = (tenant._id as any).toString();

  // ── 2. Run all subsequent operations inside the tenant's async context ──────
  return tenantLocalStorage.run({ tenantId }, async () => {
    // ── 3. Seed default roles ──────────────────────────────────────────────────
    for (const r of DEFAULT_ROLES) {
      await Role.create({ ...r, tenantId });
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
    });

    // ── 5. Create the initial admin user ───────────────────────────────────────
    const adminUser = await User.create({
      firstName: adminFirstName,
      lastName:  adminLastName,
      email:     ownerEmail,
      password:  adminPassword,  // pre-save hook in User schema hashes it
      role:      'admin',
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
