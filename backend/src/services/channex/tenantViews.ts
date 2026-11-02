/**
 * What the channel manager shows to tenants vs. the platform console.
 *
 * Pilloto uses Channex white-label: tenants see "the channel manager" and their channels,
 * never Channex ids, task ids, environments or raw Channex error text. Those stay in the
 * platform console (routes/platform.ts), where certification and support work happens.
 *
 * All DB functions run in the current tenant context (see `runInTenant`).
 */

import ChannexSyncLog from '../../models/ChannexSyncLog';
import ChannelAriChange from '../../models/ChannelAriChange';
import ChannexProperty from '../../models/ChannexProperty';
import ChannexBookingRevision from '../../models/ChannexBookingRevision';
import Reservation from '../../models/Reservation';
import { ChannelManagerStatus } from './provisioning';
import { MappingRow, StructuralSyncReport } from './structuralSync';
import { ChannexEnvironment } from './config';

export interface TenantChannelManagerStatus {
  /** The channel manager is available on this server */
  configured: boolean;
  enabled: boolean;
  property: null | {
    status: NonNullable<ChannelManagerStatus['property']>['status'];
    lastFullSyncAt?: Date;
    /** Something went wrong that support must look at (details in the platform console) */
    hasProblem: boolean;
  };
  /** Room types / rate plans that need attention, by name only */
  issues: { kind: MappingRow['kind']; name: string; parentName?: string; status: MappingRow['status'] }[];
  prerequisites: ChannelManagerStatus['prerequisites'];
  settings: ChannelManagerStatus['settings'];
}

export function toTenantStatus(status: ChannelManagerStatus, mappings: MappingRow[]): TenantChannelManagerStatus {
  return {
    configured: status.configured,
    enabled: status.enabled,
    property: status.property ? {
      status: status.property.status,
      lastFullSyncAt: status.property.lastFullSyncAt,
      hasProblem: status.property.status === 'error' || Boolean(status.property.lastError),
    } : null,
    issues: mappings
      .filter((m) => m.status === 'remap_required' || m.status === 'orphaned' || m.error)
      .map((m) => ({ kind: m.kind, name: m.name, ...(m.parentName ? { parentName: m.parentName } : {}), status: m.status })),
    prerequisites: status.prerequisites,
    settings: status.settings,
  };
}

/** Activation result for the tenant: what was set up, by name, without ids or error text. */
export function toTenantSyncReport(sync: StructuralSyncReport) {
  return {
    ok: sync.ok,
    results: sync.results.map((r) => ({ kind: r.kind, localId: r.localId, name: r.name, action: r.action })),
  };
}

export type SyncRowStatus = 'ok' | 'warning' | 'error';

const rowStatus = (l: { error?: string; warnings?: unknown[] }): SyncRowStatus => (l.error ? 'error' : l.warnings?.length ? 'warning' : 'ok');

/**
 * Recent updates sent to the channels (paged). `detailed` (platform console) adds task ids,
 * value counts, warnings, raw errors and HTTP details.
 */
export async function loadSyncActivity(environment: ChannexEnvironment, { page, limit, detailed }: { page: number; limit: number; detailed: boolean }) {
  const [logs, total, pending, property] = await Promise.all([
    ChannexSyncLog.find({}).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ChannexSyncLog.countDocuments({}),
    ChannelAriChange.countDocuments({ status: 'pending' }),
    ChannexProperty.findOne({ environment }).select('lastFullSyncAt lastPushAt pausedUntil').lean(),
  ]);
  return {
    logs: logs.map((l) => ({
      _id: l._id, createdAt: l.createdAt, trigger: l.trigger, kind: l.kind, dateFrom: l.dateFrom, dateTo: l.dateTo, status: rowStatus(l),
      ...(detailed ? {
        valuesCount: l.valuesCount, taskIds: l.taskIds, warnings: l.warnings, httpStatus: l.httpStatus, error: l.error, durationMs: l.durationMs,
      } : {}),
    })),
    total, page, limit, pending,
    lastFullSyncAt: property?.lastFullSyncAt,
    lastPushAt: property?.lastPushAt,
    pausedUntil: property?.pausedUntil && property.pausedUntil.getTime() > Date.now() ? property.pausedUntil : undefined,
  };
}

// ─── Booking inbox ───────────────────────────────────────────────────────────

/** Processing state in the tenant's words */
export type InboxState = 'waiting' | 'imported' | 'outdated' | 'failed';
const INBOX_STATE: Record<string, InboxState> = { received: 'waiting', applied: 'imported', skipped_stale: 'outdated', failed: 'failed' };

const guestName = (payload: any): string | undefined => {
  const c = payload?.customer;
  const name = [c?.name, c?.surname].filter((v) => typeof v === 'string' && v.trim()).join(' ').trim();
  return name ? name.slice(0, 120) : undefined;
};
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);

/**
 * Bookings received from the channels (paged, newest first). `detailed` (platform console) adds
 * Channex revision/booking ids, source, attempts, raw errors and ack time.
 */
export async function loadBookingInbox({ page, limit, detailed }: { page: number; limit: number; detailed: boolean }) {
  const [rows, total] = await Promise.all([
    ChannexBookingRevision.find({}).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ChannexBookingRevision.countDocuments({}),
  ]);
  const reservationIds = rows.map((r) => r.reservationId).filter(Boolean);
  const codes = new Map(
    (reservationIds.length ? await Reservation.find({ _id: { $in: reservationIds } }).select('reservationCode').lean() : [])
      .map((r: any) => [String(r._id), r.reservationCode as string | undefined]),
  );
  return {
    rows: rows.map((r) => {
      const p = (r.payload ?? {}) as any;
      return {
        _id: r._id,
        receivedAt: r.createdAt,
        otaName: r.otaName,
        otaReservationCode: r.otaReservationCode,
        status: r.status,
        state: INBOX_STATE[r.processing] ?? 'waiting',
        guestName: guestName(p),
        arrivalDate: day(p.arrival_date),
        departureDate: day(p.departure_date),
        reservationId: r.reservationId,
        reservationCode: r.reservationId ? codes.get(String(r.reservationId)) : undefined,
        acknowledged: Boolean(r.ackedAt),
        ...(detailed ? {
          channexRevisionId: r.channexRevisionId, channexBookingId: r.channexBookingId, source: r.source,
          insertedAt: r.insertedAt, attempts: r.attempts, error: r.error, ackedAt: r.ackedAt,
        } : {}),
      };
    }),
    total, page, limit,
  };
}

/** One reservation's revisions as the channel sent them (tenant view: no Channex ids). */
export async function loadChannelHistory(channexBookingId: string) {
  const rows = await ChannexBookingRevision.find({ channexBookingId }).sort({ insertedAt: 1, createdAt: 1 }).lean();
  return rows.map((r) => ({
    _id: r._id,
    receivedAt: r.createdAt,
    sentAt: r.insertedAt,
    status: r.status,
    state: INBOX_STATE[r.processing] ?? 'waiting',
    acknowledged: Boolean(r.ackedAt),
  }));
}
