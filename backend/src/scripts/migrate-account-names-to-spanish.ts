/**
 * migrate-account-names-to-spanish.ts
 *
 * One-off, idempotent backfill for `DEFAULT_CHART_OF_ACCOUNTS`'s switch from
 * English to Spanish/Dominican-market names (see `constants/accounting.ts`).
 * Every tenant provisioned before this change has system accounts still named
 * "Cash", "Accounts Receivable", etc. This renames them in place, matched by
 * `code` — only touches `isSystem: true` accounts whose `name` still exactly
 * equals the old English default, so an account an admin already renamed is
 * left untouched.
 *
 * Safe to run twice: accounts already renamed (or never English to begin
 * with) simply don't match and are skipped.
 *
 * Usage:
 *   MONGODB_URI=<uri> npx ts-node src/scripts/migrate-account-names-to-spanish.ts
 */

import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';

// code -> [old English default, new Spanish/DR default] — kept in lockstep with
// the `DEFAULT_CHART_OF_ACCOUNTS` history in constants/accounting.ts.
const RENAMES: Record<string, [string, string]> = {
  '1000': ['Cash', 'Caja'],
  '1010': ['Bank', 'Bancos'],
  '1100': ['Accounts Receivable', 'Cuentas por Cobrar'],
  '1200': ['Inventory', 'Inventario'],
  '2000': ['Accounts Payable', 'Cuentas por Pagar'],
  '2100': ['Sales Tax Payable', 'ITBIS por Pagar'],
  '3000': ["Owner's Equity", 'Capital del Propietario'],
  '3900': ['Retained Earnings', 'Utilidades Retenidas'],
  '4000': ['Sales Revenue', 'Ingresos por Ventas'],
  '4100': ['Sales Returns & Allowances', 'Devoluciones y Descuentos en Ventas'],
  '4200': ['Other Revenue', 'Otros Ingresos'],
  '5000': ['Cost of Goods Sold', 'Costo de Ventas'],
  '6000': ['Operating Expenses', 'Gastos Operativos'],
  '6010': ['Rent', 'Alquiler'],
  '6020': ['Utilities', 'Servicios Básicos'],
  '6030': ['Salaries & Wages', 'Sueldos y Salarios'],
  '6040': ['Freight & Delivery', 'Fletes y Envíos'],
  '6070': ['Cash Over/Short', 'Sobrante/Faltante de Caja'],
  '6090': ['Other Expenses', 'Otros Gastos'],
};

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');
  const accounts = mongoose.connection.db!.collection('accounts');

  let totalModified = 0;
  for (const [code, [oldName, newName]] of Object.entries(RENAMES)) {
    const result = await accounts.updateMany(
      { code, isSystem: true, name: oldName },
      { $set: { name: newName } }
    );
    if (result.modifiedCount > 0) {
      console.log(`  ✅ ${code}: "${oldName}" → "${newName}" on ${result.modifiedCount} account(s)`);
      totalModified += result.modifiedCount;
    }
  }

  console.log(totalModified > 0 ? `\n🎉 Renamed ${totalModified} account(s).` : '\n⏭️  Nothing to rename.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
