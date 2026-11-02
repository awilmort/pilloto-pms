/**
 * ARI worker — pushes the outbox to Channex (CHANNEX_ARCHITECTURE.md §6.3; plan Phase 6.2).
 *
 * `ariTick` runs every 5 s (`utils/channexCron.ts`) and right after availability changes. It
 * looks for tenants with pending outbox rows, takes a per-property lease and runs
 * `flushProperty`, when one of two debounces is due:
 *   - availability (bookings, cancellations, room blocks, rooms): 1 s without further
 *     availability changes, then ONLY availability rows are pushed — a sold room must reach
 *     the channels at once (architecture §19, amendment 2026-10-31). Held back while a
 *     structural change is pending, so a room type is created before its availability;
 *   - everything (prices, rules, structure): 5 s quiet / 30 s max, as one batch.
 * `flushProperty`: claim → structural rows first → merge → clamp → compute with
 * InventoryService / RateResolver → compress into ranges → at most ONE `POST /availability`
 * and ONE `POST /restrictions` → log with task ids. Errors re-queue rows and pause the
 * property (state lives on `ChannexProperty`, so several instances agree).
 *
 * The pure helpers (merge, compress, payload builders, backoff, limiter, debounce) are
 * exported for tests; Channex values are always computed from Pilloto's current state, so a
 * merged or repeated row can never push stale data.
 */

import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { ChannelAlertType } from '../../models/ChannelAlert';
import { raiseAlert as raise, resolveAlerts } from './alerts.service';
import ChannelAriChange, { IChannelAriChange } from '../../models/ChannelAriChange';
import ChannexEntityMap from '../../models/ChannexEntityMap';
import ChannexProperty, { IChannexProperty } from '../../models/ChannexProperty';
import ChannexSyncLog, { ChannexSyncKind, ChannexSyncTrigger } from '../../models/ChannexSyncLog';
import { ChannexAuthError, ChannexClient, ChannexError, ChannexValidationError } from './channexClient';
import { assertCurrentEnvironment } from './config';
import {
  addDays, clampRange, DateRange, eachDate, mergeRanges, todayInTz,
} from './dates';
import { getAvailability } from './inventory.service';
import { runInTenant, CHANNEX_STATE_LENGTH } from './provisioning';
import { resolveRates, ResolvedDay } from './rateResolver';
import { isOnChannels, syncStructure } from './structuralSync';
import RoomType from '../../models/RoomType';
import RatePlan from '../../models/RatePlan';

// ─── Tunables ────────────────────────────────────────────────────────────────

export const DEBOUNCE_QUIET_MS = 5_000;
export const DEBOUNCE_MAX_MS = 30_000;
/** Availability waits only this long for further changes (one front-desk action = one call) */
export const AVAILABILITY_QUIET_MS = 1_000;
export const LEASE_MS = 60_000;
export const CALLS_PER_MINUTE = 8;
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 15 * 60_000;
export const AUTH_PAUSE_MS = 15 * 60_000;
const STUCK_IN_FLIGHT_MS = 5 * 60_000;
const MAX_PROPERTIES_PER_TICK = 5;

const ALL_RATE_FIELDS = ['rate', 'min_stay_arrival', 'max_stay', 'closed_to_arrival', 'closed_to_departure', 'stop_sell'];

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Debounce: flush once changes were quiet for 5 s, or the first pending change is 30 s old. */
export function shouldFlush(oldestMs: number, newestMs: number, nowMs: number): boolean {
  return nowMs - newestMs >= DEBOUNCE_QUIET_MS || nowMs - oldestMs >= DEBOUNCE_MAX_MS;
}

export type FlushMode = 'all' | 'availability';

export interface PendingSummary {
  oldestMs: number;
  newestMs: number;
  /** Newest pending availability row, if any */
  newestAvailabilityMs?: number;
  hasStructure: boolean;
}

/** What a tenant's pending rows call for right now: everything, availability only, or nothing yet. */
export function flushMode(p: PendingSummary, nowMs: number): FlushMode | null {
  if (shouldFlush(p.oldestMs, p.newestMs, nowMs)) return 'all';
  if (p.newestAvailabilityMs !== undefined && !p.hasStructure && nowMs - p.newestAvailabilityMs >= AVAILABILITY_QUIET_MS) return 'availability';
  return null;
}

/** Pause after the n-th consecutive failure (n ≥ 1): 60 s × 2^(n−1), at most 15 min. */
export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
}

