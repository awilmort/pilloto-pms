/**
 * Channel alerts (CHANNEX_ARCHITECTURE.md §9.1; plan Phase 9.1).
 *
 * The one way the channel manager raises, resolves and shows problems:
 *
 *   raiseAlert        upsert on (tenantId, type, dedupeKey). A repeat of an open/acknowledged
 *                     alert refreshes it and bumps `occurrences`; a repeat of a resolved or
 *                     dismissed one reopens it. New and reopened critical alerts are marked for
 *                     the email digest. Never throws into the caller.
 *   resolveAlerts     auto-resolve (e.g. `push_failing` after a successful push).
 *   transitionAlert   staff actions: acknowledge → resolve | dismiss, with notes.
 *   reconcileAlerts   lazy auto-resolve run before listing: `unmapped_booking` once its
 *                     reservation has a room (any write path), `non_acked_booking` once every
 *                     revision of the booking was acknowledged.
 *   sendAlertDigests  at most one email per tenant per 15 minutes listing the new critical
 *                     alerts, to users holding `admin.ota.resolve` (cron, every minute).
 *   toTenantAlert     white-label view (architecture §18): type, severity, state, safe
 *                     params and the screen that fixes it; never Channex ids or raw payloads.
 *                     The frontend writes "what happened / what to do" from type + params.
 *
 * Platform alerts (`api_auth_failed`, `unknown_property`) have no tenant and are only shown in
 * the platform console.
 */

import mongoose from 'mongoose';
import ChannelAlert, {
  ChannelAlertSeverity, ChannelAlertStatus, ChannelAlertType, CHANNEL_ALERT_SEVERITIES, CHANNEL_ALERT_STATUSES, CHANNEL_ALERT_TYPES, IChannelAlert,
} from '../../models/ChannelAlert';
import ChannexBookingRevision from '../../models/ChannexBookingRevision';
import ChannexChannel from '../../models/ChannexChannel';
import Reservation from '../../models/Reservation';
import Tenant from '../../models/Tenant';
import User from '../../models/User';
import { getTenantId, tenantLocalStorage } from '../../middleware/tenantContext';
import { userHasPermission } from '../../middleware/auth';
import { sendEmail, tenantBaseUrl } from '../../utils/email';
import { renderChannelAlertDigest } from '../../utils/emailTemplates/channelAlertDigest';

type Id = mongoose.Types.ObjectId | string;

// ─── Catalog ─────────────────────────────────────────────────────────────────

export interface AlertDefinition {
  severity: ChannelAlertSeverity;
  /** Platform console only (no tenant) */
  platform?: boolean;
  /** Pilloto resolves it by itself when the cause goes away */
  autoResolves?: boolean;
}

/** Default severity per type (architecture §9.1). Webhook alerts may override per event. */
export const ALERT_DEFINITIONS: Record<ChannelAlertType, AlertDefinition> = {
  overbooking:                 { severity: 'critical' },
  unmapped_booking:            { severity: 'critical', autoResolves: true },
  non_acked_booking:           { severity: 'critical', autoResolves: true },
  modification_needs_review:   { severity: 'warning' },
  currency_mismatch:           { severity: 'warning' },
  sync_error:                  { severity: 'critical' },
  sync_warning:                { severity: 'warning' },
  rate_error:                  { severity: 'warning' },
  ari_warning:                 { severity: 'warning' },
  push_failing:                { severity: 'critical', autoResolves: true },
  channel_disconnected:        { severity: 'critical', autoResolves: true },
  listing_disconnected:        { severity: 'critical' },
  channel_removal_warning:     { severity: 'critical', autoResolves: true },
  property_removal_warning:    { severity: 'critical' },
  remap_required:              { severity: 'warning' },
  unmap_before_delete:         { severity: 'warning', autoResolves: true },
  airbnb_reservation_request:  { severity: 'critical', autoResolves: true },
  airbnb_alteration_request:   { severity: 'critical', autoResolves: true },
  airbnb_inquiry:              { severity: 'critical', autoResolves: true },
  api_auth_failed:             { severity: 'critical', platform: true, autoResolves: true },
  unknown_property:            { severity: 'critical', platform: true },
};

