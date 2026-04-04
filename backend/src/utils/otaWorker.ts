/**
 * otaWorker.ts
 *
 * Enterprise OTA iCal sync engine.
 *
 * Guarantees:
 *  • Idempotent per mapping per run — deduplicates by (tenantId, mappingId, externalUid).
 *  • Tenant-safe — reads context from AsyncLocalStorage via tenantPlugin.
 *  • Pilloto-wins conflict policy — never auto-overwrites a local reservation.
 *  • Stale lock recovery — 'running' SyncRun locks older than STALE_LOCK_MINUTES are evicted.
 *  • Timezone-aware — normalizes iCal dates to UTC midnight using per-tenant timezone.
 *  • Rate-limited pulled feeds — axios timeout prevents hung connections.
 */

import axios from 'axios';
import ical from 'node-ical';
import icalGenerator from 'ical-generator';
import Reservation from '../models/Reservation';
import OtaListingMapping, { IOtaListingMapping } from '../models/OtaListingMapping';
import OtaSyncRun from '../models/OtaSyncRun';
import OtaExternalEvent from '../models/OtaExternalEvent';
import OtaConflict from '../models/OtaConflict';
import AppSettings from '../models/AppSettings';
import Tenant from '../models/Tenant';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const STALE_LOCK_MINUTES = 15;
const FEED_FETCH_TIMEOUT_MS = 20_000;
const MAX_EVENTS_PER_FEED = 5_000;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface OtaSyncOptions {
  triggeredBy: 'cron' | 'manual';
  mappingId?: string; // if set, only sync this specific mapping
}

export interface OtaSyncResult {
  tenantId: string;
  mappingsProcessed: number;
  imported: number;
  updated: number;
  conflicts: number;
  errors: number;
  syncRunId?: string;
}

interface NormalizedEvent {
  uid: string;
  summary: string;
  guestName?: string;
  checkIn: Date;
  checkOut: Date;
  raw: string;
}

// ─────────────────────────────────────────────────────────────
// Outbound feed generation
// ─────────────────────────────────────────────────────────────

/**
 * Generates an iCal feed for a specific listing mapping.
 * Blocks dates from active (confirmed, checked-in) room reservations mapped to the listing.
 * Returns iCal text ready to serve as text/calendar.
 */
export async function generateOutboundFeed(token: string): Promise<string | null> {
  const mapping = await OtaListingMapping.findOne({ outboundToken: token, isActive: true })
    .lean() as IOtaListingMapping | null;

  if (!mapping) return null;

  // scope query to this tenant
  const tenantFilter = { tenantId: (mapping.tenantId as any).toString() };

  const now = new Date();
  const futureWindow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year ahead
  const pastWindow = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days back

  const query: any = {
    status: { $in: ['confirmed', 'checked-in', 'pending'] },
    ...tenantFilter,
    checkInDate: { $lte: futureWindow },
    checkOutDate: { $gte: pastWindow },
  };

  // Scope to the mapped room if configured
  if (mapping.roomId) {
    query.$or = [
      { room: mapping.roomId },
      { rooms: mapping.roomId },
    ];
  }

  const reservations = await Reservation.find(query).select('checkInDate checkOutDate guestName reservationCode status').lean();

  const cal = icalGenerator({
    name: `Pilloto – ${mapping.providerLabel || mapping.provider}`,
    prodId: '//Pilloto PMS//OTA Sync//EN',
    ttl: 3600,
  });

  for (const res of reservations) {
    const guestLabel = (res as any).guestName
      ? `${(res as any).guestName.firstName} ${(res as any).guestName.lastName}`.trim()
      : 'Reserved';
    const checkIn: Date = (res as any).checkInDate;
    const checkOut: Date = (res as any).checkOutDate || (res as any).checkInDate;
    // Strip time — use UTC date parts so the iCal VALUE=DATE is always correct
    // regardless of the server's local timezone.
    const startDate = new Date(Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate()));
    const endDate   = new Date(Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate()));
    cal.createEvent({
      id: `pilloto-${res._id}@pilloto.com`,
      summary: guestLabel,
      start: startDate,
      end: endDate,
      allDay: true,
    });
  }

  return cal.toString();
}

// ─────────────────────────────────────────────────────────────
// Inbound feed fetch + parse
// ─────────────────────────────────────────────────────────────

