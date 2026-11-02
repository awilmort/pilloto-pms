/**
 * Booking revision inbox (CHANNEX_ARCHITECTURE.md §7.2–7.3; plan Phase 7.2).
 *
 * Revisions arrive two ways and land in the same inbox (ChannexBookingRevision, unique by
 * Channex revision id), so one announced twice is stored, applied and acked once:
 *   - webhook: `booking` events carry only ids → `enqueueRevision`, payload fetched later
 *     with GET /booking_revisions/:id;
 *   - feed poller (every 2 min, account-wide, oldest first, all pages): full payloads.
 *
 * `processInbox` (one instance at a time, via a lease on PlatformSettings) then:
 *   1. fetches missing payloads;
 *   2. resolves each row's tenant from its property id — an unknown property is `failed`,
 *      raises a platform alert and is NOT acked (Channex keeps warning and re-serving it);
 *   3. per booking, in `insertedAt` order: a revision older than one already applied for the
 *      same booking is `skipped_stale`; otherwise it is applied inside the tenant scope;
 *      a failure stops that booking's later revisions until it succeeds or gives up;
 *   4. acks every applied/skipped revision not acked yet (a failed ack is retried next pass).
 *
 * Stored payloads are card-scrubbed: `guarantee` keeps only card type, last 4 digits, expiry,
 * the virtual-card flag and virtual-card meta (architecture §11.4).
 *
 * Applying is the booking mapper's `applyBookingRevision` (create / modify / cancel the reservation).
 */

import mongoose from 'mongoose';
import { raiseAlert } from './alerts.service';
import ChannexBookingRevision, {
  BookingRevisionSource, BookingRevisionStatus, BOOKING_REVISION_STATUSES, IChannexBookingRevision,
} from '../../models/ChannexBookingRevision';
import ChannexProperty from '../../models/ChannexProperty';
import PlatformSettings from '../../models/PlatformSettings';
import { tenantLocalStorage } from '../../middleware/tenantContext';
import { ChannexClient, createChannexClient, JsonApiResource } from './channexClient';
import { getChannexConfig, isChannexConfigured } from './config';
import { runInTenant } from './provisioning';
import { applyBookingRevision } from './bookingMapper';

export const MAX_APPLY_ATTEMPTS = 5;
export const INBOX_LEASE_MS = 2 * 60_000;
const MAX_PASSES = 5;

// ─── Card scrubbing (pure) ───────────────────────────────────────────────────

const CARD_KEYS = new Set(['card_number', 'cvv', 'cvc', 'card_cvv', 'cardholder_name', 'card_token', 'token']);

/** Masked guarantee summary: `{ card_type, last4, expiration_date, is_virtual, meta: { virtual_card_* } }`. */
export function scrubGuarantee(guarantee: unknown): Record<string, unknown> | null {
  if (!guarantee || typeof guarantee !== 'object') return null;
  const g = guarantee as Record<string, any>;
  const digits = typeof g.card_number === 'string' ? g.card_number.replace(/\D/g, '') : '';
  const meta = g.meta && typeof g.meta === 'object'
    ? Object.fromEntries(Object.entries(g.meta).filter(([k, v]) => k.startsWith('virtual_card_') && (typeof v === 'string' || typeof v === 'number')))
    : {};
  const out: Record<string, unknown> = {};
  if (typeof g.card_type === 'string') out.card_type = g.card_type.slice(0, 10);
  if (digits.length >= 4) out.last4 = digits.slice(-4);
  if (typeof g.expiration_date === 'string') out.expiration_date = g.expiration_date.slice(0, 10);
  if (typeof g.is_virtual === 'boolean') out.is_virtual = g.is_virtual;
  if (Object.keys(meta).length) out.meta = meta;
  return out;
}

/** Copy of a revision payload safe to store: guarantee summarized, card fields removed anywhere else. */
export function scrubRevisionPayload(payload: unknown): Record<string, unknown> {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !CARD_KEYS.has(k))
      .map(([k, val]) => [k, k === 'guarantee' ? scrubGuarantee(val) : strip(val)]));
  };
  const out = strip(payload);
  return out && typeof out === 'object' && !Array.isArray(out) ? (out as Record<string, unknown>) : {};
}

// ─── Revision facts (pure) ───────────────────────────────────────────────────