export const PLATFORM_ALERT_TYPES = CHANNEL_ALERT_TYPES.filter((t) => ALERT_DEFINITIONS[t].platform);
export const TENANT_ALERT_TYPES = CHANNEL_ALERT_TYPES.filter((t) => !ALERT_DEFINITIONS[t].platform);
export const AIRBNB_REQUEST_TYPES: ChannelAlertType[] = ['airbnb_reservation_request', 'airbnb_alteration_request', 'airbnb_inquiry'];
const ACTIVE: ChannelAlertStatus[] = ['open', 'acknowledged'];

export const EMAIL_DIGEST_INTERVAL_MS = 15 * 60_000;

// ─── Raise / resolve ─────────────────────────────────────────────────────────

export interface RaiseAlertInput {
  type: ChannelAlertType;
  dedupeKey: string;
  /** English fallback title (logs, platform console); tenants read the translated text */
  title: string;
  severity?: ChannelAlertSeverity;
  details?: Record<string, unknown>;
  reservationId?: unknown;
  channexBookingId?: string;
  channelId?: string;
  liveFeedEventId?: string;
  dueAt?: Date;
  /** Defaults to the current tenant context; platform types never have one */
  tenantId?: Id;
}

export type RaiseOutcome = 'created' | 'reopened' | 'updated' | 'failed';

const isDup = (err: unknown) => (err as { code?: number })?.code === 11000;

/** Run outside any tenant scope (platform alerts, cross-tenant jobs). */
const unscoped = <T>(fn: () => Promise<T>) => tenantLocalStorage.run(null, fn);
const runInTenant = <T>(tenantId: Id, fn: () => Promise<T>) => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);

/** Raise or refresh an alert. Never throws: alerting must not break the write that found the problem. */
export async function raiseAlert(input: RaiseAlertInput, now: Date = new Date()): Promise<RaiseOutcome> {
  const def = ALERT_DEFINITIONS[input.type];
  const tenantId = def.platform ? undefined : (input.tenantId ?? getTenantId());
  const severity = input.severity ?? def.severity;
  const filter = tenantId
    ? { tenantId: new mongoose.Types.ObjectId(String(tenantId)), type: input.type, dedupeKey: input.dedupeKey.slice(0, 200) }
    : { tenantId: { $exists: false }, type: input.type, dedupeKey: input.dedupeKey.slice(0, 200) };
  const fields: Record<string, unknown> = {
    severity, title: input.title.slice(0, 300), lastSeenAt: now,
    ...(input.details !== undefined ? { details: input.details } : {}),
    ...(input.reservationId ? { reservationId: input.reservationId } : {}),
    ...(input.channexBookingId ? { channexBookingId: input.channexBookingId } : {}),
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.liveFeedEventId ? { liveFeedEventId: input.liveFeedEventId } : {}),
    ...(input.dueAt ? { dueAt: input.dueAt } : {}),
  };
  const emailing = severity === 'critical' && !def.platform;

  const attempt = async (): Promise<RaiseOutcome> => {
    // Active: refresh in place (no new email, staff's acknowledgement kept)
    const active = await ChannelAlert.findOneAndUpdate(
      { ...filter, status: { $in: ACTIVE } },
      { $set: fields, $inc: { occurrences: 1 } },
      { new: true },
    );
    if (active) return 'updated';
    // Closed: the problem is back
    const reopened = await ChannelAlert.findOneAndUpdate(
      { ...filter, status: { $in: ['resolved', 'dismissed'] } },
      {
        $set: { ...fields, status: 'open', ...(emailing ? { emailPending: true } : {}) },
        $inc: { occurrences: 1 },
        $unset: { resolvedAt: '', resolvedBy: '', autoResolved: '', acknowledgedAt: '', acknowledgedBy: '' },
      },
      { new: true },
    );
    if (reopened) return 'reopened';
    await ChannelAlert.create({
      ...(tenantId ? { tenantId: filter.tenantId } : {}),
      type: input.type, dedupeKey: filter.dedupeKey, status: 'open', occurrences: 1, ...fields,
      ...(emailing ? { emailPending: true } : {}),
    });
    return 'created';
  };

  try {
    const run = () => attempt().catch(async (err) => { if (isDup(err)) return attempt(); throw err; });
    return tenantId ? await run() : await unscoped(run);
  } catch (err) {
    console.warn('[Channex] could not raise alert', input.type, (err as Error).message);
    return 'failed';
  }
}