/** Per-key sliding-window call limiter (kept under Channex's 10 calls/minute/kind). */
export class SlidingWindowLimiter {
  private calls = new Map<string, number[]>();
  constructor(private limit = CALLS_PER_MINUTE, private windowMs = 60_000) {}

  /** Records a call and returns true when the key is under its limit. */
  tryAcquire(key: string, nowMs: number): boolean {
    const recent = (this.calls.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.limit) { this.calls.set(key, recent); return false; }
    recent.push(nowMs);
    this.calls.set(key, recent);
    return true;
  }
}

const defaultLimiter = new SlidingWindowLimiter();

/** Clamp to property-local today..today+499 and union overlapping/adjacent ranges. */
export function clampAndMerge(ranges: DateRange[], today: string): DateRange[] {
  const max = addDays(today, CHANNEX_STATE_LENGTH - 1);
  const clamped = ranges.map((r) => clampRange(r, today, max)).filter((r): r is DateRange => r !== null);
  return mergeRanges(clamped);
}

export interface Run<T> extends DateRange { value: T }

/** Maximal runs of consecutive dates with identical values. */
export function compressRuns<T>(dates: string[], valueOf: (date: string) => T): Run<T>[] {
  const runs: Run<T>[] = [];
  for (const date of [...dates].sort()) {
    const value = valueOf(date);
    const last = runs[runs.length - 1];
    if (last && addDays(last.dateTo, 1) === date && JSON.stringify(last.value) === JSON.stringify(value)) last.dateTo = date;
    else runs.push({ dateFrom: date, dateTo: date, value });
  }
  return runs;
}

const dateKeys = (r: DateRange) => (r.dateFrom === r.dateTo ? { date: r.dateFrom } : { date_from: r.dateFrom, date_to: r.dateTo });

const WEEKDAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'] as const;
const DAY_ORDER = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
const DAY_MS = 86_400_000;
const dayIndex = (date: string) => Math.round(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS);

export interface WeekdayRun<T> extends DateRange { value: T; /** Absent = every day of the range */ days?: string[] }

/**
 * Runs that use Channex's `days` filter (restrictions only): per weekday, consecutive weeks with
 * the same value form a run; runs of different weekdays covering the same weeks with the same
 * value become ONE value with `days`. A weekly pattern (weekend prices, weekend minimum stay)
 * over 500 days then costs a handful of values instead of one per weekday/weekend block.
 * Exact: within a run's date range, each of its weekdays has the run's value on every date.
 */
export function compressWeekdayRuns<T>(dates: string[], valueOf: (date: string) => T): WeekdayRun<T>[] {
  const sorted = [...new Set(dates)].sort();
  if (!sorted.length) return [];
  const anchor = dayIndex(sorted[0]);
  type Seq = { week0: number; week1: number; from: string; to: string; key: string; value: T };
  const perDay = new Map<number, Seq[]>();
  for (const date of sorted) {
    const offset = dayIndex(date) - anchor;
    const wd = offset % 7;
    const week = Math.floor(offset / 7);
    const value = valueOf(date);
    const key = JSON.stringify(value);
    const seqs = perDay.get(wd) ?? [];
    const last = seqs[seqs.length - 1];
    if (last && last.week1 === week - 1 && last.key === key) { last.week1 = week; last.to = date; } else seqs.push({ week0: week, week1: week, from: date, to: date, key, value });
    perDay.set(wd, seqs);
  }
  const groups = new Map<string, { from: string; to: string; value: T; days: Set<string> }>();
  for (const seqs of perDay.values()) {
    for (const q of seqs) {
      const id = `${q.week0}|${q.week1}|${q.key}`;
      const g = groups.get(id) ?? { from: q.from, to: q.to, value: q.value, days: new Set<string>() };
      if (q.from < g.from) g.from = q.from;
      if (q.to > g.to) g.to = q.to;
      g.days.add(WEEKDAYS[new Date(`${q.from}T12:00:00Z`).getUTCDay()]);
      groups.set(id, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({
      dateFrom: g.from, dateTo: g.to, value: g.value,
      // Every weekday, or a range shorter than a week that the run covers entirely, needs no filter
      ...(g.days.size === 7 || g.from === g.to || dayIndex(g.to) - dayIndex(g.from) + 1 === g.days.size ? {} : { days: DAY_ORDER.filter((d) => g.days.has(d)) }),
    }))
    .sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : 0));
}