export interface RevisionFacts {
  revisionId: string;
  bookingId: string;
  propertyId?: string;
  status?: BookingRevisionStatus;
  insertedAt?: Date;
  otaName?: string;
  otaReservationCode?: string;
  payload: Record<string, unknown>;
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** A `booking_revision` resource (feed item or GET /booking_revisions/:id) → inbox fields. */
export function revisionFacts(resource: JsonApiResource | (Record<string, any> & { id?: string })): RevisionFacts | null {
  const r = resource as any;
  const attrs = r?.attributes && typeof r.attributes === 'object' ? r.attributes : r;
  const revisionId = text(r?.id, 64) ?? text(attrs?.revision_id, 64) ?? text(attrs?.id, 64);
  const bookingId = text(attrs?.booking_id, 64);
  if (!revisionId || !bookingId) return null;
  const insertedAt = attrs?.inserted_at ? new Date(attrs.inserted_at) : undefined;
  const status = (BOOKING_REVISION_STATUSES as readonly string[]).includes(attrs?.status) ? attrs.status as BookingRevisionStatus : undefined;
  return {
    revisionId,
    bookingId,
    propertyId: text(attrs?.property_id, 64),
    status,
    insertedAt: insertedAt && !Number.isNaN(insertedAt.getTime()) ? insertedAt : undefined,
    otaName: text(attrs?.ota_name, 80),
    otaReservationCode: text(attrs?.ota_reservation_code, 120),
    payload: scrubRevisionPayload({ ...attrs, id: revisionId }),
  };
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

export interface EnqueueRevisionInput {
  tenantId?: mongoose.Types.ObjectId;
  channexPropertyId?: string;
  revisionId: string;
  bookingId: string;
  source: BookingRevisionSource;
}

/** Idempotent upsert of a revision announced by id only; returns true when it was new to the inbox. */
export async function enqueueRevision(input: EnqueueRevisionInput): Promise<boolean> {
  try {
    const res = await ChannexBookingRevision.updateOne(
      { channexRevisionId: input.revisionId },
      {
        $setOnInsert: {
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          channexRevisionId: input.revisionId,
          channexBookingId: input.bookingId,
          channexPropertyId: input.channexPropertyId,
          source: input.source,
          processing: 'received',
          attempts: 0,
        },
      },
      { upsert: true },
    );
    return res.upsertedCount === 1;
  } catch (err: any) {
    // Two deliveries racing on the unique revision id: the other one inserted it
    if (err?.code === 11000) return false;
    throw err;
  }
}

/** Store a full revision (feed or fetch): inserts it, or fills in a row that has no payload yet. */
async function storeFullRevision(f: RevisionFacts, source: BookingRevisionSource): Promise<void> {
  const fields = {
    channexBookingId: f.bookingId,
    channexPropertyId: f.propertyId,
    status: f.status,
    insertedAt: f.insertedAt,
    otaName: f.otaName,
    otaReservationCode: f.otaReservationCode,
    payload: f.payload,
  };
  const filled = await ChannexBookingRevision.updateOne(
    { channexRevisionId: f.revisionId, payload: { $exists: false } },
    { $set: fields },
  );
  if (filled.matchedCount) return;
  try {
    await ChannexBookingRevision.updateOne(
      { channexRevisionId: f.revisionId },
      { $setOnInsert: { ...fields, channexRevisionId: f.revisionId, source, processing: 'received', attempts: 0 } },
      { upsert: true },
    );
  } catch (err: any) {
    if (err?.code !== 11000) throw err;
  }
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export interface ApplyResult {
  reservationId?: mongoose.Types.ObjectId;
}
export type ApplyRevision = (row: IChannexBookingRevision) => Promise<ApplyResult>;

/** Creates, updates or cancels the reservation (bookingMapper.ts). Runs inside the tenant scope. */
export const applyRevision: ApplyRevision = (row) => applyBookingRevision(row);

// ─── Alerts ──────────────────────────────────────────────────────────────────

async function raiseUnknownPropertyAlert(propertyId: string | undefined, row: Pick<IChannexBookingRevision, 'channexRevisionId' | 'channexBookingId'>) {
  await raiseAlert({
    type: 'unknown_property', dedupeKey: propertyId || 'missing', title: 'Channex sent a booking for a property no tenant owns',
    details: { propertyId, revisionId: row.channexRevisionId, bookingId: row.channexBookingId },
  });
}

// ─── Processing ──────────────────────────────────────────────────────────────

export interface InboxDeps {
  client: ChannexClient;
  apply?: ApplyRevision;
  now?: () => Date;
}

export interface InboxReport {
  ran: boolean;
  fetched: number;
  applied: number;
  stale: number;
  failed: number;
  acked: number;
  ackFailures: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 2000);
const TERMINAL = ['applied', 'skipped_stale'] as const;

async function acquireLease(now: Date): Promise<boolean> {
  await PlatformSettings.updateOne({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true });
  const res = await PlatformSettings.updateOne(
    { key: 'global', $or: [{ 'channex.inboxLeaseUntil': { $exists: false } }, { 'channex.inboxLeaseUntil': { $lte: now } }] },
    { $set: { 'channex.inboxLeaseUntil': new Date(now.getTime() + INBOX_LEASE_MS) } },
  );
  return res.modifiedCount === 1;
}

async function releaseLease() {
  await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'channex.inboxLeaseUntil': new Date(0) } });
}

