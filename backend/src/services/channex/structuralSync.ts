/**
 * Structural sync — Pilloto room types and rate plans → Channex room types and rate plans
 * (CHANNEX_ARCHITECTURE.md §4.2, §4.3, §6.5; plan Phase 5.2).
 *
 * Automated mapping: Pilloto creates and maintains the Channex objects; tenants only map OTA
 * rooms/rates to them. `ChannexEntityMap` links the two sides, and its `syncedSnapshot` is
 * what was last sent, so a run only calls Channex for what changed — re-running is a no-op.
 *
 *   room type    title, occ_adults = capacity, occ_children 0, count_of_rooms = active rooms
 *   rate plan    per_person, options 1..capacity (primary = capacity), children_fee = first
 *                child tier. Sell mode and the set of options are immutable in Channex, so a
 *                capacity change flags the plan `remap_required` instead of editing it.
 *   not offered  inactive, or "sell on channels" off (`isOnChannels`): try DELETE; Channex refuses
 *                when a channel maps it → keep it (the ARI worker sends it as stop sell / 0
 *                availability) and raise `unmap_before_delete`.
 *
 * Runs in the current tenant context. Never throws for one entity's failure: the entity's map
 * records the error and the run reports it, so the other entities still sync.
 */

import mongoose from 'mongoose';
import RoomType from '../../models/RoomType';
import Room from '../../models/Room';
import RatePlan from '../../models/RatePlan';
import ChannexEntityMap, { IChannexEntityMap } from '../../models/ChannexEntityMap';
import { ChannelAlertType } from '../../models/ChannelAlert';
import { raiseAlert as raise, resolveAlerts } from './alerts.service';
import { IChannexProperty } from '../../models/ChannexProperty';
import { ChannexClient, ChannexError, unwrapOne } from './channexClient';
import { assertCurrentEnvironment, ChannexEnvironment } from './config';

type Id = unknown;
type MapDoc = mongoose.HydratedDocument<IChannexEntityMap>;

/** Channex limits for hotels (architecture §2): beyond these the tenant cannot be provisioned. */
export const CHANNEX_MAX_ROOM_TYPES = 20;
export const CHANNEX_MAX_RATE_PLANS = 200;

// ─── Pure payload builders ───────────────────────────────────────────────────

export interface RoomTypeLike { _id: Id; name: string; capacity: number; isActive: boolean; sellOnChannels?: boolean }
export interface RatePlanLike {
  _id: Id;
  name: string;
  roomTypeId: Id;
  isActive: boolean;
  sellOnChannels?: boolean;
  occupancyTiers?: { guestType: 'adult' | 'child'; guestNumber: number; price: number }[];
}

/** Offered on OTAs: active and "sell on channels" not turned off (unset = on). */
export const isOnChannels = (e: { isActive: boolean; sellOnChannels?: boolean }): boolean => e.isActive && e.sellOnChannels !== false;

/** Occupancy options of a rate plan: 1..capacity. */
export const occupancyOptionsFor = (capacity: number): number[] =>
  Array.from({ length: Math.max(1, Math.floor(capacity)) }, (_, i) => i + 1);

/** `children_fee` (rate-plan level): the price of the first child tier, as a decimal string. */
export function childrenFeeFor(plan: Pick<RatePlanLike, 'occupancyTiers'>): number {
  const first = (plan.occupancyTiers ?? [])
    .filter((t) => t.guestType === 'child')
    .sort((a, b) => a.guestNumber - b.guestNumber)[0];
  return Math.max(0, Math.round((first?.price ?? 0) * 100) / 100);
}

const money = (n: number) => n.toFixed(2);

/** What a Channex room type should look like for a Pilloto room type. */
export function desiredRoomType(rt: RoomTypeLike, activeRooms: number) {
  const capacity = Math.max(1, Math.floor(rt.capacity));
  return {
    title: rt.name.trim().slice(0, 255),
    // Channex needs at least one room; availability pushes 0 when none is sellable
    countOfRooms: Math.max(1, activeRooms),
    capacity,
  };
}

