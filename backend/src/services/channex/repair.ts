/**
 * Platform repair screen (CHANNEX_ARCHITECTURE.md §6.5, §9.3; plan Phase 9.3).
 *
 * Pilloto room types / rate plans side by side with the Channex objects of the tenant's
 * property (`GET /room_types/options`, `GET /rate_plans/options`), so a superadmin can fix a
 * mapping that automated sync cannot:
 *
 *   relink              point a Pilloto entity at an existing Channex object (same property,
 *                       same kind, a rate plan under its room type's Channex room type, not
 *                       linked to another entity), then resend that entity over the whole window.
 *   recreate            forget the link and let structural sync create a fresh Channex object
 *                       (the old one is deleted when Channex allows it).
 *   recreateRatePlans   after a capacity change (`remap_required`): new Channex rate plans with
 *                       the new occupancy options for every plan of the room type. Old plans
 *                       Channex refuses to delete (still mapped in an OTA) are closed with one
 *                       stop-sell call over the whole window, so the OTA stops selling them
 *                       at stale prices; the tenant then maps the new plans in each OTA.
 *
 * Runs in the tenant's scope (routes/platform.ts `withTenant`). Every resend goes through the
 * outbox (reason `manual:repair`), like every other push.
 */

import mongoose from 'mongoose';
import ChannelAriChange from '../../models/ChannelAriChange';
import ChannexEntityMap, { ChannexEntityKind } from '../../models/ChannexEntityMap';
import { IChannexProperty } from '../../models/ChannexProperty';
import ChannexSyncLog from '../../models/ChannexSyncLog';
import RatePlan from '../../models/RatePlan';
import RoomType from '../../models/RoomType';
import { raiseAlert, resolveAlerts } from './alerts.service';
import { ChannexClient, ChannexError } from './channexClient';
import { FULL_WINDOW } from './changeCapture';
import { ChannexEnvironment } from './config';
import { addDays, todayInTz } from './dates';
import { CHANNEX_STATE_LENGTH } from './provisioning';
import { occupancyOptionsFor, StructuralSyncReport, syncStructure } from './structuralSync';

type Property = Pick<IChannexProperty, '_id' | 'tenantId' | 'channexPropertyId' | 'currency' | 'environment' | 'timezone'>;

export interface ChannexOption {
  id: string;
  title: string;
  /** Rate plans: the Channex room type they belong to */
  roomTypeId?: string;
  occupancy?: number;
}

/** `/room_types/options` and `/rate_plans/options` items: JSON:API resources or plain objects. */
export function parseOptions(body: any): ChannexOption[] {
  const items: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return items.map((it) => {
    const a = it?.attributes ?? it ?? {};
    const id = String(a.id ?? it?.id ?? '');
    const roomTypeId = a.room_type_id ?? it?.relationships?.room_type?.data?.id;
    return {
      id, title: String(a.title ?? ''),
      ...(roomTypeId ? { roomTypeId: String(roomTypeId) } : {}),
      ...(Number.isFinite(Number(a.occupancy)) && a.occupancy !== undefined ? { occupancy: Number(a.occupancy) } : {}),
    };
  }).filter((o) => o.id);
}

export type RepairProblem = 'not_synced' | 'missing_in_channex' | 'remap_required' | 'error' | 'wrong_room_type';

export interface RepairRow {
  kind: ChannexEntityKind;
  localId: string;
  name: string;
  /** Rate plans: their room type */
  roomTypeId?: string;
  roomTypeName?: string;
  capacity?: number;
  channexId: string | null;
  channexTitle?: string;
  status: string;
  error?: string;
  problems: RepairProblem[];
}

export interface RepairView {
  rows: RepairRow[];
  channex: { roomTypes: ChannexOption[]; ratePlans: (ChannexOption & { occupancies: number[] })[] };
  /** Channex objects no Pilloto entity links to */
  unlinked: { roomTypes: ChannexOption[]; ratePlans: (ChannexOption & { occupancies: number[] })[] };
}

async function loadOptions(client: ChannexClient, channexPropertyId: string) {
  const params = { 'filter[property_id]': channexPropertyId };
  const [rt, rp] = await Promise.all([client.get('/room_types/options', params), client.get('/rate_plans/options', params)]);
  return { roomTypes: parseOptions(rt), ratePlans: parseOptions(rp) };
}

