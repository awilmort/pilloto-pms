/**
 * Channex webhook handling (CHANNEX_ARCHITECTURE.md §7.1, §11.2; plan Phase 7.1).
 *
 *   verifyChannexSignature  pure HMAC check over the RAW body bytes:
 *                           hex(HMAC_SHA256(secret, "{x-hmac-timestamp}.{raw body}")) must match
 *                           any of the 1–2 comma-separated `x-hmac-signature-256` values
 *                           (two during a key rotation), constant-time, ±300 s clock skew.
 *   recordWebhookEvent      persists the delivery as a ChannexWebhookEvent (before the 200).
 *   dispatchWebhookEvent    runs after the response: resolves the tenant ONLY from the verified
 *                           payload's `property_id` (ChannexProperty, current environment) and
 *                           handles the event inside that tenant's scope:
 *                             booking*                → revision inbox (bookingInbox.ts), then
 *                                                       an inbox pass so the booking arrives in seconds
 *                             unmapped / non-acked    → critical alerts
 *                             sync_error / warnings   → alerts per channel
 *                             channel events          → alerts + the cached channel's last event
 *                                                       (channels.ts); activate_channel queues a full sync
 *                             property_removal_warning→ critical alert
 *                             Airbnb requests         → alerts with a 24 h deadline
 *                           Anything else is only recorded.
 *
 * Alerts go through alerts.service.ts (dedupe, reopen, email digest). The stored English titles
 * are fallbacks for the platform console; tenants read translated texts by alert type.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import { ChannelAlertSeverity, ChannelAlertType } from '../../models/ChannelAlert';
import { AIRBNB_REQUEST_TYPES, raiseAlert as raise, resolveAlerts as resolve } from './alerts.service';
import ChannexProperty, { IChannexProperty } from '../../models/ChannexProperty';
import ChannexWebhookEvent, { IChannexWebhookEvent } from '../../models/ChannexWebhookEvent';
import PlatformSettings from '../../models/PlatformSettings';
import { tenantLocalStorage } from '../../middleware/tenantContext';
import { enqueueRevision, requestInboxRun } from './bookingInbox';
import { getChannexConfig } from './config';
import { queueFullSync } from './fullSync';
import { recordChannelEvent } from './channels';
import { runInTenant } from './provisioning';

export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const AIRBNB_REQUEST_DEADLINE_MS = 24 * 3600_000;

// ─── Signature ───────────────────────────────────────────────────────────────

export interface SignatureInput {
  rawBody: Buffer;
  timestamp: string | undefined;
  signatures: string | undefined;
  /** `x-hmac-keys-256`: key labels (`...last6`) in the same order as the signatures */
  keyLabels?: string;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}

export type SignatureResult =
  | { ok: true; keyLabel?: string }
  | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'stale_timestamp' | 'bad_signature' };

export function computeSignature(secret: string, timestamp: string, rawBody: Buffer): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function verifyChannexSignature(input: SignatureInput): SignatureResult {
  const { rawBody, secret } = input;
  const timestamp = input.timestamp?.trim();
  const signatures = (input.signatures || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!timestamp || signatures.length === 0) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };

  const nowSeconds = (input.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - Number(timestamp)) > (input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expected = computeSignature(secret, timestamp, rawBody);
  // Compare against every signature (no early exit) so timing does not reveal which one matched
  let matched = -1;
  signatures.forEach((sig, i) => {
    if (safeEqual(sig, expected) && matched < 0) matched = i;
  });
  if (matched < 0) return { ok: false, reason: 'bad_signature' };
  const labels = (input.keyLabels || '').split(',').map((s) => s.trim());
  return { ok: true, keyLabel: labels[matched] || undefined };
}

// ─── Event shape ─────────────────────────────────────────────────────────────

/** The fields Pilloto reads from a delivery `{ event, property_id, user_id, timestamp, payload }`. */
export interface WebhookFacts {
  event: string;
  propertyId?: string;
  bookingId?: string;
  revisionId?: string;
  channelId?: string;
  liveFeedEventId?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : undefined);

