/**
 * PUT /api/reservations/:id/move (booking calendar drag and drop): shifts a stay keeping its
 * nights and/or swaps one room, validated as one change — room free on the new nights, room
 * blocks, booked room type / capacity, past dates, checked-in stays and permissions.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

let mockPerms: string[] = [];
jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: '64b000000000000000000001', role: 'staff', email: 'staff@hotel.test' }; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
    userHasPermission: async (_user: any, _app: any, perms: string[]) => perms.some((p) => mockPerms.includes(p)),
  };
});
jest.mock('../utils/email', () => ({
  sendReservationConfirmationEmail: jest.fn(), sendInvoiceEmail: jest.fn(), sendCorporatePriceRequestEmail: jest.fn(),
}));

// eslint-disable-next-line import/first
import reservationRoutes from '../routes/reservations';
// eslint-disable-next-line import/first
import { tenantLocalStorage } from '../middleware/tenantContext';
// eslint-disable-next-line import/first
import { connectTestDb, dropTestDb } from './helpers/testDb';
// eslint-disable-next-line import/first
import Reservation from '../models/Reservation';
// eslint-disable-next-line import/first
import Room from '../models/Room';
// eslint-disable-next-line import/first
import RoomType from '../models/RoomType';
// eslint-disable-next-line import/first
import RoomBlock from '../models/RoomBlock';

describe('reservation move (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const twin = new mongoose.Types.ObjectId();
  const family = new mongoose.Types.ObjectId();
  const [t1, t2, t3, f1] = [0, 1, 2, 3].map(() => new mongoose.Types.ObjectId());
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
  app.use('/api/reservations', reservationRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  const day = (offset: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + offset, 12)).toISOString().slice(0, 10);
  };
  const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);
  let seq = 0;
  const makeRes = async (extra: Record<string, unknown>) => {
    const { insertedId } = await Reservation.collection.insertOne({
      tenantId, type: 'room', status: 'confirmed', reservationCode: `MV${++seq}`, guests: 2,
      guestDetails: { adults: 2, children: 0, infants: 0 }, estimatedTotal: 300, totalPayments: 0, contactInfo: { email: 'guest@example.com' },
      checkInDate: noon(day(10)), checkOutDate: noon(day(13)), totalNights: 3,
      items: [{ kind: 'room', roomTypeId: twin, adults: 2, children: 0, quantity: 1, unitPrice: 100, subtotal: 300, total: 300 }],
      ...extra,
    });
    return String(insertedId);
  };
  const move = (id: string, body: Record<string, unknown>) => request(app).put(`/api/reservations/${id}/move`).send(body);

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_resmove');
    if (!ready) { console.warn('Mongo unreachable — skipping reservation move DB tests'); return; }
    await RoomType.collection.insertMany([
      { _id: twin, tenantId, name: 'Twin', capacity: 2, isActive: true },
      { _id: family, tenantId, name: 'Family', capacity: 4, isActive: true },
    ]);
    await Room.collection.insertMany([
      { _id: t1, tenantId, name: 'T1', roomTypeId: twin, status: 'active' },
      { _id: t2, tenantId, name: 'T2', roomTypeId: twin, status: 'active' },
      { _id: t3, tenantId, name: 'T3', roomTypeId: twin, status: 'inactive' },
      { _id: f1, tenantId, name: 'F1', roomTypeId: family, status: 'active' },
    ]);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    mockPerms = ['admin.reservations', 'admin.reservations.assignRoom'];
    if (ready) { await Reservation.collection.deleteMany({}); await RoomBlock.collection.deleteMany({}); }
  });

  itDb('moves dates and room together, keeping the number of nights', async () => {
    const id = await makeRes({ room: t1, rooms: [t1] });
    // T2 is taken on the old dates but free on the new ones: validated as one change
    await makeRes({ room: t2, rooms: [t2], checkInDate: noon(day(10)), checkOutDate: noon(day(12)) });
    const r = await move(id, { checkInDate: day(20), fromRoomId: String(t1), toRoomId: String(t2) });
    expect(r.status).toBe(200);
    const saved: any = await Reservation.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
    expect(saved.checkInDate.toISOString().slice(0, 10)).toBe(day(20));
    expect(saved.checkOutDate.toISOString().slice(0, 10)).toBe(day(23));
    expect(saved.totalNights).toBe(3);
    expect(saved.rooms.map(String)).toEqual([String(t2)]);
    expect(String(saved.room)).toBe(String(t2));
  });

  itDb('rejects a room taken by another stay on the new nights', async () => {
    const id = await makeRes({ room: t1, rooms: [t1] });
    await makeRes({ room: t2, rooms: [t2], reservationCode: 'TAKEN', checkInDate: noon(day(12)), checkOutDate: noon(day(14)) });
    const r = await move(id, { fromRoomId: String(t1), toRoomId: String(t2) });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/TAKEN/);
  });

  itDb('rejects a date shift onto a night the same room is taken', async () => {
    const id = await makeRes({ room: t1, rooms: [t1] });
    await makeRes({ room: t1, rooms: [t1], checkInDate: noon(day(14)), checkOutDate: noon(day(15)) });
    expect((await move(id, { checkInDate: day(12) })).status).toBe(400);
    expect((await move(id, { checkInDate: day(15) })).status).toBe(200);
  });

  itDb('rejects an out-of-service room, an inactive room and a too-small room type', async () => {
    await RoomBlock.collection.insertOne({ tenantId, roomId: t2, startDate: noon(day(11)), endDate: noon(day(12)), reason: 'maintenance' });
    const twinStay = await makeRes({ room: t1, rooms: [t1] });
    expect((await move(twinStay, { fromRoomId: String(t1), toRoomId: String(t2) })).body.message).toMatch(/out of service/);
    expect((await move(twinStay, { fromRoomId: String(t1), toRoomId: String(t3) })).body.message).toMatch(/inactive/);
    await Reservation.collection.deleteMany({});
    const familyStay = await makeRes({ room: f1, rooms: [f1], items: [{ kind: 'room', roomTypeId: family, adults: 4, children: 0, quantity: 1, unitPrice: 100, subtotal: 300, total: 300 }], guests: 4 });
    expect((await move(familyStay, { fromRoomId: String(f1), toRoomId: String(t1) })).body.message).toMatch(/holds 2 guests/);
  });

  itDb('rejects a check-in in the past and date changes on a checked-in stay', async () => {
    const id = await makeRes({ room: t1, rooms: [t1] });
    expect((await move(id, { checkInDate: day(-2) })).body.message).toMatch(/past/);
    const inHouse = await makeRes({ room: t1, rooms: [t1], status: 'checked-in', actualCheckInAt: new Date(), checkInDate: noon(day(0)), checkOutDate: noon(day(2)) });
    expect((await move(inHouse, { checkInDate: day(1) })).body.message).toMatch(/checked in/);
    expect((await move(inHouse, { fromRoomId: String(t1), toRoomId: String(t2) })).status).toBe(200);
  });

  itDb('rejects cancelled / completed stays', async () => {
    const id = await makeRes({ room: t1, rooms: [t1], status: 'cancelled' });
    expect((await move(id, { checkInDate: day(20) })).status).toBe(400);
  });

  itDb('assigning from the unassigned lane adds the room and confirms a pending stay', async () => {
    const id = await makeRes({ status: 'pending' });
    const r = await move(id, { fromRoomId: null, toRoomId: String(t1), checkInDate: day(11) });
    expect(r.status).toBe(200);
    const saved: any = await Reservation.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
    expect(saved.rooms.map(String)).toEqual([String(t1)]);
    expect(saved.status).toBe('confirmed');
    expect(saved.checkInDate.toISOString().slice(0, 10)).toBe(day(11));
  });

  itDb('needs admin.reservations for date changes and assignRoom for room changes', async () => {
    const id = await makeRes({ room: t1, rooms: [t1] });
    mockPerms = ['admin.reservations.assignRoom'];
    expect((await move(id, { checkInDate: day(20) })).status).toBe(403);
    expect((await move(id, { fromRoomId: String(t1), toRoomId: String(t2) })).status).toBe(200);
    mockPerms = ['admin.reservations'];
    expect((await move(id, { fromRoomId: String(t2), toRoomId: String(t1) })).status).toBe(403);
    expect((await move(id, { checkInDate: day(20) })).status).toBe(200);
  });

  itDb('rejects a room that is not on the reservation and an empty move', async () => {
    const id = await makeRes({ room: t1, rooms: [t1] });
    expect((await move(id, { fromRoomId: String(t2), toRoomId: String(f1) })).status).toBe(400);
    expect((await move(id, { fromRoomId: String(t1), toRoomId: String(t1) })).body.message).toBe('Nothing to move');
  });
});
