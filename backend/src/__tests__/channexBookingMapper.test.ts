/**
 * Booking mapper (services/channex/bookingMapper.ts, plan Phase 7.3) with fixture revisions in
 * the shapes of Channex's Booking.com, Expedia and Airbnb examples: new single/multi-room,
 * unmapped rate, modifications (room kept / released, after check-in), cancellations,
 * placeholder emails, overbooking, OTA-collect settlement, and the availability push every
 * applied revision queues. Local Mongo; the confirmation email is mocked.
 */
import mongoose from 'mongoose';

const mockSendConfirmation = jest.fn(() => Promise.resolve());
jest.mock('../utils/email', () => ({ sendReservationConfirmationEmail: (...a: any[]) => mockSendConfirmation(...(a as [])), tenantBaseUrl: (slug: string) => `http://${slug}.localhost:3000` }));

// eslint-disable-next-line import/first
import { applyBookingRevision, mapRevisionPayload, money, placeholderEmail } from '../services/channex/bookingMapper';
// eslint-disable-next-line import/first
import { invalidateChannelManagerCache } from '../services/channex/changeCapture';
// eslint-disable-next-line import/first
import { runInTenant } from '../services/channex/provisioning';
// eslint-disable-next-line import/first
import { connectTestDb, dropTestDb } from './helpers/testDb';
// eslint-disable-next-line import/first
import AppSettings from '../models/AppSettings';
// eslint-disable-next-line import/first
import ChannelAlert from '../models/ChannelAlert';
// eslint-disable-next-line import/first
import ChannelAriChange from '../models/ChannelAriChange';
// eslint-disable-next-line import/first
import ChannexEntityMap from '../models/ChannexEntityMap';
// eslint-disable-next-line import/first
import Company from '../models/Company';
// eslint-disable-next-line import/first
import CreditAccount from '../models/CreditAccount';
// eslint-disable-next-line import/first
import Folio from '../models/Folio';
// eslint-disable-next-line import/first
import Guest from '../models/Guest';
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
// eslint-disable-next-line import/first
import User from '../models/User';
// eslint-disable-next-line import/first
import { alertSummary, sendAlertDigests } from '../services/channex/alerts.service';

const PROP = '11111111-1111-1111-1111-111111111111';
const CH = { twin: 'ch-rt-twin', double: 'ch-rt-double', twinBar: 'ch-rp-twin-bar', doubleBar: 'ch-rp-double-bar' };

// ─── Fixtures (shapes from the Channex booking revision docs) ────────────────

let seq = 0;
interface Fx { bookingId: string; status?: 'new' | 'modified' | 'cancelled'; rooms?: any[]; insertedAt?: string; [k: string]: any }

function room(roomTypeId: string | null, ratePlanId: string | null, checkIn: string, checkOut: string, adults = 2, amount = '200.00') {
  return {
    room_type_id: roomTypeId, rate_plan_id: ratePlanId, checkin_date: checkIn, checkout_date: checkOut, amount,
    days: { [checkIn]: amount }, occupancy: { adults, children: 0, infants: 0 },
    guests: [{ name: 'Room', surname: 'Guest' }],
    taxes: [{ is_inclusive: true, name: 'ITBIS', total_price: '18.00', type: 'tax' }],
  };
}

const bookingCom = (f: Fx) => ({
  status: f.status ?? 'new', booking_id: f.bookingId, property_id: PROP, ota_name: 'BookingCom', unique_id: `BDC-${f.bookingId}`,
  ota_reservation_code: f.bookingId, arrival_date: f.rooms?.[0]?.checkin_date, departure_date: f.rooms?.[0]?.checkout_date,
  arrival_hour: '15:00', amount: f.amount ?? '200.00', currency: 'USD', notes: 'Late arrival please', payment_collect: 'property',
  payment_type: 'credit_card', ota_commission: '30.00', inserted_at: f.insertedAt ?? '2026-11-01T10:00:00Z',
  customer: { name: 'Ana', surname: 'Pérez', mail: f.mail ?? 'aperez.123@guest.booking.com', phone: '+1 809 555 0101', country: 'DO', meta: { is_genius: true } },
  guarantee: { card_type: 'MC', last4: '1111', expiration_date: '12/2027', is_virtual: true, meta: { virtual_card_currency_code: 'USD', virtual_card_current_balance: '22000', virtual_card_decimal_places: '2', virtual_card_effective_date: '2026-12-01' } },
  services: [{ type: 'Breakfast', name: 'Breakfast', total_price: '20.00', price_mode: 'Per person per night', persons: 2, nights: 1 }],
  rooms: f.rooms,
});

