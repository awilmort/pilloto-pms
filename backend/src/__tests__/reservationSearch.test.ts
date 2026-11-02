/**
 * GET /api/reservations search must stay inside what the user may see: a user without the
 * reservations permission only sees their own reservations, with or without a search term.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

let mockUser: any = null;
jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = mockUser; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
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

describe('reservation search visibility (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const guestUserId = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
  app.use('/api/reservations', reservationRoutes);
  const codes = async (query: Record<string, string>) =>
    ((await request(app).get('/api/reservations').query(query)).body.data as any[]).map((r) => r.reservationCode).sort();

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_ressearch');
    if (!ready) return;
    const base = { tenantId, type: 'room', status: 'confirmed', guests: 1, guestDetails: { adults: 1, children: 0, infants: 0 }, estimatedTotal: 100,
      totalPayments: 0, checkInDate: new Date('2027-01-10T12:00:00Z'), checkOutDate: new Date('2027-01-11T12:00:00Z') };
    await Reservation.collection.insertMany([
      { ...base, reservationCode: 'B27MINE', guestName: { firstName: 'Luis', lastName: 'Mio' }, contactInfo: { email: 'luis@example.com' }, user: guestUserId },
      { ...base, reservationCode: 'B27OTHR', guestName: { firstName: 'Maria', lastName: 'Otra' }, contactInfo: { email: 'maria@example.com' } },
    ]);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  itDb('a non-privileged user searching another guest gets nothing, and finds their own', async () => {
    mockUser = { id: String(guestUserId), role: 'guest', email: 'luis@example.com' };
    expect(await codes({})).toEqual(['B27MINE']);
    expect(await codes({ search: 'Maria' })).toEqual([]);
    expect(await codes({ search: 'B27' })).toEqual(['B27MINE']);
  });

  itDb('staff still search everyone', async () => {
    mockUser = { id: String(new mongoose.Types.ObjectId()), role: 'admin', email: 'staff@example.com' };
    expect(await codes({ search: 'Maria' })).toEqual(['B27OTHR']);
    expect(await codes({ search: 'B27' })).toEqual(['B27MINE', 'B27OTHR']);
  });
});
