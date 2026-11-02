/**
 * Platform-console actions that set up Channex webhook delivery (plan Phase 7.1; used in the 9.5 staging pass;
 * CHANNEX_ARCHITECTURE.md §7.1, §11.1). Superadmin only; the UI comes with plan 9.3.
 *
 *   createSigningKey     POST /signing_keys. Channex returns the secret ONCE: it is handed
 *                        back to the superadmin to put in CHANNEX_WEBHOOK_SECRET and never
 *                        stored or logged by Pilloto. Only the key id is kept.
 *   upsertGlobalWebhook  one global, signed webhook with the §7.1 event mask. Idempotent:
 *                        updates the stored webhook (or one already registered for the same
 *                        URL) instead of creating a second one.
 *   testWebhook          POST /webhooks/:id/test (Channex sends a delivery to our URL).
 */

import ChannexWebhookEvent from '../../models/ChannexWebhookEvent';
import PlatformSettings from '../../models/PlatformSettings';
import { ChannexClient, ChannexError, createChannexClient } from './channexClient';
import { getChannexConfig, isChannexConfigured } from './config';

export const WEBHOOK_EVENT_MASK = [
  'booking', 'booking_unmapped_room', 'booking_unmapped_rate', 'non_acked_booking',
  'sync_error', 'sync_warning', 'rate_error',
  'new_channel', 'updated_channel', 'activate_channel', 'deactivate_channel', 'disconnect_channel', 'disconnect_listing',
  'channel_removal_warning', 'property_removal_warning',
  'reservation_request', 'alteration_request', 'inquiry', 'accepted_reservation', 'declined_reservation',
].join(';');

export type SetupResult<T> = ({ ok: true } & T) | { ok: false; reason: 'not_configured' | 'invalid' | 'missing_prerequisite' | 'channex_error'; message: string };

const NOT_CONFIGURED = { ok: false as const, reason: 'not_configured' as const, message: 'CHANNEX_API_KEY is not set on this server.' };

function channexFailure(err: unknown) {
  if (!(err instanceof ChannexError)) throw err;
  return { ok: false as const, reason: 'channex_error' as const, message: err.message };
}

async function platformChannexSettings() {
  const doc = await PlatformSettings.findOne({ key: 'global' }).select('channex').lean();
  return doc?.channex ?? { globalEnabled: true, iframePlatformOnly: false };
}

async function saveChannexSettings(fields: Record<string, unknown>) {
  const $set = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`channex.${k}`, v]));
  await PlatformSettings.updateOne({ key: 'global' }, { $set }, { upsert: true });
}

function clientOrNull(client?: ChannexClient): ChannexClient | null {
  if (client) return client;
  const config = getChannexConfig();
  return isChannexConfigured(config) ? createChannexClient(config) : null;
}

// ─── Status ──────────────────────────────────────────────────────────────────

export async function webhookStatus() {
  const config = getChannexConfig();
  const settings = await platformChannexSettings();
  const recent = await ChannexWebhookEvent.find({})
    .sort({ receivedAt: -1 }).limit(20)
    .select('event channexPropertyId tenantId signatureKeyLabel receivedAt processedAt error').lean();
  return {
    environment: config.environment,
    callbackUrl: config.webhookUrl ?? null,
    secretConfigured: Boolean(config.webhookSecret),
    signingKeyId: settings.signingKeyId ?? null,
    webhookId: settings.webhookId ?? null,
    lastWebhookAt: settings.lastWebhookAt ?? null,
    eventMask: WEBHOOK_EVENT_MASK,
    recentEvents: recent,
  };
}

// ─── Signing key ─────────────────────────────────────────────────────────────

export async function createSigningKey(
  input: { billingAccountId?: unknown; title?: unknown },
  client?: ChannexClient,
): Promise<SetupResult<{ signingKeyId: string; secret: string; message: string }>> {
  const billingAccountId = typeof input.billingAccountId === 'string' ? input.billingAccountId.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(billingAccountId)) {
    return { ok: false, reason: 'invalid', message: 'billingAccountId (the Channex billing account UUID that will own the key) is required.' };
  }
  const title = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim().slice(0, 100)
    : `Pilloto ${getChannexConfig().environment} webhooks`;

  const c = clientOrNull(client);
  if (!c) return NOT_CONFIGURED;
  try {
    const res = await c.post<any>('/signing_keys', { signing_key: { title, billing_account_id: billingAccountId } });
    const signingKeyId: string | undefined = res?.data?.id ?? res?.data?.attributes?.id;
    const secret: string | undefined = res?.data?.attributes?.secret;
    if (!signingKeyId || !secret) {
      return { ok: false, reason: 'channex_error', message: 'Channex did not return a signing key id and secret.' };
    }
    await saveChannexSettings({ signingKeyId });
    return {
      ok: true,
      signingKeyId,
      secret,
      message: 'Store this secret in CHANNEX_WEBHOOK_SECRET and restart the backend. It is shown only once and Pilloto does not keep it. Then create or update the global webhook so it signs with this key.',
    };
  } catch (err) {
    return channexFailure(err);
  }
}