const expedia = (f: Fx) => ({
  status: f.status ?? 'new', booking_id: f.bookingId, property_id: PROP, ota_name: 'Expedia', unique_id: `EXP-${f.bookingId}`,
  ota_reservation_code: f.bookingId, amount: f.amount ?? '400.00', currency: 'USD', payment_collect: 'ota', payment_type: 'bank_transfer',
  inserted_at: f.insertedAt ?? '2026-11-01T10:00:00Z', customer: { name: 'John', surname: 'Smith', mail: 'jsmith@m.expediapartnercentral.com' },
  rooms: f.rooms,
});

const airbnb = (f: Fx) => ({
  status: f.status ?? 'new', booking_id: f.bookingId, property_id: PROP, ota_name: 'AirBNB', unique_id: `ABB-HM${f.bookingId}`,
  ota_reservation_code: `HM${f.bookingId}`, amount: f.amount ?? '200.00', currency: f.currency ?? 'USD', payment_collect: 'ota', payment_type: null,
  ota_commission: '6.00', inserted_at: f.insertedAt ?? '2026-11-01T10:00:00Z', customer: { name: 'Lea', surname: 'Roy', mail: null, phone: null },
  rooms: f.rooms,
});

const row = (payload: any) => ({
  channexRevisionId: `rev-${++seq}`, channexBookingId: payload.booking_id, channexPropertyId: PROP,
  status: payload.status, insertedAt: new Date(payload.inserted_at), payload,
}) as any;

// ─── Pure ────────────────────────────────────────────────────────────────────

describe('pure mapping', () => {
  const lookup = {
    roomTypes: new Map([[CH.twin, '64b000000000000000000001']]), ratePlans: new Map([[CH.twinBar, '64b000000000000000000011']]),
    roomTypeNames: new Map([['64b000000000000000000001', 'Twin Room']]), ratePlanNames: new Map([['64b000000000000000000011', 'Best Available Rate']]),
  };

  it('money and placeholder emails', () => {
    expect(money('200.00')).toBe(200);
    expect(money('19.999')).toBe(20);
    expect(money(null)).toBe(0);
    expect(placeholderEmail('BDC-123456', 'b')).toBe('ota-bdc-123456@noreply.pilloto.com');
    expect(placeholderEmail(undefined, 'e10de9d1-3e2c')).toBe('ota-e10de9d1-3e2c@noreply.pilloto.com');
  });

  it('maps a Booking.com revision field by field', () => {
    const p = bookingCom({ bookingId: 'B1', rooms: [room(CH.twin, CH.twinBar, '2027-01-10', '2027-01-12', 2, '240.00')], amount: '240.00' });
    const m = mapRevisionPayload(p, lookup, { revisionId: 'r1', bookingId: 'B1', propertyId: PROP });
    expect(m.guestName).toEqual({ firstName: 'Ana', lastName: 'Pérez' });
    expect(m).toMatchObject({ email: 'aperez.123@guest.booking.com', emailIsReal: true, guests: 2, estimatedTotal: 240, currency: 'USD' });
    expect(m.rooms[0].item).toMatchObject({ kind: 'room', unitPrice: 120, subtotal: 222, totalTaxes: 18, total: 240, adults: 2, quantity: 1 });
    expect(String(m.rooms[0].item.roomTypeId)).toBe('64b000000000000000000001');
    expect(m.checkInDate.toISOString()).toBe('2027-01-10T12:00:00.000Z');
    expect(m.specialRequests).toBe('Late arrival please\nHora de llegada: 15:00\nExtras: Breakfast 20.00');
    expect(m.pricingSnapshot).toMatchObject({ ratePlanName: 'Best Available Rate', roomTypeName: 'Twin Room', nights: 2, finalTotal: 240 });
    expect(m.channelSource).toMatchObject({
      provider: 'channex', otaName: 'Booking.com', otaCode: 'BDC', otaReservationCode: 'B1', uniqueId: 'BDC-B1', channexBookingId: 'B1',
      lastRevisionId: 'r1', paymentCollect: 'property', paymentType: 'credit_card', otaCommission: 30, currency: 'USD',
      guaranteeSummary: { cardType: 'MC', last4: '1111', isVirtual: true, virtualCardCurrency: 'USD', virtualCardBalance: 220, virtualCardActivationDate: '2026-12-01' },
    });
  });

  it('falls back to room guests, then the OTA name, and uses a placeholder for a missing email', () => {
    const p = airbnb({ bookingId: 'A1', rooms: [room(CH.twin, CH.twinBar, '2027-01-10', '2027-01-11')] });
    p.customer = { name: null, surname: null, mail: 'not-an-email' } as any;
    const m = mapRevisionPayload(p, lookup, { revisionId: 'r', bookingId: 'A1' });
    expect(m.guestName).toEqual({ firstName: 'Room', lastName: 'Guest' });
    expect(m).toMatchObject({ emailIsReal: false, email: 'ota-abb-hma1@noreply.pilloto.com' });
    p.rooms![0].guests = [];
    expect(mapRevisionPayload(p, lookup, { revisionId: 'r', bookingId: 'A1' }).guestName).toEqual({ firstName: 'Airbnb', lastName: 'Guest' });
  });
});

