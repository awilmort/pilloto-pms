/**
 * Rate plan choice end to end (local Mongo): staff quotes and reservations, rate plan
 * defaults and promo codes, the booking engine, and room items that follow date changes.
 *
 * Twin room type (2 guests), rooms T1 and T2; plans:
 *   BAR  100 public   ·  B&B 120 public  ·  VIP 70 private, code AMIGOS  ·  CORP 115 private,
 *   with a company rule (custom 95) for ACME.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: '64b000000000000000000001', role: 'admin', email: 'staff@hotel.test' }; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
    userHasPermission: async () => true,
  };
});
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  sendReservationConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendInvoiceEmail: jest.fn(),
  sendCorporatePriceRequestEmail: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/first
import reservationRoutes from '../routes/reservations';
// eslint-disable-next-line import/first
import pricingRoutes from '../routes/pricing';
// eslint-disable-next-line import/first
import bookingRoutes from '../routes/booking';
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
import RatePlan from '../models/RatePlan';
// eslint-disable-next-line import/first
import PricingRule from '../models/PricingRule';
// eslint-disable-next-line import/first
import AppSettings from '../models/AppSettings';
// eslint-disable-next-line import/first
import BookingVerification from '../models/BookingVerification';
// eslint-disable-next-line import/first
import { getInventory } from '../services/channex/inventory.service';

describe('rate plan choice (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const twin = new mongoose.Types.ObjectId();
  const [t1, t2] = [0, 1].map(() => new mongoose.Types.ObjectId());
  const [bar, bb, vip, corp] = [0, 1, 2, 3].map(() => new mongoose.Types.ObjectId());
  const acme = new mongoose.Types.ObjectId();

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = String(tenantId);
    req.tenant = { _id: String(tenantId), plan: 'pro', settings: { language: 'en', currency: 'USD', timezone: 'UTC' } };
    tenantLocalStorage.run({ tenantId: String(tenantId) }, next);
  });
  app.use('/api/reservations', reservationRoutes);
  app.use('/api/pricing', pricingRoutes);
  app.use('/api/booking', bookingRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  const day = (offset: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset, 12)).toISOString().slice(0, 10);
  };
  const staff = () => request(app).post('/api/reservations').set('Authorization', 'Bearer test');
  const roomBooking = (extra: Record<string, unknown> = {}) => ({
    type: 'room', rooms: [String(t1)], checkInDate: day(20), checkOutDate: day(22),
    guestName: { firstName: 'Ana', lastName: 'Pérez' }, contactInfo: { email: 'ana@example.com' },
    guestDetails: { adults: 2, children: 0, infants: 0 }, ...extra,
  });
  const saved = async (id: string): Promise<any> => Reservation.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_ratesel');
    if (!ready) { console.warn('Mongo unreachable — skipping rate selection DB tests'); return; }
    await RoomType.collection.insertOne({ _id: twin, tenantId, name: 'Twin', capacity: 2, isActive: true });
    await Room.collection.insertMany([
      { _id: t1, tenantId, name: 'T1', roomTypeId: twin, status: 'active', images: [] },
      { _id: t2, tenantId, name: 'T2', roomTypeId: twin, status: 'active', images: [] },
    ]);
    const base = { tenantId, roomTypeId: twin, pricingMode: 'tiered', occupancyTiers: [], isActive: true, sellOnChannels: true, isDefault: false, description: '' };
    await RatePlan.collection.insertMany([
      // B&B first in storage order: the old code picked it; the new pre-selection must not
      { ...base, _id: bb, name: 'Bed & Breakfast Rate', basePrice: 120, visibility: 'public', accessCodes: [], description: 'Breakfast for two' },
      { ...base, _id: bar, name: 'Best Available Rate', basePrice: 100, visibility: 'public', accessCodes: [] },
      { ...base, _id: vip, name: 'Friends', basePrice: 70, visibility: 'private', accessCodes: ['AMIGOS'] },
      { ...base, _id: corp, name: 'Corporate', basePrice: 115, visibility: 'private', accessCodes: [] },
    ]);
    await PricingRule.collection.insertOne({
      tenantId, name: 'ACME contract', origin: 'manual', ruleTarget: 'company', companyId: acme, ratePlanId: corp,
      ruleModel: 'custom', customBasePrice: 95, periodPattern: 'all_days', isActive: true,
    });
    await AppSettings.collection.insertOne({ tenantId, key: 'global', bookingSettings: { enabled: true, minAdvanceHours: 0, maxAdvanceDays: 365 } });
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    if (!ready) return;
    await Reservation.collection.deleteMany({});
    await RatePlan.collection.updateMany({}, { $set: { isDefault: false } });
  });

  // ── Staff ──

  itDb('rate options list every active plan with prices; the cheapest open plan is pre-selected', async () => {
    const r = await request(app).post('/api/pricing/rate-options').send({
      roomIds: [String(t1)], checkInDate: day(20), checkOutDate: day(22), adults: 2, children: 0,
    });
    expect(r.status).toBe(200);
    const room = r.body.data.rooms[0];
    expect(room.options.map((o: any) => [o.name, o.pricing.finalTotal])).toEqual([
      ['Friends', 140], ['Best Available Rate', 200], ['Corporate', 230], ['Bed & Breakfast Rate', 240],
    ]);
    // Friends is cheaper, but staff only get it pre-selected with its code; without one the cheapest open plan…
    expect(room.recommended).toEqual({ ratePlanId: String(vip), reason: 'cheapest' });
    expect(room.options.find((o: any) => o.name === 'Bed & Breakfast Rate').description).toBe('Breakfast for two');
  });

  itDb('the default plan, a promo code and a company contract change the pre-selection in that order', async () => {
    await RatePlan.collection.updateOne({ _id: bar }, { $set: { isDefault: true } });
    const ask = (extra: Record<string, unknown>) => request(app).post('/api/pricing/rate-options').send({
      roomIds: [String(t1)], checkInDate: day(20), checkOutDate: day(22), adults: 2, children: 0, ...extra,
    }).then((res) => res.body.data.rooms[0].recommended);
    expect(await ask({})).toEqual({ ratePlanId: String(bar), reason: 'default' });
    expect(await ask({ promoCode: 'amigos' })).toEqual({ ratePlanId: String(vip), reason: 'promo' });
    expect(await ask({ promoCode: 'amigos', companyId: String(acme) })).toEqual({ ratePlanId: String(corp), reason: 'contract' });
  });

  itDb('a staff reservation stores each room on the chosen plan, how it was chosen, and its price', async () => {
    await RatePlan.collection.updateOne({ _id: bar }, { $set: { isDefault: true } });
    const r = await staff().send(roomBooking({
      rooms: [String(t1), String(t2)], guestDetails: { adults: 4, children: 0, infants: 0 },
      roomRatePlans: { [String(t2)]: String(bb) },
    }));
    expect(r.status).toBe(201);
    const doc = await saved(r.body.data._id);
    expect(doc.items.map((i: any) => [i.ratePlanName, i.rateSelection, i.total])).toEqual([
      ['Best Available Rate', 'default', 200],
      ['Bed & Breakfast Rate', 'manual', 240],
    ]);
    expect(doc.estimatedTotal).toBe(440);
    expect(doc.pricingSnapshot).toMatchObject({ ratePlanName: 'Best Available Rate + Bed & Breakfast Rate', finalTotal: 440, nights: 2 });
    // Room items and their assigned rooms are counted once by the inventory
    const inv = await tenantLocalStorage.run({ tenantId: String(tenantId) }, () => getInventory({ dateFrom: day(20), dateTo: day(21), roomTypeIds: [String(twin)] }));
    expect(inv[String(twin)][day(20)].available).toBe(0);
  });

  itDb('without a choice the server applies the same pre-selection (not storage order)', async () => {
    const r = await staff().send(roomBooking());
    expect(r.status).toBe(201);
    const doc = await saved(r.body.data._id);
    // Friends (private) is the cheapest plan staff can book
    expect(doc.items[0]).toMatchObject({ ratePlanName: 'Friends', rateSelection: 'cheapest', total: 140 });
  });

  itDb('a company booking gets its contract plan and price; a promo code is stored when it unlocked the plan', async () => {
    const corporate = await staff().send(roomBooking({ isCorporate: true, company: String(acme) }));
    expect(corporate.status).toBe(201);
    expect((await saved(corporate.body.data._id)).items[0]).toMatchObject({ ratePlanName: 'Corporate', rateSelection: 'contract', total: 190 });

    const promo = await staff().send(roomBooking({ rooms: [String(t2)], promoCode: 'Amigos' }));
    expect(promo.status).toBe(201);
    const doc = await saved(promo.body.data._id);
    expect(doc.items[0]).toMatchObject({ ratePlanName: 'Friends', rateSelection: 'promo' });
    expect(doc.promoCode).toBe('AMIGOS');
  });

  itDb('a plan of another room type, or a deleted plan, is refused', async () => {
    const r = await staff().send(roomBooking({ roomRatePlans: { [String(t1)]: String(new mongoose.Types.ObjectId()) } }));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not available for T1/);
  });

  itDb('client-sent room items never override the computed price', async () => {
    const r = await staff().send(roomBooking({
      roomRatePlans: { [String(t1)]: String(bar) },
      items: [{ kind: 'room', roomTypeId: String(twin), quantity: 1, unitPrice: 1, subtotal: 1, total: 1, taxes: [], totalTaxes: 0 }],
    }));
    expect(r.status).toBe(201);
    const doc = await saved(r.body.data._id);
    expect(doc.estimatedTotal).toBe(200);
    expect(doc.items).toHaveLength(1);
  });

  itDb('without a session only public plans (or code-unlocked ones) can be booked, with no negotiated price', async () => {
    const privatePlan = await request(app).post('/api/reservations').send(roomBooking({ roomRatePlans: { [String(t1)]: String(corp) } }));
    expect(privatePlan.status).toBe(400);
    const anonymous = await request(app).post('/api/reservations').send(roomBooking({ isCorporate: true, company: String(acme) }));
    expect(anonymous.status).toBe(201);
    expect((await saved(anonymous.body.data._id)).items[0]).toMatchObject({ ratePlanName: 'Best Available Rate', total: 200 });
  });

  itDb('approving a corporate rate request moves the room to the company\'s contract plan', async () => {
    const r = await staff().send(roomBooking({ requestCorporatePrice: true, requestedCompany: String(acme), roomRatePlans: { [String(t1)]: String(bar) } }));
    expect(r.status).toBe(201);
    const id = r.body.data._id;
    expect((await saved(id)).corporatePriceStatus).toBe('pending');
    const approve = await request(app).post(`/api/reservations/${id}/corporate-price/approve`).set('Authorization', 'Bearer test').send({ companyId: String(acme) });
    expect(approve.status).toBe(200);
    const doc = await saved(id);
    expect(doc.items[0]).toMatchObject({ ratePlanName: 'Corporate', rateSelection: 'contract', total: 190 });
    expect(doc.estimatedTotal).toBe(190);
  });

  // ── Date changes keep room items on the stay ──

  itDb('editing the dates moves and rescales the room items', async () => {
    const r = await staff().send(roomBooking({ roomRatePlans: { [String(t1)]: String(bar) } }));
    const id = r.body.data._id;
    const edit = await request(app).put(`/api/reservations/${id}`).set('Authorization', 'Bearer test').send({ checkInDate: day(30), checkOutDate: day(33) });
    expect(edit.status).toBe(200);
    const item = (await saved(id)).items[0];
    expect([item.checkIn.toISOString().slice(0, 10), item.checkOut.toISOString().slice(0, 10)]).toEqual([day(30), day(33)]);
    expect(item.total).toBe(300);
    // Old nights are free again
    const inv = await tenantLocalStorage.run({ tenantId: String(tenantId) }, () => getInventory({ dateFrom: day(20), dateTo: day(21), roomTypeIds: [String(twin)] }));
    expect(inv[String(twin)][day(20)].available).toBe(2);
  });

  itDb('moving a stay in the booking calendar moves its room items', async () => {
    const r = await staff().send(roomBooking({ roomRatePlans: { [String(t1)]: String(bar) } }));
    const id = r.body.data._id;
    const move = await request(app).put(`/api/reservations/${id}/move`).set('Authorization', 'Bearer test').send({ checkInDate: day(40) });
    expect(move.status).toBe(200);
    const item = (await saved(id)).items[0];
    expect([item.checkIn.toISOString().slice(0, 10), item.checkOut.toISOString().slice(0, 10)]).toEqual([day(40), day(42)]);
  });

  // ── Rate plan settings ──

  itDb('one default plan per room type; promo codes are normalized and only kept on private plans', async () => {
    const set = (id: mongoose.Types.ObjectId, body: Record<string, unknown>) => request(app).put(`/api/pricing/rate-plans/${id}`).send(body);
    expect((await set(bar, { isDefault: true })).status).toBe(200);
    expect((await set(bb, { isDefault: true })).status).toBe(200);
    const defaults = await RatePlan.collection.find({ roomTypeId: twin, isDefault: true }).toArray();
    expect(defaults.map((p) => String(p._id))).toEqual([String(bb)]);

    const codes = await set(vip, { accessCodes: 'amigos, family-26' });
    expect(codes.body.data.accessCodes).toEqual(['AMIGOS', 'FAMILY-26']);
    expect((await set(vip, { accessCodes: ['x'] })).status).toBe(400);
    const pub = await set(bb, { accessCodes: ['NOPE'] });
    expect(pub.body.data.accessCodes).toEqual([]);
    await set(vip, { accessCodes: ['AMIGOS'] });
  });

  // ── Booking engine ──

  itDb('the booking engine lists every public plan; a promo code adds its private plan first', async () => {
    const search = (promoCode?: string) => request(app).get('/api/booking/availability')
      .query({ checkIn: day(20), checkOut: day(22), adults: 2, children: 0, ...(promoCode ? { promoCode } : {}) });
    const plain = await search();
    expect(plain.status).toBe(200);
    expect(plain.body.data[0].ratePlans.map((p: any) => [p.name, p.pricing.finalTotal])).toEqual([['Best Available Rate', 200], ['Bed & Breakfast Rate', 240]]);
    expect(plain.body.data[0].ratePlan.name).toBe('Best Available Rate');
    expect(plain.body.promo).toBeNull();

    const withCode = await search('amigos');
    expect(withCode.body.data[0].ratePlans.map((p: any) => [p.name, p.promo])).toEqual([['Friends', true], ['Best Available Rate', false], ['Bed & Breakfast Rate', false]]);
    expect(withCode.body.promo).toEqual({ code: 'AMIGOS', valid: true, applied: true });
    expect((await search('NOPE')).body.promo).toEqual({ code: 'NOPE', valid: false, applied: false });
    // Staff-only private plans are never offered
    expect(withCode.body.data[0].ratePlans.some((p: any) => p.name === 'Corporate')).toBe(false);
  });

  itDb('the guest books the plan they chose; a private plan needs its code', async () => {
    const verify = async (email: string) => {
      const v = await BookingVerification.collection.insertOne({ tenantId, email, code: '1234', verified: true, attempts: 0, ipAddress: '::1', expiresAt: new Date(Date.now() + 600_000), createdAt: new Date() });
      return String(v.insertedId);
    };
    const reserve = async (ratePlanId: mongoose.Types.ObjectId, promoCode?: string) => request(app).post('/api/booking/reserve').send({
      verificationId: await verify('guest@example.com'), email: 'guest@example.com', firstName: 'Gia', lastName: 'Ruiz',
      items: [{ kind: 'room', roomTypeId: String(twin), ratePlanId: String(ratePlanId), checkIn: day(20), checkOut: day(22), adults: 2, children: 0 }],
      acceptedTermsVersion: '1.0', acceptedPrivacyVersion: '1.0', ...(promoCode ? { promoCode } : {}),
    });
    const chosen = await reserve(bb);
    expect(chosen.status).toBe(201);
    const doc = await Reservation.collection.findOne({ reservationCode: chosen.body.data.reservationCode });
    expect(doc!.items[0]).toMatchObject({ ratePlanName: 'Bed & Breakfast Rate', rateSelection: 'manual', total: 240 });
    expect(doc!.pricingSnapshot).toMatchObject({ ratePlanName: 'Bed & Breakfast Rate', finalTotal: 240 });

    expect((await reserve(vip)).status).toBe(400);
    const withCode = await reserve(vip, 'AMIGOS');
    expect(withCode.status).toBe(201);
    const promoDoc = await Reservation.collection.findOne({ reservationCode: withCode.body.data.reservationCode });
    expect(promoDoc!.promoCode).toBe('AMIGOS');
    expect(promoDoc!.items[0]).toMatchObject({ ratePlanName: 'Friends', total: 140 });
  });
});