export function roomTypeBody(rt: RoomTypeLike, activeRooms: number, channexPropertyId?: string) {
  const d = desiredRoomType(rt, activeRooms);
  return {
    room_type: {
      ...(channexPropertyId ? { property_id: channexPropertyId } : {}),
      title: d.title,
      count_of_rooms: d.countOfRooms,
      occ_adults: d.capacity,
      occ_children: 0,
      occ_infants: 0,
      default_occupancy: d.capacity,
      room_kind: 'room',
      ...(channexPropertyId ? { meta: { pillotoRoomTypeId: String(rt._id) } } : {}),
    },
  };
}

export function ratePlanBody(plan: RatePlanLike, capacity: number, ctx: { channexPropertyId: string; channexRoomTypeId: string; currency: string }) {
  const options = occupancyOptionsFor(capacity);
  return {
    rate_plan: {
      title: plan.name.trim().slice(0, 255),
      property_id: ctx.channexPropertyId,
      room_type_id: ctx.channexRoomTypeId,
      currency: ctx.currency,
      sell_mode: 'per_person',
      rate_mode: 'manual',
      children_fee: money(childrenFeeFor(plan)),
      infant_fee: '0.00',
      options: options.map((occupancy) => ({ occupancy, is_primary: occupancy === capacity, rate: 0 })),
      meta: { pillotoRatePlanId: String(plan._id) },
    },
  };
}

/** Only the fields that change after creation (options and sell mode are immutable). */
export function ratePlanUpdateBody(plan: RatePlanLike, ctx: { channexPropertyId: string; channexRoomTypeId: string; currency: string }, capacity: number) {
  const { title, children_fee } = ratePlanBody(plan, capacity, ctx).rate_plan;
  return { rate_plan: { title, children_fee } };
}

export interface RoomTypeSnapshot { title?: string; occupancyOptions?: number[]; countOfRooms?: number; childrenFee?: number }

export type RoomTypeChange = 'none' | 'update' | 'capacity_increase' | 'capacity_decrease';

/** What a room type needs, comparing the last-sent snapshot with the desired state. */
export function diffRoomType(snapshot: RoomTypeSnapshot | undefined, rt: RoomTypeLike, activeRooms: number): RoomTypeChange {
  const d = desiredRoomType(rt, activeRooms);
  const oldCapacity = snapshot?.occupancyOptions?.length ?? 0;
  if (oldCapacity && d.capacity > oldCapacity) return 'capacity_increase';
  if (oldCapacity && d.capacity < oldCapacity) return 'capacity_decrease';
  return snapshot?.title === d.title && snapshot?.countOfRooms === d.countOfRooms ? 'none' : 'update';
}

// ─── Run report ──────────────────────────────────────────────────────────────

export type EntityAction =
  | 'created' | 'updated' | 'unchanged' | 'deleted' | 'skipped_no_rooms' | 'skipped_no_room_type'
  | 'remap_required' | 'kept_mapped' | 'failed';

export interface EntityResult {
  kind: 'room_type' | 'rate_plan';
  localId: string;
  name: string;
  action: EntityAction;
  channexId?: string;
  error?: string;
}

