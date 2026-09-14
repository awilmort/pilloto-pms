import { Types } from 'mongoose';
import { postJournalEntry, getSystemAccountIds, cashAccountCodeForMethod, reversePostedEntries } from './ledger.service';
import { SYSTEM_ACCOUNT_CODES } from '../../constants/accounting';

/**
 * PMS→GL auto-posting hooks (PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md Phase 7.2,
 * PILLOTO_ACCOUNTING_ARCHITECTURE.md §6.2). Called *after* the underlying PMS action
 * (Charge/Payment/CashierClosure) has already succeeded and saved — additive, never
 * a replacement for existing PMS behavior (§6.1's design principle). Every export
 * here is gated on `tenant.products.includes('accounting')` and swallows its own
 * errors (logged, not thrown) so a ledger-posting failure never blocks or rolls back
 * the hotel operation that already committed — same "non-blocking-but-loud" rule
 * Phase 7.1 established for Invoice/Bill posting.
 *
 * v1 posts to the fixed seeded Chart of Accounts (`SYSTEM_ACCOUNT_CODES`) — no
 * per-tenant revenue-account mapping (architecture §6.4) yet, the same deliberate
 * simplification `cashAccountCodeForMethod` already made for Invoice/Bill payments.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function tenantHasAccounting(tenant: any): boolean {
  return !!tenant?.products?.includes('accounting');
}

/** Charge added to a Folio → Dr Accounts Receivable / Cr Sales Revenue. `Charge` has no
 *  tax field in this codebase, so there is no Sales Tax Payable split here (unlike the
 *  standalone Invoice/Bill lines, which do carry a per-line taxRate). */
export async function postChargeAddedEntry(
  tenant: any,
  charge: { _id: any; amount: number; description: string },
  userId: Types.ObjectId | string
): Promise<void> {
  if (!tenantHasAccounting(tenant)) return;
  const amount = round2(Number(charge.amount || 0));
  if (amount <= 0) return;
  try {
    const accounts = await getSystemAccountIds([SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, SYSTEM_ACCOUNT_CODES.SALES_REVENUE]);
    await postJournalEntry(
      [
        { account: accounts[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], debit: amount },
        { account: accounts[SYSTEM_ACCOUNT_CODES.SALES_REVENUE], credit: amount },
      ],
      'pms_charge_added',
      { model: 'Charge', id: charge._id },
      `Folio charge: ${charge.description}`.slice(0, 500),
      userId
    );
  } catch (err) {
    console.error(`PMS→GL posting failed (charge added, charge ${charge._id}):`, err);
  }
}

/** A Payment actually completes (cash/card/transfer/check received, or a previously
 *  pending `credit`-method payment is settled) → Dr Cash/Bank (by method) / Cr
 *  Accounts Receivable. Deliberately NOT called for a `credit`-method payment while
 *  it's still `pending` — no cash moved yet, the Charge-added entry already booked
 *  the AR; `CreditAccount` tracks that sub-ledger split on the PMS side only, per
 *  architecture §6.2's "no new posting at CreditAccount charge time" reading. */
export async function postPaymentCompletedEntry(
  tenant: any,
  payment: { _id: any; amount: number; method: string; folioId: any },
  userId: Types.ObjectId | string,
  settlementMethod?: string
): Promise<void> {
  if (!tenantHasAccounting(tenant)) return;
  const amount = round2(Number(payment.amount || 0));
  if (amount <= 0) return;
  const method = settlementMethod || payment.method;
  try {
    const cashCode = cashAccountCodeForMethod(method);
    const accounts = await getSystemAccountIds([cashCode, SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE]);
    await postJournalEntry(
      [
        { account: accounts[cashCode], debit: amount },
        { account: accounts[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], credit: amount },
      ],
      'pms_payment_recorded',
      { model: 'Payment', id: payment._id },
      `Folio payment received (${method}) — folio ${payment.folioId}`.slice(0, 500),
      userId
    );
  } catch (err) {
    console.error(`PMS→GL posting failed (payment recorded, payment ${payment._id}):`, err);
  }
}

/** A previously-completed Payment is reversed → flips the `pms_payment_recorded`
 *  entry via the shared `reversePostedEntries` primitive. No-op (not an error) if
 *  that payment never had a GL entry to begin with — e.g. it was a still-pending
 *  `credit`-method payment, which never posted one. */
export async function reversePaymentEntry(
  tenant: any,
  payment: { _id: any; folioId: any },
  userId: Types.ObjectId | string
): Promise<void> {
  if (!tenantHasAccounting(tenant)) return;
  try {
    await reversePostedEntries(
      'Payment',
      payment._id,
      'pms_payment_recorded',
      'pms_payment_reversed',
      `Reversal of payment on folio ${payment.folioId}`.slice(0, 500),
      userId
    );
  } catch (err) {
    console.error(`PMS→GL posting failed (payment reversed, payment ${payment._id}):`, err);
  }
}

/** CashierClosure: compares the physical cash count (`cashDistribution`, the source of
 *  truth per architecture §6.2) against the system-expected cash total
 *  (`paymentTotals.cash`) and posts a cash-over/short adjustment for the difference,
 *  bringing the GL's Cash account in line with what was actually counted. No entry
 *  when the two already match. */
