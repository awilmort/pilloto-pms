/**
 * Resend email event webhook
 *
 * Resend delivers events (bounced, complained, etc.) via Svix.
 * This handler verifies the Svix signature and processes the events
 * to maintain the EmailSuppression collection.
 *
 * Security:
 * - Uses the svix package to cryptographically verify every payload
 * - Rejects any request that fails signature verification with 400
 * - Requires raw body; must be mounted with express.raw() — NOT express.json()
 * - Does NOT require JWT auth (Resend/Svix cannot present tokens)
 * - Rate-limited separately from the main API
 *
 * Registration: must be mounted BEFORE resolveTenant middleware in index.ts.
 *
 * Resend webhook events handled:
 * - email.bounced   → hard_bounce suppression
 * - email.complained → complaint suppression
 * All other event types are acknowledged silently.
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Webhook } from 'svix';
import EmailSuppression from '../models/EmailSuppression';

const router = express.Router();

// Tight rate limit — Resend/Svix sends at most a handful of messages per second
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(webhookLimiter);

/**
 * POST /api/webhooks/resend
 *
 * express.raw() is applied per-route so it does not conflict with the
 * global express.json() parser used by all other routes.
 */
router.post(
  '/resend',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      console.error(JSON.stringify({ webhookEvent: 'config_error', message: 'RESEND_WEBHOOK_SECRET not set' }));
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    // Svix requires the raw body as a string or Buffer
    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(String(req.body));

    const svixId = req.headers['svix-id'];
    const svixTimestamp = req.headers['svix-timestamp'];
    const svixSignature = req.headers['svix-signature'];

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.warn(JSON.stringify({ webhookEvent: 'missing_svix_headers' }));
      return res.status(400).json({ error: 'Missing Svix signature headers' });
    }

    let event: any;
    try {
      const wh = new Webhook(secret);
      event = wh.verify(rawBody, {
        'svix-id': String(svixId),
        'svix-timestamp': String(svixTimestamp),
        'svix-signature': String(svixSignature),
      });
    } catch (err: any) {
      console.warn(JSON.stringify({ webhookEvent: 'signature_invalid', message: String(err?.message) }));
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const eventType: string = event?.type ?? '';

    try {
      if (eventType === 'email.bounced') {
        // Extract recipient addresses from the Resend bounce event
        const to: string[] = Array.isArray(event.data?.to)
          ? event.data.to
          : typeof event.data?.to === 'string'
            ? [event.data.to]
            : [];

        for (const raw of to) {
          const email = raw.toLowerCase().trim();
          if (!email) continue;
          await EmailSuppression.updateOne(
            { email },
            { $setOnInsert: { email, reason: 'hard_bounce', suppressedAt: new Date() } },
            { upsert: true }
          );
          console.log(JSON.stringify({ webhookEvent: 'suppressed', email: email.slice(0, 3) + '***', reason: 'hard_bounce' }));
        }
        return res.status(200).json({ ok: true });
      }

      if (eventType === 'email.complained') {
        const to: string[] = Array.isArray(event.data?.to)
          ? event.data.to
          : typeof event.data?.to === 'string'
            ? [event.data.to]
            : [];

        for (const raw of to) {
          const email = raw.toLowerCase().trim();
          if (!email) continue;
          await EmailSuppression.updateOne(
            { email },
            { $setOnInsert: { email, reason: 'complaint', suppressedAt: new Date() } },
            { upsert: true }
          );
          console.log(JSON.stringify({ webhookEvent: 'suppressed', email: email.slice(0, 3) + '***', reason: 'complaint' }));
        }
        return res.status(200).json({ ok: true });
      }

      // All other event types (email.delivered, email.opened, etc.) — acknowledge silently
      return res.status(200).json({ ok: true });
    } catch (error: any) {
      console.error(JSON.stringify({ webhookEvent: 'error', message: String(error?.message) }));
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

export default router;
