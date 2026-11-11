/**
 * Payments from tenants, and the e-CF each one triggers.
 *
 * Pilloto issues its comprobante for money received, so recording a payment is what issues it: a
 * credit-fiscal invoice (E31) to the tenant for the amount, through the same pipeline a tenant's
 * documents use, with Pilloto itself as issuer. The payment is the money and is never lost: if the
 * e-CF cannot be issued (Pilloto's own certification is pending, BillingSoft refuses the document)
 * the payment stays recorded with the reason and the e-CF is issued again from the console.
 *
 * PortalDom will record its collections here the same way (`source: 'portaldom'`).
 */
import { Types } from 'mongoose';
import BillingCharge, { IBillingCharge } from '../../models/BillingCharge';
import BillingPayment, { BILLING_PAYMENT_METHODS, BillingPaymentMethod, BillingPaymentSource, IBillingPayment } from '../../models/BillingPayment';
import ElectronicInvoice, { ECF_VALID_ESTADOS, IElectronicInvoice } from '../../models/ElectronicInvoice';
import { BillingTax } from '../../models/PlatformSettings';
import Tenant, { ITenant } from '../../models/Tenant';
import { BillingSoftError } from '../fiscal/billingsoftClient';
import { BsDocumentRequest, BsLine } from '../fiscal/billingsoftTypes';
import { assertCanIssue, decimalString, FiscalError, netFromGross } from '../fiscal/fiscalCore';
import { issueFiscalDocument, sendIntent, toFiscalError } from '../fiscal/fiscalIssuer';
import { emailFiscalDocument } from '../fiscal/fiscalEmail';
import { markStatementPaid } from '../fiscal/fiscalStatements';
import { modificationOfCode, noteRequest, normalizeRnc } from '../fiscal/mappers';
import { getPlatformIssuer, getPlatformSettings, PLATFORM_ISSUER_ID } from '../fiscal/platformIssuer';
import { periodLabelEs, round2, toCents } from './billingMath';

export interface Actor {
  userId?: Types.ObjectId | string;
  email?: string;
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// ─── Recording ───────────────────────────────────────────────────────────────

export interface RecordPaymentInput {
  amount: unknown;
  paidAt?: unknown;
  method: unknown;
  reference?: unknown;
  notes?: unknown;
  source?: BillingPaymentSource;
}

/** Methods that leave a trace to quote: a payment by one of them needs its reference. */
const NEEDS_REFERENCE: BillingPaymentMethod[] = ['transfer', 'deposit', 'check'];

export function validatePayment(input: RecordPaymentInput, balance: number, now: Date) {
  const errors: Record<string, string> = {};
  const amount = typeof input.amount === 'string' ? Number(input.amount) : (input.amount as number);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) errors.amount = 'Monto inválido';
  else if (toCents(amount) > toCents(balance)) errors.amount = `Excede el saldo pendiente`;
  else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) errors.amount = 'Máximo dos decimales';

  const method = input.method as BillingPaymentMethod;
  if (!BILLING_PAYMENT_METHODS.includes(method)) errors.method = 'Método inválido';

  let paidAt = now;
  if (input.paidAt !== undefined && input.paidAt !== '') {
    paidAt = new Date(input.paidAt as string);
    if (Number.isNaN(paidAt.getTime())) errors.paidAt = 'Fecha inválida';
    else if (paidAt.getTime() > now.getTime() + 24 * 60 * 60 * 1000) errors.paidAt = 'La fecha no puede ser futura';
    else if (paidAt.getUTCFullYear() < 2020) errors.paidAt = 'Fecha inválida';
  }
  const reference = textOf(input.reference);
  if (!reference && NEEDS_REFERENCE.includes(method)) errors.reference = 'Indique la referencia';
  if (Object.keys(errors).length > 0) {
    throw new FiscalError(400, 'BILLING_INVALID', 'Review the highlighted fields', errors);
  }
  return { amount: round2(amount), method, paidAt, reference: reference || undefined, notes: textOf(input.notes) || undefined };
}

