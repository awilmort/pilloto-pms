/**
 * Home panel (services/reports/dashboardService.ts) against a local Mongo: tonight's KPIs,
 * movement, room / housekeeping status, the attention queue, property-local booking activity,
 * day visitors, and money hidden from callers who may not see revenue (also via the route).
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: '64b000000000000000000001', role: 'staff' }; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
    userHasAppAccess: () => true,
    // A front-desk role: dashboard yes, revenue no
    userHasPermission: async (_user: any, _app: any, perms: string[]) => !perms.includes('admin.revenue'),
  };
});

// eslint-disable-next-line import/first
import { computeDashboard } from '../services/reports/dashboardService';
// eslint-disable-next-line import/first
import adminRoutes from '../routes/admin';
// eslint-disable-next-line import/first
import { tenantLocalStorage } from '../middleware/tenantContext';
// eslint-disable-next-line import/first
import { connectTestDb, dropTestDb } from './helpers/testDb';
// eslint-disable-next-line import/first
import Reservation from '../models/Reservation';
// eslint-disable-next-line import/first
import Room from '../models/Room';
// eslint-disable-next-line import/first
import RoomBlock from '../models/RoomBlock';
// eslint-disable-next-line import/first
import Folio from '../models/Folio';
// eslint-disable-next-line import/first
import Charge from '../models/Charge';
// eslint-disable-next-line import/first
import Payment from '../models/Payment';
// eslint-disable-next-line import/first
import ChannelAlert from '../models/ChannelAlert';

describe('home panel (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const otherTenant = new mongoose.Types.ObjectId();
  const R = [0, 1, 2, 3, 4, 5, 6].map(() => new mongoose.Types.ObjectId());
  const ids = Object.fromEntries(['A', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((k) => [k, new mongoose.Types.ObjectId()]));
  const noon = (d: string) => new Date(`${d}T12:00:00Z`);
  // 11:00 in Santo Domingo (UTC−4) on 1 Nov 2026
  const NOW = new Date('2026-11-01T15:00:00Z');
  const TZ = 'America/Santo_Domingo';
  const base = { tenantId, type: 'room', guests: 2, guestDetails: { adults: 2, children: 0, infants: 0 }, totalPayments: 0, contactInfo: { email: 'a@example.com' }, createdAt: noon('2026-10-20') };
  const inTenant = <T,>(fn: () => Promise<T>) => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const run = (showMoney = true) => inTenant(() => computeDashboard({ timezone: TZ, showMoney, channelAlerts: true, dayVisits: true, now: NOW }));

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_dashboard');
    if (!ready) { console.warn('Mongo unreachable — skipping home panel DB tests'); return; }
    // R0 occupied + dirty, R1 departing, R2 vacant dirty, R3 arrived today, R4 out of service, R5 vacant clean, R6 inactive
    await Room.collection.insertMany(R.map((_id, i) => ({
      _id, tenantId, name: `R${i}`, status: i === 6 ? 'inactive' : 'active', condition: i === 0 || i === 2 ? 'pending_cleanup' : 'clean',
    })));
    await RoomBlock.collection.insertOne({ tenantId, roomId: R[4], startDate: noon('2026-10-31'), endDate: noon('2026-11-02'), reason: 'maintenance' });
    await Reservation.collection.insertMany([
      { ...base, _id: ids.A, reservationCode: 'A', guestName: { firstName: 'Ana', lastName: 'In' }, status: 'checked-in', checkInDate: noon('2026-10-30'), checkOutDate: noon('2026-11-03'), room: R[0], estimatedTotal: 400 },
      { ...base, _id: ids.D, reservationCode: 'D', guestName: { firstName: 'Dan', lastName: 'Out' }, status: 'checked-in', checkInDate: noon('2026-10-30'), checkOutDate: noon('2026-11-01'), room: R[1], estimatedTotal: 300 },
      // Arrives today, no room yet, booked this morning (local time)
      { ...base, _id: ids.E, reservationCode: 'E', guestName: { firstName: 'Eva', lastName: 'New' }, status: 'confirmed', checkInDate: noon('2026-11-01'), checkOutDate: noon('2026-11-03'), estimatedTotal: 250, createdAt: new Date('2026-11-01T13:00:00Z') },
      { ...base, _id: ids.F, reservationCode: 'F', guestName: { firstName: 'Fay', lastName: 'Here' }, status: 'checked-in', checkInDate: noon('2026-11-01'), checkOutDate: noon('2026-11-03'), room: R[3], estimatedTotal: 200 },
      // Should have arrived on 30 Oct
      { ...base, _id: ids.G, reservationCode: 'G', guestName: { firstName: 'Gus', lastName: 'Late' }, status: 'confirmed', checkInDate: noon('2026-10-30'), checkOutDate: noon('2026-11-02'), estimatedTotal: 300 },
      // Should have left on 31 Oct
      { ...base, _id: ids.H, reservationCode: 'H', guestName: { firstName: 'Hal', lastName: 'Stay' }, status: 'checked-in', checkInDate: noon('2026-10-28'), checkOutDate: noon('2026-10-31'), estimatedTotal: 300 },
      // Unconfirmed, corporate rate awaiting approval
      { ...base, _id: ids.I, reservationCode: 'I', guestName: { firstName: 'Ivy', lastName: 'Corp' }, status: 'pending', checkInDate: noon('2026-11-04'), checkOutDate: noon('2026-11-05'), estimatedTotal: 120, corporatePriceStatus: 'pending' },
      // Cancelled this morning
      { ...base, _id: ids.J, reservationCode: 'J', status: 'cancelled', checkInDate: noon('2026-11-20'), checkOutDate: noon('2026-11-22'), estimatedTotal: 200, updatedAt: new Date('2026-11-01T14:00:00Z') },
      // Booked at 22:00 local on 31 Oct (02:00 UTC on 1 Nov) — not today's booking
      { ...base, _id: ids.K, reservationCode: 'K', status: 'confirmed', checkInDate: noon('2026-11-10'), checkOutDate: noon('2026-11-12'), room: R[5], estimatedTotal: 200, createdAt: new Date('2026-11-01T02:00:00Z') },
      { ...base, type: 'daypass', status: 'confirmed', checkInDate: noon('2026-11-01'), guestDetails: { adults: 2, children: 1, infants: 0 } },
      // Another tenant's arrival never shows
      { ...base, tenantId: otherTenant, status: 'confirmed', checkInDate: noon('2026-11-01'), checkOutDate: noon('2026-11-02'), estimatedTotal: 100 },
    ]);
    const { insertedId: folioD } = await Folio.collection.insertOne({ tenantId, reservationId: ids.D, status: 'open' });
    await Charge.collection.insertOne({ tenantId, folioId: folioD, description: 'Room', amount: 300, type: 'base', category: 'room' });
    await Payment.collection.insertMany([
      { tenantId, folioId: folioD, amount: 100, status: 'completed' },
      { tenantId, folioId: folioD, amount: 999, status: 'reversed' },
    ]);
    await ChannelAlert.collection.insertMany([
      { tenantId, type: 'overbooking', severity: 'critical', status: 'open', dedupeKey: 'x', title: 'Overbooking 12 Nov', occurrences: 1 },
      { tenantId, type: 'sync_error', severity: 'warning', status: 'resolved', dedupeKey: 'y', title: 'Old', occurrences: 1 },
    ]);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });

  itDb('tonight: on-the-books occupancy over rooms available, ADR and RevPAR', async () => {
    const d = await run();
    expect(d.date).toBe('2026-11-01');
    // A, E, F, G hold a room tonight; 6 active − 1 out of service
    expect(d.tonight.current).toMatchObject({ roomsSold: 4, roomsAvailable: 5, occupancyPct: 80, roomRevenue: 425, adr: 106.25, revpar: 85 });
    expect(d.outlook).toHaveLength(14);
    expect(d.outlook[0]).toMatchObject({ date: '2026-11-01', arrivals: 2, departures: 1 });
  });

  itDb('movement and room status', async () => {
    const d = await run();
    expect(d.movement.arrivals).toMatchObject({ rooms: 2, done: 1, reservations: 2 });
    expect(d.movement.departures).toMatchObject({ rooms: 1, done: 0 });
    expect(d.movement.inHouse).toMatchObject({ rooms: 4, stayovers: 2 });
    expect(d.roomStatus).toEqual({ total: 6, occupied: 3, occupiedDirty: 1, outOfService: 1, vacantDirty: 1, vacantClean: 1 });
    expect(d.worklists.arrivals.map((s) => s.code)).toEqual(['E', 'F']);
    expect(d.worklists.arrivals[0]).toMatchObject({ unassigned: true, guest: 'Eva New', balance: 250 });
    expect(d.worklists.departures[0]).toMatchObject({ code: 'D', roomNames: ['R1'], balance: 200 });
  });

  itDb('attention queue, most severe first', async () => {
    const d = await run();
    const by = Object.fromEntries(d.attention.map((a) => [a.key, a]));
    expect(by.overdueArrivals).toMatchObject({ severity: 'critical', count: 1, items: [{ label: 'Gus Late · G', date: '2026-10-30' }] });
    expect(by.overdueDepartures).toMatchObject({ severity: 'critical', count: 1 });
    expect(by.unassigned).toMatchObject({ severity: 'critical', count: 1 });
    expect(by.unconfirmed).toMatchObject({ count: 1 });
    expect(by.balanceDue).toMatchObject({ count: 1, amount: 200 });
    expect(by.dirtyRooms).toMatchObject({ count: 1, meta: { arrivals: 1, clean: 1 } });
    expect(by.corporateRates).toMatchObject({ count: 1 });
    expect(by.channelAlerts).toMatchObject({ severity: 'critical', count: 1 });
    const ranks = d.attention.map((a) => ({ critical: 0, warning: 1, info: 2 }[a.severity]));
    expect(ranks).toEqual([...ranks].sort());
  });

  itDb('booking activity follows the property-local day; day visitors', async () => {
    const d = await run();
    expect(d.activity).toMatchObject({ newBookings: 1, newRoomNights: 2, newRevenue: 250, cancellations: 1, cancelledRoomNights: 2 });
    expect(d.activity.recent[0].code).toBe('E');
    expect(d.dayVisits).toEqual({ reservations: 1, guests: 3, byType: { daypass: 1 } });
  });

  itDb('hides money from callers who may not see revenue', async () => {
    const d = await run(false);
    expect(d.tonight.current).toMatchObject({ occupancyPct: 80, roomRevenue: 0, adr: 0 });
    expect(d.worklists.departures[0].balance).toBeUndefined();
    expect(d.attention.find((a) => a.key === 'balanceDue')).toBeUndefined();
    expect(d.activity.newRevenue).toBe(0);
    expect(d.activity.recent[0].value).toBeUndefined();
  });

  itDb('route: answers for a front-desk role without revenue', async () => {
    const app = express();
    app.use((req: any, _res, next) => { req.tenant = { plan: 'basic', settings: { timezone: TZ } }; req.tenantId = String(tenantId); next(); });
    app.use((_req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
    app.use('/api/admin', adminRoutes);
    const r = await request(app).get('/api/admin/dashboard');
    expect(r.status).toBe(200);
    expect(r.body.data.showMoney).toBe(false);
    expect(r.body.data.dayVisits).toBeNull();
    expect(r.body.data.attention.find((a: any) => a.key === 'channelAlerts')).toBeUndefined();
  });
});
