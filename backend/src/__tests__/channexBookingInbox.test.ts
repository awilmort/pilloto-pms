/**
 * Booking revision inbox (services/channex/bookingInbox.ts, plan Phase 7.2): webhook + feed
 * deduplication, per-booking ordering and stale revisions, ack retries, unknown properties,
 * card scrubbing, and the tenant/platform inbox views. Channex client mocked; local Mongo.
 */
import mongoose from 'mongoose';
import {
  enqueueRevision, pollFeed, processInbox, revisionFacts, scrubRevisionPayload,
} from '../services/channex/bookingInbox';
import { runInTenant } from '../services/channex/provisioning';
import { loadBookingInbox } from '../services/channex/tenantViews';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import ChannelAlert from '../models/ChannelAlert';
import ChannexBookingRevision from '../models/ChannexBookingRevision';
import ChannexProperty from '../models/ChannexProperty';
import PlatformSettings from '../models/PlatformSettings';

const PROP = '11111111-1111-1111-1111-111111111111';
const OTHER_PROP = '99999999-9999-9999-9999-999999999999';

const GUARANTEE = {
  card_number: '411111******1111',
  card_type: 'MC',
  cardholder_name: 'Bookingcom Agent',
  cvv: '***',
  expiration_date: '12/2027',
  is_virtual: true,
  meta: { virtual_card_currency_code: 'USD', virtual_card_current_balance: '6755', virtual_card_decimal_places: '2', other: 'x' },
};

function rev(id: string, bookingId: string, status: 'new' | 'modified' | 'cancelled', insertedAt: string, propertyId = PROP) {
  return {
    id,
    type: 'booking_revision',
    attributes: {
      booking_id: bookingId, property_id: propertyId, status, inserted_at: insertedAt,
      ota_name: 'BookingCom', ota_reservation_code: `BDC-${bookingId}`, unique_id: `BDC-${bookingId}`,
      arrival_date: '2026-12-10', departure_date: '2026-12-12',
      customer: { name: 'Ana', surname: 'Pérez', mail: 'ana@example.com' },
      guarantee: GUARANTEE,
      rooms: [{ room_type_id: 'rt', rate_plan_id: 'rp', checkin_date: '2026-12-10', checkout_date: '2026-12-12', amount: '200.00' }],
      amount: '200.00', currency: 'USD',
    },
  };
}

// ─── Pure ────────────────────────────────────────────────────────────────────