/**
 * Brings a charge's paid amount, balance and status in line with its recorded payments. The charge
 * is a pure function of its payments, so a crash between two writes can always be repaired by
 * running this again.
 */
export async function recomputeCharge(chargeId: Types.ObjectId | string): Promise<IBillingCharge> {
  const charge = await BillingCharge.findById(chargeId);
  if (!charge) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Charge not found');
  if (charge.status === 'void') return charge;
  const payments = await BillingPayment.find({ chargeId: charge._id, status: 'recorded' }).select('amount');
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  const balance = round2(Math.max(0, charge.total - paid));
  const status = balance === 0 ? 'paid' : paid > 0 ? 'partial' : 'open';
  return (await BillingCharge.findByIdAndUpdate(charge._id, { $set: { paidAmount: paid, balance, status } }, { new: true })) ?? charge;
}

export interface RecordResult {
  payment: IBillingPayment;
  charge: IBillingCharge;
}

/**
 * Records a payment against a charge and issues its e-CF. Never fails because of the e-CF: the
 * payment is saved first and carries the e-CF's error if there is one.
 */
export async function recordPayment(chargeId: string | Types.ObjectId, input: RecordPaymentInput, actor: Actor, now = new Date()): Promise<RecordResult> {
  const charge = await BillingCharge.findById(chargeId);
  if (!charge) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Charge not found');
  if (charge.status === 'void') throw new FiscalError(409, 'BILLING_STATE', 'This charge is void');
  if (charge.status === 'paid' || charge.balance <= 0) throw new FiscalError(409, 'BILLING_STATE', 'This charge is already paid');

  const valid = validatePayment(input, charge.balance, now);
  const payment = await BillingPayment.create({
    tenantId: charge.tenantId,
    chargeId: charge._id as Types.ObjectId,
    ...valid,
    source: input.source ?? 'manual',
    recordedBy: { userId: actor.userId, email: actor.email },
    status: 'recorded',
    ecfAttempt: 1,
  });

  let updated = await recomputeCharge(charge._id as Types.ObjectId);
  // Two payments recorded at the same moment can overshoot the balance: the later one yields.
  if (updated.paidAmount > updated.total) {
    await BillingPayment.deleteOne({ _id: payment._id });
    await recomputeCharge(charge._id as Types.ObjectId);
    throw new FiscalError(409, 'BILLING_STATE', 'The balance changed while recording. Reload and try again.');
  }

  const withEcf = await issueEcfForPayment(payment, actor, now);
  if (updated.status === 'paid' && updated.fiscalStatementId) {
    // The statement's usage was collected with this charge.
    try {
      await markStatementPaid(updated.tenantId, updated.period, { reference: updated.number, method: 'billing_charge' }, now);
    } catch {
      /* already marked, or void: nothing to do */
    }
  }
  updated = (await BillingCharge.findById(charge._id)) ?? updated;
  return { payment: withEcf, charge: updated };
}

// ─── The e-CF of a payment ───────────────────────────────────────────────────

const DESCRIPTION_MAX = 80;

/**
 * The credit-fiscal invoice for a payment. A payment that settles the whole charge in one go is
 * itemised exactly like the charge (so the e-CF total is the charge total); any other payment is
 * one line for the amount received, with ITBIS extracted from it.
 */
