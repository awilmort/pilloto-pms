import { Types } from 'mongoose';
import Customer, { ICustomer } from '../../models/Customer';
import Invoice, { IInvoice, IInvoiceLineItem } from '../../models/Invoice';
import CreditAccount, { ICreditAccount } from '../../models/CreditAccount';
import Company from '../../models/Company';
import Guest from '../../models/Guest';
import { nextSequence } from '../../models/Counter';

/**
 * City Ledger transfer (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 10.4,
 * PILLOTO_ACCOUNTING_ARCHITECTURE.md §11.5). Called from the PMS checkout route the
 * moment a folio balance would otherwise block checkout — never a discretionary
 * front-desk action (see the plan's "why automatic, not a button" rationale).
 *
 * Purely an AR *subledger* operation: it creates the Customer/Invoice pair so the
 * balance is trackable (aging, statements, collections) against a real party, but
 * posts **no new GL entry** — `pmsLedgerHooks.postChargeAddedEntry` already booked
 * Dr Accounts Receivable / Cr Sales Revenue when each folio Charge was created
 * (control-account only, no customer party). Booking a second Dr AR/Cr Revenue at
 * transfer time would double the receivable and the revenue.
 *
 * Two paths, split by whether credit was extended *before* the stay:
 *  - preApproved (an active CreditAccount with enough headroom): silent, no review
 *    needed — the credit decision already happened when the account was set up.
 *    The Invoice is posted straight to `status: 'sent'`.
 *  - ad hoc (no CreditAccount, or insufficient headroom): the Invoice is still
 *    created immediately (never skipped, never optional), but stays `status:
 *    'draft'` with `cityLedger.authorizationStatus: 'pending'` — invisible to AR
 *    aging/statements until a manager authorizes it via the City Ledger queue
 *    (`accounting.cityLedger.authorize`). That queue *is* the credit-control gate
 *    real hotel City Ledger SOPs require — just moved to a review step that can't
 *    be silently skipped, instead of a checkout-time button that can.
 *
 * Deliberately does NOT touch the folio's own PMS-side settlement (the caller
 * already records the `credit`-method Payment and flips `Folio.status`, mirroring
 * the pre-existing `/use-credit` route) and does NOT issue a real e-CF — the
 * guest's fiscal document (if any) is the PMS's own folio e-CF flow
 * (`POST /api/ecf/invoices`), entirely independent of this AR subledger record.
 */

export interface CityLedgerTransferResult {
  invoice: IInvoice;
  customer: ICustomer;
  preApproved: boolean;
  creditAccount: ICreditAccount | null;
}

async function findOrCreateCustomerForReservation(reservation: any): Promise<ICustomer> {
  if (reservation.company) {
    const existing = await Customer.findOne({ linkedCompanyId: reservation.company });
    if (existing) return existing;
    const company = await Company.findById(reservation.company).select('name email phone').lean<{ name: string; email?: string; phone?: string }>();
    if (company) {
      return Customer.create({
        name: company.name,
        email: company.email,
        phone: company.phone,
        linkedCompanyId: reservation.company,
      });
    }
  }

  if (reservation.guestRecord) {
    const existing = await Customer.findOne({ linkedGuestId: reservation.guestRecord });
    if (existing) return existing;
    const guest = await Guest.findById(reservation.guestRecord)
      .select('firstName lastName email phone')
      .lean<{ firstName: string; lastName: string; email?: string; phone?: string }>();
    if (guest) {
      return Customer.create({
        name: `${guest.firstName} ${guest.lastName}`.trim(),
        email: guest.email,
        phone: guest.phone,
        linkedGuestId: reservation.guestRecord,
      });
    }
  }

  // Last-resort fallback for the rare reservation with neither a Company nor an
  // auto-upserted Guest record — build the Customer from the reservation's own
  // guest-identification fields instead of failing checkout outright.
  const name = reservation.guestName?.firstName
    ? `${reservation.guestName.firstName} ${reservation.guestName.lastName}`.trim()
    : reservation.contactInfo?.email || `Reservation ${reservation.reservationCode || reservation._id}`;
  return Customer.create({
    name,
    email: reservation.contactInfo?.email,
    phone: reservation.contactInfo?.phone,
  });
}

export async function transferFolioBalanceToCityLedger(
  reservation: any,
  folio: { _id: any },
  balance: number,
  userId: Types.ObjectId | string,
): Promise<CityLedgerTransferResult> {
  let creditAccount: ICreditAccount | null = null;
  if (reservation.company) {
    creditAccount = await CreditAccount.findOne({ scope: 'company', referenceId: reservation.company, status: 'active' });
  }
  if (!creditAccount && reservation.guestRecord) {
    creditAccount = await CreditAccount.findOne({ scope: 'guest', referenceId: reservation.guestRecord, status: 'active' });
  }

  const available = creditAccount
    ? Number(creditAccount.creditLimit || 0) - Number(creditAccount.currentExposure || 0)
    : 0;
  const preApproved = !!creditAccount && available >= balance;

  const customer = await findOrCreateCustomerForReservation(reservation);

  const invoiceNumber = `INV-${String(await nextSequence('invoiceNumber')).padStart(6, '0')}`;
  const description = `Folio balance — reservation ${reservation.reservationCode || reservation._id}, checkout ${new Date().toISOString().slice(0, 10)}`;

  const lineItems: IInvoiceLineItem[] = [
    {
      description,
      quantity: 1,
      unitPrice: balance,
      discountPercent: 0,
      taxRate: 0, // already taxed at the point of Charge creation — this line is a subledger record, not a new taxable sale
      lineTotal: 0,
      taxAmount: 0,
      total: 0,
    } as IInvoiceLineItem,
  ];

  const invoice = await Invoice.create({
    invoiceNumber,
    customer: customer._id,
    isIndividual: false,
    lineItems,
    status: 'draft',
    createdBy: userId,
    cityLedger: {
      sourceReservationId: reservation._id,
      sourceFolioId: folio._id,
      preApproved,
      authorizationStatus: preApproved ? 'authorized' : 'pending',
      ...(preApproved ? { authorizedBy: userId, authorizedAt: new Date() } : {}),
    },
  });

  if (preApproved && creditAccount) {
    invoice.status = 'sent';
    await invoice.save();
    creditAccount.currentExposure = Number(creditAccount.currentExposure || 0) + balance;
    await creditAccount.save();
  }

  return { invoice, customer, preApproved, creditAccount };
}