async function ack(client: ChannexClient, row: IChannexBookingRevision, report: InboxReport) {
  try {
    await client.post(`/booking_revisions/${encodeURIComponent(row.channexRevisionId)}/ack`);
    row.ackedAt = new Date();
    await ChannexBookingRevision.updateOne({ _id: row._id }, { $set: { ackedAt: row.ackedAt } });
    report.acked++;
  } catch (err) {
    report.ackFailures++;
    console.warn(`[Channex] ack of revision ${row.channexRevisionId} failed (retried next pass): ${errText(err)}`);
  }
}

async function fetchMissingPayloads(client: ChannexClient, report: InboxReport) {
  const rows = await ChannexBookingRevision.find({ processing: 'received', payload: { $exists: false } }).limit(100);
  for (const row of rows) {
    try {
      const body = await client.get<{ data?: JsonApiResource }>(`/booking_revisions/${encodeURIComponent(row.channexRevisionId)}`);
      const f = body?.data ? revisionFacts(body.data) : null;
      if (!f) throw new Error('Unexpected booking revision response');
      await storeFullRevision({ ...f, revisionId: row.channexRevisionId }, row.source);
      report.fetched++;
    } catch (err) {
      const attempts = row.attempts + 1;
      await ChannexBookingRevision.updateOne({ _id: row._id }, {
        $set: { attempts, error: `fetch: ${errText(err)}`, ...(attempts >= MAX_APPLY_ATTEMPTS ? { processing: 'failed' } : {}) },
      });
    }
  }
}

/** Fill in tenants from property ids; unknown properties fail (no ack) and raise a platform alert. */
async function resolveTenants(environment: string) {
  const rows = await ChannexBookingRevision.find({ processing: 'received', tenantId: { $exists: false }, payload: { $exists: true } })
    .select('channexPropertyId channexRevisionId channexBookingId').limit(500);
  const cache = new Map<string, mongoose.Types.ObjectId | null>();
  for (const row of rows) {
    const pid = row.channexPropertyId;
    if (pid && !cache.has(pid)) {
      const p = await ChannexProperty.findOne({ channexPropertyId: pid, environment }).select('tenantId').lean();
      cache.set(pid, p?.tenantId ?? null);
    }
    const tenantId = pid ? cache.get(pid) : null;
    if (tenantId) {
      await ChannexBookingRevision.updateOne({ _id: row._id }, { $set: { tenantId } });
    } else {
      await ChannexBookingRevision.updateOne({ _id: row._id }, {
        $set: { processing: 'failed', error: `No Pilloto tenant owns Channex property ${pid ?? '(none)'} in this environment.` },
      });
      await raiseUnknownPropertyAlert(pid, row);
    }
  }
}