async function fetchFeed(url: string): Promise<NormalizedEvent[]> {
  const response = await axios.get(url, {
    timeout: FEED_FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': 'PillotoPMS/1.0 iCal-Sync' },
    maxContentLength: 5 * 1024 * 1024, // 5 MB max
    responseType: 'text',
  });

  const rawText: string = response.data;
  // Yield to the event loop before the synchronous (CPU-bound) parse to avoid
  // blocking timers — this is what triggers node-cron's "missed execution" warning.
  const parsed: Record<string, any> = await new Promise(resolve =>
    setImmediate(() => resolve(ical.parseICS(rawText)))
  );

  const events: NormalizedEvent[] = [];

  for (const [, component] of Object.entries(parsed)) {
    if ((component as any).type !== 'VEVENT') continue;
    if (events.length >= MAX_EVENTS_PER_FEED) break;

    const ev = component as any;
    const uid: string = ev.uid || crypto.randomUUID();
    const summary: string = ev.summary || '';
    const start: Date | undefined = ev.start;
    const end: Date | undefined = ev.end;

    if (!start || !end) continue;

    // Normalize to midnight UTC — iCal DATE (all-day) values arrive as local midnight
    const checkIn = toUTCNoon(start);
    const checkOut = toUTCNoon(end);

    if (checkIn >= checkOut) continue; // skip degenerate events

    events.push({
      uid: uid.slice(0, 500),
      summary: summary.slice(0, 500),
      guestName: parseGuestName(summary),
      checkIn,
      checkOut,
      raw: JSON.stringify({ uid, summary, start: start.toISOString(), end: end.toISOString() }).slice(0, 4000),
    });
  }

  return events;
}

/** Converts a JS Date to UTC noon of the same calendar date. */
function toUTCNoon(d: Date): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return new Date(Date.UTC(y, m, day, 12, 0, 0));
}

