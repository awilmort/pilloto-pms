/**
 * Reservation history: writes milestone events (models/ReservationEvent.ts) and reads the
 * merged timeline.
 *
 * Write side — callers record semantic actions (check-in, room move, cancellation…) with the
 * actor from the request. Edits carry a field diff over a short whitelist of tracked fields
 * (`snapshotReservation`), and an edit that changes none of them writes nothing. Recording
 * never throws into the caller: history must not break the operation it describes.
 *
 * Read side — `loadReservationHistory` merges the logged events with facts other collections
 * already hold, so they are never stored twice:
 *  - charges and payments (amount, time, `createdBy`) become "charge added" / "payment recorded";
 *  - for reservations created before history existed, creation, room assignment, check-in and
 *    check-out are inferred from the reservation's own timestamps (`inferred: true`).
 */
import mongoose from 'mongoose';
import ReservationEvent, { IEventActor, IFieldChange, ReservationEventAction } from '../models/ReservationEvent';
import Room from '../models/Room';
import User from '../models/User';
import Folio from '../models/Folio';
import Charge from '../models/Charge';
import Payment from '../models/Payment';
import { BOOKING_ENGINE_TOKEN_RE } from './reservationRecords';

type Id = mongoose.Types.ObjectId | string;

export const SYSTEM_ACTOR: IEventActor = { kind: 'system' };
export const GUEST_ACTOR: IEventActor = { kind: 'guest' };
export const channelActor = (otaName?: string): IEventActor => ({ kind: 'channel', ...(otaName ? { name: otaName } : {}) });

const userName = (u: any): string | undefined =>
  [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || undefined;

/** The authenticated staff user of a request, or the guest when there is none. */
export function actorFromRequest(req: { user?: any }): IEventActor {
  const u = req.user;
  const userId = u?._id ?? u?.id;
  if (!userId) return GUEST_ACTOR;
  return { kind: 'user', userId, name: userName(u) };
}

// ─── Tracked fields ──────────────────────────────────────────────────────────

export type ReservationSnapshot = Record<string, string | number | string[] | undefined>;

const day = (d: unknown) => (d ? new Date(d as any).toISOString().slice(0, 10) : undefined);
const money = (n: unknown) => (n === undefined || n === null ? undefined : Math.round(Number(n) * 100) / 100);

/**
 * The fields a history diff looks at. Derived and bookkeeping fields (totals of payments,
 * nights, timestamps, channel revision ids) are left out on purpose: they change as a
 * consequence of a milestone, never as one.
 */
export function snapshotReservation(r: any): ReservationSnapshot {
  const rooms = [...new Set([r.room, ...(r.rooms ?? [])].filter(Boolean).map(String))].sort();
  const guestName = [r.guestName?.firstName, r.guestName?.lastName].filter(Boolean).join(' ');
  const requests = r.specialRequests ? String(r.specialRequests) : '';
  return {
    status: r.status,
    checkInDate: day(r.checkInDate),
    checkOutDate: day(r.checkOutDate),
    adults: r.guestDetails?.adults,
    children: r.guestDetails?.children,
    infants: r.guestDetails?.infants,
    rooms,
    estimatedTotal: money(r.estimatedTotal),
    guestName: guestName || undefined,
    email: r.contactInfo?.email || undefined,
    phone: r.contactInfo?.phone || undefined,
    specialRequests: requests ? (requests.length > 200 ? `${requests.slice(0, 197)}...` : requests) : undefined,
    corporatePriceStatus: r.corporatePriceStatus,
  };
}

export function diffSnapshots(before: ReservationSnapshot, after: ReservationSnapshot): IFieldChange[] {
  const changes: IFieldChange[] = [];
  for (const field of Object.keys(after)) {
    const from = before[field];
    const to = after[field];
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) changes.push({ field, from, to });
  }
  return changes;
}

// ─── Write ───────────────────────────────────────────────────────────────────

/** Actions that only describe a change: nothing is recorded when the diff comes back empty. */
const DIFF_ONLY: ReservationEventAction[] = ['updated', 'rooms_changed', 'moved', 'channel_modified', 'payment_updated'];

/** Room ids in a `rooms` change → room names, so the row reads well after rooms are renamed or removed. */
async function nameRooms(changes: IFieldChange[]): Promise<IFieldChange[]> {
  const roomChange = changes.find((c) => c.field === 'rooms');
  if (!roomChange) return changes;
  const ids = [...(roomChange.from as string[] ?? []), ...(roomChange.to as string[] ?? [])];
  const rooms = await Room.find({ _id: { $in: ids } }).select('name').lean();
  const names = new Map(rooms.map((r: any) => [String(r._id), r.name as string]));
  const label = (list: unknown) => (list as string[] | undefined)?.map((id) => names.get(id) ?? id);
  return changes.map((c) => (c === roomChange ? { field: 'rooms', from: label(c.from), to: label(c.to) } : c));
}