export interface StructuralSyncReport {
  results: EntityResult[];
  /** Number of Channex write calls made */
  calls: number;
  ok: boolean;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

const raiseAlert = (type: ChannelAlertType, dedupeKey: string, title: string, details: Record<string, unknown>) =>
  raise({ type, dedupeKey, title, details });

const resolveAlert = (type: ChannelAlertType, dedupeKey: string) => resolveAlerts({ types: [type], dedupeKey });

// ─── The sync ────────────────────────────────────────────────────────────────

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const isNotFound = (e: unknown) => e instanceof ChannexError && e.status === 404;

export interface StructuralSyncInput {
  client: ChannexClient;
  /** Provisioned property (must carry `channexPropertyId`, `currency`, current environment) */
  property: Pick<IChannexProperty, 'channexPropertyId' | 'currency' | 'environment'>;
}

export async function syncStructure({ client, property }: StructuralSyncInput): Promise<StructuralSyncReport> {
  assertCurrentEnvironment(property, client.config);
  if (!property.channexPropertyId || !property.currency) throw new Error('Property is not provisioned in Channex yet.');
  const environment = property.environment as ChannexEnvironment;
  const channexPropertyId = property.channexPropertyId;
  const currency = property.currency;
  const report: StructuralSyncReport = { results: [], calls: 0, ok: true };
  const write = async <T>(fn: () => Promise<T>): Promise<T> => { report.calls++; return fn(); };
  const record = (r: EntityResult) => { report.results.push(r); if (r.action === 'failed') report.ok = false; };

  const [roomTypes, plans, rooms, maps] = await Promise.all([
    RoomType.find({}).sort({ name: 1 }).lean() as unknown as Promise<(RoomTypeLike & { _id: Id })[]>,
    RatePlan.find({}).sort({ name: 1 }).lean() as unknown as Promise<RatePlanLike[]>,
    Room.find({ status: 'active' }).select('roomTypeId').lean(),
    ChannexEntityMap.find({ environment }) as unknown as Promise<MapDoc[]>,
  ]);
  const activeRooms = new Map<string, number>();
  for (const r of rooms) if (r.roomTypeId) activeRooms.set(String(r.roomTypeId), (activeRooms.get(String(r.roomTypeId)) ?? 0) + 1);
  const mapOf = (kind: 'room_type' | 'rate_plan', id: Id) => maps.find((m) => m.kind === kind && String(m.localId) === String(id));
  const dropMap = async (m: MapDoc) => { await m.deleteOne(); maps.splice(maps.indexOf(m), 1); };
  const saveMap = async (m: MapDoc | undefined, kind: 'room_type' | 'rate_plan', localId: Id, channexId: string, snapshot: IChannexEntityMap['syncedSnapshot'], status: IChannexEntityMap['status'] = 'active'): Promise<MapDoc> => {
    if (m) {
      m.channexId = channexId; m.syncedSnapshot = snapshot; m.status = status; m.lastSyncedAt = new Date(); m.lastError = undefined;
      await m.save();
      return m;
    }
    const created = await ChannexEntityMap.create({ environment, kind, localId, channexId, channexPropertyId, syncedSnapshot: snapshot, status, lastSyncedAt: new Date() });
    maps.push(created);
    return created;
  };
  const failMap = async (m: MapDoc | undefined, error: string) => {
    if (m) { m.lastError = error; await m.save(); }
  };

  // Rate plans whose Channex object disappears with their room type
  const forgetPlansOf = async (roomTypeId: Id) => {
    for (const p of plans.filter((x) => String(x.roomTypeId) === String(roomTypeId))) {
      const pm = mapOf('rate_plan', p._id);
      if (pm) await dropMap(pm);
    }
  };

  // ── Room types ──
  for (const rt of roomTypes) {
    const id = String(rt._id);
    const n = activeRooms.get(id) ?? 0;
    let m = mapOf('room_type', rt._id);
    const base = { kind: 'room_type' as const, localId: id, name: rt.name };

    try {
      // Not offered on channels any more: remove from Channex when nothing maps it
      if (!isOnChannels(rt)) {
        if (!m) { record({ ...base, action: 'unchanged' }); continue; }
        try {
          await write(() => client.delete(`/room_types/${m!.channexId}`));
          await forgetPlansOf(rt._id);
          await dropMap(m);
          await resolveAlert('unmap_before_delete', `room_type:${id}`);
          record({ ...base, action: 'deleted' });
        } catch (e) {
          if (isNotFound(e)) { await forgetPlansOf(rt._id); await dropMap(m); record({ ...base, action: 'deleted' }); continue; }
          await failMap(m, errMessage(e));
          await raiseAlert('unmap_before_delete', `room_type:${id}`, `“${rt.name}” is mapped to a channel and was kept in the channel manager`, { kind: 'room_type', localId: id, name: rt.name });
          record({ ...base, action: 'kept_mapped', channexId: m.channexId, error: errMessage(e) });
        }
        continue;
      }

      if (!m && n === 0) { record({ ...base, action: 'skipped_no_rooms' }); continue; }

      if (!m) {
        const res = await write(() => client.post('/room_types', roomTypeBody(rt, n, channexPropertyId)));
        const channexId = unwrapOne(res).id;
        const d = desiredRoomType(rt, n);
        await saveMap(undefined, 'room_type', rt._id, channexId, { title: d.title, occupancyOptions: occupancyOptionsFor(d.capacity), countOfRooms: d.countOfRooms });
        record({ ...base, action: 'created', channexId });
        continue;
      }

      const change = diffRoomType(m.syncedSnapshot, rt, n);
      if (change === 'none') { record({ ...base, action: 'unchanged', channexId: m.channexId }); continue; }

      const d = desiredRoomType(rt, n);
      try {
        await write(() => client.put(`/room_types/${m!.channexId}`, roomTypeBody(rt, n)));
      } catch (e) {
        // A capacity decrease is refused while a channel maps the removed occupancy
        if (change === 'capacity_decrease' && !isNotFound(e)) {
          await failMap(m, errMessage(e));
          await flagRemap(rt, id, m, plans, mapOf, 'Capacity was reduced; the channel manager kept the old occupancy options.');
          record({ ...base, action: 'remap_required', channexId: m.channexId, error: errMessage(e) });
          continue;
        }
        throw e;
      }
      const oldSnapshot = m.syncedSnapshot;
      m = await saveMap(m, 'room_type', rt._id, m.channexId, { title: d.title, occupancyOptions: oldSnapshot?.occupancyOptions ?? occupancyOptionsFor(d.capacity), countOfRooms: d.countOfRooms });
      if (change === 'capacity_increase' || change === 'capacity_decrease') {
        // Existing rate plans keep their old options: remapping them in the OTAs is the tenant's step
        m.syncedSnapshot = { ...m.syncedSnapshot, occupancyOptions: occupancyOptionsFor(d.capacity) };
        await m.save();
        await flagRemap(rt, id, m, plans, mapOf, 'Capacity changed; the rate plans of this room type must be recreated.');
        record({ ...base, action: 'remap_required', channexId: m.channexId });
      } else {
        record({ ...base, action: 'updated', channexId: m.channexId });
      }
    } catch (e) {
      if (isNotFound(e) && m) {
        // Removed in Channex behind our back: forget it, the next run recreates it
        await forgetPlansOf(rt._id);
        await dropMap(m);
      } else {
        await failMap(m, errMessage(e));
      }
      record({ ...base, action: 'failed', error: errMessage(e) });
    }
  }

  // ── Rate plans ──
  for (const plan of plans) {
    const id = String(plan._id);
    const rt = roomTypes.find((r) => String(r._id) === String(plan.roomTypeId));
    let m = mapOf('rate_plan', plan._id);
    const base = { kind: 'rate_plan' as const, localId: id, name: plan.name };
    const rtMap = rt ? mapOf('room_type', rt._id) : undefined;

    try {
      if (!isOnChannels(plan) || !rt || !isOnChannels(rt)) {
        if (!m) { record({ ...base, action: 'unchanged' }); continue; }
        try {
          await write(() => client.delete(`/rate_plans/${m!.channexId}`));
          await dropMap(m);
          await resolveAlert('unmap_before_delete', `rate_plan:${id}`);
          record({ ...base, action: 'deleted' });
        } catch (e) {
          if (isNotFound(e)) { await dropMap(m); record({ ...base, action: 'deleted' }); continue; }
          await failMap(m, errMessage(e));
          await raiseAlert('unmap_before_delete', `rate_plan:${id}`, `“${plan.name}” is mapped to a channel and was kept in the channel manager`, { kind: 'rate_plan', localId: id, name: plan.name });
          record({ ...base, action: 'kept_mapped', channexId: m.channexId, error: errMessage(e) });
        }
        continue;
      }
      if (!rtMap) { record({ ...base, action: 'skipped_no_room_type' }); continue; }

      const capacity = Math.max(1, Math.floor(rt.capacity));
      const ctx = { channexPropertyId, channexRoomTypeId: rtMap.channexId, currency };

      if (!m) {
        const res = await write(() => client.post('/rate_plans', ratePlanBody(plan, capacity, ctx)));
        const channexId = unwrapOne(res).id;
        await saveMap(undefined, 'rate_plan', plan._id, channexId, { title: plan.name.trim().slice(0, 255), occupancyOptions: occupancyOptionsFor(capacity), childrenFee: childrenFeeFor(plan) });
        record({ ...base, action: 'created', channexId });
        continue;
      }

      const snap = m.syncedSnapshot;
      const title = plan.name.trim().slice(0, 255);
      const fee = childrenFeeFor(plan);
      if (m.status === 'remap_required') { record({ ...base, action: 'remap_required', channexId: m.channexId }); continue; }
      if (snap?.title === title && snap?.childrenFee === fee) { record({ ...base, action: 'unchanged', channexId: m.channexId }); continue; }
      await write(() => client.put(`/rate_plans/${m!.channexId}`, ratePlanUpdateBody(plan, ctx, capacity)));
      await saveMap(m, 'rate_plan', plan._id, m.channexId, { ...snap, title, childrenFee: fee });
      record({ ...base, action: 'updated', channexId: m.channexId });
    } catch (e) {
      if (isNotFound(e) && m) await dropMap(m);
      else await failMap(m, errMessage(e));
      record({ ...base, action: 'failed', error: errMessage(e) });
    }
  }

  return report;
}

/** Mark the room type's rate plans `remap_required` and raise the alert. */
async function flagRemap(
  rt: RoomTypeLike & { name: string },
  id: string,
  _roomTypeMap: MapDoc,
  plans: { _id: Id; roomTypeId: Id }[],
  mapOf: (kind: 'room_type' | 'rate_plan', id: Id) => MapDoc | undefined,
  reason: string,
) {
  for (const p of plans.filter((x) => String(x.roomTypeId) === id)) {
    const pm = mapOf('rate_plan', p._id);
    if (pm && pm.status !== 'remap_required') { pm.status = 'remap_required'; await pm.save(); }
  }
  await raiseAlert('remap_required', `room_type:${id}`, `“${rt.name}” changed capacity: its rates must be remapped`, { roomTypeId: id, name: rt.name, reason });
}

// ─── Mappings view ───────────────────────────────────────────────────────────

export interface MappingRow {
  kind: 'room_type' | 'rate_plan';
  localId: string;
  name: string;
  /** For rate plans: the room type name */
  parentName?: string;
  channexId: string | null;
  status: IChannexEntityMap['status'] | 'not_synced';
  lastSyncedAt?: Date;
  error?: string;
}

/** Every Pilloto room type and rate plan with its Channex counterpart (if any). */
export async function listMappings(environment: ChannexEnvironment): Promise<MappingRow[]> {
  const [roomTypes, plans, maps] = await Promise.all([
    RoomType.find({}).sort({ name: 1 }).select('_id name').lean(),
    RatePlan.find({}).sort({ name: 1 }).select('_id name roomTypeId').lean(),
    ChannexEntityMap.find({ environment }).lean(),
  ]);
  const find = (kind: string, id: Id) => maps.find((m) => m.kind === kind && String(m.localId) === String(id));
  const rtName = new Map(roomTypes.map((r) => [String(r._id), r.name]));
  const row = (kind: MappingRow['kind'], id: Id, name: string, parentName?: string): MappingRow => {
    const m = find(kind, id);
    return {
      kind, localId: String(id), name, ...(parentName ? { parentName } : {}),
      channexId: m?.channexId ?? null, status: m?.status ?? 'not_synced', lastSyncedAt: m?.lastSyncedAt, error: m?.lastError,
    };
  };
  return [
    ...roomTypes.map((r) => row('room_type', r._id, r.name)),
    ...plans.map((p) => row('rate_plan', p._id, p.name, rtName.get(String(p.roomTypeId)))),
  ];
}

/** Why a hard delete of a Pilloto room type / rate plan is refused (null = allowed). */
export async function hardDeleteBlockReason(kind: 'room_type' | 'rate_plan', localId: Id, environment: ChannexEnvironment): Promise<string | null> {
  const mapped = await ChannexEntityMap.exists({ environment, kind, localId: new mongoose.Types.ObjectId(String(localId)) });
  if (!mapped) return null;
  return kind === 'room_type'
    ? 'This room type is synced with the channel manager. Deactivate it instead: it is removed from the channel manager when no channel uses it.'
    : 'This rate plan is synced with the channel manager. Deactivate it instead: it is removed from the channel manager when no channel uses it.';
}
