/**
 * audit-room-reservations.ts
 *
 * Read-only report for InventoryService (CHANNEX_ARCHITECTURE.md §6.1, plan Phase 3.1).
 * Lists, per tenant, future room reservations that availability cannot count correctly:
 *   1. Neither assigned rooms nor room items — cannot be attributed to a room type, so
 *      they reduce no room type's availability.
 *   2. Room items referencing a room type that is inactive or no longer exists.
 *
 * "Future" = blocking status (pending / confirmed / checked-in) and check-out today or later.
 * Writes nothing. Fixing the findings (assign a room, or correct the room type) is manual.
 *
 * Usage:
 *   MONGODB_URI=<uri> npm run audit:room-reservations
 */

import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export interface AuditReservation {
  _id: unknown;
  tenantId?: unknown;
  reservationCode?: string;
  status: string;
  checkInDate: Date;
  checkOutDate?: Date;
  room?: unknown;
  rooms?: unknown[];
  items?: { kind: string; roomTypeId?: unknown }[];
}

export type AuditFinding =
  | { kind: 'unattributable'; reservation: AuditReservation }
  | { kind: 'inactive_room_type'; reservation: AuditReservation; roomTypeIds: string[] };

/** Classify reservations given the set of active room type ids (pure). */
export function auditReservations(reservations: AuditReservation[], activeRoomTypeIds: Set<string>): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const r of reservations) {
    const hasRooms = Boolean(r.room) || (r.rooms ?? []).length > 0;
    const roomItems = (r.items ?? []).filter((i) => i.kind === 'room');
    if (!hasRooms && roomItems.length === 0) {
      findings.push({ kind: 'unattributable', reservation: r });
      continue;
    }
    const bad = [...new Set(roomItems
      .map((i) => (i.roomTypeId ? String(i.roomTypeId) : null))
      .filter((id): id is string => !!id && !activeRoomTypeIds.has(id)))];
    if (bad.length) findings.push({ kind: 'inactive_room_type', reservation: r, roomTypeIds: bad });
  }
  return findings;
}

const fmt = (d?: Date) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;
  console.log(`✅ Connected to MongoDB (${db.databaseName}) — read-only audit`);

  const todayMidnight = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const tenants = await db.collection('tenants').find({}, { projection: { name: 1, slug: 1 } }).toArray();
  const tenantName = new Map(tenants.map((t) => [String(t._id), `${t.name} [${t.slug}]`]));

  const roomTypes = await db.collection('roomtypes').find({}, { projection: { tenantId: 1, isActive: 1, name: 1 } }).toArray();
  const activeByTenant = new Map<string, Set<string>>();
  const typeName = new Map<string, string>();
  for (const rt of roomTypes) {
    typeName.set(String(rt._id), `${rt.name}${rt.isActive ? '' : ' (inactive)'}`);
    if (!rt.isActive) continue;
    const key = String(rt.tenantId);
    if (!activeByTenant.has(key)) activeByTenant.set(key, new Set());
    activeByTenant.get(key)!.add(String(rt._id));
  }

  const reservations = await db.collection('reservations').find({
    type: 'room',
    status: { $in: ['pending', 'confirmed', 'checked-in'] },
    $or: [{ checkOutDate: { $gte: todayMidnight } }, { checkOutDate: null, checkInDate: { $gte: todayMidnight } }],
  }, {
    projection: { tenantId: 1, reservationCode: 1, status: 1, checkInDate: 1, checkOutDate: 1, room: 1, rooms: 1, 'items.kind': 1, 'items.roomTypeId': 1 },
  }).toArray() as unknown as AuditReservation[];

  const byTenant = new Map<string, AuditReservation[]>();
  for (const r of reservations) {
    const key = String(r.tenantId);
    if (!byTenant.has(key)) byTenant.set(key, []);
    byTenant.get(key)!.push(r);
  }

  console.log(`\n📋 Future room reservations checked: ${reservations.length}`);
  let total = 0;
  for (const [tenantId, list] of byTenant) {
    const findings = auditReservations(list, activeByTenant.get(tenantId) ?? new Set());
    if (findings.length === 0) continue;
    total += findings.length;
    console.log(`\n🏨 ${tenantName.get(tenantId) ?? tenantId}`);
    for (const f of findings) {
      const r = f.reservation;
      const stay = `${r.reservationCode ?? r._id} (${r.status}, ${fmt(r.checkInDate)} → ${fmt(r.checkOutDate)})`;
      if (f.kind === 'unattributable') {
        console.log(`  ⚠️  ${stay}: no assigned room and no room items — assign a room so availability counts it`);
      } else {
        const names = f.roomTypeIds.map((id) => typeName.get(id) ?? `${id} (deleted)`).join(', ');
        console.log(`  ⚠️  ${stay}: room items reference ${names} — reactivate the type or correct the booking`);
      }
    }
  }
  console.log(total === 0 ? '\n✅ No findings.' : `\n🔍 Findings: ${total}`);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Audit failed:', err);
    process.exit(1);
  });
}
