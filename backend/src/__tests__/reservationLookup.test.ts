/**
 * GET /api/reservations/:id accepts the database id or the human reservation code (any case); anything else —
 * unknown code, garbage, or another property's reservation — is a plain 404, never a 500.
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

describe('reservation lookup by id or code (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const otherTenant = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
  app.use('/api/reservations', reservationRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  let id = '';
  const insert = async (extra: Record<string, unknown>) => {
    const { insertedId } = await Reservation.collection.insertOne({
      type: 'room', status: 'confirmed', guests: 2, guestDetails: { adults: 2, children: 0, infants: 0 }, estimatedTotal: 100, totalPayments: 0,
      contactInfo: { email: 'guest@example.com' }, checkInDate: new Date(), checkOutDate: new Date(Date.now() + 86_400_000), totalNights: 1, ...extra,
    });
    return String(insertedId);
  };

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_reslookup');
    if (!ready) { console.warn('Mongo unreachable — skipping reservation lookup DB tests'); return; }
    id = await insert({ tenantId, reservationCode: 'B26X7KQ' });
    await insert({ tenantId: otherTenant, reservationCode: 'B26ZZZZ' });
  });
  afterAll(async () => { if (ready) await dropTestDb(); });

  itDb('finds a reservation by its database id', async () => {
    const res = await request(app).get(`/api/reservations/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.reservationCode).toBe('B26X7KQ');
  });

  itDb('finds the same reservation by its code, in any case', async () => {
    for (const ref of ['B26X7KQ', 'b26x7kq', ' B26x7Kq ']) {
      const res = await request(app).get(`/api/reservations/${encodeURIComponent(ref)}`);
      expect(res.status).toBe(200);
      expect(res.body.data._id).toBe(id);
    }
  });

  itDb('answers 404 for an unknown code', async () => {
    expect((await request(app).get('/api/reservations/B26NOPE')).status).toBe(404);
  });

  itDb('answers 404 — not 500 — for garbage that is neither an id nor a code', async () => {
    expect((await request(app).get('/api/reservations/not-a-real-thing')).status).toBe(404);
  });

  itDb("never returns another property's reservation, by id or by code", async () => {
    expect((await request(app).get('/api/reservations/B26ZZZZ')).status).toBe(404);
    const otherId = String((await Reservation.collection.findOne({ reservationCode: 'B26ZZZZ' }))!._id);
    expect((await request(app).get(`/api/reservations/${otherId}`)).status).toBe(404);
  });
});
