/**
 * create-superadmin.ts — One-shot production superadmin bootstrap
 *
 * Run this ONCE during first deployment to create the platform superadmin.
 * It will refuse to run if:
 *   - Required env vars are missing
 *   - A superadmin user already exists in the database
 *
 * Usage:
 *   SUPERADMIN_EMAIL=you@company.com \
 *   SUPERADMIN_PASSWORD=<strong-password> \
 *   MONGODB_URI=mongodb+srv://... \
 *   npx ts-node src/scripts/create-superadmin.ts
 *
 * Required environment variables:
 *   MONGODB_URI           MongoDB connection string
 *   SUPERADMIN_EMAIL     Email address for the superadmin account
 *   SUPERADMIN_PASSWORD  Password — must be at least 12 characters
 *
 * Optional:
 *   SUPERADMIN_FIRST_NAME  default: Super
 *   SUPERADMIN_LAST_NAME   default: Admin
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

import User from '../models/User';

dotenv.config();

// ---------------------------------------------------------------------------
// Strict env validation — no silent defaults in production
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`\n❌  Missing required environment variable: ${name}`);
    console.error('    Aborting — no changes were made.\n');
    process.exit(1);
  }
  return value.trim();
}

const MONGO_URI   = requireEnv('MONGODB_URI');
const EMAIL       = requireEnv('SUPERADMIN_EMAIL');
const PASSWORD    = requireEnv('SUPERADMIN_PASSWORD');
const FIRST_NAME  = process.env.SUPERADMIN_FIRST_NAME?.trim() || 'Super';
const LAST_NAME   = process.env.SUPERADMIN_LAST_NAME?.trim()  || 'Admin';

if (PASSWORD.length < 12) {
  console.error('\n❌  SUPERADMIN_PASSWORD must be at least 12 characters.');
  console.error('    Aborting — no changes were made.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const run = async () => {
  console.log('\nPilloto — Create Superadmin');
  console.log('-'.repeat(50));

  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    // Refuse if any superadmin already exists
    const existing = await User.findOne({ role: 'superadmin' });
    if (existing) {
      console.log('\n⚠  A superadmin user already exists:', existing.email);
      console.log('   Aborting — no changes were made.');
      console.log('\n   If you need to reset the superadmin, do it directly in the database.\n');
      process.exit(0);
    }

    await User.create({
      firstName:     FIRST_NAME,
      lastName:      LAST_NAME,
      email:         EMAIL,
      password:      PASSWORD,
      role:          'superadmin',
      emailVerified: true,
      isActive:      true,
      // Intentionally no tenantId — platform-level user.
    });

    console.log('\n✅  Superadmin created successfully.');
    console.log(`    Email: ${EMAIL}`);
    console.log('\n   Store the password securely and remove it from your environment.\n');

  } catch (err) {
    console.error('\n❌  Failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

run();
