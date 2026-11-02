/**
 * Change capture — writes the ARI outbox (CHANNEX_ARCHITECTURE.md §6.2; plan Phase 6.1).
 *
 * A Mongoose plugin attached to every model whose writes change availability, rates or
 * restrictions. Document `save` and query hooks
 * (`findOneAndUpdate`, `updateOne`, `updateMany`, deletes, replaces, `insertMany`) load the
 * old values before the write and the new values after it, derive `ChannelAriChange` rows
 * with *superset* semantics (a range may be over-reported, never under-reported), and insert
 * them for tenants that enabled the channel manager.
 *
 * Capture never throws into the caller: failures are logged, and the nightly full sync (§6.4)
 * is the reconciliation backstop.
 *
 * `deriveRows` is pure (no database); the plugin only loads snapshots and lookups around it.
 */

import mongoose, { Schema } from 'mongoose';
import { getTenantId } from '../../middleware/tenantContext';
import type { ChannelAriChangeKind } from '../../models/ChannelAriChange';
import { getChannexConfig } from './config';
import { addDays, DateRange, nightsRange, toChannexDate } from './dates';

export const CAPTURE_MODELS = ['Reservation', 'Room', 'RoomBlock', 'RoomType', 'RatePlan', 'PricingRule', 'RestrictionRule'] as const;
export type CaptureModel = typeof CAPTURE_MODELS[number];

/** "Everything the channel can hold": the worker clamps it to today..today+state_length-1. */
export const FULL_WINDOW: DateRange = { dateFrom: '2000-01-01', dateTo: '2099-12-31' };

/** Same set the InventoryService treats as occupying rooms. */
const BLOCKING_STATUSES = ['pending', 'confirmed', 'checked-in'];

export interface AriRow {
  kind: ChannelAriChangeKind;
  roomTypeId?: string;
  ratePlanId?: string;
  dateFrom?: string;
  dateTo?: string;
  fields: string[];
  reason: string;
}

export interface CaptureLookups {
  /** Room id → room type id */
  roomTypeOfRoom: Record<string, string | undefined>;
  /** Every rate plan of the tenant (for restriction scopes and room type flips) */
  ratePlans: { id: string; roomTypeId: string }[];
}

type Snap = Record<string, any> | null | undefined;

const id = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
const day = (v: unknown): string => toChannexDate(v instanceof Date ? v : new Date(v as any));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Restriction rule field → Channex restriction field
const RESTRICTION_FIELDS: [string, string][] = [
  ['minStayArrival', 'min_stay_arrival'],
  ['maxStay', 'max_stay'],
  ['closedToArrival', 'closed_to_arrival'],
  ['closedToDeparture', 'closed_to_departure'],
  ['stopSell', 'stop_sell'],
];

