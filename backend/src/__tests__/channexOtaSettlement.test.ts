/**
 * OTA-collect settlement (plan Phase 7.4): an OTA-collect booking applied by the booking mapper
 * goes through the real check-in / check-out routes and ends with its balance in City Ledger
 * under the OTA's customer (Accounting tenant) or as a credit payment on the OTA's credit
 * account (PMS-only tenant, "use credit"). Also the reservation list's source filter and the
 * channel history endpoint. Auth is mocked; local Mongo.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

let mockTenant: any = null;
const userId = new mongoose.Types.ObjectId();
jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: String(userId), role: 'admin', email: 'staff@example.com' }; req.tenant = mockTenant; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
  };
});
jest.mock('../utils/email', () => ({
  sendReservationConfirmationEmail: jest.fn(() => Promise.resolve()),
  sendInvoiceEmail: jest.fn(() => Promise.resolve()),
  sendCorporatePriceRequestEmail: jest.fn(() => Promise.resolve()),
}));

// eslint-disable-next-line import/first
import reservationRoutes from '../routes/reservations';
// eslint-disable-next-line import/first
import { tenantLocalStorage } from '../middleware/tenantContext';
// eslint-disable-next-line import/first
import { applyBookingRevision } from '../services/channex/bookingMapper';
// eslint-disable-next-line import/first
import { runInTenant } from '../services/channex/provisioning';
// eslint-disable-next-line import/first
import { connectTestDb, dropTestDb } from './helpers/testDb';
// eslint-disable-next-line import/first
import AppSettings from '../models/AppSettings';
// eslint-disable-next-line import/first
import ChannexBookingRevision from '../models/ChannexBookingRevision';
// eslint-disable-next-line import/first
import ChannexEntityMap from '../models/ChannexEntityMap';
// eslint-disable-next-line import/first
import Company from '../models/Company';
// eslint-disable-next-line import/first
import CreditAccount from '../models/CreditAccount';
// eslint-disable-next-line import/first
import Customer from '../models/Customer';
// eslint-disable-next-line import/first
import Folio from '../models/Folio';
// eslint-disable-next-line import/first
import Invoice from '../models/Invoice';
// eslint-disable-next-line import/first
import Payment from '../models/Payment';
// eslint-disable-next-line import/first
import RatePlan from '../models/RatePlan';
// eslint-disable-next-line import/first
import Reservation from '../models/Reservation';
// eslint-disable-next-line import/first
import Room from '../models/Room';
// eslint-disable-next-line import/first
import RoomType from '../models/RoomType';
// eslint-disable-next-line import/first
import Tenant from '../models/Tenant';

const PROP = '11111111-1111-1111-1111-111111111111';

describe('OTA-collect settlement and channel reservations (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const twin = new mongoose.Types.ObjectId();
  const plan = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
  app.use('/api/reservations', reservationRoutes);

  const expediaCollect = (bookingId: string, checkIn: string, checkOut: string, amount = '250.00') => ({
    channexRevisionId: `rev-${bookingId}`, channexBookingId: bookingId, channexPropertyId: PROP, status: 'new',
    insertedAt: new Date('2026-11-01T10:00:00Z'),
    payload: {
      status: 'new', booking_id: bookingId, property_id: PROP, ota_name: 'Expedia', unique_id: `EXP-${bookingId}`, ota_reservation_code: bookingId,
      amount, currency: 'USD', payment_collect: 'ota', payment_type: 'bank_transfer', inserted_at: '2026-11-01T10:00:00Z',
      customer: { name: 'John', surname: 'Smith', mail: 'jsmith@m.expediapartnercentral.com' },
      rooms: [{ room_type_id: 'ch-twin', rate_plan_id: 'ch-twin-bar', checkin_date: checkIn, checkout_date: checkOut, amount, occupancy: { adults: 2, children: 0, infants: 0 } }],
    },
  }) as any;

  const ingest = async (bookingId: string, checkIn: string, checkOut: string) => {
    const out = await runInTenant(tenantId, () => applyBookingRevision(expediaCollect(bookingId, checkIn, checkOut)));
    await ChannexBookingRevision.collection.insertOne({
      tenantId, channexRevisionId: `rev-${bookingId}`, channexBookingId: bookingId, status: 'new', insertedAt: new Date(), source: 'feed',
      processing: 'applied', reservationId: out.reservationId, ackedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), attempts: 0,
    });
    return String(out.reservationId);
  };
  const checkIn = (id: string) => request(app).patch(`/api/reservations/${id}/check-in`).send({ identificationDocument: 'P1234567', identificationType: 'pasaporte' });

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_otasettle');
    if (!ready) { console.warn('Mongo unreachable — skipping OTA settlement DB tests'); return; }
    await Tenant.collection.insertOne({ _id: tenantId, name: 'Test Property', slug: 'ota-settle', isActive: true, products: ['pms', 'accounting'], settings: { currency: 'USD' } });
    await AppSettings.collection.insertOne({ tenantId, key: 'global', channelManager: { enabled: false, autoAssignRooms: true } });
    await RoomType.collection.insertOne({ _id: twin, tenantId, name: 'Twin Room', capacity: 2, isActive: true });
    await RatePlan.collection.insertOne({ _id: plan, tenantId, name: 'Best Available Rate', roomTypeId: twin, basePrice: 100, isActive: true, occupancyTiers: [] });
    await Room.collection.insertMany([1, 2, 3].map((n) => ({ tenantId, name: `T${n}`, description: 'Twin', bedConfiguration: '2 twin beds', images: [], roomTypeId: twin, status: 'active', condition: 'clean' })));
    await ChannexEntityMap.collection.insertMany([
      { tenantId, environment: 'staging', kind: 'room_type', localId: twin, channexId: 'ch-twin', channexPropertyId: PROP, status: 'active' },
      { tenantId, environment: 'staging', kind: 'rate_plan', localId: plan, channexId: 'ch-twin-bar', channexPropertyId: PROP, status: 'active' },
    ]);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  itDb('Accounting tenant: checkout moves the balance to City Ledger under the OTA customer, pre-approved', async () => {
    mockTenant = { _id: tenantId, products: ['pms', 'accounting'] };
    const id = await ingest('EXP-A', '2027-01-10', '2027-01-12');
    expect((await checkIn(id)).status).toBe(200);
    const out = await request(app).patch(`/api/reservations/${id}/check-out`).send({});
    expect(out.status).toBe(200);
    expect(out.body.cityLedger).toMatchObject({ transferred: true, preApproved: true, authorizationStatus: 'authorized' });

    const company = (await Company.collection.findOne({ tenantId, name: 'Expedia' }))!;
    const customer = (await Customer.collection.findOne({ tenantId, linkedCompanyId: company._id }))!;
    expect(customer.name).toBe('Expedia');
    const invoice = (await Invoice.collection.findOne({ tenantId, 'cityLedger.sourceReservationId': new mongoose.Types.ObjectId(id) }))!;
    expect(String(invoice.customer)).toBe(String(customer._id));
    expect(invoice.status).toBe('sent');
    expect(invoice.lineItems[0].unitPrice).toBe(250);
    const folio = (await Folio.collection.findOne({ reservationId: new mongoose.Types.ObjectId(id) }))!;
    expect(folio.status).toBe('in_ar');
    expect(await Payment.collection.findOne({ folioId: folio._id, method: 'credit' })).toMatchObject({ amount: 250, status: 'pending' });
    expect((await CreditAccount.collection.findOne({ tenantId, referenceId: company._id }))!.currentExposure).toBe(250);
    expect((await Reservation.collection.findOne({ _id: new mongoose.Types.ObjectId(id) }))!.status).toBe('completed');
  });

  itDb('PMS-only tenant: checkout is blocked by the balance, "use credit" puts it on the OTA credit account', async () => {
    mockTenant = { _id: tenantId, products: ['pms'] };
    const id = await ingest('EXP-B', '2027-02-10', '2027-02-11');
    expect((await checkIn(id)).status).toBe(200);
    const blocked = await request(app).patch(`/api/reservations/${id}/check-out`).send({});
    expect(blocked.status).toBe(400);
    expect(blocked.body.data.creditAvailability).toBeGreaterThanOrEqual(250);
    const before = (await CreditAccount.collection.findOne({ tenantId, scope: 'company' }))!.currentExposure;
    const used = await request(app).post(`/api/reservations/${id}/use-credit`).send({});
    expect(used.status).toBe(200);
    const folio = (await Folio.collection.findOne({ reservationId: new mongoose.Types.ObjectId(id) }))!;
    expect(await Payment.collection.findOne({ folioId: folio._id, method: 'credit' })).toMatchObject({ amount: 250, status: 'pending' });
    expect((await CreditAccount.collection.findOne({ tenantId, scope: 'company' }))!.currentExposure).toBe(before + 250);
    expect((await Reservation.collection.findOne({ _id: new mongoose.Types.ObjectId(id) }))!.status).toBe('completed');
  });

  itDb('list: filter by source and find by OTA code; channel sources and history', async () => {
    mockTenant = { _id: tenantId, products: ['pms'] };
    const otaId = await ingest('EXP-C', '2027-03-10', '2027-03-11');
    const base = { type: 'room', status: 'confirmed', guests: 1, guestDetails: { adults: 1, children: 0, infants: 0 }, estimatedTotal: 100, totalPayments: 0,
      checkInDate: new Date('2027-03-10T12:00:00Z'), checkOutDate: new Date('2027-03-11T12:00:00Z') };
    const [direct, engine] = await runInTenant(tenantId, () => Promise.all([
      Reservation.create({ ...base, contactInfo: { email: 'desk@example.com' }, confirmationToken: `${Date.now()}-abc123def`, reservationCode: 'B27DESK' }),
      Reservation.create({ ...base, contactInfo: { email: 'web@example.com' }, confirmationToken: 'a'.repeat(64), reservationCode: 'B27WEB1' }),
    ]));
    const list = async (source: string) => ((await request(app).get('/api/reservations').query({ source, limit: 50 })).body.data as any[]).map((r) => String(r._id));

    expect(await list('ota:Expedia')).toContain(otaId);
    expect(await list('ota:Expedia')).not.toContain(String(direct._id));
    expect(await list('channel')).toContain(otaId);
    expect(await list('direct')).toEqual([String(direct._id)]);
    expect(await list('booking_engine')).toEqual([String(engine._id)]);
    const search = (await request(app).get('/api/reservations').query({ search: 'EXP-C' })).body.data as any[];
    expect(search.map((r) => String(r._id))).toEqual([otaId]);

    const one = (await request(app).get(`/api/reservations/${otaId}`)).body.data;
    expect(one.channelSource).toMatchObject({ provider: 'channex', otaName: 'Expedia', otaReservationCode: 'EXP-C', paymentCollect: 'ota' });
    for (const k of ['channexBookingId', 'channexPropertyId', 'lastRevisionId', 'channelId']) expect(one.channelSource).not.toHaveProperty(k);

    expect((await request(app).get('/api/reservations/channel-sources')).body.data).toEqual(['Expedia']);
    const history = (await request(app).get(`/api/reservations/${otaId}/channel-history`)).body.data;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'new', state: 'imported', acknowledged: true });
    expect(JSON.stringify(history)).not.toMatch(/rev-|channex/i);
    expect((await request(app).get(`/api/reservations/${direct._id}/channel-history`)).body.data).toEqual([]);
  });
});