// ─── DB-backed ───────────────────────────────────────────────────────────────

describe('applyBookingRevision (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const ids = {
    twin: new mongoose.Types.ObjectId(), double: new mongoose.Types.ObjectId(),
    twinBar: new mongoose.Types.ObjectId(), doubleBar: new mongoose.Types.ObjectId(),
    t1: new mongoose.Types.ObjectId(), t2: new mongoose.Types.ObjectId(), d1: new mongoose.Types.ObjectId(),
  };
  const apply = (payload: any) => runInTenant(tenantId, () => applyBookingRevision(row(payload)));
  const applyRow = (r: any) => runInTenant(tenantId, () => applyBookingRevision(r));
  const res = (bookingId: string) => Reservation.collection.findOne({ 'channelSource.channexBookingId': bookingId });
  const alert = (type: string, key: string) => ChannelAlert.collection.findOne({ tenantId, type, dedupeKey: key });
  const outboxFor = (reservationId: unknown) => ChannelAriChange.collection.find({ tenantId, kind: 'availability', sourceId: reservationId }).toArray();
  const roomsOf = (r: any) => [...new Set([r.room, ...(r.rooms ?? [])].filter(Boolean).map(String))];

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_mapper');
    if (!ready) { console.warn('Mongo unreachable — skipping booking mapper DB tests'); return; }
    await Tenant.collection.insertOne({ _id: tenantId, name: 'Test Property', slug: 'mapper-test', isActive: true, products: ['pms'], settings: { currency: 'USD', timezone: 'America/Santo_Domingo' } });
    await AppSettings.collection.insertOne({ tenantId, key: 'global', channelManager: { enabled: true, autoAssignRooms: true, sendGuestConfirmationEmail: false, ratesIncludeTaxes: false } });
    await RoomType.collection.insertMany([
      { _id: ids.twin, tenantId, name: 'Twin Room', capacity: 2, isActive: true },
      { _id: ids.double, tenantId, name: 'Double Room', capacity: 2, isActive: true },
    ]);
    await RatePlan.collection.insertMany([
      { _id: ids.twinBar, tenantId, name: 'Best Available Rate', roomTypeId: ids.twin, basePrice: 100, isActive: true, occupancyTiers: [] },
      { _id: ids.doubleBar, tenantId, name: 'Best Available Rate', roomTypeId: ids.double, basePrice: 100, isActive: true, occupancyTiers: [] },
    ]);
    await Room.collection.insertMany([
      { _id: ids.t1, tenantId, name: 'T1', roomTypeId: ids.twin, status: 'active' },
      { _id: ids.t2, tenantId, name: 'T2', roomTypeId: ids.twin, status: 'active' },
      { _id: ids.d1, tenantId, name: 'D1', roomTypeId: ids.double, status: 'active' },
    ]);
    await ChannexEntityMap.collection.insertMany([
      { tenantId, environment: 'staging', kind: 'room_type', localId: ids.twin, channexId: CH.twin, channexPropertyId: PROP, status: 'active' },
      { tenantId, environment: 'staging', kind: 'room_type', localId: ids.double, channexId: CH.double, channexPropertyId: PROP, status: 'active' },
      { tenantId, environment: 'staging', kind: 'rate_plan', localId: ids.twinBar, channexId: CH.twinBar, channexPropertyId: PROP, status: 'active' },
      { tenantId, environment: 'staging', kind: 'rate_plan', localId: ids.doubleBar, channexId: CH.doubleBar, channexPropertyId: PROP, status: 'active' },
    ]);
    invalidateChannelManagerCache();
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    mockSendConfirmation.mockClear();
    if (!ready) return;
    await Reservation.collection.deleteMany({});
    await ChannelAlert.collection.deleteMany({});
    await ChannelAriChange.collection.deleteMany({});
  });
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  itDb('new single-room Booking.com booking: confirmed, room assigned, guest, folio, no email, availability queued', async () => {
    const out = await apply(bookingCom({ bookingId: 'N1', rooms: [room(CH.twin, CH.twinBar, '2027-01-10', '2027-01-12')] }));
    const r = (await res('N1'))!;
    expect(String(out.reservationId)).toBe(String(r._id));
    expect(r).toMatchObject({ type: 'room', status: 'confirmed', estimatedTotal: 200, roomCount: 1, guests: 2 });
    expect(r.reservationCode).toMatch(/^B\d{2}[A-Z0-9]{4}$/);
    expect(roomsOf(r)).toEqual([String(ids.t1)]);
    expect(String(r.items[0].roomTypeId)).toBe(String(ids.twin));
    expect(String(r.items[0].ratePlanId)).toBe(String(ids.twinBar));
    expect(r.contactInfo.email).toBe('aperez.123@guest.booking.com');
    expect(String(r.guestRecord)).toBe(String((await Guest.collection.findOne({ email: 'aperez.123@guest.booking.com' }))!._id));
    expect(await Folio.collection.countDocuments({ reservationId: r._id })).toBe(1);
    expect(r.company).toBeUndefined(); // guest pays the hotel
    expect(mockSendConfirmation).not.toHaveBeenCalled();
    const rows = await outboxFor(r._id);
    expect(rows.some((x) => String(x.roomTypeId) === String(ids.twin) && x.dateFrom <= '2027-01-10' && x.dateTo >= '2027-01-11')).toBe(true);
  });

  itDb('new multi-room booking with different room types: one item per room, each type assigned', async () => {
    await apply(expedia({ bookingId: 'M1', rooms: [room(CH.twin, CH.twinBar, '2027-02-01', '2027-02-03'), room(CH.double, CH.doubleBar, '2027-02-01', '2027-02-03')] }));
    const r = (await res('M1'))!;
    expect(r.items.map((i: any) => String(i.roomTypeId)).sort()).toEqual([String(ids.twin), String(ids.double)].sort());
    expect(r.roomCount).toBe(2);
    expect(r.guestDetails).toMatchObject({ adults: 4 });
    expect(roomsOf(r).sort()).toEqual([String(ids.t1), String(ids.d1)].sort());
    const rows = await outboxFor(r._id);
    expect(new Set(rows.map((x) => String(x.roomTypeId)))).toEqual(new Set([String(ids.twin), String(ids.double)]));
  });

  itDb('OTA-collect booking is billed to the OTA company with an active credit account (created once)', async () => {
    await apply(expedia({ bookingId: 'C1', rooms: [room(CH.twin, CH.twinBar, '2027-03-01', '2027-03-02')] }));
    await apply(expedia({ bookingId: 'C2', rooms: [room(CH.twin, CH.twinBar, '2027-03-05', '2027-03-06')] }));
    const companies = await Company.collection.find({ tenantId, name: 'Expedia' }).toArray();
    expect(companies).toHaveLength(1);
    expect(String((await res('C1'))!.company)).toBe(String(companies[0]._id));
    expect(String((await res('C2'))!.company)).toBe(String(companies[0]._id));
    expect(await CreditAccount.collection.findOne({ tenantId, scope: 'company', referenceId: companies[0]._id })).toMatchObject({ status: 'active' });
  });

  itDb('unmapped rate: created, item keeps its room type but no rate plan, critical alert', async () => {
    await apply(bookingCom({ bookingId: 'U1', rooms: [room(CH.twin, null, '2027-04-01', '2027-04-02')] }));
    const r = (await res('U1'))!;
    expect(r.items[0].ratePlanId).toBeUndefined();
    expect(String(r.items[0].roomTypeId)).toBe(String(ids.twin));
    expect(await alert('unmapped_booking', 'U1')).toMatchObject({ severity: 'critical', status: 'open' });
  });

  itDb('unmapped room: created without a room type or room, critical alert', async () => {
    await apply(bookingCom({ bookingId: 'U2', rooms: [room('ch-unknown', 'ch-unknown-rate', '2027-04-01', '2027-04-02')] }));
    const r = (await res('U2'))!;
    expect(r.items[0].roomTypeId).toBeUndefined();
    expect(roomsOf(r)).toEqual([]);
    expect((await alert('unmapped_booking', 'U2'))!.title).not.toMatch(/channex/i);
  });

  itDb('Airbnb booking without email: placeholder email, no guest record', async () => {
    const before = await Guest.collection.countDocuments({});
    await apply(airbnb({ bookingId: 'P1', rooms: [room(CH.double, CH.doubleBar, '2027-05-01', '2027-05-03')] }));
    const r = (await res('P1'))!;
    expect(r.contactInfo.email).toBe('ota-abb-hmp1@noreply.pilloto.com');
    expect(r.guestRecord).toBeUndefined();
    expect(await Guest.collection.countDocuments({})).toBe(before);
    expect(r.channelSource).toMatchObject({ otaName: 'Airbnb', paymentCollect: 'ota', otaCommission: 6 });
  });

  itDb('overbooking: a second Double on the same nights is still created, unassigned, with a critical alert naming the competitor', async () => {
    await apply(bookingCom({ bookingId: 'O1', rooms: [room(CH.double, CH.doubleBar, '2027-06-01', '2027-06-03')] }));
    await apply(airbnb({ bookingId: 'O2', rooms: [room(CH.double, CH.doubleBar, '2027-06-02', '2027-06-04')] }));
    const first = (await res('O1'))!;
    const second = (await res('O2'))!;
    expect(second.status).toBe('confirmed');
    expect(roomsOf(second)).toEqual([]);
    const a = (await alert('overbooking', 'O2'))!;
    expect(a.severity).toBe('critical');
    expect(a.details.nights).toEqual(['2027-06-02']);
    expect(a.details.competingReservations.map((c: any) => c.reservationId)).toEqual([String(first._id)]);
    expect(await alert('overbooking', 'O1')).toBeNull();
  });

  itDb('modification moving dates keeps the room when it is still free, and queues old ∪ new nights', async () => {
    await apply(bookingCom({ bookingId: 'K1', rooms: [room(CH.twin, CH.twinBar, '2027-07-10', '2027-07-12')] }));
    const before = (await res('K1'))!;
    expect(roomsOf(before)).toEqual([String(ids.t1)]);
    await ChannelAriChange.collection.deleteMany({});
    await apply(bookingCom({ bookingId: 'K1', status: 'modified', insertedAt: '2027-01-01T00:00:00Z', amount: '300.00', rooms: [room(CH.twin, CH.twinBar, '2027-07-11', '2027-07-14', 2, '300.00')] }));
    const after = (await res('K1'))!;
    expect(String(after._id)).toBe(String(before._id));
    expect(after.checkInDate.toISOString().slice(0, 10)).toBe('2027-07-11');
    expect(after.checkOutDate.toISOString().slice(0, 10)).toBe('2027-07-14');
    expect(after.estimatedTotal).toBe(300);
    expect(roomsOf(after)).toEqual([String(ids.t1)]);
    expect(after.reservationCode).toBe(before.reservationCode);
    const rows = await outboxFor(after._id);
    const covered = (d: string) => rows.some((x) => x.dateFrom <= d && x.dateTo >= d);
    expect(['2027-07-10', '2027-07-11', '2027-07-12', '2027-07-13'].every(covered)).toBe(true);
  });

  itDb('modification moving dates releases a room taken on the new nights and assigns a free one', async () => {
    await apply(bookingCom({ bookingId: 'R1', rooms: [room(CH.twin, CH.twinBar, '2027-08-10', '2027-08-12')] }));
    expect(roomsOf((await res('R1'))!)).toEqual([String(ids.t1)]);
    // Staff put another guest in T1 on the 13th
    await runInTenant(tenantId, () => Reservation.create({
      type: 'room', status: 'confirmed', checkInDate: new Date('2027-08-13T12:00:00Z'), checkOutDate: new Date('2027-08-14T12:00:00Z'),
      guests: 1, guestDetails: { adults: 1, children: 0, infants: 0 }, contactInfo: { email: 'walkin@example.com' }, estimatedTotal: 100,
      totalPayments: 0, room: ids.t1, rooms: [ids.t1], items: [{ kind: 'room', roomTypeId: ids.twin, quantity: 1, unitPrice: 100, subtotal: 100, taxes: [], totalTaxes: 0, total: 100 }],
    }));
    await apply(bookingCom({ bookingId: 'R1', status: 'modified', rooms: [room(CH.twin, CH.twinBar, '2027-08-12', '2027-08-14')] }));
    expect(roomsOf((await res('R1'))!)).toEqual([String(ids.t2)]);
  });

  itDb('a simulated overbooking shows in the nav badge count and produces one batched email', async () => {
    await User.collection.deleteMany({});
    await User.collection.insertOne({ tenantId, email: 'gm@hotel.test', firstName: 'G', role: 'admin', isActive: true, appRoles: [] });
    await apply(bookingCom({ bookingId: 'OB1', rooms: [room(CH.double, CH.doubleBar, '2027-07-01', '2027-07-03')] }));
    await apply(airbnb({ bookingId: 'OB2', rooms: [room(CH.double, CH.doubleBar, '2027-07-01', '2027-07-03')] }));
    await apply(bookingCom({ bookingId: 'OB3', rooms: [room(CH.double, CH.doubleBar, '2027-07-02', '2027-07-04')] }));
    expect(await runInTenant(tenantId, () => alertSummary())).toMatchObject({ openCritical: 2 });
    const send = jest.fn().mockResolvedValue('id');
    const now = new Date();
    await sendAlertDigests({ now, send });
    await sendAlertDigests({ now: new Date(now.getTime() + 60_000), send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('gm@hotel.test');
    expect(send.mock.calls[0][1].subject).toMatch(/^2 alertas del Channel Manager/);
    expect(send.mock.calls[0][1].text).toMatch(/Sobreventa: Airbnb/);
  });

  itDb('modification after check-in changes guest details only and raises a review alert with the diff', async () => {
    await apply(bookingCom({ bookingId: 'H1', rooms: [room(CH.twin, CH.twinBar, '2027-09-10', '2027-09-12')] }));
    await Reservation.collection.updateOne({ 'channelSource.channexBookingId': 'H1' }, { $set: { status: 'checked-in', actualCheckInAt: new Date() } });
    const p = bookingCom({ bookingId: 'H1', status: 'modified', rooms: [room(CH.twin, CH.twinBar, '2027-09-10', '2027-09-14')] });
    p.customer.surname = 'Pérez-Gómez';
    await apply(p);
    const r = (await res('H1'))!;
    expect(r.status).toBe('checked-in');
    expect(r.checkOutDate.toISOString().slice(0, 10)).toBe('2027-09-12');
    expect(r.guestName.lastName).toBe('Pérez-Gómez');
    const a = (await alert('modification_needs_review', 'H1'))!;
    expect(a.details.diff).toEqual([{ field: 'checkOut', from: '2027-09-12', to: '2027-09-14' }]);
  });

  itDb('cancellation: status cancelled with the OTA in the reason, room released for availability', async () => {
    await apply(bookingCom({ bookingId: 'X1', rooms: [room(CH.twin, CH.twinBar, '2027-10-10', '2027-10-12')] }));
    await ChannelAriChange.collection.deleteMany({});
    await apply(bookingCom({ bookingId: 'X1', status: 'cancelled', rooms: [room(CH.twin, CH.twinBar, '2027-10-10', '2027-10-12')] }));
    const r = (await res('X1'))!;
    expect(r.status).toBe('cancelled');
    expect(r.cancellationReason).toBe('Cancelled via Booking.com (X1)');
    expect((await outboxFor(r._id)).some((x) => x.dateFrom <= '2027-10-10' && x.dateTo >= '2027-10-11')).toBe(true);
  });

  itDb('cancellation after check-in does not cancel and raises a review alert', async () => {
    await apply(bookingCom({ bookingId: 'X2', rooms: [room(CH.twin, CH.twinBar, '2027-10-20', '2027-10-22')] }));
    await Reservation.collection.updateOne({ 'channelSource.channexBookingId': 'X2' }, { $set: { status: 'checked-in', actualCheckInAt: new Date() } });
    await apply(bookingCom({ bookingId: 'X2', status: 'cancelled', rooms: [room(CH.twin, CH.twinBar, '2027-10-20', '2027-10-22')] }));
    expect((await res('X2'))!.status).toBe('checked-in');
    expect(await alert('modification_needs_review', 'X2')).toMatchObject({ details: { change: 'cancelled' } });
  });

  itDb('a cancellation of an unknown booking creates nothing; a modification of one is created', async () => {
    expect(await apply(bookingCom({ bookingId: 'Z1', status: 'cancelled', rooms: [room(CH.twin, CH.twinBar, '2027-11-01', '2027-11-02')] }))).toEqual({});
    expect(await res('Z1')).toBeNull();
    await apply(bookingCom({ bookingId: 'Z2', status: 'modified', rooms: [room(CH.twin, CH.twinBar, '2027-11-01', '2027-11-02')] }));
    expect((await res('Z2'))!.status).toBe('confirmed');
  });

  itDb('re-applying the same revision does not duplicate or change anything', async () => {
    const r1 = row(bookingCom({ bookingId: 'I1', rooms: [room(CH.twin, CH.twinBar, '2027-12-01', '2027-12-02')] }));
    const a = await applyRow(r1);
    const b = await applyRow(r1);
    expect(String(a.reservationId)).toBe(String(b.reservationId));
    expect(await Reservation.collection.countDocuments({ 'channelSource.channexBookingId': 'I1' })).toBe(1);
  });

  itDb('currency mismatch raises a warning; confirmation email only when enabled and the email is real', async () => {
    await AppSettings.collection.updateOne({ tenantId }, { $set: { 'channelManager.sendGuestConfirmationEmail': true } });
    await apply(airbnb({ bookingId: 'E1', currency: 'EUR', rooms: [room(CH.twin, CH.twinBar, '2028-01-01', '2028-01-02')] }));
    expect(mockSendConfirmation).not.toHaveBeenCalled(); // placeholder email
    expect(await alert('currency_mismatch', 'E1')).toMatchObject({ severity: 'warning', details: { bookingCurrency: 'EUR', propertyCurrency: 'USD' } });
    await apply(bookingCom({ bookingId: 'E2', rooms: [room(CH.twin, CH.twinBar, '2028-01-05', '2028-01-06')] }));
    expect(mockSendConfirmation).toHaveBeenCalledTimes(1);
    await AppSettings.collection.updateOne({ tenantId }, { $set: { 'channelManager.sendGuestConfirmationEmail': false } });
  });

  itDb('autoAssignRooms off: no room is assigned', async () => {
    await AppSettings.collection.updateOne({ tenantId }, { $set: { 'channelManager.autoAssignRooms': false } });
    await apply(bookingCom({ bookingId: 'NA1', rooms: [room(CH.twin, CH.twinBar, '2028-02-01', '2028-02-02')] }));
    expect(roomsOf((await res('NA1'))!)).toEqual([]);
    await AppSettings.collection.updateOne({ tenantId }, { $set: { 'channelManager.autoAssignRooms': true } });
  });
});