export interface AvailabilityValue { property_id: string; room_type_id: string; availability: number; date?: string; date_from?: string; date_to?: string }

export function buildAvailabilityValues(
  channexPropertyId: string,
  perRoomType: { channexRoomTypeId: string; ranges: DateRange[]; availability: Record<string, number> }[],
): AvailabilityValue[] {
  const out: AvailabilityValue[] = [];
  for (const rt of perRoomType) {
    const dates = rt.ranges.flatMap((r) => eachDate(r.dateFrom, r.dateTo));
    for (const run of compressRuns(dates, (d) => rt.availability[d] ?? 0)) {
      out.push({ property_id: channexPropertyId, room_type_id: rt.channexRoomTypeId, availability: run.value, ...dateKeys(run) });
    }
  }
  return out;
}

const decimal = (cents: number) => (cents / 100).toFixed(2);

/** The touched restriction fields of one resolved day, in Channex's field names. `fields: ['*']` = all. */
export function restrictionFieldValues(day: ResolvedDay, fields: string[]): Record<string, unknown> {
  const wanted = (f: string) => fields.includes('*') || fields.includes(f);
  const out: Record<string, unknown> = {};
  if (wanted('rate')) {
    const occupancies = Object.keys(day.rates).map(Number).sort((a, b) => a - b);
    // Channex rejects rates ≤ 0; such days are forced to stop sell by the resolver
    if (occupancies.length && occupancies.every((n) => day.rates[n] > 0)) {
      out.rates = occupancies.map((n) => ({ occupancy: n, rate: decimal(day.rates[n]) }));
    }
  }
  if (wanted('min_stay_arrival')) out.min_stay_arrival = day.minStayArrival;
  if (wanted('max_stay')) out.max_stay = day.maxStay;
  if (wanted('closed_to_arrival')) out.closed_to_arrival = day.closedToArrival;
  if (wanted('closed_to_departure')) out.closed_to_departure = day.closedToDeparture;
  if (wanted('stop_sell')) out.stop_sell = day.stopSell;
  return out;
}

/** Every day stop-sold: a rate plan the tenant does not sell on channels (still bookable directly). */
export function closeOnChannels(days: Record<string, ResolvedDay>): Record<string, ResolvedDay> {
  return Object.fromEntries(Object.entries(days).map(([d, day]) => [d, { ...day, stopSell: true }]));
}

export interface RestrictionGroup {
  channexPropertyId: string;
  channexRatePlanId: string;
  ranges: DateRange[];
  fields: string[];
  days: Record<string, ResolvedDay>;
}

/**
 * Restriction values per rate plan: maximal date runs, or weekday runs (`days`) when those are
 * fewer — the full-sync payload of a large property stays far below Channex's 10 MB request
 * limit (plan 9.4), while short calendar edits keep their plain one-value-per-run shape.
 */
export function buildRestrictionValues(groups: RestrictionGroup[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const g of groups) {
    const dates = g.ranges.flatMap((r) => eachDate(r.dateFrom, r.dateTo)).filter((d) => g.days[d]);
    const valueOf = (d: string) => restrictionFieldValues(g.days[d], g.fields);
    const nonEmpty = <R extends { value: Record<string, unknown> }>(runs: R[]) => runs.filter((r) => Object.keys(r.value).length > 0);
    const plain = nonEmpty(compressRuns(dates, valueOf));
    const weekly = plain.length > 7 ? nonEmpty(compressWeekdayRuns(dates, valueOf)) : [];
    if (weekly.length && weekly.length < plain.length) {
      for (const run of weekly) out.push({ property_id: g.channexPropertyId, rate_plan_id: g.channexRatePlanId, ...dateKeys(run), ...(run.days ? { days: run.days } : {}), ...run.value });
    } else {
      for (const run of plain) out.push({ property_id: g.channexPropertyId, rate_plan_id: g.channexRatePlanId, ...dateKeys(run), ...run.value });
    }
  }
  return out;
}