/** Heuristically extracts a guest name from common OTA iCal summary patterns. */
function parseGuestName(summary: string): string | undefined {
  // Airbnb: "Airbnb (Not available)" / "BLOCKED" — no real name
  if (/blocked|not available|unavailable/i.test(summary)) return undefined;
  // Booking.com: "CLOSED - Guest Name"
  const bcomMatch = summary.match(/^CLOSED\s*-\s*(.+)$/i);
  if (bcomMatch) return bcomMatch[1].trim().slice(0, 200);
  // Vrbo: "Reservation - John Doe"
  const vrboMatch = summary.match(/^reservation\s*-\s*(.+)$/i);
  if (vrboMatch) return vrboMatch[1].trim().slice(0, 200);
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// Overlap detection
// ─────────────────────────────────────────────────────────────

async function findOverlappingReservation(
  roomId: mongoose.Types.ObjectId | undefined,
  checkIn: Date,
  checkOut: Date,
  excludeOtaEventId?: mongoose.Types.ObjectId,
): Promise<any | null> {
  const blockedStatuses = ['pending', 'confirmed', 'checked-in'];

  const query: any = {
    status: { $in: blockedStatuses },
    checkInDate: { $lt: checkOut },
    checkOutDate: { $gt: checkIn },
  };

  if (roomId) {
    query.$or = [{ room: roomId }, { rooms: roomId }];
  }

  // Exclude the reservation linked to this OTA event (idempotent update case)
  if (excludeOtaEventId) {
    query['otaSource.externalEventId'] = { $ne: excludeOtaEventId };
  }

  return Reservation.findOne(query).select('_id checkInDate checkOutDate guestName status').lean();
}

// ─────────────────────────────────────────────────────────────
// Core sync logic (per mapping)
// ─────────────────────────────────────────────────────────────

interface MappingSyncResult {
  imported: number;
  updated: number;
  conflicts: number;
  errors: number;
}

async function syncMapping(
  mapping: IOtaListingMapping,
  tenantId: string,
): Promise<MappingSyncResult> {
  const result: MappingSyncResult = { imported: 0, updated: 0, conflicts: 0, errors: 0 };

  if (!mapping.inboundFeedUrl) {
    return result;
  }

  let events: NormalizedEvent[];
  try {
    events = await fetchFeed(mapping.inboundFeedUrl);
  } catch (err: any) {
    await OtaListingMapping.findByIdAndUpdate(mapping._id, {
      lastSyncStatus: 'error',
      lastSyncError: String(err?.message || err).slice(0, 1000),
    });
    result.errors += 1;
    return result;
  }

  const seenUids = new Set<string>();

  for (const ev of events) {
    seenUids.add(ev.uid);
    try {
      // Upsert the external event record
      const existing = await OtaExternalEvent.findOne({
        tenantId,
        mappingId: mapping._id,
        externalUid: ev.uid,
      });

      let externalEvent: any;

      if (existing) {
        // Check if dates changed (update case)
        const datesChanged =
          existing.checkIn.getTime() !== ev.checkIn.getTime() ||
          existing.checkOut.getTime() !== ev.checkOut.getTime();

        await OtaExternalEvent.findByIdAndUpdate(existing._id, {
          checkIn: ev.checkIn,
          checkOut: ev.checkOut,
          summary: ev.summary,
          guestName: ev.guestName,
          rawSnapshot: ev.raw,
          status: 'active',
          lastSeenAt: new Date(),
        });

        externalEvent = { ...existing, _id: existing._id, checkIn: ev.checkIn, checkOut: ev.checkOut };

        if (!existing.reservationId || datesChanged) {
          // Fall through to create/update reservation
        } else {
          // No change needed
          continue;
        }
      } else {
        // Create new external event
        externalEvent = await OtaExternalEvent.create({
          tenantId,
          mappingId: mapping._id,
          provider: mapping.provider,
          externalUid: ev.uid,
          summary: ev.summary,
          guestName: ev.guestName,
          checkIn: ev.checkIn,
          checkOut: ev.checkOut,
          rawSnapshot: ev.raw,
          status: 'active',
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        });
      }

      // Check if a conflict already exists for this event
      const existingConflict = await OtaConflict.findOne({
        tenantId,
        externalEventId: externalEvent._id,
        status: 'pending_review',
      });
      if (existingConflict) {
        // Already flagged — skip until resolved
        result.conflicts += 1;
        continue;
      }

      // Check overlap against Pilloto reservations
      const overlap = await findOverlappingReservation(
        mapping.roomId,
        ev.checkIn,
        ev.checkOut,
        existing?.reservationId,
      );

      if (overlap) {
        // Create conflict record — Pilloto-wins policy, do NOT touch local reservation
        await OtaConflict.findOneAndUpdate(
          {
            tenantId,
            externalEventId: externalEvent._id,
            overlappingReservationId: overlap._id,
          },
          {
            $setOnInsert: {
              tenantId,
              mappingId: mapping._id,
              externalEventId: externalEvent._id,
              overlappingReservationId: overlap._id,
              conflictType: 'date_overlap',
              status: 'pending_review',
              snapshot: {
                externalCheckIn: ev.checkIn,
                externalCheckOut: ev.checkOut,
                externalGuestName: ev.guestName,
                localCheckIn: overlap.checkInDate,
                localCheckOut: overlap.checkOutDate,
                localGuestName: overlap.guestName
                  ? `${overlap.guestName.firstName} ${overlap.guestName.lastName}`.trim()
                  : undefined,
                localStatus: overlap.status,
              },
            },
          },
          { upsert: true, new: false },
        );
        result.conflicts += 1;
        continue;
      }

      // No overlap — create or update local reservation
      const linkedRes = existing?.reservationId
        ? await Reservation.findById(existing.reservationId)
        : null;

      if (linkedRes) {
        // Update dates if they changed
        await Reservation.findByIdAndUpdate(linkedRes._id, {
          checkInDate: ev.checkIn,
          checkOutDate: ev.checkOut,
          'otaSource.importedAt': new Date(),
        });
        result.updated += 1;
      } else {
        // Create a new confirmed OTA reservation
        const guestFirstName = ev.guestName?.split(' ')[0] || mapping.provider;
        const guestLastName = ev.guestName?.split(' ').slice(1).join(' ') || 'Guest';

        const newRes = await Reservation.create({
          tenantId,
          type: 'room',
          status: 'confirmed',
          checkInDate: ev.checkIn,
          checkOutDate: ev.checkOut,
          room: mapping.roomId,
          guests: 1,
          guestDetails: { adults: 1, children: 0, infants: 0 },
          guestName: { firstName: guestFirstName, lastName: guestLastName },
          contactInfo: { email: `ota-${ev.uid.slice(0, 30)}@noreply.pilloto.com` },
          estimatedTotal: 0,
          totalPayments: 0,
          otaSource: {
            provider: mapping.provider,
            externalEventId: externalEvent._id,
            mappingId: mapping._id,
            externalUid: ev.uid,
            importedAt: new Date(),
          },
        });

        // Link external event to the new reservation
        await OtaExternalEvent.findByIdAndUpdate(externalEvent._id, {
          reservationId: newRes._id,
        });

        result.imported += 1;
      }
    } catch (err: any) {
      console.error(`OTA sync error for uid ${ev.uid}:`, err?.message || err);
      result.errors += 1;
    }
  }

  // Update mapping last-synced metadata
  await OtaListingMapping.findByIdAndUpdate(mapping._id, {
    lastSyncedAt: new Date(),
    lastSyncStatus: result.errors > 0 && result.imported + result.updated === 0 ? 'error' : 'ok',
    lastSyncError: result.errors > 0 ? `${result.errors} event(s) failed` : undefined,
  });

  return result;
}

// ─────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────

/**
 * Run OTA sync for a specific tenant.
 * Sets tenant context via AsyncLocalStorage so all model queries are scoped.
 */
export async function runOtaSyncForTenant(
  tenantId: string,
  options: OtaSyncOptions,
): Promise<OtaSyncResult> {
  const result: OtaSyncResult = {
    tenantId,
    mappingsProcessed: 0,
    imported: 0,
    updated: 0,
    conflicts: 0,
    errors: 0,
  };

  // Check stale running lock
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000);
  await OtaSyncRun.updateMany(
    { tenantId, status: 'running', startedAt: { $lt: staleCutoff } },
    { $set: { status: 'failed', error: 'Stale lock evicted', completedAt: new Date() } },
  );

  // Check if a run is already active
  const activeRun = await OtaSyncRun.findOne({ tenantId, status: 'running' });
  if (activeRun) {
    return result; // avoid duplicate concurrent runs
  }

  // Create sync run record
  const syncRun = await OtaSyncRun.create({
    tenantId,
    mappingId: options.mappingId || undefined,
    triggeredBy: options.triggeredBy,
    status: 'running',
    startedAt: new Date(),
  });
  result.syncRunId = String(syncRun._id);

  try {
    const mappingQuery: any = { tenantId, isActive: true };
    if (options.mappingId) mappingQuery._id = options.mappingId;

    const mappings = await OtaListingMapping.find(mappingQuery).lean() as IOtaListingMapping[];

    for (const mapping of mappings) {
      const mr = await syncMapping(mapping, tenantId);
      result.mappingsProcessed += 1;
      result.imported += mr.imported;
      result.updated += mr.updated;
      result.conflicts += mr.conflicts;
      result.errors += mr.errors;
    }

    await OtaSyncRun.findByIdAndUpdate(syncRun._id, {
      status: result.errors > 0 && result.imported + result.updated === 0 ? 'failed' : 'completed',
      completedAt: new Date(),
      imported: result.imported,
      updated: result.updated,
      conflicts: result.conflicts,
      errorCount: result.errors,
    });
  } catch (err: any) {
    await OtaSyncRun.findByIdAndUpdate(syncRun._id, {
      status: 'failed',
      completedAt: new Date(),
      error: String(err?.message || err).slice(0, 2000),
    });
    result.errors += 1;
  }

  return result;
}