export function paymentInvoiceRequest(input: {
  charge: Pick<IBillingCharge, 'number' | 'period' | 'lines' | 'total'>;
  payment: Pick<IBillingPayment, 'amount'>;
  settlesWholeCharge: boolean;
  tax: BillingTax;
  buyer: { name?: string; rnc?: string; email?: string };
}): BsDocumentRequest {
  const rnc = normalizeRnc(input.buyer.rnc);
  const name = (input.buyer.name ?? '').trim();
  if (!rnc || !name) {
    throw new FiscalError(
      400,
      'BILLING_TENANT_PROFILE',
      "The tenant's company profile needs its legal name and RNC to receive a credit-fiscal invoice",
      { ...(rnc ? {} : { rnc: 'Falta el RNC' }), ...(name ? {} : { legalName: 'Falta la razón social' }) },
    );
  }
  const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX);
  const lines: BsLine[] = input.settlesWholeCharge
    ? input.charge.lines.map((l) => ({ name: clip(l.description), kind: 'service', quantity: '1', unitPrice: decimalString(l.amount), tax: input.tax }))
    : [
        {
          name: clip(`Pago a cuenta ${input.charge.number} — suscripción Pilloto ${periodLabelEs(input.charge.period)}`),
          kind: 'service',
          quantity: '1',
          unitPrice: input.tax === 'exempt' || input.tax === 'itbis0' ? input.payment.amount.toFixed(2) : netFromGross(input.payment.amount, input.tax === 'itbis16' ? 16 : 18),
          tax: input.tax,
        },
      ];
  return {
    type: '31',
    buyer: { name: name.slice(0, 150), rnc, ...(input.buyer.email ? { email: input.buyer.email } : {}) },
    incomeType: '01',
    payment: { type: 'cash' },
    lines,
  };
}

/** A person-readable reason an e-CF could not be issued. */
function ecfProblem(err: unknown): string {
  if (err instanceof FiscalError) {
    switch (err.code) {
      case 'FISCAL_NOT_ACTIVATED':
        return "Pilloto's own e-invoicing is not set up yet. Link it under Billing → Pilloto e-CF.";
      case 'FISCAL_NOT_CERTIFIED':
        return "DGII has not certified Pilloto to issue e-CF yet, so no e-CF was issued for this payment.";
      case 'FISCAL_NOT_CONFIGURED':
        return 'Electronic invoicing is not configured on this server.';
      default: {
        const fields = err.fields ? ` (${Object.values(err.fields).join(', ')})` : '';
        return `${err.message}${fields}`;
      }
    }
  }
  if (err instanceof BillingSoftError) return toFiscalError(err).message;
  return (err as Error)?.message ?? 'Unknown error';
}

/**
 * Issues the e-CF for `payment` (or finds the one already issued under the attempt's key). Never
 * throws for a problem with the e-CF: the reason is stored on the payment instead.
 */
export async function issueEcfForPayment(payment: IBillingPayment, actor: Actor = {}, now = new Date()): Promise<IBillingPayment> {
  try {
    const [charge, tenant, settings, issuer] = await Promise.all([
      BillingCharge.findById(payment.chargeId),
      Tenant.findById(payment.tenantId),
      getPlatformSettings(),
      getPlatformIssuer(),
    ]);
    if (!charge || !tenant) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'The charge or its tenant no longer exists');
    assertCanIssue(issuer);

    const others = await BillingPayment.countDocuments({ chargeId: charge._id, status: 'recorded', _id: { $ne: payment._id } });
    const request = paymentInvoiceRequest({
      charge,
      payment,
      settlesWholeCharge: others === 0 && toCents(payment.amount) === toCents(charge.total),
      tax: charge.tax,
      buyer: { name: tenant.profile?.legalName || tenant.name, rnc: tenant.profile?.rnc, email: tenant.billing?.billingEmail || tenant.profile?.email || tenant.ownerEmail },
    });
    const { record } = await issueFiscalDocument({
      tenant: issuer,
      route: 'invoices',
      request,
      actorId: actor.userId ?? PLATFORM_ISSUER_ID,
      source: 'platform_payment',
      links: { billingPaymentId: payment._id as Types.ObjectId },
      numeroFacturaInterna: charge.number,
      idempotencyKey: `platform-payment-${payment._id}-${payment.ecfAttempt}`,
    });
    const updated = await BillingPayment.findByIdAndUpdate(payment._id, { $set: { electronicInvoiceId: record._id }, $unset: { ecfError: '' } }, { new: true });
    const result = updated ?? payment;
    if (record.billingsoftDocumentId) await sendReceipt(result, now);
    return (await BillingPayment.findById(payment._id)) ?? result;
  } catch (err) {
    const message = ecfProblem(err).slice(0, 1000);
    const updated = await BillingPayment.findByIdAndUpdate(payment._id, { $set: { ecfError: message } }, { new: true });
    return updated ?? payment;
  }
}