/** Group outbox rows per (rate plan, field set) with their ranges clamped and merged. */
export function groupRateRows(rows: Pick<IChannelAriChange, 'ratePlanId' | 'dateFrom' | 'dateTo' | 'fields'>[], today: string) {
  const buckets = new Map<string, { ratePlanId: string; fields: string[]; ranges: DateRange[] }>();
  for (const row of rows) {
    if (!row.ratePlanId || !row.dateFrom || !row.dateTo) continue;
    const fields = [...new Set(row.fields?.length ? row.fields : ['*'])].sort();
    const key = `${row.ratePlanId}|${fields.join(',')}`;
    const bucket = buckets.get(key) ?? { ratePlanId: String(row.ratePlanId), fields, ranges: [] };
    bucket.ranges.push({ dateFrom: row.dateFrom, dateTo: row.dateTo });
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((b) => ({ ...b, ranges: clampAndMerge(b.ranges, today) }))
    .filter((b) => b.ranges.length > 0);
}

export function groupAvailabilityRows(rows: Pick<IChannelAriChange, 'roomTypeId' | 'dateFrom' | 'dateTo'>[], today: string) {
  const buckets = new Map<string, DateRange[]>();
  for (const row of rows) {
    if (!row.roomTypeId || !row.dateFrom || !row.dateTo) continue;
    const key = String(row.roomTypeId);
    buckets.set(key, [...(buckets.get(key) ?? []), { dateFrom: row.dateFrom, dateTo: row.dateTo }]);
  }
  return [...buckets.entries()]
    .map(([roomTypeId, ranges]) => ({ roomTypeId, ranges: clampAndMerge(ranges, today) }))
    .filter((b) => b.ranges.length > 0);
}

const hull = (ranges: DateRange[]): DateRange => ({
  dateFrom: ranges.reduce((m, r) => (r.dateFrom < m ? r.dateFrom : m), ranges[0].dateFrom),
  dateTo: ranges.reduce((m, r) => (r.dateTo > m ? r.dateTo : m), ranges[0].dateTo),
});

// ─── Alerts ──────────────────────────────────────────────────────────────────

const raiseAlert = (
  tenantId: mongoose.Types.ObjectId | undefined,
  type: ChannelAlertType,
  dedupeKey: string,
  title: string,
  details: Record<string, unknown>,
  severity: 'warning' | 'critical' = 'warning',
) => raise({ type, dedupeKey, title, details, severity, ...(tenantId ? { tenantId } : {}) });

/** The channels have been out of date long enough to tell the tenant (architecture §9.1). */
export const PUSH_FAILING_AFTER_FAILURES = 5;
export const PUSH_FAILING_AFTER_MS = 15 * 60_000;

/**
 * `push_failing` is due after 5 consecutive failures, or once the property will have gone 15
 * minutes without a successful push by its next retry (failure streak start → paused until).
 */
export function isPushFailing(p: { failures: number; failingSince?: Date; pausedUntil: Date }): boolean {
  if (p.failures >= PUSH_FAILING_AFTER_FAILURES) return true;
  return Boolean(p.failingSince) && p.pausedUntil.getTime() - p.failingSince!.getTime() >= PUSH_FAILING_AFTER_MS;
}

// ─── Flush ───────────────────────────────────────────────────────────────────

export interface FlushDeps {
  client: ChannexClient;
  now?: () => Date;
  limiter?: SlidingWindowLimiter;
  /** 'availability': claim only availability rows (prices and rules keep batching) */
  mode?: FlushMode;
}

export interface FlushResult {
  claimed: number;
  structure: boolean;
  availabilityCalls: number;
  restrictionCalls: number;
  paused: boolean;
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

function triggerOf(rows: { reason?: string }[]): ChannexSyncTrigger {
  if (rows.some((r) => r.reason?.startsWith('full_sync'))) return 'full_sync';
  if (rows.some((r) => r.reason?.startsWith('manual'))) return 'manual';
  return 'delta';
}

/** Push the property's pending outbox rows. Must run inside the tenant context. */
export async function flushProperty(property: IChannexProperty, deps: FlushDeps): Promise<FlushResult> {
  const { client } = deps;
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? defaultLimiter;
  assertCurrentEnvironment(property, client.config);
  const result: FlushResult = { claimed: 0, structure: false, availabilityCalls: 0, restrictionCalls: 0, paused: false };
  if (!property.channexPropertyId || !property.timezone) return result;

  // ── Claim ──
  const batchId = randomUUID();
  const pending = await ChannelAriChange.find({ status: 'pending', ...(deps.mode === 'availability' ? { kind: 'availability' } : {}) }).select('_id').lean();
  if (pending.length === 0) return result;
  await ChannelAriChange.updateMany({ _id: { $in: pending.map((p) => p._id) }, status: 'pending' }, { $set: { status: 'in_flight', batchId } });
  const rows = await ChannelAriChange.find({ batchId, status: 'in_flight' }).lean();
  result.claimed = rows.length;

  const idsOf = (list: { _id: unknown }[]) => list.map((r) => r._id);
  const requeue = (list: { _id: unknown }[], countAttempt: boolean, error?: string) =>
    list.length
      ? ChannelAriChange.updateMany({ _id: { $in: idsOf(list) } }, {
        $set: { status: 'pending', ...(error ? { error } : {}) }, $unset: { batchId: '' }, ...(countAttempt ? { $inc: { attempts: 1 } } : {}),
      })
      : Promise.resolve();
  const finish = (list: { _id: unknown }[], status: 'done' | 'failed', error?: string) =>
    list.length
      ? ChannelAriChange.updateMany({ _id: { $in: idsOf(list) } }, { $set: { status, completedAt: now(), ...(error ? { error } : {}) } })
      : Promise.resolve();

  const structureRows = rows.filter((r) => r.kind === 'structure');
  const availabilityRows = rows.filter((r) => r.kind === 'availability');
  const rateRows = rows.filter((r) => r.kind === 'rates');
  const trigger = triggerOf(rows);
  const tenantId = property.tenantId;

  // Pause + requeue everything not yet finished after a retryable failure
  // Pause, requeue and (when it lasts) tell the tenant; nothing is lost
  const pauseAfterFailure = async (unfinished: typeof rows, err: unknown, pauseMs: (failures: number) => number) => {
    const failures = (property.consecutiveFailures ?? 0) + 1;
    const failingSince = property.failingSince ?? now();
    property.consecutiveFailures = failures;
    property.failingSince = failingSince;
    const pausedUntil = new Date(now().getTime() + pauseMs(failures));
    await requeue(unfinished, true, errMessage(err));
    await ChannexProperty.updateOne({ _id: property._id }, { $set: { pausedUntil, consecutiveFailures: failures, failingSince, lastError: errMessage(err) } });
    if (isPushFailing({ failures, failingSince, pausedUntil })) {
      await raiseAlert(tenantId, 'push_failing', 'property', 'Changes cannot be sent to your channels; Pilloto keeps retrying',
        { since: failingSince, failures, pausedUntil }, 'critical');
    }
    result.paused = true;
  };
  const failRetryable = (unfinished: typeof rows, err: unknown) => pauseAfterFailure(unfinished, err, backoffMs);
  const failAuth = async (unfinished: typeof rows, err: unknown) => {
    await pauseAfterFailure(unfinished, err, () => AUTH_PAUSE_MS);
    await raiseAlert(undefined, 'api_auth_failed', 'channex', 'Channex rejected Pilloto\'s API key or IP address', { message: errMessage(err) }, 'critical');
  };

  try {
    const today = todayInTz(property.timezone, now());

    // ── Structure first: a new rate plan must exist before its rates ──
    if (structureRows.length) {
      const report = await syncStructure({ client, property });
      result.structure = true;
      await finish(structureRows, 'done');
      if (!report.ok) {
        const failed = report.results.filter((r) => r.action === 'failed').map((r) => `${r.name}: ${r.error}`).join('; ');
        await requeue([...availabilityRows, ...rateRows], true, `Structural sync incomplete: ${failed}`.slice(0, 2000));
        await ChannexProperty.updateOne({ _id: property._id }, { $set: { lastError: failed.slice(0, 2000) } });
        return result;
      }
    }

    // ── Compute ──
    const maps = await ChannexEntityMap.find({ environment: client.config.environment, status: 'active' }).lean();
    const channexIdOf = (kind: 'room_type' | 'rate_plan', localId: string) =>
      maps.find((m) => m.kind === kind && String(m.localId) === localId)?.channexId;

    const availGroups = groupAvailabilityRows(availabilityRows, today)
      .map((g) => ({ ...g, channexRoomTypeId: channexIdOf('room_type', g.roomTypeId) }))
      .filter((g): g is typeof g & { channexRoomTypeId: string } => Boolean(g.channexRoomTypeId));
    const rateGroups = groupRateRows(rateRows, today)
      .map((g) => ({ ...g, channexRatePlanId: channexIdOf('rate_plan', g.ratePlanId) }))
      .filter((g): g is typeof g & { channexRatePlanId: string } => Boolean(g.channexRatePlanId));

    // Room types / rate plans with "sell on channels" off that a channel still maps: closed on the channels only
    const offAvail = new Set<string>();
    const offRates = new Set<string>();
    if (availGroups.length || rateGroups.length) {
      const [types, plans] = await Promise.all([
        RoomType.find({}).select('_id isActive sellOnChannels').lean(),
        RatePlan.find({ _id: { $in: rateGroups.map((g) => g.ratePlanId) } }).select('_id roomTypeId isActive sellOnChannels').lean(),
      ]);
      for (const t of types) if (t.isActive && !isOnChannels(t)) offAvail.add(String(t._id));
      const typeOff = new Set(types.filter((t) => !isOnChannels(t)).map((t) => String(t._id)));
      for (const p of plans) if (p.isActive && (!isOnChannels(p) || typeOff.has(String(p.roomTypeId)))) offRates.add(String(p._id));
    }

    let availabilityValues: AvailabilityValue[] = [];
    if (availGroups.length) {
      const window = hull(availGroups.flatMap((g) => g.ranges));
      const grid = await getAvailability({ ...window, roomTypeIds: availGroups.map((g) => g.roomTypeId) });
      availabilityValues = buildAvailabilityValues(property.channexPropertyId, availGroups.map((g) => ({
        channexRoomTypeId: g.channexRoomTypeId, ranges: g.ranges, availability: offAvail.has(g.roomTypeId) ? {} : grid[g.roomTypeId] ?? {},
      })));
    }
    let restrictionValues: Record<string, unknown>[] = [];
    if (rateGroups.length) {
      const window = hull(rateGroups.flatMap((g) => g.ranges));
      const resolved = await resolveRates({ ...window, ratePlanIds: [...new Set(rateGroups.map((g) => g.ratePlanId))] });
      restrictionValues = buildRestrictionValues(rateGroups.map((g) => ({
        channexPropertyId: property.channexPropertyId!, channexRatePlanId: g.channexRatePlanId, ranges: g.ranges, fields: g.fields,
        days: offRates.has(g.ratePlanId) ? closeOnChannels(resolved[g.ratePlanId] ?? {}) : resolved[g.ratePlanId] ?? {},
      })));
    }

    // ── Push: at most one call per kind ──
    const kinds: { name: ChannexSyncKind; path: string; rows: typeof rows; values: unknown[] }[] = [
      { name: 'availability', path: '/availability', rows: availabilityRows, values: availabilityValues },
      { name: 'restrictions', path: '/restrictions', rows: rateRows, values: restrictionValues },
    ];
    let stopped = false;
    let pushedOk = false;

    for (const kind of kinds) {
      if (stopped) { await requeue(kind.rows, false); continue; }
      if (kind.values.length === 0) { await finish(kind.rows, 'done'); continue; }
      if (!limiter.tryAcquire(`${property._id}:${kind.name}`, now().getTime())) { await requeue(kind.rows, false); continue; }

      const started = Date.now();
      const spans = kind.values.map((v: any) => [v.date ?? v.date_from, v.date ?? v.date_to] as [string, string]);
      const log = {
        tenantId, trigger, kind: kind.name, valuesCount: kind.values.length, batchId,
        dateFrom: spans.reduce((m, s) => (s[0] < m ? s[0] : m), spans[0][0]),
        dateTo: spans.reduce((m, s) => (s[1] > m ? s[1] : m), spans[0][1]),
      };
      try {
        const res = await client.post(kind.path, { values: kind.values });
        const taskIds = (Array.isArray(res?.data) ? res.data : []).map((t: any) => String(t?.id)).filter(Boolean);
        const warnings: unknown[] = Array.isArray(res?.meta?.warnings) ? res.meta.warnings : [];
        await finish(kind.rows, 'done');
        await ChannexSyncLog.create({ ...log, taskIds, warnings, httpStatus: 200, durationMs: Date.now() - started });
        if (kind.name === 'availability') result.availabilityCalls++; else result.restrictionCalls++;
        pushedOk = true;
        if (warnings.length) {
          await raiseAlert(tenantId, 'ari_warning', `${kind.name}:${JSON.stringify(warnings).slice(0, 120)}`,
            'The channel manager did not accept some values', { kind: kind.name, warnings: warnings.slice(0, 20), taskIds });
        }
      } catch (err) {
        await ChannexSyncLog.create({ ...log, taskIds: [], warnings: [], httpStatus: err instanceof ChannexError ? err.status : undefined, durationMs: Date.now() - started, error: errMessage(err) }).catch(() => undefined);
        if (err instanceof ChannexValidationError) {
          await finish(kind.rows, 'failed', errMessage(err));
          await raiseAlert(tenantId, 'sync_error', `${kind.name}:${batchId}`, 'The channel manager rejected an update', { kind: kind.name, message: errMessage(err) });
          continue;
        }
        stopped = true;
        if (err instanceof ChannexAuthError) await failAuth(kind.rows, err); else await failRetryable(kind.rows, err);
      }
    }

    if (pushedOk && !result.paused) {
      await ChannexProperty.updateOne({ _id: property._id }, { $set: { consecutiveFailures: 0, lastPushAt: now() }, $unset: { lastError: '', failingSince: '' } });
      property.consecutiveFailures = 0;
      property.failingSince = undefined;
      await resolveAlerts({ tenantId, types: ['push_failing'], dedupeKey: 'property' }, { now: now() });
      await resolveAlerts({ types: ['api_auth_failed'], dedupeKey: 'channex' }, { now: now() });
    }
  } catch (err) {
    // Compute/structure failure: nothing was lost — every unfinished row goes back to pending
    const unfinished = await ChannelAriChange.find({ batchId, status: 'in_flight' }).lean();
    if (err instanceof ChannexAuthError) await failAuth(unfinished, err); else await failRetryable(unfinished, err);
  }
  return result;
}

// ─── Tick ────────────────────────────────────────────────────────────────────

export interface TickDeps {
  client: ChannexClient;
  now?: () => Date;
  limiter?: SlidingWindowLimiter;
}

/** One tick: lease properties whose changes are due and flush them. Returns the tenants flushed. */
export async function ariTick(deps: TickDeps): Promise<string[]> {
  const now = deps.now ?? (() => new Date());
  const nowMs = now().getTime();
  const environment = deps.client.config.environment;

  // Rows stuck in flight (crashed instance) go back to pending
  await ChannelAriChange.updateMany(
    { status: 'in_flight', updatedAt: { $lt: new Date(nowMs - STUCK_IN_FLIGHT_MS) } },
    { $set: { status: 'pending' }, $unset: { batchId: '' } },
  );

  const candidates = await ChannelAriChange.aggregate([
    { $match: { status: 'pending' } },
    {
      $group: {
        _id: '$tenantId',
        oldest: { $min: '$createdAt' },
        newest: { $max: '$createdAt' },
        newestAvailability: { $max: { $cond: [{ $eq: ['$kind', 'availability'] }, '$createdAt', null] } },
        structure: { $max: { $cond: [{ $eq: ['$kind', 'structure'] }, 1, 0] } },
      },
    },
    { $sort: { oldest: 1 } },
  ]);
  const due = candidates
    .map((c) => ({
      ...c,
      mode: c._id ? flushMode({
        oldestMs: new Date(c.oldest).getTime(),
        newestMs: new Date(c.newest).getTime(),
        newestAvailabilityMs: c.newestAvailability ? new Date(c.newestAvailability).getTime() : undefined,
        hasStructure: c.structure === 1,
      }, nowMs) : null,
    }))
    .filter((c) => c.mode !== null);

  const flushed: string[] = [];
  const work: Promise<void>[] = [];
  for (const c of due) {
    if (work.length >= MAX_PROPERTIES_PER_TICK) break;
    const leased = await ChannexProperty.findOneAndUpdate(
      {
        tenantId: c._id, environment, status: 'active', channexPropertyId: { $exists: true }, pushesPaused: { $ne: true },
        pausedUntil: { $lte: now() }, ariLeaseUntil: { $lte: now() },
      },
      { $set: { ariLeaseUntil: new Date(nowMs + LEASE_MS) } },
      { new: true },
    );
    if (!leased) continue;
    flushed.push(String(c._id));
    work.push(
      runInTenant(String(c._id), () => flushProperty(leased, { ...deps, mode: c.mode! }))
        .then(() => undefined)
        .catch((err) => console.error(`[Channex] ARI flush failed for tenant ${c._id}:`, errMessage(err)))
        .then(() => ChannexProperty.updateOne({ _id: leased._id }, { $set: { ariLeaseUntil: new Date(0) } }))
        .then(() => undefined),
    );
  }
  await Promise.all(work);
  return flushed;
}