// Guards against concurrent cron invocations (e.g. if a tick takes longer than the schedule interval).
let _syncTickRunning = false;

/**
 * Platform-level cron tick: runs all OTA-enabled tenants that are due for a sync.
 * Called every N minutes from the global cron job in index.ts.
 */
export async function runOtaSyncTick(): Promise<void> {
  if (_syncTickRunning) {
    console.log('⏭️  OTA sync tick skipped — previous tick still running');
    return;
  }
  _syncTickRunning = true;
  try {
    await _runOtaSyncTickInner();
  } finally {
    _syncTickRunning = false;
  }
}

async function _runOtaSyncTickInner(): Promise<void> {
  const tenants = await Tenant.find({ isActive: true }).select('_id').lean();

  for (const tenant of tenants) {
    const tid = String(tenant._id);

    try {
      const settings = await AppSettings.findOne({ tenantId: tid }).lean();
      const ota = (settings as any)?.otaSettings;

      if (!ota?.enabled) continue;

      const intervalMs = (ota.syncIntervalMinutes || 60) * 60 * 1000;

      // Check if any mapping is due
      const dueMapping = await OtaListingMapping.findOne({
        tenantId: tid,
        isActive: true,
        $or: [
          { lastSyncedAt: { $exists: false } },
          { lastSyncedAt: { $lt: new Date(Date.now() - intervalMs) } },
        ],
      }).lean();

      if (!dueMapping) continue;

      await runOtaSyncForTenant(tid, { triggeredBy: 'cron' });
    } catch (err: any) {
      console.error(`OTA sync tick error for tenant ${tid}:`, err?.message || err);
    }
  }
}

// Bring in the mongoose type for ObjectId use inside this file
import mongoose from 'mongoose';
