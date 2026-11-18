/**
 * Paying a charge online with HandyPay: start a checkout session for the charge's balance, and turn
 * a confirmed session into a recorded payment (which issues Pilloto's e-CF, as a payment recorded
 * in the console does).
 *
 * Confirmation is idempotent and never trusts the webhook body: the session is read back from
 * HandyPay, and the payment is recorded once per session.
 */
import mongoose from 'mongoose';
import BillingCharge from '../../models/BillingCharge';
import BillingOnlinePayment, { IBillingOnlinePayment } from '../../models/BillingOnlinePayment';
import Tenant from '../../models/Tenant';
import { sendEmail } from '../../utils/email';
import { tenantBaseUrl } from '../../utils/appUrls';
import { FiscalError } from '../fiscal/fiscalCore';
import { getPlatformSettings } from '../fiscal/platformIssuer';
import { getHandyPayClient, getHandyPayConfig, HandyPayError, isHandyPayConfigured, isSessionPaid } from '../handypay/handypayClient';
import { toCents, fromCents } from './billingMath';
import { recordPayment } from './billingPayments';

/** Pages a tenant may come back to after paying (never an arbitrary URL: no open redirect). */
const RETURN_PATHS = ['/admin/subscription', '/accounting/subscription'];
/** An open session is reused for the same amount for this long. */
const REUSE_MS = 12 * 60 * 60 * 1000;

const toFiscal = (err: unknown) =>
  err instanceof HandyPayError ? new FiscalError(err.status === 503 ? 503 : 502, 'PAYMENT_GATEWAY', err.message) : err;

export async function startOnlinePayment(
  tenantId: string,
  chargeId: string,
  options: { email?: string; returnBase?: unknown; now?: Date } = {},
): Promise<{ url: string; sessionId: string }> {
  if (!isHandyPayConfigured()) throw new FiscalError(503, 'PAYMENT_GATEWAY_OFF', 'Online payment is not available yet. Pay by transfer.');
  const now = options.now ?? new Date();
  const charge = await BillingCharge.findOne({ _id: chargeId, tenantId, status: { $in: ['open', 'partial'] } });
  if (!charge || charge.balance <= 0) throw new FiscalError(409, 'BILLING_STATE', 'This charge has nothing to pay');
  const tenant = await Tenant.findById(tenantId).select('slug ownerEmail billing.billingEmail name');
  if (!tenant) throw new FiscalError(404, 'TENANT_NOT_FOUND', 'Tenant not found');

  const reusable = await BillingOnlinePayment.findOne({
    chargeId: charge._id, status: 'open', amount: charge.balance, createdAt: { $gt: new Date(now.getTime() - REUSE_MS) },
  }).sort({ createdAt: -1 });
  if (reusable?.url) return { url: reusable.url, sessionId: reusable.sessionId };

  const path = RETURN_PATHS.includes(options.returnBase as string) ? (options.returnBase as string) : RETURN_PATHS[0];
  const back = `${tenantBaseUrl(tenant.slug)}${path}`;
  const cfg = getHandyPayConfig();
  let session;
  try {
    session = await getHandyPayClient().createSession({
      amount: toCents(charge.balance),
      currency: cfg.currency,
      name: `Pilloto — cobro ${charge.number}`,
      successUrl: `${back}?payment=success&session={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${back}?payment=cancelled`,
      customerEmail: tenant.billing?.billingEmail || tenant.ownerEmail || options.email,
      metadata: { chargeId: String(charge._id), tenantId: String(tenantId), chargeNumber: charge.number },
    });
  } catch (err) {
    throw toFiscal(err);
  }
  if (!session.url) throw new FiscalError(502, 'PAYMENT_GATEWAY', 'HandyPay did not return a checkout page');
  await BillingOnlinePayment.create({
    tenantId, chargeId: charge._id, sessionId: session.id, url: session.url, amount: charge.balance, currency: cfg.currency,
    startedByEmail: options.email,
  });
  return { url: session.url, sessionId: session.id };
}

async function notifyReview(online: IBillingOnlinePayment, reason: string): Promise<void> {
  const to = (await getPlatformSettings()).billing?.notifyEmail;
  if (!to) return;
  try {
    await sendEmail({
      to,
      subject: '[Pilloto] Pago en línea por revisar',
      html: `<p>HandyPay confirmó el pago de la sesión <code>${online.sessionId}</code> (RD$ ${online.amount.toFixed(2)}), pero no se pudo registrar: ${reason}</p><p>Regístrelo o reembólselo desde la consola.</p>`,
      _logMeta: { emailType: 'online_payment_review', referenceId: String(online._id) },
    });
  } catch (err: any) {
    console.warn(`[Billing] Could not email the online payment review: ${err?.message}`);
  }
}

export type ConfirmOutcome = 'recorded' | 'already_recorded' | 'not_paid' | 'expired' | 'needs_review' | 'unknown_session';

/**
 * Reads the session back from HandyPay and, if it is paid, records the payment against its charge
 * (once). Safe to call from the webhook and from the tenant's return page.
 */
export async function confirmOnlinePayment(sessionId: string, options: { tenantId?: string; now?: Date } = {}): Promise<{ outcome: ConfirmOutcome; online?: IBillingOnlinePayment }> {
  const online = await BillingOnlinePayment.findOne({ provider: 'handypay', sessionId, ...(options.tenantId ? { tenantId: options.tenantId } : {}) });
  if (!online) return { outcome: 'unknown_session' };
  if (online.status === 'paid') return { outcome: 'already_recorded', online };
  if (online.status === 'needs_review') return { outcome: 'needs_review', online };

  let session;
  try {
    session = await getHandyPayClient().getSession(sessionId);
  } catch (err) {
    throw toFiscal(err);
  }
  if (!isSessionPaid(session)) {
    if (session.status === 'expired') {
      await BillingOnlinePayment.updateOne({ _id: online._id, status: 'open' }, { $set: { status: 'expired' } });
      return { outcome: 'expired', online };
    }
    return { outcome: 'not_paid', online };
  }

  // Claim the session so two confirmations (webhook + return page) never record twice.
  const claimed = await BillingOnlinePayment.findOneAndUpdate({ _id: online._id, status: { $in: ['open', 'expired', 'failed'] } }, { $set: { status: 'paid' } }, { new: true });
  if (!claimed) return { outcome: 'already_recorded', online };

  const amount = session.amountTotal !== undefined ? fromCents(session.amountTotal) : online.amount;
  try {
    const { payment } = await recordPayment(
      online.chargeId,
      { amount, method: 'card', reference: session.paymentIntent ?? sessionId, paidAt: (options.now ?? new Date()).toISOString(), notes: 'Pago en línea (HandyPay)', source: 'handypay' },
      { email: 'handypay' },
      options.now,
    );
    claimed.paymentId = payment._id as mongoose.Types.ObjectId;
    await claimed.save();
    return { outcome: 'recorded', online: claimed };
  } catch (err: any) {
    const reason = err?.message ?? String(err);
    await BillingOnlinePayment.updateOne({ _id: online._id }, { $set: { status: 'needs_review', error: reason.slice(0, 500) } });
    await notifyReview(online, reason);
    return { outcome: 'needs_review', online };
  }
}

/** Marks a session expired (webhook `checkout.session.expired`). */
export async function expireOnlinePayment(sessionId: string): Promise<void> {
  await BillingOnlinePayment.updateOne({ provider: 'handypay', sessionId, status: 'open' }, { $set: { status: 'expired' } });
}

export { toCents };
