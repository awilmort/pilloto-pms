/**
 * Guest erasure for channel-manager data (CHANNEX_ARCHITECTURE.md §11.5; plan Phase 9.4).
 *
 * The booking inbox keeps each OTA revision as Pilloto's durable copy (Channex deletes bookings
 * 6 months after checkout), so it holds the guest's name, email, phone, address, room guests
 * and notes. Erasing a guest removes those from every revision of their bookings, keeping what
 * accounting and reconciliation need (OTA, codes, dates, rooms, amounts, masked guarantee), and
 * deletes the raw webhook deliveries of those bookings (they expire after 14 days anyway).
 *
 * Callers: DELETE /api/guests/:id (tenant scope) and a completed "deletion" privacy request
 * (platform, every tenant).
 */

import ChannexBookingRevision from '../../models/ChannexBookingRevision';
import ChannexWebhookEvent from '../../models/ChannexWebhookEvent';
import Reservation from '../../models/Reservation';
import { tenantLocalStorage } from '../../middleware/tenantContext';

/** Payload keys that identify the guest (top level) */
const GUEST_KEYS = ['customer', 'notes', 'arrival_hour', 'guarantee_holder'];
const ERASED = '[erased]';

/** The revision payload without the guest's personal data (pure). */
export function erasePayload(payload: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!payload || typeof payload !== 'object') return payload;
  const out: Record<string, any> = { ...payload };
  for (const k of GUEST_KEYS) if (k in out) out[k] = k === 'customer' ? { name: ERASED } : ERASED;
  if (Array.isArray(out.rooms)) {
    out.rooms = out.rooms.map((r: any) => (r && typeof r === 'object' ? { ...r, guests: [] } : r));
  }
  if (out.guarantee && typeof out.guarantee === 'object') {
    const { cardholder_name: _name, ...rest } = out.guarantee;
    out.guarantee = rest;
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ErasureInput {
  /** The guest's email: matches the revisions' `customer.mail` (any case) */
  email?: string;
  /** Pilloto reservations of the guest */
  reservationIds?: unknown[];
}

/**
 * Erase in the current scope (a tenant, or every tenant when called outside one).
 * Returns how many revisions were scrubbed and webhook deliveries deleted.
 */
export async function eraseChannelGuestData(input: ErasureInput, now: Date = new Date()): Promise<{ revisions: number; webhookEvents: number }> {
  const email = input.email?.trim();
  const or: Record<string, unknown>[] = [];
  if (email) or.push({ 'payload.customer.mail': { $regex: `^${escape(email)}$`, $options: 'i' } });
  const reservationIds = (input.reservationIds ?? []).filter(Boolean);
  if (reservationIds.length) {
    or.push({ reservationId: { $in: reservationIds } });
    const bookings = await Reservation.find({ _id: { $in: reservationIds }, 'channelSource.channexBookingId': { $exists: true } })
      .select('channelSource.channexBookingId').lean();
    const ids = bookings.map((b: any) => b.channelSource?.channexBookingId).filter(Boolean);
    if (ids.length) or.push({ channexBookingId: { $in: ids } });
  }
  if (!or.length) return { revisions: 0, webhookEvents: 0 };

  // A guest's booking: every revision of every booking one of their revisions belongs to
  const matched = await ChannexBookingRevision.find({ $or: or }).select('channexBookingId').lean();
  const bookingIds = [...new Set(matched.map((r) => r.channexBookingId))];
  if (!bookingIds.length) return { revisions: 0, webhookEvents: 0 };

  const rows = await ChannexBookingRevision.find({ channexBookingId: { $in: bookingIds } }).select('_id payload').lean();
  for (const r of rows) {
    await ChannexBookingRevision.updateOne({ _id: r._id }, { $set: { payload: erasePayload(r.payload as any), erasedAt: now } });
  }
  // Raw deliveries are platform-scoped documents
  const events = await tenantLocalStorage.run(null, () => ChannexWebhookEvent.deleteMany({ 'payload.payload.booking_id': { $in: bookingIds } }));
  return { revisions: rows.length, webhookEvents: events.deletedCount ?? 0 };
}