/** The e-CF record of a payment. */
export async function ecfOf(payment: Pick<IBillingPayment, 'electronicInvoiceId'>): Promise<IElectronicInvoice | null> {
  if (!payment.electronicInvoiceId) return null;
  return ElectronicInvoice.findOne({ _id: payment.electronicInvoiceId, tenantId: PLATFORM_ISSUER_ID });
}

/**
 * Tries again to give a payment its e-CF: sends one BillingSoft never confirmed (same key, so it
 * cannot issue twice), issues a new one when DGII rejected the last, or issues the first if none
 * was. Throws when there is nothing to retry.
 */
export async function retryEcf(paymentId: string | Types.ObjectId, actor: Actor = {}, now = new Date()): Promise<IBillingPayment> {
  const payment = await BillingPayment.findById(paymentId);
  if (!payment) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Payment not found');
  if (payment.status !== 'recorded') throw new FiscalError(409, 'BILLING_STATE', 'This payment was reversed');
  const record = await ecfOf(payment);

  if (!record) return issueEcfForPayment(payment, actor, now);

  if (record.estadoECF === 'Pendiente' || (record.estadoECF === 'Error' && !record.billingsoftDocumentId)) {
    const issuer = await getPlatformIssuer();
    try {
      assertCanIssue(issuer);
      if (record.estadoECF === 'Error') {
        record.estadoECF = 'Pendiente';
        record.estatus = 'pending';
        await record.save();
      }
      const { record: sent } = await sendIntent(record, issuer, true, now);
      if (sent.billingsoftDocumentId) await sendReceipt(payment, now);
      await BillingPayment.updateOne({ _id: payment._id }, { $unset: { ecfError: '' } });
    } catch (err) {
      await BillingPayment.updateOne({ _id: payment._id }, { $set: { ecfError: ecfProblem(err).slice(0, 1000) } });
    }
    return (await BillingPayment.findById(payment._id)) ?? payment;
  }

  if (record.estadoECF === 'Rechazado' || record.estadoECF === 'Error') {
    // A new document under a new key; the rejected one stays as the record of what happened.
    const bumped = await BillingPayment.findByIdAndUpdate(payment._id, { $inc: { ecfAttempt: 1 }, $unset: { electronicInvoiceId: '', ecfEmailedAt: '' } }, { new: true });
    return issueEcfForPayment(bumped!, actor, now);
  }
  throw new FiscalError(409, 'BILLING_STATE', 'This payment already has a valid e-CF');
}

// ─── Receipt email ───────────────────────────────────────────────────────────

const RECEIPT_ESTADOS = new Set(['Firmado', 'En Proceso', 'Aceptado', 'Aceptado Condicional', 'Sin Resolver']);

/**
 * Emails the tenant its e-CF once BillingSoft holds it and DGII has not rejected it. A document
 * from DGII's test environment is never sent (it has no fiscal value); the reason is kept so the
 * job does not try forever.
 */
export async function sendReceipt(payment: IBillingPayment, now = new Date(), to?: string): Promise<boolean> {
  if (payment.ecfEmailedAt && !to) return true;
  const record = await ecfOf(payment);
  if (!record?.billingsoftDocumentId || !RECEIPT_ESTADOS.has(record.estadoECF)) return false;
  const tenant = await Tenant.findById(payment.tenantId);
  const recipient = to || tenant?.billing?.billingEmail || tenant?.profile?.email || tenant?.ownerEmail;
  if (!recipient) return false;
  try {
    await emailFiscalDocument(await getPlatformIssuer(), record, recipient);
    await BillingPayment.updateOne({ _id: payment._id }, { $set: { ecfEmailedAt: now }, $unset: { ecfEmailError: '' } });
    return true;
  } catch (err: any) {
    if (to) throw err;
    const message = String(err?.message ?? 'Email failed').slice(0, 300);
    // A document with no fiscal value is never sent: stop trying until someone sends it by hand.
    if (err instanceof FiscalError && err.code === 'FISCAL_TEST_DOCUMENT') {
      await BillingPayment.updateOne({ _id: payment._id }, { $set: { ecfEmailError: message } });
    }
    console.warn(`[Billing] Could not email the e-CF of payment ${payment._id}: ${message}`);
    return false;
  }
}