export async function postCashierClosureAdjustment(
  tenant: any,
  closure: {
    _id: any;
    periodStart: Date;
    paymentTotals: { cash: number };
    cashDistribution: Array<{ subtotal: number }>;
  },
  userId: Types.ObjectId | string
): Promise<void> {
  if (!tenantHasAccounting(tenant)) return;
  const expected = round2(Number(closure.paymentTotals?.cash || 0));
  const counted = round2((closure.cashDistribution || []).reduce((sum, d) => sum + Number(d.subtotal || 0), 0));
  const diff = round2(counted - expected);
  if (diff === 0) return;
  try {
    const accounts = await getSystemAccountIds([SYSTEM_ACCOUNT_CODES.CASH, SYSTEM_ACCOUNT_CODES.CASH_OVER_SHORT]);
    const overage = diff > 0;
    const magnitude = Math.abs(diff);
    const lines = overage
      ? [
          { account: accounts[SYSTEM_ACCOUNT_CODES.CASH], debit: magnitude },
          { account: accounts[SYSTEM_ACCOUNT_CODES.CASH_OVER_SHORT], credit: magnitude },
        ]
      : [
          { account: accounts[SYSTEM_ACCOUNT_CODES.CASH_OVER_SHORT], debit: magnitude },
          { account: accounts[SYSTEM_ACCOUNT_CODES.CASH], credit: magnitude },
        ];
    await postJournalEntry(
      lines,
      'pms_cashier_closure',
      { model: 'CashierClosure', id: closure._id },
      `Cashier closure ${overage ? 'overage' : 'shortage'} for shift starting ${closure.periodStart.toISOString()}`,
      userId
    );
  } catch (err) {
    console.error(`PMS→GL posting failed (cashier closure, closure ${closure._id}):`, err);
  }
}

/** Legacy Folio-driven e-CF credit note (E34) issued against a folio's charges →
 *  Dr Sales Returns & Allowances(+Sales Tax Payable) / Cr Accounts Receivable —
 *  same shape as the standalone Accounting product's `CreditNote.issue()` (Phase 8.1),
 *  minus any COGS-reversal (hotels don't carry COGS on room revenue, per architecture
 *  §6.2's own note; day-pass/retail inventory COGS would need its own future line). */
export async function postFolioCreditNoteEntry(
  tenant: any,
  electronicInvoice: { _id: any; totalFactura: number; totalImpuestos: number; folioId?: any },
  userId: Types.ObjectId | string
): Promise<void> {
  if (!tenantHasAccounting(tenant)) return;
  const gross = round2(Number(electronicInvoice.totalFactura || 0));
  const tax = round2(Number(electronicInvoice.totalImpuestos || 0));
  const net = round2(gross - tax);
  if (gross <= 0) return;
  try {
    const accounts = await getSystemAccountIds([
      SYSTEM_ACCOUNT_CODES.SALES_RETURNS_AND_ALLOWANCES,
      SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE,
      SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
    ]);
    const lines = [
      { account: accounts[SYSTEM_ACCOUNT_CODES.SALES_RETURNS_AND_ALLOWANCES], debit: net },
      ...(tax > 0 ? [{ account: accounts[SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE], debit: tax }] : []),
      { account: accounts[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], credit: gross },
    ];
    await postJournalEntry(
      lines,
      'pms_folio_credit_note',
      { model: 'ElectronicInvoice', id: electronicInvoice._id },
      `Folio credit note (e-CF E34)${electronicInvoice.folioId ? ` — folio ${electronicInvoice.folioId}` : ''}`,
      userId
    );
  } catch (err) {
    console.error(`PMS→GL posting failed (folio credit note, ecf ${electronicInvoice._id}):`, err);
  }
}

/** Legacy Folio-driven e-CF debit note (E33) issued against a folio →
 *  Dr Accounts Receivable / Cr Other Revenue(+Sales Tax Payable) — mirrors the
 *  standalone Accounting product's `DebitNote.issue()` (Phase 8.3). */
export async function postFolioDebitNoteEntry(
  tenant: any,
  electronicInvoice: { _id: any; totalFactura: number; totalImpuestos: number; folioId?: any },
  userId: Types.ObjectId | string
): Promise<void> {
  if (!tenantHasAccounting(tenant)) return;
  const gross = round2(Number(electronicInvoice.totalFactura || 0));
  const tax = round2(Number(electronicInvoice.totalImpuestos || 0));
  const net = round2(gross - tax);
  if (gross <= 0) return;
  try {
    const accounts = await getSystemAccountIds([
      SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
      SYSTEM_ACCOUNT_CODES.OTHER_REVENUE,
      SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE,
    ]);
    const lines = [
      { account: accounts[SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE], debit: gross },
      { account: accounts[SYSTEM_ACCOUNT_CODES.OTHER_REVENUE], credit: net },
      ...(tax > 0 ? [{ account: accounts[SYSTEM_ACCOUNT_CODES.SALES_TAX_PAYABLE], credit: tax }] : []),
    ];
    await postJournalEntry(
      lines,
      'pms_folio_debit_note',
      { model: 'ElectronicInvoice', id: electronicInvoice._id },
      `Folio debit note (e-CF E33)${electronicInvoice.folioId ? ` — folio ${electronicInvoice.folioId}` : ''}`,
      userId
    );
  } catch (err) {
    console.error(`PMS→GL posting failed (folio debit note, ecf ${electronicInvoice._id}):`, err);
  }
}
