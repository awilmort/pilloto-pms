/**
 * Reservation history: milestone events written by the reservation routes (who and when),
 * edits recorded as a diff of tracked fields only, no-op edits recording nothing, and the
 * read side merging charges, payments and — for reservations older than history — the
 * reservation's own timestamps.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: '64b000000000000000000001', firstName: 'Ana', lastName: 'Front', role: 'admin', email: 'ana@hotel.test' };
      next();
    },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
    userHasPermission: async () => true,
  };
});
jest.mock('../utils/email', () => ({
  sendReservationConfirmationEmail: jest.fn(async () => undefined), sendInvoiceEmail: jest.fn(async () => undefined),
  sendCorporatePriceRequestEmail: jest.fn(async () => undefined),
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
import ReservationEvent from '../models/ReservationEvent';
// eslint-disable-next-line import/first
import Room from '../models/Room';
// eslint-disable-next-line import/first
import RoomType from '../models/RoomType';
// eslint-disable-next-line import/first
import User from '../models/User';
// eslint-disable-next-line import/first
import Folio from '../models/Folio';
// eslint-disable-next-line import/first
import Charge from '../models/Charge';
// eslint-disable-next-line import/first
import Payment from '../models/Payment';
// eslint-disable-next-line import/first
import { diffSnapshots, recordReservationEvent, snapshotReservation } from '../services/reservationHistory';

describe('reservation history — tracked fields', () => {
  it('diffs only the tracked fields that changed', () => {
    const base = {
      status: 'confirmed', checkInDate: new Date('2026-12-01T12:00:00Z'), checkOutDate: new Date('2026-12-03T12:00:00Z'),
      guestDetails: { adults: 2, children: 0, infants: 0 }, estimatedTotal: 200, contactInfo: { email: 'a@b.co' },
      rooms: ['r1'], totalPayments: 0, updatedAt: new Date(1),
    };
    const after = { ...base, checkOutDate: new Date('2026-12-04T12:00:00Z'), totalPayments: 150, updatedAt: new Date(2) };
    expect(diffSnapshots(snapshotReservation(base), snapshotReservation(after)))
      .toEqual([{ field: 'checkOutDate', from: '2026-12-03', to: '2026-12-04' }]);
  });

  it('treats room and rooms as one sorted set', () => {
    const a = snapshotReservation({ room: 'r2', rooms: ['r1', 'r2'] });
    const b = snapshotReservation({ room: 'r1', rooms: ['r2', 'r1'] });
    expect(diffSnapshots(a, b)).toEqual([]);
  });
});

describe('reservation history (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId('64b000000000000000000001');
  const twin = new mongoose.Types.ObjectId();
  const [t1, t2] = [0, 1].map(() => new mongoose.Types.ObjectId());
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
  const makeRes = async (extra: Record<string, unknown> = {}) => {
    const { insertedId } = await Reservation.collection.insertOne({
      tenantId, type: 'room', status: 'confirmed', reservationCode: `HI${++seq}`, guests: 2,
      guestDetails: { adults: 2, children: 0, infants: 0 }, estimatedTotal: 300, totalPayments: 0,
      contactInfo: { email: 'guest@example.com' }, checkInDate: noon(day(10)), checkOutDate: noon(day(13)), totalNights: 3,
      room: t1, rooms: [t1], createdAt: new Date(Date.now() - 86_400_000),
      items: [{ kind: 'room', roomTypeId: twin, adults: 2, children: 0, quantity: 1, unitPrice: 100, subtotal: 300, total: 300 }],
      ...extra,
    });
    return String(insertedId);
  };
  const history = async (id: string) => (await request(app).get(`/api/reservations/${id}/history`)).body.data as any[];
  const events = (id: string) => ReservationEvent.collection.find({ reservationId: new mongoose.Types.ObjectId(id) }).toArray();

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_reshistory');
    if (!ready) { console.warn('Mongo unreachable — skipping reservation history DB tests'); return; }
    await RoomType.collection.insertOne({ _id: twin, tenantId, name: 'Twin', capacity: 2, isActive: true });
    await Room.collection.insertMany([
      { _id: t1, tenantId, name: 'T1', roomTypeId: twin, status: 'active' },
      { _id: t2, tenantId, name: 'T2', roomTypeId: twin, status: 'active' },
    ]);
    await User.collection.insertOne({ _id: staffId, tenantId, firstName: 'Ana', lastName: 'Front', email: 'ana@hotel.test' });
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    if (!ready) return;
    await Promise.all([Reservation, ReservationEvent, Folio, Charge, Payment].map((m: any) => m.collection.deleteMany({})));
  });

  itDb('records an edit as a diff with who did it, and nothing for an edit that changes no tracked field', async () => {
    const id = await makeRes({ specialRequests: 'Late arrival' });
    expect((await request(app).put(`/api/reservations/${id}`).send({ specialRequests: 'Late arrival' })).status).toBe(200);
    expect(await events(id)).toHaveLength(0);

    expect((await request(app).put(`/api/reservations/${id}`).send({ checkOutDate: day(14) })).status).toBe(200);
    const [e] = await events(id);
    expect(e.action).toBe('updated');
    expect(e.actor).toEqual({ kind: 'user', userId: staffId, name: 'Ana Front' });
    expect(e.changes).toEqual(expect.arrayContaining([{ field: 'checkOutDate', from: day(13), to: day(14) }]));
    expect(e.changes.map((c: any) => c.field)).not.toContain('totalNights');
  });

  itDb('records a room move with room names, not ids', async () => {
    const id = await makeRes();
    expect((await request(app).put(`/api/reservations/${id}/move`).send({ fromRoomId: String(t1), toRoomId: String(t2) })).status).toBe(200);
    const [e] = await events(id);
    expect(e.action).toBe('moved');
    expect(e.changes).toEqual([{ field: 'rooms', from: ['T1'], to: ['T2'] }]);
  });

  itDb('check-in: logs the milestone and the base charge shows up as a charge by the same user', async () => {
    const id = await makeRes();
    const r = await request(app).patch(`/api/reservations/${id}/check-in`).send({ identificationDocument: '001-1234567-8', identificationType: 'cedula' });
    expect(r.status).toBe(200);
    const h = await history(id);
    const checkIn = h.find((x) => x.action === 'checked_in');
    expect(checkIn).toMatchObject({ actor: { kind: 'user', name: 'Ana Front' }, note: 'cedula' });
    expect(JSON.stringify(h)).not.toContain('001-1234567-8'); // the document number stays out of the log
    expect(h.find((x) => x.action === 'charge_added')).toMatchObject({ amount: 300, actor: { kind: 'user', name: 'Ana Front' } });
  });

  itDb('payments: recorded ones come from the payment rows, deletions are logged with their amount', async () => {
    const id = await makeRes();
    const pay = (amount: number, method: string) =>
      request(app).post(`/api/reservations/${id}/payments`).send({ amount, method, paymentStage: 'deposit' });
    expect((await pay(100, 'cash')).status).toBe(200);
    expect((await pay(50, 'card')).status).toBe(200);
    expect(await events(id)).toHaveLength(0); // nothing duplicated into the log
    const card: any = await Payment.collection.findOne({ method: 'card' });
    expect((await request(app).delete(`/api/reservations/${id}/payments/${card._id}`)).status).toBe(200);

    const h = await history(id);
    expect(h.filter((x) => x.action === 'payment_recorded')).toEqual([
      expect.objectContaining({ amount: 100, method: 'cash', note: 'deposit', actor: { kind: 'user', name: 'Ana Front' } }),
    ]);
    expect(h.find((x) => x.action === 'payment_deleted')).toMatchObject({ amount: 50, note: 'card', actor: { name: 'Ana Front' } });
  });

  itDb('a guest cancelling from the public link is recorded as the guest, with the reason', async () => {
    const id = await makeRes({ confirmationToken: 'tok-1' });
    expect((await request(app).put('/api/reservations/public/tok-1/cancel').send({ cancellationReason: 'Flight cancelled' })).status).toBe(200);
    const [e] = await events(id);
    expect(e).toMatchObject({ action: 'cancelled', actor: { kind: 'guest' }, note: 'Flight cancelled' });
  });

  itDb('reservations older than history get their milestones inferred from stored timestamps', async () => {
    const createdAt = new Date('2026-01-01T10:00:00Z');
    const id = await makeRes({
      createdAt, user: staffId, assignedBy: staffId, assignedAt: new Date('2026-01-01T11:00:00Z'),
      actualCheckInAt: new Date('2026-01-05T15:00:00Z'), status: 'checked-in',
    });
    const h = await history(id);
    expect(h.map((x) => x.action)).toEqual(['checked_in', 'rooms_changed', 'created']); // newest first
    expect(h.every((x) => x.inferred)).toBe(true);
    expect(h.find((x) => x.action === 'created')).toMatchObject({ actor: { kind: 'user', name: 'Ana Front' } });
    expect(h.find((x) => x.action === 'rooms_changed')).toMatchObject({ actor: { kind: 'user', name: 'Ana Front' } });
  });

  itDb('front-desk creation is logged; no inferred duplicate once a real event exists', async () => {
    const r = await request(app).post('/api/reservations').set('Authorization', 'Bearer x').send({
      type: 'daypass', checkInDate: day(5), guestDetails: { adults: 1, children: 0, infants: 0 },
      guestName: { firstName: 'Luis', lastName: 'P' }, contactInfo: { email: 'luis@example.com' },
    });
    expect(r.status).toBe(201);
    const h = await history(r.body.data._id);
    expect(h.filter((x) => x.action === 'created')).toEqual([expect.objectContaining({ actor: { kind: 'user', name: 'Ana Front' } })]);
    expect(h.some((x) => x.inferred)).toBe(false);
  });

  itDb('a failing write never throws into the caller', async () => {
    await expect(recordReservationEvent('not-an-id', 'updated', { actor: { kind: 'system' }, changes: [{ field: 'x', from: 1, to: 2 }] }))
      .resolves.toBeUndefined();
  });
});
