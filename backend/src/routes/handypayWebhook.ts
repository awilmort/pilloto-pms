/**
 * POST /api/webhooks/handypay — HandyPay's events about Pilloto's checkout sessions.
 *
 * Raw body (the signature covers the exact bytes), no tenant, no JWT. Registered before
 * express.json(). The event only says which session to look at: confirmOnlinePayment reads the
 * session back from HandyPay before recording anything. Answers 2xx fast; HandyPay retries
 * otherwise and deactivates the endpoint after 10 consecutive failures.
 */
import express, { Request, Response } from 'express';
import BillingOnlinePayment from '../models/BillingOnlinePayment';
import { getHandyPayConfig, verifyHandyPaySignature } from '../services/handypay/handypayClient';
import { confirmOnlinePayment, expireOnlinePayment } from '../services/platformBilling/onlinePayments';

const router = express.Router();

const PAID_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];

router.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const { webhookSecret } = getHandyPayConfig();
  if (!verifyHandyPaySignature(raw, req.header('x-handypay-signature'), webhookSecret)) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }
  let event: any;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }
  const type = String(event?.type ?? '');
  const object = event?.data?.object ?? event?.data ?? {};
  const sessionId: string | undefined = object?.id ?? object?.session_id ?? object?.sessionId;
  if (!sessionId || !type.startsWith('checkout.session.')) return res.json({ success: true, ignored: true });

  // Deduplicate by event id (HandyPay may deliver an event more than once).
  if (event?.id) {
    const fresh = await BillingOnlinePayment.updateOne({ provider: 'handypay', sessionId, eventIds: { $ne: String(event.id) } }, { $push: { eventIds: String(event.id) } });
    if (fresh.matchedCount === 0) {
      const known = await BillingOnlinePayment.exists({ provider: 'handypay', sessionId });
      return res.json({ success: true, ...(known ? { duplicate: true } : { ignored: true }) });
    }
  }

  try {
    if (PAID_EVENTS.includes(type)) {
      const { outcome } = await confirmOnlinePayment(sessionId);
      return res.json({ success: true, outcome });
    }
    if (type === 'checkout.session.expired') await expireOnlinePayment(sessionId);
    return res.json({ success: true });
  } catch (err: any) {
    // HandyPay unreachable while reading the session back: let it retry.
    console.warn(`[HandyPay] Could not handle ${type} for ${sessionId}: ${err?.message}`);
    if (event?.id) await BillingOnlinePayment.updateOne({ provider: 'handypay', sessionId }, { $pull: { eventIds: String(event.id) } });
    return res.status(503).json({ success: false, message: 'Try again' });
  }
});

export default router;