export async function recordReservationEvent(
  reservationId: Id,
  action: ReservationEventAction,
  opts: { actor: IEventActor; changes?: IFieldChange[]; ref?: { kind: 'charge' | 'payment'; id: Id }; amount?: number; note?: string },
): Promise<void> {
  try {
    if (DIFF_ONLY.includes(action) && opts.changes && opts.changes.length === 0) return;
    const changes = opts.changes?.length ? await nameRooms(opts.changes) : undefined;
    await ReservationEvent.create({
      reservationId,
      action,
      actor: opts.actor,
      ...(changes ? { changes } : {}),
      ...(opts.ref ? { ref: opts.ref } : {}),
      ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
      ...(opts.note ? { note: opts.note.slice(0, 300) } : {}),
    });
  } catch (err) {
    console.error(`[history] failed to record ${action} for reservation ${reservationId}:`, err);
  }
}

// ─── Read ────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  at: Date;
  action: ReservationEventAction | 'charge_added' | 'payment_recorded';
  actor: PublicActor;
  changes?: IFieldChange[];
  note?: string;
  amount?: number;
  method?: string;
  /** Reconstructed from data stored before history tracking existed */
  inferred?: boolean;
}

/** How a reservation created before history tracking came in. */
function creationActor(r: any, users: Map<string, string>): IEventActor {
  if (r.channelSource?.provider) return channelActor(r.channelSource.otaName);
  if (r.confirmationToken && BOOKING_ENGINE_TOKEN_RE.test(r.confirmationToken)) return GUEST_ACTOR;
  const userId = r.user?._id ?? r.user;
  if (userId) return { kind: 'user', name: users.get(String(userId)) };
  return GUEST_ACTOR;
}

type PublicActor = { kind: IEventActor['kind']; name?: string };
const publicActor = (a: IEventActor): PublicActor => ({ kind: a.kind, ...(a.name ? { name: a.name } : {}) });

/** The reservation's full history, newest first. `reservation` is the stored (lean or hydrated) document. */
export async function loadReservationHistory(reservation: any): Promise<HistoryEntry[]> {
  const reservationId = reservation._id;
  const folio = await Folio.findOne({ reservationId }).select('_id').lean();
  const [events, charges, payments] = await Promise.all([
    ReservationEvent.find({ reservationId }).sort({ createdAt: -1 }).lean(),
    folio ? Charge.find({ folioId: folio._id }).select('description amount type createdBy createdAt').lean() : [],
    folio ? Payment.find({ folioId: folio._id }).select('amount method paymentStage createdBy createdAt').lean() : [],
  ]);

  // Names for actors that are only stored as ids (charges, payments, legacy creators)
  const userIds = new Set<string>();
  for (const c of charges as any[]) if (c.createdBy) userIds.add(String(c.createdBy));
  for (const p of payments as any[]) if (p.createdBy) userIds.add(String(p.createdBy));
  if (reservation.user) userIds.add(String(reservation.user?._id ?? reservation.user));
  if (reservation.assignedBy) userIds.add(String(reservation.assignedBy?._id ?? reservation.assignedBy));
  const users = new Map<string, string>();
  if (userIds.size) {
    const docs = await User.find({ _id: { $in: [...userIds] } }).select('firstName lastName email').lean();
    for (const u of docs) users.set(String(u._id), userName(u) ?? '');
  }
  const byUser = (id: unknown): PublicActor => {
    if (!id) return { kind: 'system' };
    const name = users.get(String(id));
    return { kind: 'user', ...(name ? { name } : {}) };
  };

  const entries: HistoryEntry[] = events.map((e: any) => ({
    id: String(e._id),
    at: e.createdAt,
    action: e.action,
    actor: publicActor(e.actor),
    ...(e.changes?.length ? { changes: e.changes } : {}),
    ...(e.amount !== undefined ? { amount: e.amount } : {}),
    ...(e.note ? { note: e.note } : {}),
  }));

  for (const c of charges as any[]) {
    entries.push({
      id: String(c._id), at: c.createdAt, action: 'charge_added',
      // Night-audit charges (`auto_rule`) and base charges posted before `createdBy` existed have no user
      actor: byUser(c.createdBy), note: c.description, amount: c.amount,
    });
  }
  for (const p of payments as any[]) {
    entries.push({
      id: String(p._id), at: p.createdAt, action: 'payment_recorded',
      actor: byUser(p.createdBy), amount: p.amount, method: p.method,
      ...(p.paymentStage === 'deposit' ? { note: 'deposit' } : {}),
    });
  }

  // Milestones of reservations created before history tracking, from their own timestamps
  const logged = new Set(events.map((e: any) => e.action));
  if (!logged.has('created')) {
    const r = reservation;
    const creator = creationActor(r, users);
    entries.push({ id: 'inferred-created', at: r.createdAt, action: 'created', actor: publicActor(creator), inferred: true });
    if (r.assignedAt && !logged.has('rooms_changed') && !logged.has('moved')) {
      entries.push({
        id: 'inferred-rooms', at: r.assignedAt, action: 'rooms_changed', inferred: true,
        actor: r.assignedBy ? byUser(r.assignedBy?._id ?? r.assignedBy) : publicActor(creator),
      });
    }
  }
  if (reservation.actualCheckInAt && !logged.has('checked_in')) {
    entries.push({ id: 'inferred-checkin', at: reservation.actualCheckInAt, action: 'checked_in', actor: { kind: 'system' }, inferred: true });
  }
  if (reservation.actualCheckOutAt && !logged.has('checked_out')) {
    entries.push({ id: 'inferred-checkout', at: reservation.actualCheckOutAt, action: 'checked_out', actor: { kind: 'system' }, inferred: true });
  }

  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