export async function loadRepairView(client: ChannexClient, property: Property): Promise<RepairView> {
  const environment = property.environment as ChannexEnvironment;
  const [channex, roomTypes, plans, maps] = await Promise.all([
    loadOptions(client, property.channexPropertyId!),
    RoomType.find({}).sort({ name: 1 }).select('_id name capacity isActive').lean(),
    RatePlan.find({}).sort({ name: 1 }).select('_id name roomTypeId isActive').lean(),
    ChannexEntityMap.find({ environment }).lean(),
  ]);
  const mapOf = (kind: ChannexEntityKind, id: unknown) => maps.find((m) => m.kind === kind && String(m.localId) === String(id));
  const rtById = new Map(roomTypes.map((r) => [String(r._id), r]));
  const rows: RepairRow[] = [];
  for (const rt of roomTypes) {
    const m = mapOf('room_type', rt._id);
    const opt = m ? channex.roomTypes.find((o) => o.id === m.channexId) : undefined;
    const problems: RepairProblem[] = [];
    if (!m) { if (rt.isActive) problems.push('not_synced'); } else if (!opt) problems.push('missing_in_channex');
    if (m?.lastError) problems.push('error');
    rows.push({ kind: 'room_type', localId: String(rt._id), name: rt.name, capacity: rt.capacity, channexId: m?.channexId ?? null, channexTitle: opt?.title, status: m?.status ?? 'not_synced', error: m?.lastError, problems });
  }
  for (const p of plans) {
    const m = mapOf('rate_plan', p._id);
    const rtMap = mapOf('room_type', p.roomTypeId);
    const opt = m ? channex.ratePlans.find((o) => o.id === m.channexId) : undefined;
    const problems: RepairProblem[] = [];
    if (!m) { if (p.isActive) problems.push('not_synced'); } else if (!opt) problems.push('missing_in_channex');
    if (m?.status === 'remap_required') problems.push('remap_required');
    if (opt?.roomTypeId && rtMap && opt.roomTypeId !== rtMap.channexId) problems.push('wrong_room_type');
    if (m?.lastError) problems.push('error');
    const rt = rtById.get(String(p.roomTypeId));
    rows.push({
      kind: 'rate_plan', localId: String(p._id), name: p.name, roomTypeId: String(p.roomTypeId), roomTypeName: rt?.name, capacity: rt?.capacity,
      channexId: m?.channexId ?? null, channexTitle: opt?.title, status: m?.status ?? 'not_synced', error: m?.lastError, problems,
    });
  }
  // Rate plan options come once per occupancy: one entry per id with all its occupancies
  const byId = new Map<string, ChannexOption & { occupancies: number[] }>();
  for (const { occupancy, ...o } of channex.ratePlans) {
    const entry = byId.get(o.id) ?? { ...o, occupancies: [] };
    if (occupancy !== undefined && !entry.occupancies.includes(occupancy)) entry.occupancies.push(occupancy);
    byId.set(o.id, entry);
  }
  const ratePlans = [...byId.values()].map((o) => ({ ...o, occupancies: o.occupancies.sort((a, b) => a - b) }));
  const linked = new Set(maps.map((m) => m.channexId));
  return {
    rows,
    channex: { roomTypes: channex.roomTypes, ratePlans },
    unlinked: { roomTypes: channex.roomTypes.filter((o) => !linked.has(o.id)), ratePlans: ratePlans.filter((o) => !linked.has(o.id)) },
  };
}

/** Resend one room type / rate plan over the whole window through the outbox. */
async function queueEntityResend(property: Property, rows: { roomTypeIds?: unknown[]; ratePlanIds?: unknown[] }): Promise<number> {
  const docs = [
    ...(rows.roomTypeIds ?? []).map((id) => ({ kind: 'availability' as const, roomTypeId: id })),
    ...(rows.ratePlanIds ?? []).map((id) => ({ kind: 'rates' as const, ratePlanId: id })),
  ].map((r) => ({ ...r, tenantId: property.tenantId, ...FULL_WINDOW, fields: ['*'], reason: 'manual:repair', sourceModel: 'repair', status: 'pending' as const }));
  if (docs.length) await ChannelAriChange.insertMany(docs);
  return docs.length;
}

export type RepairResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; reason: 'invalid' | 'not_found' | 'conflict' | 'channex_error'; message: string };