export interface ResolveFilter {
  types: ChannelAlertType[];
  dedupeKey?: string;
  reservationId?: unknown;
  liveFeedEventId?: string;
  tenantId?: Id;
}

/** Auto-resolve active alerts matching the filter. Returns the number resolved; never throws. */
export async function resolveAlerts(f: ResolveFilter, opts: { notes?: string; now?: Date } = {}): Promise<number> {
  const platform = f.types.every((t) => ALERT_DEFINITIONS[t].platform);
  const tenantId = platform ? undefined : (f.tenantId ?? getTenantId());
  const filter: Record<string, unknown> = {
    type: { $in: f.types }, status: { $in: ACTIVE },
    ...(tenantId ? { tenantId: new mongoose.Types.ObjectId(String(tenantId)) } : platform ? { tenantId: { $exists: false } } : {}),
    ...(f.dedupeKey !== undefined ? { dedupeKey: f.dedupeKey } : {}),
    ...(f.reservationId ? { reservationId: f.reservationId } : {}),
    ...(f.liveFeedEventId ? { liveFeedEventId: f.liveFeedEventId } : {}),
  };
  try {
    const run = () => ChannelAlert.updateMany(filter, {
      $set: { status: 'resolved', resolvedAt: opts.now ?? new Date(), autoResolved: true, emailPending: false, ...(opts.notes ? { notes: opts.notes.slice(0, 2000) } : {}) },
    });
    const r = tenantId ? await run() : await unscoped(run);
    return r.modifiedCount ?? 0;
  } catch (err) {
    console.warn('[Channex] could not resolve alerts', f.types.join(','), (err as Error).message);
    return 0;
  }
}

// ─── Staff actions ───────────────────────────────────────────────────────────

export type AlertAction = 'acknowledge' | 'resolve' | 'dismiss';
export const ALERT_ACTIONS: AlertAction[] = ['acknowledge', 'resolve', 'dismiss'];

/** Allowed transitions: open → acknowledged; open/acknowledged → resolved/dismissed. */
export function nextStatus(current: ChannelAlertStatus, action: AlertAction): ChannelAlertStatus | null {
  if (action === 'acknowledge') return current === 'open' ? 'acknowledged' : null;
  if (!ACTIVE.includes(current)) return null;
  return action === 'resolve' ? 'resolved' : 'dismissed';
}

export type TransitionResult =
  | { ok: true; alert: IChannelAlert }
  | { ok: false; reason: 'not_found' | 'invalid_transition'; message: string };

/** Acknowledge / resolve / dismiss (in the current tenant scope, or a platform alert when `platform`). */
export async function transitionAlert(
  id: string, action: AlertAction, opts: { userId?: Id; notes?: string; now?: Date; platform?: boolean } = {},
): Promise<TransitionResult> {
  if (!mongoose.Types.ObjectId.isValid(id)) return { ok: false, reason: 'not_found', message: 'Alert not found.' };
  const run = async (): Promise<TransitionResult> => {
    const alert = await ChannelAlert.findOne({ _id: id, ...(opts.platform ? { tenantId: { $exists: false } } : { type: { $in: TENANT_ALERT_TYPES } }) });
    if (!alert) return { ok: false, reason: 'not_found', message: 'Alert not found.' };
    const next = nextStatus(alert.status, action);
    if (!next) return { ok: false, reason: 'invalid_transition', message: `An alert that is ${alert.status} cannot be ${action === 'acknowledge' ? 'acknowledged' : action === 'resolve' ? 'resolved' : 'dismissed'}.` };
    const now = opts.now ?? new Date();
    alert.status = next;
    const by = opts.userId ? new mongoose.Types.ObjectId(String(opts.userId)) : undefined;
    if (next === 'acknowledged') { alert.acknowledgedAt = now; alert.acknowledgedBy = by; }
    else { alert.resolvedAt = now; alert.resolvedBy = by; alert.autoResolved = false; alert.emailPending = false; }
    const notes = typeof opts.notes === 'string' ? opts.notes.trim().slice(0, 2000) : '';
    if (notes) alert.notes = notes;
    await alert.save();
    return { ok: true, alert };
  };
  return opts.platform ? unscoped(run) : run();
}