describe('card scrubbing', () => {
  it('keeps only card type, last 4, expiry, virtual flag and virtual-card meta', () => {
    const out = scrubRevisionPayload({ ...rev('r', 'b', 'new', '2026-11-01T10:00:00Z').attributes, rooms: [{ guarantee: GUARANTEE, card_number: '4111111111111111' }] });
    expect(out.guarantee).toEqual({
      card_type: 'MC', last4: '1111', expiration_date: '12/2027', is_virtual: true,
      meta: { virtual_card_currency_code: 'USD', virtual_card_current_balance: '6755', virtual_card_decimal_places: '2' },
    });
    const json = JSON.stringify(out);
    for (const s of ['411111', 'card_number', 'cvv', 'cardholder_name', 'Bookingcom Agent', '4111111111111111']) expect(json).not.toContain(s);
    expect((out.rooms as any[])[0].guarantee.last4).toBe('1111');
  });

  it('revisionFacts reads ids, status, time and OTA codes', () => {
    const f = revisionFacts(rev('r-1', 'b-1', 'modified', '2026-11-01T10:00:00Z') as any)!;
    expect(f).toMatchObject({ revisionId: 'r-1', bookingId: 'b-1', propertyId: PROP, status: 'modified', otaName: 'BookingCom', otaReservationCode: 'BDC-b-1' });
    expect(f.insertedAt!.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(JSON.stringify(f.payload)).not.toContain('411111');
    expect(revisionFacts({ id: 'x', attributes: {} } as any)).toBeNull();
  });
});

// ─── DB-backed ───────────────────────────────────────────────────────────────

describe('booking inbox (local Mongo)', () => {
  let ready = false;
  const saved = { ...process.env };
  const tenantId = new mongoose.Types.ObjectId();
  let feed: any[] = [];
  const acks: string[] = [];
  const fetched: Record<string, any> = {};
  const applied: string[] = [];

  const client: any = {
    config: { environment: 'staging' },
    paginateAll: jest.fn(async () => feed),
    get: jest.fn(async (path: string) => {
      const id = decodeURIComponent(path.split('/')[2]);
      if (!fetched[id]) throw new Error('404');
      return { data: fetched[id] };
    }),
    post: jest.fn(async (path: string) => {
      const id = decodeURIComponent(path.split('/')[2]);
      acks.push(id);
      return { meta: { message: 'Success' } };
    }),
  };
  const apply = jest.fn(async (row: any) => { applied.push(row.channexRevisionId); return {}; });
  const deps = () => ({ client, apply });
  const row = (id: string) => ChannexBookingRevision.collection.findOne({ channexRevisionId: id });

  beforeAll(async () => {
    process.env = { ...saved, CHANNEX_ENV: 'staging' };
    delete process.env.CHANNEX_API_KEY;
    ready = await connectTestDb('pilloto_inbox');
    if (!ready) { console.warn('Mongo unreachable — skipping booking inbox DB tests'); return; }
    await ChannexProperty.collection.insertOne({ tenantId, environment: 'staging', channexPropertyId: PROP, status: 'active', pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0 });
  });
  afterAll(async () => {
    process.env = saved;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    feed = []; acks.length = 0; applied.length = 0;
    for (const k of Object.keys(fetched)) delete fetched[k];
    apply.mockClear();
    apply.mockImplementation(async (r: any) => { applied.push(r.channexRevisionId); return {}; });
    if (ready) {
      await ChannexBookingRevision.deleteMany({});
      await ChannelAlert.deleteMany({});
      await PlatformSettings.deleteMany({});
    }
  });
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  itDb('a revision delivered by webhook and by the feed is applied once and acked once', async () => {
    const r = rev('rev-1', 'bk-1', 'new', '2026-11-01T10:00:00Z');
    await enqueueRevision({ tenantId, channexPropertyId: PROP, revisionId: 'rev-1', bookingId: 'bk-1', source: 'webhook' });
    await enqueueRevision({ tenantId, channexPropertyId: PROP, revisionId: 'rev-1', bookingId: 'bk-1', source: 'webhook' });
    feed = [r];
    const report = await pollFeed(deps());
    expect(report).toMatchObject({ ran: true, received: 1, applied: 1, acked: 1 });
    feed = [];
    await pollFeed(deps());
    await processInbox(deps());
    expect(applied).toEqual(['rev-1']);
    expect(acks).toEqual(['rev-1']);
    expect(await ChannexBookingRevision.countDocuments({})).toBe(1);
    const stored = await row('rev-1');
    expect(stored).toMatchObject({ processing: 'applied', source: 'webhook', status: 'new', otaName: 'BookingCom', otaReservationCode: 'BDC-bk-1' });
    expect(stored!.ackedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(stored!.payload)).not.toContain('411111');
  });

  itDb('a webhook-only revision is fetched, scrubbed, applied in its tenant and acked', async () => {
    fetched['rev-w'] = rev('rev-w', 'bk-w', 'new', '2026-11-01T10:00:00Z');
    await enqueueRevision({ tenantId, channexPropertyId: PROP, revisionId: 'rev-w', bookingId: 'bk-w', source: 'webhook' });
    let tenantSeen: string | undefined;
    apply.mockImplementationOnce(async (r: any) => {
      tenantSeen = (await ChannexProperty.findOne({}).lean()) ? String(r.tenantId) : undefined;
      applied.push(r.channexRevisionId);
      return { reservationId: new mongoose.Types.ObjectId() };
    });
    expect(await processInbox(deps())).toMatchObject({ fetched: 1, applied: 1, acked: 1 });
    expect(client.get).toHaveBeenCalledWith('/booking_revisions/rev-w');
    expect(tenantSeen).toBe(String(tenantId));
    const stored = await row('rev-w');
    expect(stored!.reservationId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(JSON.stringify(stored!.payload)).not.toMatch(/411111|cardholder_name|cvv/);
  });

  itDb('modified before new: the modification applies, the older new is skipped as stale (and acked)', async () => {
    feed = [rev('rev-mod', 'bk-2', 'modified', '2026-11-01T11:00:00Z')];
    await pollFeed(deps());
    feed = [rev('rev-new', 'bk-2', 'new', '2026-11-01T10:00:00Z')];
    const report = await pollFeed(deps());
    expect(report).toMatchObject({ applied: 0, stale: 1 });
    expect(applied).toEqual(['rev-mod']);
    expect((await row('rev-new'))!.processing).toBe('skipped_stale');
    expect(acks.sort()).toEqual(['rev-mod', 'rev-new']);
  });

  itDb('an older modification arriving after a newer one is skipped; same-pass revisions apply oldest first', async () => {
    feed = [rev('m2', 'bk-3', 'modified', '2026-11-01T12:00:00Z'), rev('n1', 'bk-3', 'new', '2026-11-01T10:00:00Z')];
    await pollFeed(deps());
    expect(applied).toEqual(['n1', 'm2']);
    feed = [rev('m1', 'bk-3', 'modified', '2026-11-01T11:00:00Z')];
    await pollFeed(deps());
    expect((await row('m1'))!.processing).toBe('skipped_stale');
    expect(applied).toEqual(['n1', 'm2']);
  });

  itDb('a failed ack is retried on the next poll without applying again', async () => {
    // Channex unreachable for acks during the whole first poll (inline ack + end-of-pass retry)
    client.post.mockImplementationOnce(async () => { throw new Error('Channex unreachable (ECONNRESET)'); })
      .mockImplementationOnce(async () => { throw new Error('Channex unreachable (ECONNRESET)'); });
    feed = [rev('rev-a', 'bk-4', 'new', '2026-11-01T10:00:00Z')];
    expect(await pollFeed(deps())).toMatchObject({ applied: 1, acked: 0, ackFailures: 2 });
    expect((await row('rev-a'))!.ackedAt).toBeUndefined();
    // Still unacked in Channex → the feed serves it again
    expect(await pollFeed(deps())).toMatchObject({ applied: 0, acked: 1 });
    expect(applied).toEqual(['rev-a']);
    expect((await row('rev-a'))!.ackedAt).toBeInstanceOf(Date);
  });

  itDb('a revision the feed serves again after Pilloto acked it is acked again (not re-applied)', async () => {
    feed = [rev('rev-b', 'bk-5', 'new', '2026-11-01T10:00:00Z')];
    await pollFeed(deps());
    await pollFeed(deps());
    expect(applied).toEqual(['rev-b']);
    expect(acks).toEqual(['rev-b', 'rev-b']);
  });

  itDb('an unknown property fails without ack and raises one platform alert; it applies once the property exists', async () => {
    feed = [rev('rev-u', 'bk-6', 'new', '2026-11-01T10:00:00Z', OTHER_PROP)];
    await pollFeed(deps());
    await pollFeed(deps());
    expect(applied).toEqual([]);
    expect(acks).toEqual([]);
    expect(await row('rev-u')).toMatchObject({ processing: 'failed' });
    expect(await ChannelAlert.collection.countDocuments({ type: 'unknown_property', dedupeKey: OTHER_PROP, tenantId: { $exists: false } })).toBe(1);

    const otherTenant = new mongoose.Types.ObjectId();
    await ChannexProperty.collection.insertOne({ tenantId: otherTenant, environment: 'staging', channexPropertyId: OTHER_PROP, status: 'active', pausedUntil: new Date(0), ariLeaseUntil: new Date(0), consecutiveFailures: 0 });
    await pollFeed(deps());
    expect(applied).toEqual(['rev-u']);
    expect(String((await row('rev-u'))!.tenantId)).toBe(String(otherTenant));
    await ChannexProperty.collection.deleteOne({ channexPropertyId: OTHER_PROP });
  });

  itDb('an apply failure holds back later revisions of the same booking, then both apply in order', async () => {
    apply.mockImplementationOnce(async () => { throw new Error('boom'); });
    feed = [rev('x1', 'bk-7', 'new', '2026-11-01T10:00:00Z'), rev('x2', 'bk-7', 'modified', '2026-11-01T11:00:00Z')];
    await pollFeed(deps());
    expect(await row('x1')).toMatchObject({ processing: 'received', attempts: 1, error: 'apply: boom' });
    expect((await row('x2'))!.processing).toBe('received');
    expect(acks).toEqual([]);
    await pollFeed(deps());
    expect(applied).toEqual(['x1', 'x2']);
    expect(acks).toEqual(['x1', 'x2']);
  });

  itDb('only one pass runs at a time (lease)', async () => {
    let release!: () => void;
    apply.mockImplementationOnce(() => new Promise((r) => { release = () => r({}); }));
    await enqueueRevision({ tenantId, channexPropertyId: PROP, revisionId: 'rev-l', bookingId: 'bk-8', source: 'webhook' });
    fetched['rev-l'] = rev('rev-l', 'bk-8', 'new', '2026-11-01T10:00:00Z');
    const first = processInbox(deps());
    await new Promise((r) => setTimeout(r, 200));
    expect((await processInbox(deps())).ran).toBe(false);
    release();
    expect((await first).ran).toBe(true);
    expect((await processInbox(deps())).ran).toBe(true);
  });

  itDb('tenant inbox view: words and codes, no Channex ids; platform view adds them', async () => {
    feed = [rev('rev-v', 'bk-9', 'new', '2026-11-01T10:00:00Z')];
    await pollFeed(deps());
    const tenantView = await runInTenant(tenantId, () => loadBookingInbox({ page: 1, limit: 10, detailed: false }));
    expect(tenantView.total).toBe(1);
    expect(tenantView.rows[0]).toMatchObject({
      otaName: 'BookingCom', otaReservationCode: 'BDC-bk-9', status: 'new', state: 'imported', guestName: 'Ana Pérez',
      arrivalDate: '2026-12-10', departureDate: '2026-12-12', acknowledged: true,
    });
    expect(JSON.stringify(tenantView)).not.toMatch(/rev-v|channex/i);
    const other = await runInTenant(new mongoose.Types.ObjectId(), () => loadBookingInbox({ page: 1, limit: 10, detailed: false }));
    expect(other.total).toBe(0);
    const platformView = await runInTenant(tenantId, () => loadBookingInbox({ page: 1, limit: 10, detailed: true }));
    expect(platformView.rows[0]).toMatchObject({ channexRevisionId: 'rev-v', channexBookingId: 'bk-9', source: 'feed' });
  });
});
