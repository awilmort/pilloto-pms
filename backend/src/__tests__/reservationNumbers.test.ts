/**
 * Reservation numbers (RES-000123): atomic per-property allocation (no duplicates however many are created, or
 * at once), the per-property unique index replacing the old global one, a counter that heals itself, the
 * migration for existing data, and the guest-access rules that make a guessable number safe.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

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
import Counter from '../models/Counter';
// eslint-disable-next-line import/first
import { allocateReservationCode, formatReservationCode, RESERVATION_COUNTER_KEY } from '../services/reservationCode';
// eslint-disable-next-line import/first
import { ensureReservationIndexes, hasLegacyReservationCodeIndex } from '../services/reservationIndexes';
// eslint-disable-next-line import/first
import { migrateReservationCodes } from '../scripts/migrate-reservation-codes';
// eslint-disable-next-line import/first
import { newFrontDeskToken, tokensMatch } from '../utils/guestAccess';
// eslint-disable-next-line import/first
import { BOOKING_ENGINE_TOKEN_RE } from '../services/reservationRecords';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
const inTenant = <T,>(tenantId: mongoose.Types.ObjectId, fn: () => Promise<T>): Promise<T> => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn) as Promise<T>;

describe('formatReservationCode (pure)', () => {
  it('pads to six digits and keeps growing past them — there is no ceiling', () => {
    expect(formatReservationCode(1)).toBe('RES-000001');
    expect(formatReservationCode(123)).toBe('RES-000123');
    expect(formatReservationCode(999_999)).toBe('RES-999999');
    expect(formatReservationCode(1_000_000)).toBe('RES-1000000');
  });
});

describe('guest access helpers (pure)', () => {
  it('front-desk tokens are 256 bits and never look like booking-engine tokens (source detection depends on it)', () => {
    const t = newFrontDeskToken();
    expect(t).toMatch(/^fd-[0-9a-f]{64}$/);
    expect(BOOKING_ENGINE_TOKEN_RE.test(t)).toBe(false);
    expect(newFrontDeskToken()).not.toBe(t);
  });

  it('compares tokens exactly, and rejects anything missing or of another type', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc123', 'abc124')).toBe(false);
    expect(tokensMatch('abc123', 'abc12')).toBe(false);
    expect(tokensMatch('abc123', undefined)).toBe(false);
    expect(tokensMatch('abc123', ['abc123'])).toBe(false);
    expect(tokensMatch(undefined, 'abc123')).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
  });
});

describe('reservation numbering (local Mongo)', () => {
  let ready = false;
  const A = new mongoose.Types.ObjectId();
  const B = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => tenantLocalStorage.run({ tenantId: String(req.header('x-test-tenant') || A) }, next));
  app.use('/api/reservations', reservationRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  const base = (extra: Record<string, unknown> = {}) => ({
    type: 'room', status: 'confirmed', guestName: { firstName: 'Ada', lastName: 'Lovelace' }, contactInfo: { email: 'ada@example.com' },
    checkInDate: day(10), checkOutDate: day(12), totalNights: 2, guests: 2, guestDetails: { adults: 2, children: 0, infants: 0 },
    estimatedTotal: 100, totalPayments: 0, ...extra,
  });
  const create = (tenant: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) => inTenant(tenant, () => Reservation.create(base(extra)));
  const codes = async (tenant: mongoose.Types.ObjectId) => (await Reservation.collection.find({ tenantId: tenant }).toArray()).map((r) => r.reservationCode as string);

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_resnum');
    if (!ready) { console.warn('Mongo unreachable — skipping reservation numbering DB tests'); return; }
    await Reservation.init();
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    if (!ready) return;
    await Reservation.collection.deleteMany({});
    await Counter.collection.deleteMany({});
  });

  itDb('numbers each property independently, from 1', async () => {
    expect(await inTenant(A, allocateReservationCode)).toBe('RES-000001');
    expect(await inTenant(A, allocateReservationCode)).toBe('RES-000002');
    expect(await inTenant(B, allocateReservationCode)).toBe('RES-000001');
    expect(await inTenant(A, allocateReservationCode)).toBe('RES-000003');
  });

  itDb('refuses to number anything outside a property context', async () => {
    await expect(tenantLocalStorage.run(null, () => allocateReservationCode())).rejects.toThrow(/tenant context/);
  });

  itDb('gives a new reservation its number on save — whichever route created it', async () => {
    const r = await create(A);
    expect(r.reservationCode).toBe('RES-000001');
    expect((await create(A)).reservationCode).toBe('RES-000002');
  });

  itDb('never duplicates under heavy concurrency: 150 reservations created at once get 150 distinct, gapless numbers', async () => {
    const made = await Promise.all(Array.from({ length: 150 }, () => create(A)));
    const got = made.map((r) => r.reservationCode as string);
    expect(new Set(got).size).toBe(150);
    expect([...got].sort()).toEqual(Array.from({ length: 150 }, (_, i) => formatReservationCode(i + 1)));
  });

  itDb('is also safe when several properties create at once — each keeps its own run', async () => {
    await Promise.all(Array.from({ length: 60 }, (_, i) => create(i % 2 ? A : B)));
    for (const t of [A, B]) {
      expect((await codes(t)).sort()).toEqual(Array.from({ length: 30 }, (_, i) => formatReservationCode(i + 1)));
    }
  });

  itDb('keeps codes that already exist: an explicit or legacy code is never replaced', async () => {
    const legacy = await create(A, { reservationCode: 'B26X7KQ' });
    expect(legacy.reservationCode).toBe('B26X7KQ');
    expect((await create(A)).reservationCode).toBe('RES-000001'); // legacy codes do not consume or disturb the sequence
  });

  itDb('a reservation that fails validation uses no number', async () => {
    await expect(inTenant(A, () => Reservation.create(base({ type: 'not-a-type' })))).rejects.toThrow();
    expect((await create(A)).reservationCode).toBe('RES-000001');
  });

  itDb('heals itself when the counter is behind the data (restored backup, import): it skips taken numbers', async () => {
    await Reservation.collection.insertMany([1, 2, 3, 4, 5].map((n) => ({ tenantId: A, reservationCode: formatReservationCode(n), type: 'room' })));
    // counter starts at 0 although RES-000001..5 exist
    expect(await inTenant(A, allocateReservationCode)).toBe('RES-000006');
    expect(await inTenant(A, allocateReservationCode)).toBe('RES-000007');
  });

  itDb('keeps going past six digits', async () => {
    await Counter.collection.insertOne({ tenantId: A, key: RESERVATION_COUNTER_KEY, seq: 999_999 });
    expect(await inTenant(A, allocateReservationCode)).toBe('RES-1000000');
    expect(await inTenant(A, allocateReservationCode)).toBe('RES-1000001');
  });

  itDb('the database itself forbids a duplicate within a property, but allows the same number in another', async () => {
    await Reservation.collection.insertOne({ tenantId: A, reservationCode: 'RES-000001' });
    await expect(Reservation.collection.insertOne({ tenantId: A, reservationCode: 'RES-000001' })).rejects.toMatchObject({ code: 11000 });
    await expect(Reservation.collection.insertOne({ tenantId: B, reservationCode: 'RES-000001' })).resolves.toBeTruthy();
  });

  itDb('reservations without a code never collide with each other', async () => {
    await expect(Reservation.collection.insertMany([{ tenantId: A, type: 'room' }, { tenantId: A, type: 'room' }, { tenantId: A, type: 'room', reservationCode: null }])).resolves.toBeTruthy();
  });

  describe('replacing the old global index', () => {
    const makeLegacy = () => Reservation.collection.createIndex({ reservationCode: 1 }, { unique: true, sparse: true, name: 'reservationCode_1' });

    itDb('while the old index exists, a second property cannot use the same number — the reason it must go', async () => {
      await makeLegacy();
      await Reservation.collection.insertOne({ tenantId: A, reservationCode: 'RES-000001' });
      await expect(Reservation.collection.insertOne({ tenantId: B, reservationCode: 'RES-000001' })).rejects.toMatchObject({ code: 11000 });
      await Reservation.collection.dropIndex('reservationCode_1');
    });

    itDb('server start drops it and builds the new one, so two properties can both have RES-000001', async () => {
      await makeLegacy();
      expect(await hasLegacyReservationCodeIndex(mongoose.connection.db!)).toBe(true);
      expect(await ensureReservationIndexes()).toEqual({ droppedLegacyIndex: true });
      expect(await hasLegacyReservationCodeIndex(mongoose.connection.db!)).toBe(false);
      expect((await create(A)).reservationCode).toBe('RES-000001');
      expect((await create(B)).reservationCode).toBe('RES-000001');
      expect(await ensureReservationIndexes()).toEqual({ droppedLegacyIndex: false }); // idempotent
    });
  });

  describe('migration of existing reservations', () => {
    const seed = async () => {
      await Reservation.collection.createIndex({ reservationCode: 1 }, { unique: true, sparse: true, name: 'reservationCode_1' }).catch(() => undefined);
      const t = (n: number) => new Date(2025, 0, n);
      await Reservation.collection.insertMany([
        { tenantId: A, type: 'room', reservationCode: 'B25AAAA', createdAt: t(1) },           // already has a (legacy) code
        { tenantId: A, type: 'room', createdAt: t(3), tag: 'third' },                         // no code
        { tenantId: A, type: 'room', reservationCode: null, createdAt: t(2), tag: 'second' }, // null code
        { tenantId: A, type: 'room', reservationCode: '', createdAt: t(4), tag: 'fourth' },   // empty code
        { tenantId: B, type: 'room', createdAt: t(1), tag: 'b-first' },
      ]);
    };
    const codeOf = async (tag: string) => (await Reservation.collection.findOne({ tag }))!.reservationCode;

    itDb('a dry run reports and changes nothing', async () => {
      await seed();
      const report = await migrateReservationCodes(mongoose.connection.db!, false);
      expect(report).toMatchObject({ applied: false, legacyIndexPresent: true, withoutCode: 4, backfilled: 0 });
      expect(report.perTenant).toEqual({ [String(A)]: 3, [String(B)]: 1 });
      expect(await codeOf('third')).toBeUndefined();
      expect(await hasLegacyReservationCodeIndex(mongoose.connection.db!)).toBe(true);
    });

    itDb('applying numbers the missing ones oldest-first per property, keeps existing codes, and drops the old index', async () => {
      await seed();
      const report = await migrateReservationCodes(mongoose.connection.db!, true);
      expect(report).toMatchObject({ applied: true, backfilled: 4 });
      expect(await codeOf('second')).toBe('RES-000001');
      expect(await codeOf('third')).toBe('RES-000002');
      expect(await codeOf('fourth')).toBe('RES-000003');
      expect(await codeOf('b-first')).toBe('RES-000001');
      expect((await Reservation.collection.findOne({ reservationCode: 'B25AAAA' }))).toBeTruthy();
      expect(await hasLegacyReservationCodeIndex(mongoose.connection.db!)).toBe(false);
    });

    itDb('is safe to run twice: the second run finds nothing to do', async () => {
      await seed();
      await migrateReservationCodes(mongoose.connection.db!, true);
      expect(await migrateReservationCodes(mongoose.connection.db!, true)).toMatchObject({ withoutCode: 0, backfilled: 0, legacyIndexPresent: false });
    });

    itDb('new reservations after the migration continue the sequence', async () => {
      await seed();
      await migrateReservationCodes(mongoose.connection.db!, true);
      expect((await create(A)).reservationCode).toBe('RES-000004');
    });
  });

  describe('guest access without logging in', () => {
    const token = 'f'.repeat(64);
    let code = '';
    beforeEach(async () => {
      const r = await create(A, { confirmationToken: token, status: 'confirmed' });
      code = r.reservationCode as string;
    });
    const view = (c: string, q = '') => request(app).get(`/api/reservations/public/code/${c}${q}`);
    const cancel = (c: string, body: Record<string, unknown> = {}, q = '') => request(app).put(`/api/reservations/public/code/${c}/cancel${q}`).send(body);
    const status = async () => (await Reservation.collection.findOne({ reservationCode: code }))!.status;

    itDb('the number alone opens nothing — it is guessable, so it proves nothing', async () => {
      expect((await view(code)).status).toBe(404);
    });

    itDb('a wrong token answers exactly like an unknown number (no way to learn which numbers exist)', async () => {
      const wrong = await view(code, '?token=nope');
      const unknown = await view('RES-999999', `?token=${token}`);
      expect(wrong.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(wrong.body).toEqual(unknown.body);
    });

    itDb('the right number and token opens it, whatever the case of the number', async () => {
      const res = await view(code.toLowerCase(), `?token=${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.reservationCode).toBe(code);
    });

    itDb('anyone counting RES-000001, 2, 3… cannot cancel reservations: no token, no cancellation', async () => {
      expect((await cancel(code)).status).toBe(404);
      expect((await cancel(code, { token: 'nope' })).status).toBe(404);
      expect(await status()).toBe('confirmed');
    });

    itDb('the guest, with the token from their confirmation, can still cancel', async () => {
      expect((await cancel(code, { token })).status).toBe(200);
      expect(await status()).toBe('cancelled');
    });

    itDb("another property's guest cannot reach it, even with the right number and token", async () => {
      const res = await request(app).get(`/api/reservations/public/code/${code}?token=${token}`).set('x-test-tenant', String(B));
      expect(res.status).toBe(404);
    });
  });
});