function dedupe(rows: AriRow[]): AriRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = JSON.stringify([r.kind, r.roomTypeId, r.ratePlanId, r.dateFrom, r.dateTo, r.fields]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Per-model derivation ────────────────────────────────────────────────────

interface Span { roomTypeId: string; dateFrom: string; dateTo: string; quantity?: number }

/** Room-type nights a reservation occupies (empty when it does not block). */
function reservationSpans(r: Snap, lookups: CaptureLookups): Span[] {
  if (!r || r.type !== 'room' || !BLOCKING_STATUSES.includes(r.status)) return [];
  const spans: Span[] = [];
  const whole = r.checkInDate && r.checkOutDate ? nightsRange(day(r.checkInDate), day(r.checkOutDate)) : null;

  for (const item of r.items ?? []) {
    if (item?.kind !== 'room' || !id(item.roomTypeId)) continue;
    const from = item.checkIn ?? r.checkInDate;
    const to = item.checkOut ?? r.checkOutDate;
    const range = from && to ? nightsRange(day(from), day(to)) : null;
    if (range) spans.push({ roomTypeId: id(item.roomTypeId)!, ...range, quantity: item.quantity });
  }
  if (whole) {
    const assigned = [r.room, ...(r.rooms ?? [])].map(id).filter((x): x is string => Boolean(x));
    for (const roomId of assigned) {
      const roomTypeId = lookups.roomTypeOfRoom[roomId];
      if (roomTypeId) spans.push({ roomTypeId, ...whole });
    }
  }
  return spans;
}

function reservationRows(before: Snap, after: Snap, lookups: CaptureLookups, reason: string): AriRow[] {
  const b = reservationSpans(before, lookups);
  const a = reservationSpans(after, lookups);
  if (before && after && sameJson(b, a)) return [];
  return [...b, ...a].map((s) => ({
    kind: 'availability' as const, roomTypeId: s.roomTypeId, dateFrom: s.dateFrom, dateTo: s.dateTo, fields: ['*'], reason,
  }));
}

function roomRows(before: Snap, after: Snap, reason: string): AriRow[] {
  const typeOf = (r: Snap) => (r && r.status === 'active' ? id(r.roomTypeId) : undefined);
  const rawType = (r: Snap) => id(r?.roomTypeId);
  const changed = !before || !after
    || before.status !== after.status || rawType(before) !== rawType(after);
  if (!changed) return [];
  const types = new Set([typeOf(before), typeOf(after), rawType(before), rawType(after)].filter((x): x is string => Boolean(x)));
  return [...types].flatMap((roomTypeId): AriRow[] => [
    { kind: 'availability', roomTypeId, ...FULL_WINDOW, fields: ['*'], reason },
    { kind: 'structure', roomTypeId, fields: ['*'], reason },
  ]);
}

function roomBlockRows(before: Snap, after: Snap, lookups: CaptureLookups, reason: string): AriRow[] {
  const rowOf = (b: Snap): AriRow[] => {
    if (!b) return [];
    const roomTypeId = lookups.roomTypeOfRoom[id(b.roomId) ?? ''];
    const range = b.startDate && b.endDate ? nightsRange(day(b.startDate), day(b.endDate)) : null;
    return roomTypeId && range ? [{ kind: 'availability', roomTypeId, ...range, fields: ['*'], reason }] : [];
  };
  return [...rowOf(before), ...rowOf(after)];
}

function roomTypeRows(before: Snap, after: Snap, lookups: CaptureLookups, reason: string): AriRow[] {
  const snap = after ?? before;
  const roomTypeId = id(snap?._id);
  if (!snap || !roomTypeId) return [];
  const offeredChanged = before && after
    && (before.isActive !== after.isActive || (before.sellOnChannels !== false) !== (after.sellOnChannels !== false));
  const changed = !before || !after || before.name !== after.name || before.capacity !== after.capacity || offeredChanged;
  if (!changed) return [];
  const rows: AriRow[] = [{ kind: 'structure', roomTypeId, fields: ['*'], reason }];
  if (offeredChanged) {
    rows.push({ kind: 'availability', roomTypeId, ...FULL_WINDOW, fields: ['*'], reason });
    for (const p of lookups.ratePlans.filter((p) => p.roomTypeId === roomTypeId)) {
      rows.push({ kind: 'rates', ratePlanId: p.id, ...FULL_WINDOW, fields: ['rate', 'stop_sell'], reason });
    }
  }
  return rows;
}

function ratePlanRows(before: Snap, after: Snap, reason: string): AriRow[] {
  const snap = after ?? before;
  const ratePlanId = id(snap?._id);
  if (!snap || !ratePlanId) return [];
  if (!after) return [{ kind: 'structure', ratePlanId, fields: ['*'], reason }];
  if (!before) {
    return [
      { kind: 'structure', ratePlanId, fields: ['*'], reason },
      { kind: 'rates', ratePlanId, ...FULL_WINDOW, fields: ['*'], reason },
    ];
  }
  const priceChanged = before.basePrice !== after.basePrice || !sameJson(before.occupancyTiers, after.occupancyTiers);
  // Offered on channels = active and "sell on channels"; either flip opens or closes it there
  const activeChanged = before.isActive !== after.isActive || (before.sellOnChannels !== false) !== (after.sellOnChannels !== false);
  const nameChanged = before.name !== after.name;
  const typeChanged = id(before.roomTypeId) !== id(after.roomTypeId);

  const rows: AriRow[] = [];
  if (nameChanged || typeChanged || activeChanged || priceChanged) rows.push({ kind: 'structure', ratePlanId, fields: ['*'], reason });
  if (typeChanged) rows.push({ kind: 'rates', ratePlanId, ...FULL_WINDOW, fields: ['*'], reason });
  else if (activeChanged) rows.push({ kind: 'rates', ratePlanId, ...FULL_WINDOW, fields: ['rate', 'stop_sell'], reason });
  else if (priceChanged) rows.push({ kind: 'rates', ratePlanId, ...FULL_WINDOW, fields: ['rate'], reason });
  return rows;
}

/** Validity window of a pricing rule; open-ended rules cover the full window. A day of slack each side (server-local rule days). */
function pricingRuleWindow(r: Snap): DateRange {
  if (!r?.dateStart || !r?.dateEnd) return FULL_WINDOW;
  return { dateFrom: addDays(day(r.dateStart), -1), dateTo: addDays(day(r.dateEnd), 1) };
}

function pricingRuleRows(before: Snap, after: Snap, reason: string): AriRow[] {
  const promo = (r: Snap) => Boolean(r) && r!.ruleTarget === 'promotional';
  if (!promo(before) && !promo(after)) return [];
  if (before && after && sameJson(stripTimes(before), stripTimes(after))) return [];
  return [before, after].filter((r): r is Record<string, any> => promo(r) && Boolean(id(r!.ratePlanId))).map((r) => ({
    kind: 'rates' as const, ratePlanId: id(r.ratePlanId), ...pricingRuleWindow(r), fields: ['rate'], reason,
  }));
}

function stripTimes(r: Record<string, any>) {
  const { updatedAt, createdAt, __v, ...rest } = r;
  return rest;
}

function restrictionPlanIds(r: Snap, lookups: CaptureLookups): string[] {
  if (!r) return [];
  if (r.scope === 'rate_plans') return (r.ratePlanIds ?? []).map(id).filter(Boolean) as string[];
  if (r.scope === 'room_types') {
    const types = new Set((r.roomTypeIds ?? []).map(id));
    return lookups.ratePlans.filter((p) => types.has(p.roomTypeId)).map((p) => p.id);
  }
  return lookups.ratePlans.map((p) => p.id);
}

function restrictionFields(r: Snap): string[] {
  if (!r) return [];
  return RESTRICTION_FIELDS.filter(([local]) => r[local] !== undefined && r[local] !== null).map(([, channex]) => channex);
}

function restrictionRuleRows(before: Snap, after: Snap, lookups: CaptureLookups, reason: string): AriRow[] {
  if (before && after && sameJson(stripTimes(before), stripTimes(after))) return [];
  const fields = [...new Set([...restrictionFields(before), ...restrictionFields(after)])];
  const plans = [...new Set([...restrictionPlanIds(before, lookups), ...restrictionPlanIds(after, lookups)])];
  const ranges = [before, after]
    .filter((r): r is Record<string, any> => Boolean(r?.dateStart && r?.dateEnd))
    .map((r) => ({ dateFrom: String(r.dateStart), dateTo: String(r.dateEnd) }));
  return plans.flatMap((ratePlanId) => ranges.map((range): AriRow => ({
    kind: 'rates', ratePlanId, ...range, fields: fields.length ? fields : ['*'], reason,
  })));
}

/** Outbox rows for one document going from `before` (null = created) to `after` (null = deleted). */
export function deriveRows(model: CaptureModel, before: Snap, after: Snap, lookups: CaptureLookups): AriRow[] {
  const reason = `${model}.${!before ? 'create' : !after ? 'delete' : 'update'}`;
  let rows: AriRow[];
  switch (model) {
    case 'Reservation': rows = reservationRows(before, after, lookups, reason); break;
    case 'Room': rows = roomRows(before, after, reason); break;
    case 'RoomBlock': rows = roomBlockRows(before, after, lookups, reason); break;
    case 'RoomType': rows = roomTypeRows(before, after, lookups, reason); break;
    case 'RatePlan': rows = ratePlanRows(before, after, reason); break;
    case 'PricingRule': rows = pricingRuleRows(before, after, reason); break;
    case 'RestrictionRule': rows = restrictionRuleRows(before, after, lookups, reason); break;
    default: rows = [];
  }
  return dedupe(rows);
}

// ─── Enabled-tenant cache ────────────────────────────────────────────────────

const ENABLED_TTL_MS = 30_000;
const enabledCache = new Map<string, { enabled: boolean; at: number }>();

/** Forget the cached "channel manager enabled" flag (one tenant, or all when omitted). */
export function invalidateChannelManagerCache(tenantId?: unknown) {
  if (tenantId) enabledCache.delete(String(tenantId)); else enabledCache.clear();
}

async function isEnabled(tenantId: string): Promise<boolean> {
  const hit = enabledCache.get(tenantId);
  if (hit && Date.now() - hit.at < ENABLED_TTL_MS) return hit.enabled;
  const settings = await mongoose.model('AppSettings').findOne({ tenantId }).select('channelManager.enabled').lean() as any;
  const enabled = Boolean(settings?.channelManager?.enabled);
  enabledCache.set(tenantId, { enabled, at: Date.now() });
  return enabled;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const debugEnabled = () =>
  process.env.CHANNEX_LOG_OUTBOX === 'true'
  || (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test' && getChannexConfig().environment === 'staging');

async function loadLookups(model: CaptureModel, tenantId: string, snaps: Snap[]): Promise<CaptureLookups> {
  const lookups: CaptureLookups = { roomTypeOfRoom: {}, ratePlans: [] };
  const roomIds = new Set<string>();
  for (const s of snaps) {
    if (!s) continue;
    if (model === 'Reservation') [s.room, ...(s.rooms ?? [])].map(id).forEach((x) => x && roomIds.add(x));
    if (model === 'RoomBlock') { const r = id(s.roomId); if (r) roomIds.add(r); }
  }
  if (roomIds.size) {
    const rooms = await mongoose.model('Room').find({ _id: { $in: [...roomIds] }, tenantId }).select('roomTypeId').lean() as any[];
    for (const r of rooms) lookups.roomTypeOfRoom[String(r._id)] = id(r.roomTypeId);
  }
  if (model === 'RestrictionRule' || model === 'RoomType') {
    const plans = await mongoose.model('RatePlan').find({ tenantId }).select('roomTypeId').lean() as any[];
    lookups.ratePlans = plans.map((p) => ({ id: String(p._id), roomTypeId: String(p.roomTypeId) }));
  }
  return lookups;
}

export interface CapturePair { before: Snap; after: Snap }

// ─── Outbox listeners ────────────────────────────────────────────────────────

export type OutboxListener = (tenantId: string, kinds: Set<AriRow['kind']>) => void;
const outboxListeners = new Set<OutboxListener>();

/** Called after rows are written (the ARI worker uses it to push availability at once). Returns an unsubscribe. */
export function onOutboxWrite(listener: OutboxListener): () => void {
  outboxListeners.add(listener);
  return () => { outboxListeners.delete(listener); };
}

function notifyOutboxWrite(tenantId: string, rows: AriRow[]) {
  const kinds = new Set(rows.map((r) => r.kind));
  for (const listener of outboxListeners) {
    try { listener(tenantId, kinds); } catch (err) { console.warn('[Channex] outbox listener failed:', (err as Error).message); }
  }
}

/** Derive and store outbox rows for the given before/after pairs. Never throws. Returns the rows written. */
export async function captureChanges(model: CaptureModel, tenantId: string | undefined, pairs: CapturePair[]): Promise<AriRow[]> {
  try {
    if (!tenantId || pairs.length === 0 || !(await isEnabled(tenantId))) return [];
    const lookups = await loadLookups(model, tenantId, pairs.flatMap((p) => [p.before, p.after]));
    const written: AriRow[] = [];
    const docs: Record<string, unknown>[] = [];
    for (const { before, after } of pairs) {
      const sourceId = (after ?? before)?._id;
      for (const row of deriveRows(model, before, after, lookups)) {
        written.push(row);
        docs.push({ ...row, tenantId, sourceModel: model, sourceId, status: 'pending' });
      }
    }
    if (docs.length) {
      await mongoose.model('ChannelAriChange').insertMany(docs);
      notifyOutboxWrite(tenantId, written);
      if (debugEnabled()) {
        console.log(`[Channex outbox] +${docs.length} from ${model}:`, written.map((r) =>
          `${r.kind}${r.roomTypeId ? ` rt=${r.roomTypeId}` : ''}${r.ratePlanId ? ` rp=${r.ratePlanId}` : ''} ${r.dateFrom ?? ''}..${r.dateTo ?? ''} [${r.fields.join(',')}]`).join(' | '));
      }
    }
    return written;
  } catch (err) {
    console.error(`[Channex] change capture failed for ${model} (the nightly full sync will reconcile):`, (err as Error).message);
    return [];
  }
}

// ─── The plugin ──────────────────────────────────────────────────────────────

const QUERY_UPDATE_OPS = ['findOneAndUpdate', 'updateOne', 'updateMany', 'findOneAndReplace', 'replaceOne'] as const;
const QUERY_DELETE_OPS = ['findOneAndDelete', 'deleteOne', 'deleteMany'] as const;

function toPlain(doc: any): Record<string, any> {
  return doc && typeof doc.toObject === 'function' ? doc.toObject({ depopulate: true, virtuals: false }) : doc;
}

export function changeCapturePlugin(schema: Schema, options: { model: CaptureModel }): void {
  const model = options.model;
  const tenantOf = (doc: any): string | undefined => id(doc?.get?.('tenantId') ?? doc?.tenantId) ?? getTenantId();

  /** Pairs from query hooks, grouped by the tenant stored on the documents themselves. */
  const captureGrouped = async (pairs: CapturePair[]) => {
    const byTenant = new Map<string | undefined, CapturePair[]>();
    for (const p of pairs) {
      const t = id((p.after ?? p.before)?.tenantId) ?? getTenantId();
      byTenant.set(t, [...(byTenant.get(t) ?? []), p]);
    }
    for (const [tenantId, group] of byTenant) await captureChanges(model, tenantId, group);
  };

  // ── Documents ──
  schema.pre('save', async function () {
    const doc = this as any;
    try {
      doc.$locals.ariBefore = null;
      const tenantId = tenantOf(doc);
      if (!doc.isNew && tenantId && await isEnabled(tenantId)) {
        doc.$locals.ariBefore = await (doc.constructor as mongoose.Model<any>).findOne({ _id: doc._id, tenantId }).lean();
      }
    } catch (err) {
      console.error(`[Channex] change capture (pre-save ${model}):`, (err as Error).message);
    }
  });

  schema.post('save', async function (doc: any) {
    await captureChanges(model, tenantOf(doc), [{ before: doc.$locals?.ariBefore ?? null, after: toPlain(doc) }]);
  });

  // Document deleteOne() runs the query hooks below too, which capture it

  schema.post('insertMany', async function (docs: any[]) {
    for (const [tenantId, group] of groupByTenant(docs)) {
      await captureChanges(model, tenantId, group.map((d) => ({ before: null, after: toPlain(d) })));
    }
  });

  // ── Queries ──
  const loadBefore = async function (this: any) {
    try {
      const filter = this.getFilter();
      const tenantId = id(filter?.tenantId) ?? getTenantId();
      this._ariTenantId = tenantId;
      this._ariBefore = null;
      // Without a tenant in scope (platform requests, scripts) load anyway: the documents carry their tenant
      if (!tenantId || await isEnabled(tenantId)) {
        this._ariBefore = await this.model.find(filter).lean();
      }
    } catch (err) {
      console.error(`[Channex] change capture (pre ${this.op} ${model}):`, (err as Error).message);
    }
  };

  for (const op of [...QUERY_UPDATE_OPS, ...QUERY_DELETE_OPS]) {
    schema.pre(op as any, { document: false, query: true } as any, loadBefore);
  }

  for (const op of QUERY_UPDATE_OPS) {
    schema.post(op as any, { document: false, query: true } as any, async function (this: any, res: any) {
      try {
        const before: any[] | null = this._ariBefore;
        if (!before) return;
        const ids = before.map((d) => d._id);
        const upsertedId = res?.upsertedId ?? (before.length === 0 && res?._id ? res._id : undefined);
        if (upsertedId) ids.push(upsertedId);
        const afterDocs: any[] = ids.length ? await this.model.find({ _id: { $in: ids } }).lean() : [];
        const beforeById = new Map(before.map((d) => [String(d._id), d]));
        await captureGrouped(afterDocs.map((after) => ({ before: beforeById.get(String(after._id)) ?? null, after })));
      } catch (err) {
        console.error(`[Channex] change capture (post ${this.op} ${model}):`, (err as Error).message);
      }
    });
  }

  for (const op of QUERY_DELETE_OPS) {
    schema.post(op as any, { document: false, query: true } as any, async function (this: any) {
      const before: any[] | null = this._ariBefore;
      if (before?.length) await captureGrouped(before.map((b) => ({ before: b, after: null })));
    });
  }
}

function groupByTenant(docs: any[]): Map<string | undefined, any[]> {
  const out = new Map<string | undefined, any[]>();
  for (const d of docs ?? []) {
    const tenantId = id(d?.tenantId) ?? getTenantId();
    out.set(tenantId, [...(out.get(tenantId) ?? []), d]);
  }
  return out;
}