// ─── Lazy auto-resolve ───────────────────────────────────────────────────────

const hasRoom = (r: { room?: unknown; rooms?: unknown[] }) => Boolean(r.room) || (Array.isArray(r.rooms) && r.rooms.length > 0);

/**
 * Resolve alerts whose cause went away through any write path. Runs in the tenant scope
 * before listing or counting; cheap (only active alerts of these types are read).
 */
export async function reconcileAlerts(now: Date = new Date()): Promise<number> {
  let resolved = 0;
  const unmapped = await ChannelAlert.find({ type: 'unmapped_booking', status: { $in: ACTIVE } }).select('_id reservationId channexBookingId').lean();
  if (unmapped.length) {
    const ids = unmapped.map((a) => a.reservationId).filter(Boolean);
    const bookingIds = unmapped.filter((a) => !a.reservationId && a.channexBookingId).map((a) => a.channexBookingId!);
    const reservations = await Reservation.find({
      $or: [{ _id: { $in: ids } }, ...(bookingIds.length ? [{ 'channelSource.channexBookingId': { $in: bookingIds } }] : [])],
    }).select('_id room rooms status channelSource.channexBookingId').lean();
    const done = unmapped.filter((a) => {
      const r: any = reservations.find((x: any) => (a.reservationId && String(x._id) === String(a.reservationId))
        || (a.channexBookingId && x.channelSource?.channexBookingId === a.channexBookingId));
      return r && (hasRoom(r) || r.status === 'cancelled');
    });
    if (done.length) {
      const r = await ChannelAlert.updateMany({ _id: { $in: done.map((a) => a._id) } },
        { $set: { status: 'resolved', resolvedAt: now, autoResolved: true, emailPending: false } });
      resolved += r.modifiedCount ?? 0;
    }
  }

  const nonAcked = await ChannelAlert.find({ type: 'non_acked_booking', status: { $in: ACTIVE }, channexBookingId: { $exists: true } }).select('_id channexBookingId').lean();
  if (nonAcked.length) {
    const bookingIds = nonAcked.map((a) => a.channexBookingId!);
    const [unacked, seen] = await Promise.all([
      ChannexBookingRevision.distinct('channexBookingId', { channexBookingId: { $in: bookingIds }, ackedAt: { $exists: false } }),
      ChannexBookingRevision.distinct('channexBookingId', { channexBookingId: { $in: bookingIds } }),
    ]);
    const done = nonAcked.filter((a) => seen.includes(a.channexBookingId!) && !unacked.includes(a.channexBookingId!));
    if (done.length) {
      const r = await ChannelAlert.updateMany({ _id: { $in: done.map((a) => a._id) } },
        { $set: { status: 'resolved', resolvedAt: now, autoResolved: true, emailPending: false } });
      resolved += r.modifiedCount ?? 0;
    }
  }
  return resolved;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export interface AlertQuery {
  status?: string;
  type?: string;
  severity?: string;
  page?: number;
  limit?: number;
}

/** Validated filter; `status` may be a single status or 'active' (open + acknowledged, the default). */
export function alertFilter(q: AlertQuery): Record<string, unknown> | { error: string } {
  const filter: Record<string, unknown> = { type: { $in: TENANT_ALERT_TYPES } };
  const status = q.status || 'active';
  if (status === 'active') filter.status = { $in: ACTIVE };
  else if (status !== 'all') {
    if (!(CHANNEL_ALERT_STATUSES as readonly string[]).includes(status)) return { error: 'Unknown status.' };
    filter.status = status;
  }
  if (q.type) {
    if (!(TENANT_ALERT_TYPES as string[]).includes(q.type)) return { error: 'Unknown alert type.' };
    filter.type = q.type;
  }
  if (q.severity) {
    if (!(CHANNEL_ALERT_SEVERITIES as readonly string[]).includes(q.severity)) return { error: 'Unknown severity.' };
    filter.severity = q.severity;
  }
  return filter;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** Counts for the nav badge and the page header (tenant scope). */
export async function alertSummary() {
  await reconcileAlerts().catch(() => 0);
  const rows = await ChannelAlert.aggregate([
    { $match: { status: { $in: ACTIVE }, type: { $in: TENANT_ALERT_TYPES } } },
    { $group: { _id: { status: '$status', severity: '$severity' }, n: { $sum: 1 } } },
  ]);
  const count = (pred: (k: { status: string; severity: string }) => boolean) => rows.filter((r) => pred(r._id)).reduce((s, r) => s + r.n, 0);
  return {
    openCritical: count((k) => k.status === 'open' && k.severity === 'critical'),
    open: count((k) => k.status === 'open'),
    acknowledged: count((k) => k.status === 'acknowledged'),
    activeCritical: count((k) => k.severity === 'critical'),
  };
}

// ─── Tenant view ─────────────────────────────────────────────────────────────

export type AlertActionKind = 'reservation' | 'channels' | 'calendar' | 'airbnb_request' | 'none';

/** Where the alert is fixed (frontend route); the button label comes from the kind. */
export function alertAction(a: Pick<IChannelAlert, 'type' | 'reservationId'>): { kind: AlertActionKind; path?: string } {
  const reservation = a.reservationId ? { kind: 'reservation' as const, path: `/admin/reservations?id=${a.reservationId}` } : null;
  switch (a.type) {
    case 'overbooking':
    case 'unmapped_booking':
    case 'modification_needs_review':
    case 'currency_mismatch':
      return reservation ?? { kind: 'channels', path: '/admin/settings/channel-manager' };
    case 'ari_warning':
    case 'rate_error':
      return { kind: 'calendar', path: '/admin/pricing?tab=calendar' };
    case 'airbnb_reservation_request':
    case 'airbnb_alteration_request':
    case 'airbnb_inquiry':
      return { kind: 'airbnb_request' };
    case 'api_auth_failed':
    case 'unknown_property':
      return { kind: 'none' };
    default:
      return { kind: 'channels', path: '/admin/settings/channel-manager' };
  }
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** OTA/provider text made safe for tenants: no ids, no provider name, bounded. */
export function scrubProviderText(s: string): string {
  return s.replace(UUID_RE, '…').replace(/channex(\.io)?/gi, 'channel manager').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Up to 5 human messages found in an OTA/provider payload (message, error, errors[], warnings[] …). */
export function providerMessages(payload: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown, depth: number) => {
    if (out.length >= 5 || depth > 4 || v == null) return;
    if (typeof v === 'string') { if (v.trim().length > 3 && !/^[0-9a-f-]{20,}$/i.test(v.trim())) out.push(scrubProviderText(v)); return; }
    if (Array.isArray(v)) { v.slice(0, 10).forEach((x) => visit(x, depth + 1)); return; }
    if (typeof v === 'object') {
      for (const k of ['message', 'error', 'errors', 'warning', 'warnings', 'description', 'reason', 'title', 'details']) {
        if (k in (v as Record<string, unknown>)) visit((v as Record<string, unknown>)[k], depth + 1);
      }
    }
  };
  visit(payload, 0);
  return [...new Set(out)].filter(Boolean);
}

const str = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);

/** Requested stay of an Airbnb request (reservation/alteration requests carry `bms`, inquiries `booking_details`). */
export function airbnbRequestFacts(details: unknown) {
  const d: any = (details as any)?.payload ?? details ?? {};
  const bms = d.bms ?? d.payload?.bms;
  const inquiry = d.booking_details ?? d.payload?.booking_details;
  const src = bms ?? inquiry ?? {};
  const customer = bms?.customer ?? {};
  const rooms: any[] = Array.isArray(bms?.rooms) ? bms.rooms : [];
  const occupancy = rooms.reduce((acc, r) => ({
    adults: acc.adults + (Number(r?.occupancy?.adults) || 0), children: acc.children + (Number(r?.occupancy?.children) || 0),
  }), { adults: 0, children: 0 });
  const checkIn = day(src.arrival_date) ?? day(src.checkin_date) ?? day(rooms[0]?.checkin_date);
  let checkOut = day(src.departure_date) ?? day(src.checkout_date) ?? day(rooms[rooms.length - 1]?.checkout_date);
  const nights = Number(src.nights) || undefined;
  if (!checkOut && checkIn && nights) {
    const t = new Date(`${checkIn}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + nights); checkOut = t.toISOString().slice(0, 10);
  }
  const amount = Number(bms?.amount ?? src.total_price ?? src.price);
  return {
    checkIn, checkOut,
    nights: nights ?? (checkIn && checkOut ? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400_000) : undefined),
    guestName: str([customer.name, customer.surname].filter(Boolean).join(' ')) ?? str(src.guest_name),
    adults: occupancy.adults || Number(src.adults ?? src.guests) || undefined,
    children: occupancy.children || undefined,
    payout: Number.isFinite(amount) && amount > 0 ? amount : undefined,
    currency: str(bms?.currency ?? src.currency, 3),
    otaReservationCode: str(bms?.ota_reservation_code),
    message: str(src.message ?? d.message, 1000),
    channexRoomTypeId: str(rooms[0]?.room_type_id ?? src.room_type_id, 64),
    resolved: d.resolved === true || typeof d.resolution === 'string',
    resolution: str(d.resolution, 40),
  };
}

export interface TenantAlert {
  _id: string;
  type: ChannelAlertType;
  severity: ChannelAlertSeverity;
  status: ChannelAlertStatus;
  createdAt: Date;
  lastSeenAt?: Date;
  occurrences: number;
  dueAt?: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  autoResolved?: boolean;
  notes?: string;
  reservationId?: string;
  /** Tenant channel id (ChannexChannel `_id`) */
  channelId?: string;
  params: Record<string, unknown>;
  action: { kind: AlertActionKind; path?: string };
}

interface ViewContext {
  reservations: Map<string, any>;
  channels: Map<string, { _id: string; title?: string; otaCode?: string }>;
}

/** Type-specific values tenants may see (no Channex ids, no raw payloads). */
function paramsFor(a: IChannelAlert | any, ctx: ViewContext): Record<string, unknown> {
  const d: any = a.details ?? {};
  const r = a.reservationId ? ctx.reservations.get(String(a.reservationId)) : undefined;
  const ch = a.channelId ? ctx.channels.get(a.channelId) : undefined;
  const p: Record<string, unknown> = {};
  if (r) {
    Object.assign(p, {
      reservationCode: r.reservationCode, guestName: r.guestName, checkIn: day(r.checkInDate?.toISOString?.()), checkOut: day(r.checkOutDate?.toISOString?.()),
      otaName: r.channelSource?.otaName, otaReservationCode: r.channelSource?.otaReservationCode, reservationStatus: r.status,
    });
  }
  if (ch) Object.assign(p, { channelName: ch.title, otaCode: ch.otaCode });
  switch (a.type) {
    case 'overbooking':
      p.nights = Array.isArray(d.nights) ? d.nights.slice(0, 31) : [];
      p.competingReservations = (Array.isArray(d.competingReservations) ? d.competingReservations : []).slice(0, 10).map((c: any) => {
        const cr = ctx.reservations.get(String(c.reservationId));
        return { reservationId: String(c.reservationId), reservationCode: c.reservationCode ?? cr?.reservationCode, guestName: cr?.guestName, otaName: cr?.channelSource?.otaName };
      });
      break;
    case 'unmapped_booking':
      p.rooms = Array.isArray(d.rooms) ? d.rooms.length : undefined;
      p.unmappedKind = d.event === 'booking_unmapped_rate' ? 'rate' : d.event === 'booking_unmapped_room' ? 'room' : undefined;
      break;
    case 'modification_needs_review':
      p.change = d.change ?? 'modified';
      p.diff = Array.isArray(d.diff) ? d.diff.filter((x: any) => x?.field !== 'roomTypes').slice(0, 10) : undefined;
      break;
    case 'currency_mismatch':
      Object.assign(p, { bookingCurrency: d.bookingCurrency, propertyCurrency: d.propertyCurrency, amount: d.amount });
      break;
    case 'sync_error':
    case 'sync_warning':
    case 'rate_error':
      p.messages = providerMessages(d.payload ?? d.message);
      break;
    case 'ari_warning':
      p.count = Array.isArray(d.warnings) ? d.warnings.length : undefined;
      p.what = d.kind === 'availability' ? 'availability' : 'rates';
      break;
    case 'push_failing':
      Object.assign(p, { since: d.since, failures: d.failures });
      break;
    case 'channel_removal_warning':
      p.removalDate = day(d.payload?.expected_removal_date) ?? day(d.payload?.removal_date);
      break;
    case 'remap_required':
    case 'unmap_before_delete':
      Object.assign(p, { name: d.name, kind: d.kind ?? 'room_type', phase: d.phase });
      break;
    case 'airbnb_reservation_request':
    case 'airbnb_alteration_request':
    case 'airbnb_inquiry': {
      const { channexRoomTypeId: _ignored, ...facts } = airbnbRequestFacts(d);
      Object.assign(p, facts, { decision: d.decision });
      break;
    }
    default:
      break;
  }
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

async function loadViewContext(alerts: any[]): Promise<ViewContext> {
  const resIds = new Set<string>();
  for (const a of alerts) {
    if (a.reservationId) resIds.add(String(a.reservationId));
    for (const c of (a.details?.competingReservations ?? []) as any[]) if (c?.reservationId) resIds.add(String(c.reservationId));
  }
  const channelIds = [...new Set(alerts.map((a) => a.channelId).filter(Boolean))];
  const [reservations, channels] = await Promise.all([
    resIds.size ? Reservation.find({ _id: { $in: [...resIds] } }).select('reservationCode guestName checkInDate checkOutDate status channelSource.otaName channelSource.otaReservationCode').lean() : [],
    channelIds.length ? ChannexChannel.find({ channexChannelId: { $in: channelIds } }).select('_id channexChannelId title otaCode').lean() : [],
  ]);
  return {
    reservations: new Map((reservations as any[]).map((r) => [String(r._id), r])),
    channels: new Map((channels as any[]).map((c) => [c.channexChannelId, { _id: String(c._id), title: c.title, otaCode: c.otaCode }])),
  };
}

export function toTenantAlert(a: any, ctx: ViewContext): TenantAlert {
  return {
    _id: String(a._id), type: a.type, severity: a.severity, status: a.status, createdAt: a.createdAt, lastSeenAt: a.lastSeenAt,
    occurrences: a.occurrences ?? 1, dueAt: a.dueAt, acknowledgedAt: a.acknowledgedAt, resolvedAt: a.resolvedAt, autoResolved: a.autoResolved,
    notes: a.notes, reservationId: a.reservationId ? String(a.reservationId) : undefined,
    channelId: a.channelId ? ctx.channels.get(a.channelId)?._id : undefined,
    params: paramsFor(a, ctx), action: alertAction(a),
  };
}

/** Paged tenant list, critical first then newest (tenant scope). */
export async function listTenantAlerts(q: AlertQuery) {
  const filter = alertFilter(q);
  if ('error' in filter) return { ok: false as const, reason: 'invalid', message: String(filter.error) };
  await reconcileAlerts().catch(() => 0);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
  const page = Math.max(1, Number(q.page) || 1);
  const [docs, total] = await Promise.all([
    ChannelAlert.find(filter).sort({ updatedAt: -1 }).limit(500).lean(),
    ChannelAlert.countDocuments(filter),
  ]);
  docs.sort((x, y) => (SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]) || (+new Date(y.lastSeenAt ?? y.updatedAt) - +new Date(x.lastSeenAt ?? x.updatedAt)));
  const slice = docs.slice((page - 1) * limit, page * limit);
  const ctx = await loadViewContext(slice);
  return { ok: true as const, alerts: slice.map((a) => toTenantAlert(a, ctx)), total, page, limit };
}

/** One alert with its context (tenant scope). */
export async function loadTenantAlert(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const a = await ChannelAlert.findOne({ _id: id, type: { $in: TENANT_ALERT_TYPES } }).lean();
  if (!a) return null;
  const ctx = await loadViewContext([a]);
  const users = [a.resolvedBy, a.acknowledgedBy].filter(Boolean);
  const names = new Map(
    (users.length ? await User.find({ _id: { $in: users } }).select('firstName lastName').lean() : [])
      .map((u: any) => [String(u._id), [u.firstName, u.lastName].filter(Boolean).join(' ')]),
  );
  return {
    ...toTenantAlert(a, ctx),
    resolvedByName: a.resolvedBy ? names.get(String(a.resolvedBy)) : undefined,
    acknowledgedByName: a.acknowledgedBy ? names.get(String(a.acknowledgedBy)) : undefined,
  };
}

// ─── Email digest ────────────────────────────────────────────────────────────

/** Users of the current tenant who may resolve channel alerts. */
export async function alertRecipients(tenantId: Id): Promise<string[]> {
  const users = await User.find({ isActive: true }).select('email role appRoles isSuperAdmin').lean();
  const out: string[] = [];
  for (const u of users) {
    if (!u.email) continue;
    if (await userHasPermission(u, 'pms', ['admin.ota.resolve'], String(tenantId))) out.push(u.email);
  }
  return [...new Set(out)];
}

export type DigestSender = (to: string, mail: { subject: string; html: string; text: string }) => Promise<unknown>;

const defaultSender: DigestSender = (to, mail) => sendEmail({ to, ...mail, _logMeta: { emailType: 'channel_alert_digest' } });

/**
 * One email per tenant per 15 minutes with its new critical alerts (cron, every minute).
 * A tenant that was emailed less than 15 minutes ago keeps its pending alerts for the next
 * digest. Returns the tenants emailed.
 */
export async function sendAlertDigests(opts: { now?: Date; send?: DigestSender } = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? defaultSender;
  const tenantIds: mongoose.Types.ObjectId[] = await unscoped(() => ChannelAlert.distinct('tenantId', { emailPending: true, tenantId: { $exists: true } }));
  const emailed: string[] = [];
  for (const tenantId of tenantIds) {
    try {
      const sent = await runInTenant(tenantId, async () => {
        const last = await ChannelAlert.findOne({ emailedAt: { $exists: true } }).sort({ emailedAt: -1 }).select('emailedAt').lean();
        if (last?.emailedAt && now.getTime() - last.emailedAt.getTime() < EMAIL_DIGEST_INTERVAL_MS) return false;
        const pending = await ChannelAlert.find({ emailPending: true }).sort({ createdAt: 1 }).lean();
        const active = pending.filter((a) => a.status === 'open' && a.severity === 'critical');
        const stale = pending.filter((a) => !active.includes(a));
        if (stale.length) await ChannelAlert.updateMany({ _id: { $in: stale.map((a) => a._id) } }, { $set: { emailPending: false } });
        if (!active.length) return false;

        const recipients = await alertRecipients(tenantId);
        if (recipients.length) {
          const tenant = await Tenant.findById(tenantId).select('name slug').lean<{ name?: string; slug?: string }>();
          const ctx = await loadViewContext(active);
          const mail = renderChannelAlertDigest({
            tenantName: tenant?.name ?? 'Pilloto',
            alertsUrl: `${tenantBaseUrl(tenant?.slug)}/admin/channel-alerts`,
            alerts: active.map((a) => ({ type: a.type, params: paramsFor(a, ctx), createdAt: a.createdAt })),
          });
          for (const to of recipients) {
            await send(to, mail).catch((err) => console.error(`[Channex] alert digest to a user of tenant ${tenantId} failed: ${(err as Error).message}`));
          }
        }
        await ChannelAlert.updateMany({ _id: { $in: active.map((a) => a._id) } }, { $set: { emailPending: false, emailedAt: now } });
        return recipients.length > 0;
      });
      if (sent) emailed.push(String(tenantId));
    } catch (err) {
      console.error(`[Channex] alert digest failed for tenant ${tenantId}:`, (err as Error).message);
    }
  }
  return emailed;
}
