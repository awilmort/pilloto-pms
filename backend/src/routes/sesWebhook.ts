/**
 * Amazon SNS → SES event webhook
 *
 * Handles SubscriptionConfirmation (auto-confirms) and
 * Notification events containing SES bounce/complaint data.
 *
 * Security:
 * - Validates that SigningCertURL belongs to amazonaws.com
 * - Rate-limited separately from the main API
 * - Does NOT require JWT auth (SNS cannot present tokens)
 * - Signature body verification via the 'sns-validator' package
 *   is optional but recommended in production; we verify the
 *   cert domain as a minimum.
 *
 * Registration: must be mounted BEFORE resolveTenant middleware
 * in index.ts so there is no tenant context dependency.
 */

import express, { Request, Response } from 'express';
import https from 'https';
import rateLimit from 'express-rate-limit';
import EmailSuppression from '../models/EmailSuppression';

const router = express.Router();

// Tight rate limit — SNS sends at most a handful of msgs/second
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(webhookLimiter);

// Validate the signing certificate URL is from amazonaws.com
function isSafeCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'https:') &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

// Fetch the subscription confirmation URL (plain HTTPS GET)
function httpGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith('.amazonaws.com') || parsed.protocol !== 'https:') {
        return reject(new Error('Unsafe subscription URL'));
      }
      https.get(url, res => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

// POST /api/webhooks/ses
router.post('/ses', express.json({ type: ['application/json', 'text/plain'] }), async (req: Request, res: Response) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Basic structure check
    if (!body || typeof body !== 'object' || !body.Type) {
      return res.status(400).json({ error: 'Invalid SNS payload' });
    }

    // Reject unsafe cert URLs before any processing
    if (body.SigningCertURL && !isSafeCertUrl(body.SigningCertURL)) {
      console.warn(JSON.stringify({ webhookEvent: 'unsafe_cert_url', url: String(body.SigningCertURL) }));
      return res.status(400).json({ error: 'Invalid signing certificate URL' });
    }

    // ── Subscription confirmation ────────────────────────────────
    if (body.Type === 'SubscriptionConfirmation') {
      if (typeof body.SubscribeURL !== 'string') {
        return res.status(400).json({ error: 'Missing SubscribeURL' });
      }
      await httpGet(body.SubscribeURL);
      console.log(JSON.stringify({ webhookEvent: 'sns_subscription_confirmed' }));
      return res.status(200).json({ ok: true });
    }

    // ── Notification ─────────────────────────────────────────────
    if (body.Type === 'Notification') {
      let message: any;
      try {
        message = typeof body.Message === 'string' ? JSON.parse(body.Message) : body.Message;
      } catch {
        console.warn(JSON.stringify({ webhookEvent: 'parse_error', type: body.Type }));
        return res.status(400).json({ error: 'Invalid Message JSON' });
      }

      const eventType: string = message?.notificationType ?? message?.eventType ?? '';

      if (eventType === 'Bounce') {
        const bounce = message.bounce;
        if (!bounce) return res.status(200).json({ ok: true });

        const reason: 'hard_bounce' | 'soft_bounce' =
          bounce.bounceType === 'Permanent' ? 'hard_bounce' : 'soft_bounce';

        const addresses: string[] = (bounce.bouncedRecipients || [])
          .map((r: any) => typeof r.emailAddress === 'string' ? r.emailAddress.toLowerCase().trim() : null)
          .filter(Boolean);

        for (const email of addresses) {
          await EmailSuppression.updateOne(
            { email },
            { $setOnInsert: { email, reason, suppressedAt: new Date() } },
            { upsert: true }
          );
          console.log(JSON.stringify({ webhookEvent: 'suppressed', email: email.slice(0, 3) + '***', reason }));
        }
        return res.status(200).json({ ok: true });
      }

      if (eventType === 'Complaint') {
        const complaint = message.complaint;
        if (!complaint) return res.status(200).json({ ok: true });

        const addresses: string[] = (complaint.complainedRecipients || [])
          .map((r: any) => typeof r.emailAddress === 'string' ? r.emailAddress.toLowerCase().trim() : null)
          .filter(Boolean);

        for (const email of addresses) {
          await EmailSuppression.updateOne(
            { email },
            { $setOnInsert: { email, reason: 'complaint', suppressedAt: new Date() } },
            { upsert: true }
          );
          console.log(JSON.stringify({ webhookEvent: 'suppressed', email: email.slice(0, 3) + '***', reason: 'complaint' }));
        }
        return res.status(200).json({ ok: true });
      }

      // Other notification types (delivery, send, etc.) — acknowledge silently
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error(JSON.stringify({ webhookEvent: 'error', message: String(error.message) }));
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