const isId = (v: unknown): v is string => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export async function relinkEntity(
  client: ChannexClient, property: Property, input: { kind?: unknown; localId?: unknown; channexId?: unknown },
): Promise<RepairResult<{ queued: number }>> {
  const { kind, localId, channexId } = input;
  if (kind !== 'room_type' && kind !== 'rate_plan') return { ok: false, reason: 'invalid', message: 'kind must be room_type or rate_plan.' };
  if (!isId(localId)) return { ok: false, reason: 'invalid', message: 'localId must be a Pilloto id.' };
  if (typeof channexId !== 'string' || !channexId.trim()) return { ok: false, reason: 'invalid', message: 'channexId is required.' };
  const environment = property.environment as ChannexEnvironment;

  const entity = kind === 'room_type'
    ? await RoomType.findById(localId).select('_id name capacity').lean()
    : await RatePlan.findById(localId).select('_id name roomTypeId').lean();
  if (!entity) return { ok: false, reason: 'not_found', message: `No such ${kind === 'room_type' ? 'room type' : 'rate plan'} in this tenant.` };

  let options;
  try { options = await loadOptions(client, property.channexPropertyId!); } catch (e) {
    if (e instanceof ChannexError) return { ok: false, reason: 'channex_error', message: e.message };
    throw e;
  }
  const opt = (kind === 'room_type' ? options.roomTypes : options.ratePlans).find((o) => o.id === channexId);
  if (!opt) return { ok: false, reason: 'invalid', message: `Channex ${kind === 'room_type' ? 'room type' : 'rate plan'} ${channexId} does not belong to this tenant's property.` };

  let capacity: number | undefined;
  if (kind === 'rate_plan') {
    const rtId = (entity as any).roomTypeId;
    const rtMap = await ChannexEntityMap.findOne({ environment, kind: 'room_type', localId: rtId }).lean();
    if (!rtMap) return { ok: false, reason: 'conflict', message: 'Link the rate plan\'s room type first.' };
    if (opt.roomTypeId && opt.roomTypeId !== rtMap.channexId) return { ok: false, reason: 'invalid', message: 'That Channex rate plan belongs to another Channex room type.' };
    capacity = (await RoomType.findById(rtId).select('capacity').lean())?.capacity;
  } else {
    capacity = (entity as any).capacity;
  }
  const taken = await ChannexEntityMap.findOne({ environment, channexId }).lean();
  if (taken && !(taken.kind === kind && String(taken.localId) === localId)) {
    return { ok: false, reason: 'conflict', message: 'That Channex object is already linked to another Pilloto entity; unlink or recreate that one first.' };
  }

  // Occupancy options of a Channex rate plan: one options row per occupancy
  const occupancies = kind === 'rate_plan'
    ? [...new Set(options.ratePlans.filter((o) => o.id === channexId && o.occupancy).map((o) => o.occupancy!))].sort((a, b) => a - b)
    : [];
  const snapshot = {
    title: opt.title,
    occupancyOptions: occupancies.length ? occupancies : occupancyOptionsFor(capacity ?? 1),
  };
  const remap = kind === 'rate_plan' && occupancies.length > 0 && capacity !== undefined && occupancies[occupancies.length - 1] !== capacity;
  await ChannexEntityMap.findOneAndUpdate(
    { environment, kind, localId },
    {
      $set: { channexId, channexPropertyId: property.channexPropertyId, syncedSnapshot: snapshot, status: remap ? 'remap_required' : 'active', lastSyncedAt: new Date() },
      $unset: { lastError: '' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  // Title/children fee/count of rooms brought in line by the next structural pass; values resent now
  await ChannelAriChange.create({ tenantId: property.tenantId, kind: 'structure', ...FULL_WINDOW, fields: ['*'], reason: 'manual:repair', sourceModel: 'repair', status: 'pending' });
  const queued = await queueEntityResend(property, kind === 'room_type' ? { roomTypeIds: [localId] } : { ratePlanIds: [localId] });
  return { ok: true, queued };
}

/** Forget the link of one entity and let structural sync create a fresh Channex object. */
export async function recreateEntity(
  client: ChannexClient, property: Property, input: { kind?: unknown; localId?: unknown },
): Promise<RepairResult<{ sync: StructuralSyncReport; queued: number; oldDeleted: boolean }>> {
  const { kind, localId } = input;
  if (kind !== 'room_type' && kind !== 'rate_plan') return { ok: false, reason: 'invalid', message: 'kind must be room_type or rate_plan.' };
  if (!isId(localId)) return { ok: false, reason: 'invalid', message: 'localId must be a Pilloto id.' };
  if (kind === 'room_type') return { ok: false, reason: 'invalid', message: 'Recreating a room type would orphan its rate plans; re-link it, or recreate its rate plans.' };
  const environment = property.environment as ChannexEnvironment;
  const m = await ChannexEntityMap.findOne({ environment, kind, localId });
  let oldDeleted = false;
  if (m) {
    oldDeleted = await tryDelete(client, `/rate_plans/${m.channexId}`);
    if (!oldDeleted) await closeOldRatePlans(client, property, [m.channexId]);
    await m.deleteOne();
  }
  const sync = await syncStructure({ client, property: property as IChannexProperty });
  const queued = await queueEntityResend(property, { ratePlanIds: [localId] });
  return { ok: true, sync, queued, oldDeleted };
}

async function tryDelete(client: ChannexClient, path: string): Promise<boolean> {
  try { await client.delete(path); return true; } catch (e) {
    if (e instanceof ChannexError && e.status === 404) return true;
    if (e instanceof ChannexError) return false;
    throw e;
  }
}

/** One stop-sell call over the whole window for Channex rate plans Pilloto no longer links. */
async function closeOldRatePlans(client: ChannexClient, property: Property, channexRatePlanIds: string[]) {
  if (!channexRatePlanIds.length || !property.timezone) return;
  const dateFrom = todayInTz(property.timezone);
  const dateTo = addDays(dateFrom, CHANNEX_STATE_LENGTH - 1);
  const values = channexRatePlanIds.map((id) => ({ property_id: property.channexPropertyId, rate_plan_id: id, date_from: dateFrom, date_to: dateTo, stop_sell: true }));
  const started = Date.now();
  const log = { tenantId: property.tenantId, trigger: 'manual' as const, kind: 'restrictions' as const, valuesCount: values.length, dateFrom, dateTo };
  try {
    const res = await client.post('/restrictions', { values });
    const taskIds = (Array.isArray(res?.data) ? res.data : []).map((t: any) => String(t?.id)).filter(Boolean);
    await ChannexSyncLog.create({ ...log, taskIds, warnings: res?.meta?.warnings ?? [], httpStatus: 200, durationMs: Date.now() - started });
  } catch (e) {
    await ChannexSyncLog.create({ ...log, taskIds: [], warnings: [], httpStatus: e instanceof ChannexError ? e.status : undefined, durationMs: Date.now() - started, error: errText(e) });
    throw e;
  }
}

/** "Recreate rate plans for this room type" after a capacity change (`remap_required`). */
export async function recreateRatePlansForRoomType(
  client: ChannexClient, property: Property, roomTypeId: unknown,
): Promise<RepairResult<{ recreated: number; closed: number; sync: StructuralSyncReport; queued: number }>> {
  if (!isId(roomTypeId)) return { ok: false, reason: 'invalid', message: 'roomTypeId must be a Pilloto id.' };
  const environment = property.environment as ChannexEnvironment;
  const rt = await RoomType.findById(roomTypeId).select('_id name').lean();
  if (!rt) return { ok: false, reason: 'not_found', message: 'No such room type in this tenant.' };
  const plans = await RatePlan.find({ roomTypeId }).select('_id').lean();
  const maps = await ChannexEntityMap.find({ environment, kind: 'rate_plan', localId: { $in: plans.map((p) => p._id) } });

  const kept: string[] = [];
  for (const m of maps) if (!(await tryDelete(client, `/rate_plans/${m.channexId}`))) kept.push(m.channexId);
  try {
    await closeOldRatePlans(client, property, kept);
  } catch (e) {
    if (e instanceof ChannexError) return { ok: false, reason: 'channex_error', message: `The old rate plans could not be closed, nothing was recreated: ${e.message}` };
    throw e;
  }
  await ChannexEntityMap.deleteMany({ _id: { $in: maps.map((m) => m._id) } });
  const sync = await syncStructure({ client, property: property as IChannexProperty });
  const queued = await queueEntityResend(property, { ratePlanIds: plans.map((p) => p._id) });

  await resolveAlerts({ types: ['remap_required'], dedupeKey: `room_type:${roomTypeId}` }, { notes: 'Rate plans recreated by Pilloto support.' });
  await raiseAlert({
    type: 'remap_required', dedupeKey: `room_type:${roomTypeId}:map`, title: `“${rt.name}”: map the recreated rates in each channel`,
    details: { roomTypeId: String(roomTypeId), name: rt.name, kind: 'room_type', phase: 'map_in_channels', closedRatePlans: kept },
  });
  return { ok: true, recreated: maps.length, closed: kept.length, sync, queued };
}
