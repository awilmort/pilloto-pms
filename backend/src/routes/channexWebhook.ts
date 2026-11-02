/**
 * Channex webhook — POST /api/webhooks/channex (CHANNEX_ARCHITECTURE.md §7.1, §11.2)
 *
 * Security:
 * - Mounted in index.ts BEFORE express.json() and resolveTenant: the HMAC is computed over
 *   the raw bytes (a re-serialized body would not verify), and the tenant comes only from
 *   the verified payload's property_id — never from the Host or headers.
 * - HMAC-SHA256 with CHANNEX_WEBHOOK_SECRET, ±300 s timestamp, constant-time, either of two
 *   signatures during a key rotation (services/channex/webhookHandler.ts).
 * - No JWT (Channex cannot present one); dedicated rate limiter; 2 MB body limit.
 *
 * The event is stored before answering 200 (a storage failure answers 500 so Channex
 * retries) and is processed after the response, so Channex never times out.
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getChannexConfig } from '../services/channex/config';
import { dispatchWebhookEvent, recordWebhookEvent, verifyChannexSignature } from '../services/channex/webhookHandler';

const router = express.Router();

// Channex delivers bursts after an outage (retries with backoff); keep headroom
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/',
  webhookLimiter,
  // Any content type: the body must stay raw bytes for the signature
  express.raw({ type: () => true, limit: '2mb' }),
  async (req: Request, res: Response) => {
    const secret = getChannexConfig().webhookSecret;
    if (!secret) {
      console.error(JSON.stringify({ webhookEvent: 'channex_config_error', message: 'CHANNEX_WEBHOOK_SECRET not set' }));
      // 5xx: Channex retries for ~24 h, so deliveries made before the secret is set are not lost
      return res.status(503).json({ success: false, message: 'Webhook secret not configured' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const verified = verifyChannexSignature({
      rawBody,
      timestamp: req.get('x-hmac-timestamp'),
      signatures: req.get('x-hmac-signature-256'),
      keyLabels: req.get('x-hmac-keys-256'),
      secret,
    });
    if (!verified.ok) {
      console.warn(JSON.stringify({ webhookEvent: 'channex_signature_rejected', reason: verified.reason }));
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, message: 'Body is not JSON' });
    }

    let eventId: string;
    try {
      eventId = String((await recordWebhookEvent(body, verified.keyLabel))._id);
    } catch (err: any) {
      console.error(JSON.stringify({ webhookEvent: 'channex_store_failed', message: String(err?.message) }));
      return res.status(500).json({ success: false, message: 'Could not store the event' });
    }

    res.status(200).json({ success: true });
    setImmediate(() => { void dispatchWebhookEvent(eventId); });
  },
);

export default router;