/** Job: sends the e-CF of every payment whose document BillingSoft has since confirmed. */
export async function sendDueReceipts(now = new Date(), limit = 50): Promise<number> {
  const payments = await BillingPayment.find({
    status: 'recorded',
    electronicInvoiceId: { $exists: true },
    ecfEmailedAt: { $exists: false },
    ecfEmailError: { $exists: false },
  })
    .sort({ createdAt: 1 })
    .limit(limit);
  let sent = 0;
  for (const payment of payments) {
    if (await sendReceipt(payment, now)) sent++;
  }
  return sent;
}

// ─── Reversal ────────────────────────────────────────────────────────────────

/**
 * Reverses a payment recorded by mistake. When its e-CF was accepted by DGII, a credit note
 * (E34) cancels it first; while DGII is still deciding the reversal waits, and a rejected or
 * never-issued e-CF needs no note.
 */
export async function reversePayment(paymentId: string | Types.ObjectId, reason: string, actor: Actor, now = new Date()): Promise<{ payment: IBillingPayment; charge: IBillingCharge }> {
  const text = textOf(reason);
  if (text.length < 5) throw new FiscalError(400, 'BILLING_INVALID', 'A reason is required', { reason: 'Requerido' });
  const payment = await BillingPayment.findById(paymentId);
  if (!payment) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Payment not found');
  if (payment.status === 'reversed') throw new FiscalError(409, 'BILLING_STATE', 'This payment was already reversed');

  let creditNoteId: Types.ObjectId | undefined;
  const record = await ecfOf(payment);
  if (record) {
    if (ECF_VALID_ESTADOS.includes(record.estadoECF)) {
      const issuer = await getPlatformIssuer();
      assertCanIssue(issuer);
      const request = noteRequest({
        note: 'credit',
        original: { eNCF: record.eNCF, issuedAt: record.issuedAt ?? record.createdAt, buyerRnc: record.buyerRnc, buyerName: record.buyerName, buyerEmail: record.buyerEmail },
        modificationCode: '1',
        reason: text,
        lines: (record.request as BsDocumentRequest).lines,
      });
      modificationOfCode('1');
      try {
        const { record: note } = await issueFiscalDocument({
          tenant: issuer,
          route: 'credit-notes',
          request,
          actorId: actor.userId ?? PLATFORM_ISSUER_ID,
          source: 'credit_note',
          links: { billingPaymentId: payment._id as Types.ObjectId },
          numeroFacturaInterna: record.numeroFacturaInterna,
          original: { eNCF: record.eNCF!, codigoModificacion: '1' },
          idempotencyKey: `platform-reversal-${payment._id}`,
        });
        creditNoteId = note._id as Types.ObjectId;
      } catch (err) {
        if (err instanceof BillingSoftError) throw toFiscalError(err);
        throw err;
      }
    } else if (record.estadoECF !== 'Rechazado' && record.estadoECF !== 'Error' && record.estadoECF !== 'Anulado') {
      throw new FiscalError(409, 'BILLING_ECF_PENDING', "The e-CF of this payment is still being processed. Wait for DGII's answer, then reverse it.");
    }
  }

  const updated = await BillingPayment.findOneAndUpdate(
    { _id: payment._id, status: 'recorded' },
    { $set: { status: 'reversed', reversal: { at: now, reason: text.slice(0, 500), byEmail: actor.email, ...(creditNoteId ? { creditNoteId } : {}) } } },
    { new: true },
  );
  if (!updated) throw new FiscalError(409, 'BILLING_STATE', 'This payment changed; reload it');
  const charge = await recomputeCharge(updated.chargeId);
  return { payment: updated, charge };
}