async function processBookings(deps: InboxDeps, report: InboxReport) {
  const apply = deps.apply ?? applyRevision;
  const bookingIds: string[] = await ChannexBookingRevision.distinct('channexBookingId', {
    processing: 'received', tenantId: { $exists: true }, payload: { $exists: true },
  });
  for (const bookingId of bookingIds) {
    const rows = await ChannexBookingRevision.find({
      channexBookingId: bookingId, processing: 'received', tenantId: { $exists: true }, payload: { $exists: true },
    }).sort({ insertedAt: 1, createdAt: 1 });
    for (const row of rows) {
      const newerApplied = row.insertedAt
        ? await ChannexBookingRevision.exists({ channexBookingId: bookingId, processing: 'applied', insertedAt: { $gt: row.insertedAt } })
        : null;
      if (newerApplied) {
        row.processing = 'skipped_stale';
        await row.save();
        report.stale++;
        await ack(deps.client, row, report);
        continue;
      }
      try {
        const result = await runInTenant(row.tenantId!, () => apply(row));
        row.processing = 'applied';
        if (result.reservationId) row.reservationId = result.reservationId;
        row.error = undefined;
        await row.save();
        report.applied++;
        await ack(deps.client, row, report);
      } catch (err) {
        row.attempts += 1;
        row.error = `apply: ${errText(err)}`;
        if (row.attempts >= MAX_APPLY_ATTEMPTS) {
          row.processing = 'failed';
          report.failed++;
        }
        await row.save();
        console.warn(`[Channex] revision ${row.channexRevisionId} (booking ${bookingId}) failed to apply (attempt ${row.attempts}): ${row.error}`);
        // Keep this booking's order: later revisions wait until this one succeeds or gives up
        if (row.processing !== 'failed') break;
      }
    }
  }
}

async function retryAcks(client: ChannexClient, report: InboxReport) {
  const rows = await ChannexBookingRevision.find({ processing: { $in: TERMINAL }, ackedAt: { $exists: false } }).limit(200);
  for (const row of rows) await ack(client, row, report);
}

let rerunRequested = false;

/** One processing pass over the whole inbox (all tenants). Returns `ran: false` when another pass holds the lease. */
export async function processInbox(deps: InboxDeps): Promise<InboxReport> {
  const report: InboxReport = { ran: false, fetched: 0, applied: 0, stale: 0, failed: 0, acked: 0, ackFailures: 0 };
  const now = deps.now?.() ?? new Date();
  return tenantLocalStorage.run(null, async () => {
    if (!(await acquireLease(now))) {
      rerunRequested = true;
      return report;
    }
    report.ran = true;
    try {
      const { environment } = deps.client.config ?? getChannexConfig();
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        rerunRequested = false;
        await fetchMissingPayloads(deps.client, report);
        await resolveTenants(environment);
        await processBookings(deps, report);
        await retryAcks(deps.client, report);
        if (!rerunRequested) break;
      }
    } finally {
      await releaseLease();
    }
    return report;
  });
}

// ─── Feed poller ─────────────────────────────────────────────────────────────

/**
 * GET /booking_revisions/feed (unacked revisions, account-wide, oldest first, every page) into
 * the inbox, then a processing pass. Revisions Pilloto already finished are acked again (Channex
 * did not register the earlier ack); revisions that failed for an unknown property get another
 * chance once the property is known.
 */
export async function pollFeed(deps: InboxDeps): Promise<InboxReport & { received: number }> {
  const now = deps.now?.() ?? new Date();
  const items = await deps.client.paginateAll('/booking_revisions/feed', { 'order[inserted_at]': 'asc' });
  await tenantLocalStorage.run(null, async () => {
    for (const item of items) {
      const f = revisionFacts(item as any);
      if (!f) continue;
      await storeFullRevision(f, 'feed');
      await ChannexBookingRevision.updateOne(
        { channexRevisionId: f.revisionId, processing: 'failed', tenantId: { $exists: false } },
        { $set: { processing: 'received' }, $unset: { error: 1 } },
      );
      await ChannexBookingRevision.updateOne(
        { channexRevisionId: f.revisionId, processing: { $in: TERMINAL }, ackedAt: { $exists: true } },
        { $unset: { ackedAt: 1 } },
      );
    }
    await PlatformSettings.updateOne({ key: 'global' }, { $set: { 'channex.lastFeedPollAt': now } }, { upsert: true });
  });
  return { ...(await processInbox(deps)), received: items.length };
}

/** Process right away (after a webhook); never throws. No-op when Channex is not configured. */
export function requestInboxRun(client?: ChannexClient): void {
  const config = getChannexConfig();
  if (!client && !isChannexConfigured(config)) return;
  processInbox({ client: client ?? createChannexClient(config) })
    .catch((err) => console.error('[Channex] booking inbox pass failed:', errText(err)));
}
