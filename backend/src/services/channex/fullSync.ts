/**
 * Full sync (CHANNEX_ARCHITECTURE.md §6.4; plan Phase 6.3).
 *
 * A full sync is availability for every mapped room type plus rates/restrictions (all fields)
 * for every mapped rate plan over the whole window, queued as ordinary outbox rows
 * (`fields: ['*']`, `reason: 'full_sync:*'`). The ARI worker therefore applies its usual
 * limits and logging, and the whole thing is exactly two Channex calls.
 *
 * Triggers: go-live (after enabling), the manual button (10-minute guard), a channel being
 * activated (called by Phase 7's `activate_channel` handler), and nightly at 03:00
 * property-local time (skipped when a full sync ran in the last 20 h). There is no other
 * timer-driven push.
 *
 * Every function takes explicit tenant ids so it works from routes and from the cron.
 */

import ChannelAriChange from '../../models/ChannelAriChange';
import ChannexEntityMap from '../../models/ChannexEntityMap';
import ChannexProperty, { IChannexProperty } from '../../models/ChannexProperty';
import { FULL_WINDOW } from './changeCapture';
import { ChannexEnvironment } from './config';

export const MANUAL_GUARD_MS = 10 * 60_000;
export const NIGHTLY_SKIP_MS = 20 * 3600_000;
export const NIGHTLY_LOCAL_HOUR = 3;
export const NIGHTLY_MAX_PER_TICK = 5;

export type FullSyncTrigger = 'go_live' | 'manual' | 'nightly' | 'channel_activated';

type PropertyRef = Pick<IChannexProperty, '_id' | 'tenantId' | 'environment' | 'lastFullSyncAt'>;

/** Hour of day (0–23) in an IANA timezone; null for an unknown timezone. */
export function localHour(timeZone: string | undefined, now: Date): number | null {
  if (!timeZone) return null;
  try {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now);
    return Number(h);
  } catch {
    return null;
  }
}

export function manualGuardRemainingMs(lastFullSyncAt: Date | undefined, now: Date): number {
  return lastFullSyncAt ? Math.max(0, MANUAL_GUARD_MS - (now.getTime() - lastFullSyncAt.getTime())) : 0;
}

export function isNightlyDue(p: { timezone?: string; lastFullSyncAt?: Date }, now: Date): boolean {
  if (localHour(p.timezone, now) !== NIGHTLY_LOCAL_HOUR) return false;
  return !p.lastFullSyncAt || now.getTime() - p.lastFullSyncAt.getTime() >= NIGHTLY_SKIP_MS;
}

/** Queue the full-window rows for every mapped room type and rate plan. Returns the number of rows. */
export async function queueFullSync(property: PropertyRef, trigger: FullSyncTrigger, now: Date = new Date()): Promise<number> {
  const maps = await ChannexEntityMap.find({ tenantId: property.tenantId, environment: property.environment as ChannexEnvironment, status: 'active' })
    .select('kind localId').lean();
  const reason = `full_sync:${trigger}`;
  const rows = maps.map((m) => (m.kind === 'room_type'
    ? { kind: 'availability' as const, roomTypeId: m.localId }
    : { kind: 'rates' as const, ratePlanId: m.localId }))
    .map((r) => ({ ...r, tenantId: property.tenantId, ...FULL_WINDOW, fields: ['*'], reason, status: 'pending' as const }));
  if (rows.length) await ChannelAriChange.insertMany(rows);
  await ChannexProperty.updateOne({ _id: property._id }, { $set: { lastFullSyncAt: now } });
  return rows.length;
}

export type ManualFullSyncResult = { ok: true; queued: number } | { ok: false; retryAfterSeconds: number };

/** The "Full sync" button: refused when the property had a full sync in the last 10 minutes. */
export async function requestManualFullSync(property: PropertyRef, now: Date = new Date()): Promise<ManualFullSyncResult> {
  const wait = manualGuardRemainingMs(property.lastFullSyncAt, now);
  if (wait > 0) return { ok: false, retryAfterSeconds: Math.ceil(wait / 1000) };
  return { ok: true, queued: await queueFullSync(property, 'manual', now) };
}

/** Go-live: once, right after the first successful enable. */
export async function queueGoLiveSync(property: PropertyRef, now: Date = new Date()): Promise<number> {
  return property.lastFullSyncAt ? 0 : queueFullSync(property, 'go_live', now);
}

/** Nightly pass (called every minute): queue properties whose local time is 03:xx, a few per tick so they stagger. */
export async function runNightlyFullSyncs(environment: ChannexEnvironment, now: Date = new Date(), max = NIGHTLY_MAX_PER_TICK): Promise<string[]> {
  const candidates = await ChannexProperty.find({
    environment, status: 'active', channexPropertyId: { $exists: true },
    $or: [{ lastFullSyncAt: { $exists: false } }, { lastFullSyncAt: { $lte: new Date(now.getTime() - NIGHTLY_SKIP_MS) } }],
  }).sort({ lastFullSyncAt: 1 }).limit(500);

  const done: string[] = [];
  for (const p of candidates) {
    if (done.length >= max) break;
    if (!isNightlyDue(p, now)) continue;
    try {
      const n = await queueFullSync(p, 'nightly', now);
      console.log(`🌙 Channex nightly full sync queued for tenant ${p.tenantId} (${n} rows)`);
      done.push(String(p.tenantId));
    } catch (err) {
      console.error(`[Channex] nightly full sync failed to queue for tenant ${p.tenantId}:`, (err as Error).message);
    }
  }
  return done;
}
