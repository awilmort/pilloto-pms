/**
 * seed.ts - Enterprise bootstrap seed
 *
 * Creates the minimum required data to run the platform:
 *   1. Superadmin user (no tenantId - platform-wide)
 *   2. One demo tenant + its admin user via provisionTenant()
 *
 * Safe to re-run: checks for existing records before inserting.
 * Does NOT delete any existing data.
 *
 * Usage: npm run seed
 *
 * Environment variables (all optional - safe defaults for local dev):
 *   SUPERADMIN_EMAIL        default: superadmin@pilloto.com
 *   SUPERADMIN_PASSWORD     default: change-me-now!
 *   SUPERADMIN_FIRST_NAME   default: Super
 *   SUPERADMIN_LAST_NAME    default: Admin
 *   DEMO_TENANT_NAME        default: Demo Property
 *   DEMO_TENANT_SLUG        default: demo
 *   DEMO_TENANT_PLAN        default: enterprise
 *   DEMO_ADMIN_EMAIL        default: admin@demo.pilloto.com
 *   DEMO_ADMIN_PASSWORD     default: change-me-now!
 *   DEMO_ADMIN_FIRST_NAME   default: Tenant
 *   DEMO_ADMIN_LAST_NAME    default: Admin
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

import User from '../models/User';
import Tenant from '../models/Tenant';
import { provisionTenant } from '../utils/provisionTenant';

dotenv.config();

// ---------------------------------------------------------------------------
// Configuration — sourced from environment variables with dev-safe defaults
// ---------------------------------------------------------------------------

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';

const SUPERADMIN_EMAIL      = process.env.SUPERADMIN_EMAIL      || 'superadmin@pilloto.com';
const SUPERADMIN_PASSWORD   = process.env.SUPERADMIN_PASSWORD   || 'change-me-now!';
const SUPERADMIN_FIRST_NAME = process.env.SUPERADMIN_FIRST_NAME || 'Super';
const SUPERADMIN_LAST_NAME  = process.env.SUPERADMIN_LAST_NAME  || 'Admin';

const DEMO_TENANT_NAME      = process.env.DEMO_TENANT_NAME        || 'Demo Property';
const DEMO_TENANT_SLUG      = process.env.DEMO_TENANT_SLUG        || 'demo';
const DEMO_TENANT_PLAN      = (process.env.DEMO_TENANT_PLAN as 'basic' | 'pro' | 'enterprise') || 'enterprise';
const DEMO_ADMIN_EMAIL      = process.env.DEMO_ADMIN_EMAIL        || 'admin@demo.pilloto.com';
const DEMO_ADMIN_PASSWORD   = process.env.DEMO_ADMIN_PASSWORD     || 'change-me-now!';
const DEMO_ADMIN_FIRST_NAME = process.env.DEMO_ADMIN_FIRST_NAME   || 'Tenant';
const DEMO_ADMIN_LAST_NAME  = process.env.DEMO_ADMIN_LAST_NAME    || 'Admin';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const seed = async () => {
  console.log('Pilloto — Enterprise Seed');
  console.log('-'.repeat(50));

  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB:', MONGO_URI);

    // ── 1. Superadmin user ──────────────────────────────────────────────────
    console.log('\n[1/2] Superadmin user...');
    const existingSuperadmin = await User.findOne({ email: SUPERADMIN_EMAIL });

    if (existingSuperadmin) {
      console.log('  Already exists — skipping.');
    } else {
      await User.create({
        firstName:     SUPERADMIN_FIRST_NAME,
        lastName:      SUPERADMIN_LAST_NAME,
        email:         SUPERADMIN_EMAIL,
        password:      SUPERADMIN_PASSWORD,
        role:          'superadmin',
        emailVerified: true,
        isActive:      true,
        // Intentionally no tenantId — this is a platform-level user.
      });
      console.log('  Created:', SUPERADMIN_EMAIL);
    }

    // ── 2. Demo tenant ──────────────────────────────────────────────────────
    console.log('\n[2/2] Demo tenant...');
    const existingTenant = await Tenant.findOne({ slug: DEMO_TENANT_SLUG });

    if (existingTenant) {
      console.log(`  Tenant "${DEMO_TENANT_SLUG}" already exists — skipping.`);
    } else {
      const result = await provisionTenant({
        name:           DEMO_TENANT_NAME,
        slug:           DEMO_TENANT_SLUG,
        plan:           DEMO_TENANT_PLAN,
        ownerEmail:     DEMO_ADMIN_EMAIL,
        adminFirstName: DEMO_ADMIN_FIRST_NAME,
        adminLastName:  DEMO_ADMIN_LAST_NAME,
        adminPassword:  DEMO_ADMIN_PASSWORD,
      });

      console.log('  Tenant provisioned:', result.tenant.name, `(${result.tenant.slug})`);
      console.log('  Tenant admin:', result.adminUser.email);
      console.log('  Roles, AppSettings, and uploads directory created automatically.');
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n' + '-'.repeat(50));
    console.log('Seed complete.\n');
    console.log('Platform:');
    console.log(`  Superadmin  ${SUPERADMIN_EMAIL}  /  ${SUPERADMIN_PASSWORD}`);
    console.log('\nDemo Tenant:');
    console.log(`  Slug   ${DEMO_TENANT_SLUG}`);
    console.log(`  Plan   ${DEMO_TENANT_PLAN}`);
    console.log(`  Admin  ${DEMO_ADMIN_EMAIL}  /  ${DEMO_ADMIN_PASSWORD}`);
    console.log('\n⚠  Change default passwords before deploying to production.');

  } catch (err) {
    console.error('\nSeed failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  }
};

seed();
