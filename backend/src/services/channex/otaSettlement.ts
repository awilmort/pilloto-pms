/**
 * OTA-collect settlement (CHANNEX_ARCHITECTURE.md §7.6; plan Phase 7.4).
 *
 * When the OTA collects the guest's payment (`payment_collect = 'ota'`: Expedia Collect,
 * Airbnb, Booking.com Payments) the OTA, not the guest, owes the property. Such reservations
 * are billed to a per-OTA Company ("Airbnb", "Booking.com", …) with an active company
 * CreditAccount, so the existing flows settle them without special cases:
 *   - Accounting tenants: checkout transfers the folio balance to City Ledger under the
 *     OTA's AR customer (`transferFolioBalanceToCityLedger`, pre-approved by the credit
 *     account), reconciled when the OTA payout arrives;
 *   - PMS-only tenants: "use credit" moves the balance onto the OTA's credit account.
 *
 * Runs inside the tenant scope.
 */

import mongoose from 'mongoose';
import Company from '../../models/Company';
import CreditAccount from '../../models/CreditAccount';

/**
 * OTAs pay what they collected; the limit only exists because CreditAccount requires one.
 * Staff can lower it in Credit Accounts.
 */
export const OTA_CREDIT_LIMIT = 1_000_000_000;

/** Channex `ota_name` → the name hoteliers know (also the Company name). */
const OTA_DISPLAY_NAMES: Record<string, string> = {
  bookingcom: 'Booking.com',
  expedia: 'Expedia',
  airbnb: 'Airbnb',
  vrbo: 'Vrbo',
  homeaway: 'Vrbo',
  agoda: 'Agoda',
  despegar: 'Despegar',
  tripcom: 'Trip.com',
  ctrip: 'Trip.com',
  hotelbeds: 'Hotelbeds',
  hostelworld: 'Hostelworld',
};

export function otaDisplayName(otaName: string | undefined | null): string {
  if (!otaName || !otaName.trim()) return 'OTA';
  return OTA_DISPLAY_NAMES[otaName.toLowerCase().replace(/[^a-z]/g, '')] ?? otaName.trim().slice(0, 80);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Find-or-create the OTA's Company and its active company CreditAccount; returns the Company id. */
export async function ensureOtaCompany(otaName: string | undefined | null): Promise<mongoose.Types.ObjectId> {
  const name = otaDisplayName(otaName);
  let company = await Company.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
  if (!company) {
    company = await Company.create({
      name,
      notes: `Created by the channel manager: bookings paid through ${name} are billed to it and settled when ${name} pays out.`,
    });
  }
  try {
    await CreditAccount.updateOne(
      { scope: 'company', referenceId: company._id },
      { $setOnInsert: { scope: 'company', referenceId: company._id, creditLimit: OTA_CREDIT_LIMIT, currentExposure: 0, status: 'active' } },
      { upsert: true },
    );
  } catch (err: any) {
    // Two bookings racing: the other one created it
    if (err?.code !== 11000) throw err;
  }
  return company._id as mongoose.Types.ObjectId;
}