export function webhookFacts(body: any): WebhookFacts {
  const p = body?.payload && typeof body.payload === 'object' ? body.payload : {};
  return {
    event: (str(body?.event) || 'unknown').slice(0, 80),
    propertyId: str(body?.property_id) ?? str(p.property_id),
    bookingId: str(p.booking_id),
    revisionId: str(p.revision_id) ?? str(p.booking_revision_id),
    channelId: str(p.channel_id) ?? str(p.channel?.id),
    liveFeedEventId: str(p.live_feed_event_id) ?? str(p.id),
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Store the verified delivery. Outside any tenant scope (the tenant is not known yet). */
export async function recordWebhookEvent(body: unknown, signatureKeyLabel?: string): Promise<IChannexWebhookEvent> {
  const facts = webhookFacts(body);
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : { body };
  return tenantLocalStorage.run(null, () => ChannexWebhookEvent.create({
    event: facts.event,
    channexPropertyId: facts.propertyId,
    payload,
    signatureKeyLabel,
    receivedAt: new Date(),
  }));
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

interface AlertInput {
  type: ChannelAlertType;
  severity: ChannelAlertSeverity;
  dedupeKey: string;
  title: string;
  details: Record<string, unknown>;
  channexBookingId?: string;
  channelId?: string;
  liveFeedEventId?: string;
  dueAt?: Date;
}

const raiseAlert = (tenantId: mongoose.Types.ObjectId | undefined, a: AlertInput) => raise({ ...a, ...(tenantId ? { tenantId } : {}) });
const resolveAlerts = (tenantId: mongoose.Types.ObjectId, types: ChannelAlertType[], dedupeKey: string) => resolve({ tenantId, types, dedupeKey });

// ─── Dispatch ────────────────────────────────────────────────────────────────

export const BOOKING_EVENTS = new Set(['booking', 'booking_new', 'booking_modification', 'booking_cancellation']);

const CHANNEL_ALERTS: Record<string, { type: ChannelAlertType; severity: ChannelAlertSeverity; title: string }> = {
  sync_error:              { type: 'sync_error', severity: 'critical', title: 'A channel reported an error with your prices or availability' },
  sync_warning:            { type: 'sync_warning', severity: 'warning', title: 'A channel reported a warning about your prices or availability' },
  rate_error:              { type: 'rate_error', severity: 'warning', title: 'A channel rejected one of your prices' },
  disconnect_channel:      { type: 'channel_disconnected', severity: 'critical', title: 'A channel was disconnected' },
  disconnect_listing:      { type: 'listing_disconnected', severity: 'critical', title: 'A listing was disconnected from its channel' },
  channel_removal_warning: { type: 'channel_removal_warning', severity: 'critical', title: 'A disabled channel will soon be removed' },
};

const AIRBNB_REQUESTS: Record<string, { type: ChannelAlertType; title: string }> = {
  reservation_request: { type: 'airbnb_reservation_request', title: 'Airbnb reservation request: answer within 24 hours' },
  alteration_request:  { type: 'airbnb_alteration_request', title: 'Airbnb change request: answer within 24 hours' },
  inquiry:             { type: 'airbnb_inquiry', title: 'Airbnb guest inquiry: answer within 24 hours' },
};

export type DispatchOutcome =
  | 'no_property'
  | 'unknown_property'
  | 'revision_enqueued'
  | 'alert'
  | 'alert_resolved'
  | 'full_sync_queued'
  | 'recorded';

export interface DispatchDeps {
  now?: () => Date;
}

/** Handle one event inside its tenant's scope. Returns what was done (for logs and tests). */
async function handleForProperty(property: IChannexProperty, facts: WebhookFacts, body: any, now: Date): Promise<DispatchOutcome> {
  const tenantId = property.tenantId;
  const payload = (body?.payload && typeof body.payload === 'object') ? body.payload : {};
  const details = { event: facts.event, payload };

  if (BOOKING_EVENTS.has(facts.event)) {
    if (!facts.revisionId || !facts.bookingId) return 'recorded';
    await enqueueRevision({ tenantId, channexPropertyId: facts.propertyId, revisionId: facts.revisionId, bookingId: facts.bookingId, source: 'webhook' });
    requestInboxRun();
    return 'revision_enqueued';
  }

  if (facts.event === 'booking_unmapped_room' || facts.event === 'booking_unmapped_rate') {
    if (facts.revisionId && facts.bookingId) {
      await enqueueRevision({ tenantId, channexPropertyId: facts.propertyId, revisionId: facts.revisionId, bookingId: facts.bookingId, source: 'webhook' });
      requestInboxRun();
    }
    await raiseAlert(tenantId, {
      type: 'unmapped_booking', severity: 'critical', dedupeKey: facts.bookingId || facts.revisionId || `event:${facts.event}`,
      title: facts.event === 'booking_unmapped_room'
        ? 'A booking arrived for a room that is not mapped in your channel'
        : 'A booking arrived for a rate that is not mapped in your channel',
      details, channexBookingId: facts.bookingId,
    });
    return 'alert';
  }

  if (facts.event === 'non_acked_booking') {
    await raiseAlert(tenantId, {
      type: 'non_acked_booking', severity: 'critical', dedupeKey: facts.bookingId || facts.revisionId || 'non_acked',
      title: 'A channel booking has not been received in Pilloto yet', details, channexBookingId: facts.bookingId,
    });
    return 'alert';
  }

  // Channel cards show the latest event and active flag without waiting for a list read
  if (facts.channelId) {
    await recordChannelEvent(property.environment, facts.channelId, facts.event, now)
      .catch((err) => console.error(`[Channex] channel event ${facts.event} not recorded: ${(err as Error).message}`));
  }

  const channelAlert = CHANNEL_ALERTS[facts.event];
  if (channelAlert) {
    await raiseAlert(tenantId, { ...channelAlert, dedupeKey: facts.channelId || 'property', details, channelId: facts.channelId });
    return 'alert';
  }

  if (facts.event === 'activate_channel') {
    if (facts.channelId) await resolveAlerts(tenantId, ['channel_disconnected', 'channel_removal_warning'], facts.channelId);
    if (property.status !== 'active') return 'recorded';
    await queueFullSync(property, 'channel_activated', now);
    return 'full_sync_queued';
  }

  if (facts.event === 'property_removal_warning') {
    await raiseAlert(tenantId, {
      type: 'property_removal_warning', severity: 'critical', dedupeKey: 'property',
      title: 'Your channel manager will be removed soon because no channel is connected', details,
    });
    return 'alert';
  }

  const request = AIRBNB_REQUESTS[facts.event];
  if (request) {
    // Reservation/alteration requests carry the requested booking as `bms`
    const bookingId = facts.bookingId ?? str(payload?.bms?.booking_id);
    await raiseAlert(tenantId, {
      type: request.type, severity: 'critical', dedupeKey: facts.liveFeedEventId || bookingId || `event:${now.getTime()}`,
      title: request.title, details, liveFeedEventId: facts.liveFeedEventId, channexBookingId: bookingId,
      dueAt: new Date(now.getTime() + AIRBNB_REQUEST_DEADLINE_MS),
    });
    return 'alert';
  }

  if (facts.event === 'accepted_reservation' || facts.event === 'declined_reservation') {
    // Answered (from Pilloto or the Airbnb app): close the request's alert
    const bookingId = facts.bookingId ?? str(payload?.bms?.booking_id);
    const notes = facts.event === 'accepted_reservation' ? 'Accepted on Airbnb.' : 'Declined on Airbnb.';
    let n = facts.liveFeedEventId ? await resolve({ tenantId, types: AIRBNB_REQUEST_TYPES, liveFeedEventId: facts.liveFeedEventId }, { notes, now }) : 0;
    if (!n && facts.liveFeedEventId) n = await resolve({ tenantId, types: AIRBNB_REQUEST_TYPES, dedupeKey: facts.liveFeedEventId }, { notes, now });
    if (!n && bookingId) await resolve({ tenantId, types: AIRBNB_REQUEST_TYPES, dedupeKey: bookingId }, { notes, now });
    return 'alert_resolved';
  }

  // new_channel, updated_channel, deactivate_channel, test deliveries, …: kept in ChannexWebhookEvent only
  return 'recorded';
}

/**
 * Process a stored event. Never throws: failures are written to the event's `error`.
 * Runs outside tenant scope until the property is resolved, then inside it.
 */
export async function dispatchWebhookEvent(eventId: mongoose.Types.ObjectId | string, deps: DispatchDeps = {}): Promise<DispatchOutcome | 'error'> {
  const now = deps.now?.() ?? new Date();
  return tenantLocalStorage.run(null, async () => {
    const doc = await ChannexWebhookEvent.findById(eventId);
    if (!doc) return 'error';
    const facts = webhookFacts(doc.payload);
    try {
      await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'channex.lastWebhookAt': now } }, { upsert: true });

      let outcome: DispatchOutcome;
      if (!facts.propertyId) {
        outcome = 'no_property';
      } else {
        const property = await ChannexProperty.findOne({ channexPropertyId: facts.propertyId, environment: getChannexConfig().environment });
        if (!property) {
          outcome = 'unknown_property';
          doc.error = `No Pilloto tenant owns Channex property ${facts.propertyId} in this environment.`;
          if (BOOKING_EVENTS.has(facts.event) || facts.event.startsWith('booking_')) {
            // A booking nobody can receive: platform emergency (architecture §7.3)
            await raiseAlert(undefined, {
              type: 'unknown_property', severity: 'critical', dedupeKey: facts.propertyId,
              title: 'Channex sent a booking for a property no tenant owns', details: { event: facts.event, propertyId: facts.propertyId, bookingId: facts.bookingId, revisionId: facts.revisionId },
            });
          }
        } else {
          doc.tenantId = property.tenantId;
          outcome = await runInTenant(property.tenantId, () => handleForProperty(property, facts, doc.payload, now));
        }
      }
      doc.processedAt = new Date();
      await doc.save();
      return outcome;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
      console.error(`[Channex] webhook ${facts.event} (${doc._id}) failed: ${message}`);
      await ChannexWebhookEvent.updateOne({ _id: doc._id }, { $set: { error: message, processedAt: new Date() } }).catch(() => undefined);
      return 'error';
    }
  });
}
