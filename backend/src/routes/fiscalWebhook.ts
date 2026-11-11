/**
 * BillingSoft webhook — POST /api/webhooks/billingsoft/:tenantId
 *
 * Mounted in index.ts BEFORE express.json() and resolveTenant: the signature covers the raw bytes,
 * and the tenant comes from the path and is confirmed by the verified event's organization id —
 * never from the Host header. No JWT (BillingSoft cannot present one).
 *
 * The signing secret is the tenant's own, so the tenant is looked up first and the body is trusted
 * only after it verifies. Answers 200 once the event is handled (or known to be a duplicate), and
 * 5xx when handling failed so BillingSoft retries.
 */
import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { OWN_ORGANIZATION } from '../services/fiscal/billingsoftClient';
import { loadIssuer } from '../services/fiscal/platformIssuer';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { decrypt } from '../utils/encryption';
import { BsWebhookEvent } from '../services/fiscal/billingsoftTypes';
import { handleEvent, verifySignature } from '../services/fiscal/fiscalWebhook';

const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/:tenantId',
  webhookLimiter,
  express.raw({ type: () => true, limit: '1mb' }),
  async (req: Request, res: Response) => {
    const { tenantId } = req.params;
    // Same answer for an unknown tenant and a bad signature: nothing to learn by probing.
    const reject = () => res.status(401).json({ success: false, message: 'Invalid webhook' });
    if (!mongoose.Types.ObjectId.isValid(tenantId)) return reject();

    // The path names the issuer: a tenant, or Pilloto itself (its own e-CF).
    const tenant = await loadIssuer(tenantId);
    if (!tenant?.fiscal?.organizationId || !tenant.fiscal.webhookSecret) return reject();

    let secret: string;
    try {
      secret = decrypt(tenant.fiscal.webhookSecret);
    } catch {
      console.error(JSON.stringify({ webhookEvent: 'billingsoft_secret_unreadable', tenantId }));
      return res.status(503).json({ success: false, message: 'Webhook secret unavailable' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const verified = verifySignature({ rawBody, header: req.get('BillingSoft-Signature'), secret });
    if (!verified.ok) {
      console.warn(JSON.stringify({ webhookEvent: 'billingsoft_signature_rejected', tenantId, reason: verified.reason }));
      return reject();
    }

    let event: BsWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, message: 'Malformed body' });
    }
    // Pilloto's own events name its real Organization, which Pilloto stores as `self`; the signature
    // (its own secret) is what ties them to it.
    const ownEvents = tenant.fiscal.organizationId === OWN_ORGANIZATION;
    if (!event?.id || !event.type || (!ownEvents && event.organizationId !== tenant.fiscal.organizationId)) {
      return res.status(400).json({ success: false, message: 'Event does not belong to this company' });
    }

    try {
      const outcome = await tenantLocalStorage.run({ tenantId }, () => handleEvent(tenant, event));
      return res.status(200).json({ success: true, outcome });
    } catch (err: any) {
      console.error(JSON.stringify({ webhookEvent: 'billingsoft_handler_error', tenantId, eventId: event.id, message: err?.message }));
      return res.status(500).json({ success: false, message: 'Could not handle the event' });
    }
  },
);

export default router;