// ─── Global webhook ──────────────────────────────────────────────────────────

export function globalWebhookBody(callbackUrl: string, signingKeyId: string) {
  return {
    webhook: {
      callback_url: callbackUrl,
      event_mask: WEBHOOK_EVENT_MASK,
      property_id: null,
      is_global: true,
      is_active: true,
      send_data: true,
      is_signed: true,
      signing_key_id: signingKeyId,
    },
  };
}

export async function upsertGlobalWebhook(
  input: { signingKeyId?: unknown } = {},
  client?: ChannexClient,
): Promise<SetupResult<{ webhookId: string; created: boolean; callbackUrl: string; eventMask: string }>> {
  const config = getChannexConfig();
  if (!config.webhookUrl) {
    return { ok: false, reason: 'missing_prerequisite', message: 'Set CHANNEX_WEBHOOK_URL (public URL ending in /api/webhooks/channex) and restart the backend.' };
  }
  if (!/^https:\/\//.test(config.webhookUrl)) {
    return { ok: false, reason: 'missing_prerequisite', message: 'CHANNEX_WEBHOOK_URL must be an https URL reachable by Channex.' };
  }
  const settings = await platformChannexSettings();
  const signingKeyId = (typeof input.signingKeyId === 'string' && input.signingKeyId.trim()) || settings.signingKeyId;
  if (!signingKeyId) {
    return { ok: false, reason: 'missing_prerequisite', message: 'Create a signing key first (or pass signingKeyId).' };
  }

  const c = clientOrNull(client);
  if (!c) return NOT_CONFIGURED;
  const body = globalWebhookBody(config.webhookUrl, signingKeyId);
  try {
    let webhookId: string | undefined = settings.webhookId;
    if (webhookId) {
      try {
        await c.put(`/webhooks/${encodeURIComponent(webhookId)}`, body);
      } catch (err) {
        if (!(err instanceof ChannexError && err.status === 404)) throw err;
        webhookId = undefined; // deleted in Channex: find or create below
      }
    }
    let created = false;
    if (!webhookId) {
      const existing = (await c.paginateAll<{ callback_url?: string; is_global?: boolean }>('/webhooks'))
        .find((w) => w.is_global && w.callback_url === config.webhookUrl);
      if (existing) {
        webhookId = existing.id;
        await c.put(`/webhooks/${encodeURIComponent(webhookId)}`, body);
      } else {
        const res = await c.post<any>('/webhooks', body);
        webhookId = res?.data?.id;
        created = true;
        if (!webhookId) return { ok: false, reason: 'channex_error', message: 'Channex did not return a webhook id.' };
      }
    }
    await saveChannexSettings({ webhookId, signingKeyId });
    return { ok: true, webhookId, created, callbackUrl: config.webhookUrl, eventMask: WEBHOOK_EVENT_MASK };
  } catch (err) {
    return channexFailure(err);
  }
}

// ─── Test ────────────────────────────────────────────────────────────────────

export async function testWebhook(client?: ChannexClient): Promise<SetupResult<{ webhookId: string; result: unknown }>> {
  const { webhookId } = await platformChannexSettings();
  if (!webhookId) return { ok: false, reason: 'missing_prerequisite', message: 'Create the global webhook first.' };
  const c = clientOrNull(client);
  if (!c) return NOT_CONFIGURED;
  try {
    const res = await c.post<any>(`/webhooks/${encodeURIComponent(webhookId)}/test`);
    // Channex reports what our endpoint answered (status_code, body) and the HMAC headers it sent
    return { ok: true, webhookId, result: res?.data?.attributes ?? res?.data ?? res };
  } catch (err) {
    return channexFailure(err);
  }
}
