/**
 * Management reports: the stay-night engine (services/reports/stayEngine.ts), the pure
 * builders (forecast & pace, segmentation, booking insights) and, against a local Mongo,
 * the report routes end to end (multi-room stays, out-of-service rooms, posted vs booked
 * revenue, manager's flash).
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: '64b000000000000000000001', role: 'admin' }; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
  };
});

// eslint-disable-next-line import/first
import {
  Stay, Capacity, sourceOf, nightSold, nightlyRows, totals, sameDateLastYear, sameWeekdayLastYear, dateRange, soldInRange,
} from '../services/reports/stayEngine';
// eslint-disable-next-line import/first
import { buildForecast, buildSegmentation, buildBookingInsights } from '../services/reports/managementService';
// eslint-disable-next-line import/first
import reportRoutes from '../routes/reports';
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

const stay = (over: Partial<Stay>): Stay => ({
  id: Math.random().toString(36).slice(2), code: 'R', status: 'confirmed', checkIn: '2026-11-10', checkOut: '2026-11-12', nights: 2, rooms: 1,
  roomRevenue: 200, revenueBasis: 'booked', source: 'front_desk', sourceLabel: 'Front desk', roomTypeIds: ['T'], ratePlanName: 'BAR',
  bookedOn: '2026-11-01', leadDays: 9, guests: 2, guestKey: 'g1', commission: 0, cancelled: false, cancelledOn: null, ...over,
});
const cap = (activeRooms: number, ooo: Record<string, number> = {}): Capacity => ({ activeRooms, outOfOrder: new Map(Object.entries(ooo)) });

describe('stay engine', () => {
  it('tells sources apart', () => {
    expect(sourceOf({ channelSource: { otaName: 'Booking.com' } })).toEqual({ key: 'ota:booking.com', label: 'Booking.com' });
    expect(sourceOf({ isCorporate: true }).key).toBe('corporate');
    expect(sourceOf({ confirmationToken: 'a'.repeat(64) }).key).toBe('booking_engine');
    expect(sourceOf({ confirmationToken: '1700000000-abc' }).key).toBe('front_desk');
  });

  it('sells past nights only for stays that checked in; future nights when on the books', () => {
    expect(nightSold(stay({ status: 'confirmed' }), '2026-11-10', '2026-11-11')).toBe(false); // no-show
    expect(nightSold(stay({ status: 'confirmed' }), '2026-11-11', '2026-11-11')).toBe(true);
    expect(nightSold(stay({ status: 'completed' }), '2026-11-10', '2026-11-20')).toBe(true);
    expect(nightSold(stay({ cancelled: true, status: 'cancelled' }), '2026-11-11', '2026-11-01')).toBe(false);
  });

  it('counts every room of a multi-room stay and takes out-of-service rooms out of availability', () => {
    const rows = nightlyRows(['2026-11-10', '2026-11-11', '2026-11-12'], [stay({ rooms: 3, roomRevenue: 600 })], cap(10, { '2026-11-11': 2 }), '2026-11-01');
    expect(rows.map((r) => r.roomsSold)).toEqual([3, 3, 0]);
    expect(rows.map((r) => r.roomsAvailable)).toEqual([10, 8, 10]);
    expect(rows[1]).toMatchObject({ roomsOutOfOrder: 2, occupancyPct: 37.5, roomRevenue: 300, adr: 100, revpar: 37.5 });
    expect(totals(rows)).toMatchObject({ roomsSold: 6, roomsAvailable: 28, roomRevenue: 600, adr: 100 });
  });

  it('dates last year: same calendar date and same weekday', () => {
    expect(sameDateLastYear('2028-02-29')).toBe('2027-02-28');
    expect(sameDateLastYear('2026-11-01')).toBe('2025-11-01');
    expect(sameWeekdayLastYear('2026-11-02')).toBe('2025-11-03');
    expect(dateRange('2026-11-03', '2026-11-01')).toEqual([]);
  });

  it('sold nights inside a range', () => {
    expect(soldInRange(stay({ rooms: 2 }), '2026-11-11', '2026-11-30', '2026-11-01')).toEqual({ nights: 1, roomNights: 2, revenue: 100 });
  });
});

describe('forecast & pace', () => {
  it('on the books, 7-day pickup and STLY as it stood a year earlier', () => {
    const asOf = '2026-11-01';
    const days = ['2026-11-10', '2026-11-11'];
    const stays = [
      stay({ bookedOn: '2026-10-01' }),
      stay({ bookedOn: '2026-10-30', rooms: 2, roomRevenue: 400 }), // picked up in the last 7 days
    ];
    // Last year: nights 52 weeks earlier
    const ly = [
      stay({ checkIn: '2025-11-11', checkOut: '2025-11-13', bookedOn: '2025-10-01', status: 'completed' }),
      stay({ checkIn: '2025-11-11', checkOut: '2025-11-13', bookedOn: '2025-11-05', status: 'completed' }), // booked after the STLY as-of date (2025-11-02)
      stay({ checkIn: '2025-11-11', checkOut: '2025-11-13', bookedOn: '2025-10-01', cancelled: true, cancelledOn: '2025-11-20', status: 'cancelled' }), // still on the books then
    ];
    const f = buildForecast(days, stays, cap(10), ly, cap(10), asOf);
    expect(f.rows.map((r) => r.roomsSold)).toEqual([3, 3]);
    expect(f.rows.map((r) => r.pickup7)).toEqual([2, 2]);
    expect(f.rows[0].stlyDate).toBe('2025-11-11');
    expect(f.rows.map((r) => r.stlyRoomsSold)).toEqual([2, 2]);
    expect(f.rows[0].arrivals).toBe(3);
    expect(f.summary).toMatchObject({ roomsSold: 6, pickup7: 4 });
    expect(f.summary.stly.roomsSold).toBe(4);
  });
});

describe('segmentation', () => {
  it('splits revenue, commission and cancellations by source', () => {
    const today = '2026-11-01';
    const stays = [
      stay({ source: 'ota:booking.com', sourceLabel: 'Booking.com', roomRevenue: 300, nights: 3, checkOut: '2026-11-13', commission: 45, leadDays: 20 }),
      stay({ source: 'front_desk', roomRevenue: 200 }),
      stay({ source: 'ota:booking.com', sourceLabel: 'Booking.com', cancelled: true, cancelledOn: '2026-10-20', status: 'cancelled' }),
    ];
    const seg = buildSegmentation(stays, '2026-11-10', '2026-11-11', 'source', today);
    const bdc = seg.segments.find((s) => s.key === 'ota:booking.com')!;
    // 2 of 3 nights fall in range
    expect(bdc).toMatchObject({ reservations: 1, roomNights: 2, revenue: 200, adr: 100, commission: 30, netRevenue: 170, cancellations: 1, cancellationRatePct: 50, avgLeadDays: 20 });
    expect(seg.totals).toMatchObject({ revenue: 400, roomNights: 4, commission: 30, netRevenue: 370 });
    expect(bdc.revenueSharePct).toBe(50);
    expect(seg.bucket).toBe('day');
    expect(seg.trend.map((t) => t.values['ota:booking.com'])).toEqual([100, 100]);
  });

  it('room types share a multi-room stay by booked room', () => {
    const seg = buildSegmentation([stay({ rooms: 2, roomTypeIds: ['T', 'F'], roomRevenue: 400 })], '2026-11-10', '2026-11-11', 'roomType', '2026-11-01', { T: 'Twin', F: 'Family' });
    expect(seg.segments.map((s) => [s.label, s.revenue, s.roomNights])).toEqual([['Twin', 200, 2], ['Family', 200, 2]]);
  });
});

describe('booking insights', () => {
  it('lead time, LOS, cancellations, no-shows and repeat guests', () => {
    const today = '2026-11-15';
    const stays = [
      stay({ leadDays: 0, nights: 1, checkOut: '2026-11-11', status: 'completed', guestKey: 'repeat' }),
      stay({ leadDays: 10, status: 'confirmed' }), // past check-in, never arrived → no-show
      stay({ leadDays: 45, cancelled: true, status: 'cancelled', source: 'ota:airbnb', sourceLabel: 'airbnb' }),
      stay({ leadDays: 45, status: 'completed', guestKey: 'new' }),
    ];
    const first = new Map([['repeat', '2025-01-01'], ['new', '2026-11-10'], ['g1', '2026-11-10']]);
    const ins = buildBookingInsights(stays, [], first, today);
    expect(ins.arrivals).toBe(3);
    expect(ins.cancellationRatePct).toBe(25);
    expect(ins.noShows).toBe(1);
    expect(ins.leadTime.find((b) => b.key === '31-60')).toMatchObject({ reservations: 1, cancellations: 1, cancellationRatePct: 50 });
    expect(ins.lengthOfStay.find((b) => b.key === '1')!.reservations).toBe(1);
    expect(ins.repeatGuestPct).toBe(33.33);
    expect(ins.cancellationsBySource.find((s) => s.key === 'ota:airbnb')).toMatchObject({ cancellations: 1, cancellationRatePct: 100 });
  });
});

describe('report routes (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const roomIds = [0, 1, 2, 3].map(() => new mongoose.Types.ObjectId());
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
  app.use('/api/admin/reports', reportRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const noon = (d: string) => new Date(`${d}T12:00:00Z`);
  const base = { tenantId, type: 'room', guests: 2, guestDetails: { adults: 2, children: 0, infants: 0 }, totalPayments: 0, contactInfo: { email: 'a@example.com' } };

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_mgmtreports');
    if (!ready) { console.warn('Mongo unreachable — skipping report route DB tests'); return; }
    await Room.collection.insertMany(roomIds.map((_id, i) => ({ _id, tenantId, name: `R${i}`, status: 'active' })));
    await RoomBlock.collection.insertOne({ tenantId, roomId: roomIds[3], startDate: noon('2025-03-10'), endDate: noon('2025-03-12'), reason: 'maintenance' });
    const [multi, single] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await Reservation.collection.insertMany([
      // Two rooms, two nights, booked value 400 (no posted charges)
      { ...base, _id: multi, reservationCode: 'M1', status: 'completed', checkInDate: noon('2025-03-10'), checkOutDate: noon('2025-03-12'), rooms: [roomIds[0], roomIds[1]], room: roomIds[0],
        items: [{ kind: 'room', quantity: 2, unitPrice: 100, subtotal: 400, total: 400, totalTaxes: 0 }], estimatedTotal: 400, createdAt: noon('2025-03-01') },
      // One room, one night, posted charge 150 wins over booked 90
      { ...base, _id: single, reservationCode: 'S1', status: 'completed', checkInDate: noon('2025-03-11'), checkOutDate: noon('2025-03-12'), room: roomIds[2], rooms: [roomIds[2]],
        estimatedTotal: 90, createdAt: noon('2025-03-05'), channelSource: { provider: 'channex', otaName: 'Booking.com', otaCommission: 15 } },
      { ...base, reservationCode: 'C1', status: 'cancelled', checkInDate: noon('2025-03-11'), checkOutDate: noon('2025-03-12'), estimatedTotal: 90, createdAt: noon('2025-03-02'), updatedAt: noon('2025-03-04') },
    ]);
    const { insertedId: folioId } = await Folio.collection.insertOne({ tenantId, reservationId: single, status: 'closed' });
    await Charge.collection.insertOne({ tenantId, folioId, description: 'Room', amount: 150, type: 'base', category: 'room' });
  });
  afterAll(async () => { if (ready) await dropTestDb(); });

  itDb('occupancy counts multi-room stays, out-of-service rooms and posted revenue', async () => {
    const r = await request(app).get('/api/admin/reports/occupancy').query({ from: '2025-03-10', to: '2025-03-11' });
    expect(r.status).toBe(200);
    const [d10, d11] = r.body.data.rows;
    expect(d10).toMatchObject({ roomsAvailable: 3, roomsOutOfOrder: 1, roomsSold: 2, roomRevenue: 200 });
    expect(d11).toMatchObject({ roomsAvailable: 3, roomsSold: 3, occupancyPct: 100, roomRevenue: 350 });
  });

  itDb('segmentation by source, with commission', async () => {
    const r = await request(app).get('/api/admin/reports/segmentation').query({ from: '2025-03-10', to: '2025-03-11', by: 'source' });
    expect(r.status).toBe(200);
    const bdc = r.body.data.segments.find((s: any) => s.key === 'ota:booking.com');
    expect(bdc).toMatchObject({ revenue: 150, commission: 15, netRevenue: 135 });
    expect(r.body.data.segments.find((s: any) => s.key === 'front_desk')).toMatchObject({ revenue: 400, cancellations: 1 });
  });

  itDb('manager flash and booking insights answer', async () => {
    const flash = await request(app).get('/api/admin/reports/manager-flash').query({ date: '2025-03-11' });
    expect(flash.status).toBe(200);
    expect(flash.body.data.periods.day.current).toMatchObject({ roomsSold: 3, roomRevenue: 350 });
    expect(flash.body.data.operations).toMatchObject({ arrivals: 1, inHouse: 3 });
    expect(flash.body.data.outlook.rows).toHaveLength(30);
    const ins = await request(app).get('/api/admin/reports/booking-insights').query({ from: '2025-03-01', to: '2025-03-31' });
    expect(ins.status).toBe(200);
    expect(ins.body.data).toMatchObject({ arrivals: 2, cancellationRatePct: 33.33 });
    expect((await request(app).get('/api/admin/reports/forecast').query({ from: '2025-03-10', to: '2025-03-11' })).status).toBe(200);
  });

  itDb('rejects bad ranges and dimensions', async () => {
    expect((await request(app).get('/api/admin/reports/forecast').query({ from: '2025-02-30', to: '2025-03-01' })).status).toBe(400);
    expect((await request(app).get('/api/admin/reports/segmentation').query({ by: 'nope' })).status).toBe(400);
    expect((await request(app).get('/api/admin/reports/booking-insights').query({ from: '2025-03-10', to: '2025-03-01' })).status).toBe(400);
  });
});
