/**
 * BillingSoft's webhook: the signature scheme, the raw-body route (mounted ahead of express.json),
 * at-least-once delivery (duplicates), and what each event makes Pilloto do.
 */
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

jest.mock('../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue('email-id') }));

/* eslint-disable import/first */
import { sendEmail } from '../utils/email';
import ElectronicInvoice from '../models/ElectronicInvoice';
import FiscalWebhookEvent from '../models/FiscalWebhookEvent';
import Tenant from '../models/Tenant';
import { encrypt } from '../utils/encryption';
import fiscalWebhookRoutes from '../routes/fiscalWebhook';
import { setBillingSoftClient } from '../services/fiscal/fiscalClient';
import { computeSignature, handleEvent, verifySignature, WEBHOOK_TOLERANCE_SECONDS } from '../services/fiscal/fiscalWebhook';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import { createFakeBillingSoft, FakeBillingSoft } from './helpers/fakeBillingSoft';
/* eslint-enable import/first */

const SECRET = 'whsec_test_secret_0123456789';
const NOW_S = 1_793_000_000;
const sign = (body: string, t = NOW_S, secret = SECRET) => `t=${t},v1=${computeSignature(secret, String(t), Buffer.from(body))}`;

describe('verifySignature', () => {
  const body = '{"id":"evt_1","type":"document.accepted"}';
  const base = { rawBody: Buffer.from(body), secret: SECRET, nowMs: NOW_S * 1000 };

  it('accepts the documented scheme: HMAC-SHA256 of "t.body"', () => {
    const expected = crypto.createHmac('sha256', SECRET).update(`${NOW_S}.${body}`).digest('hex');
    expect(computeSignature(SECRET, String(NOW_S), Buffer.from(body))).toBe(expected);
    expect(verifySignature({ ...base, header: sign(body) })).toEqual({ ok: true });
  });

  it('rejects a body that was changed after signing, even by one byte of whitespace', () => {
    expect(verifySignature({ ...base, rawBody: Buffer.from(`${body} `), header: sign(body) })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a signature made with another secret', () => {
    expect(verifySignature({ ...base, header: sign(body, NOW_S, 'whsec_other') })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a replay: a correctly signed delivery older (or later) than five minutes', () => {
    for (const t of [NOW_S - WEBHOOK_TOLERANCE_SECONDS - 1, NOW_S + WEBHOOK_TOLERANCE_SECONDS + 1]) {
      expect(verifySignature({ ...base, header: sign(body, t) })).toEqual({ ok: false, reason: 'stale' });
    }
    expect(verifySignature({ ...base, header: sign(body, NOW_S - WEBHOOK_TOLERANCE_SECONDS) })).toEqual({ ok: true });
  });

  it.each([[undefined, 'missing'], ['', 'missing'], ['garbage', 'malformed'], ['t=abc,v1=00', 'malformed'], [`t=${NOW_S}`, 'malformed'], [`t=${NOW_S},v1=zz`, 'malformed']])(
    'rejects a missing or malformed header (%j)',
    (header, reason) => {
      expect(verifySignature({ ...base, header: header as string | undefined })).toEqual({ ok: false, reason });
    },
  );
});

describe('webhook (local Mongo)', () => {
  let ready = false;
  let fake: FakeBillingSoft;
  const tenantId = new mongoose.Types.ObjectId();
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const app = express();
  app.use('/api/webhooks/billingsoft', fiscalWebhookRoutes);
  app.use(express.json()); // as in index.ts: the webhook is mounted ahead of this

  const event = (over: Record<string, unknown> = {}) => ({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'document.accepted',
    organizationId: 'org-1',
    createdAt: new Date().toISOString(),
    data: {},
    ...over,
  });
  const post = (e: object, header?: string, id: mongoose.Types.ObjectId | string = tenantId) => {
    const raw = JSON.stringify(e);
    return request(app)
      .post(`/api/webhooks/billingsoft/${id}`)
      .set('Content-Type', 'application/json')
      .set('BillingSoft-Signature', header ?? sign(raw, Math.floor(Date.now() / 1000)))
      .send(raw);
  };
  const issued = async () => {
    const answer = await fake.client.issue('org-1', 'invoices', { type: '32', payment: { type: 'cash' }, lines: [{ name: 'x', kind: 'service', quantity: '1', unitPrice: '100.00', tax: 'itbis18' }] } as any, `k${Math.random()}`);
    const detail = fake.documents.get(answer.documentId)!;
    const record = await ElectronicInvoice.create({
      tenantId, tipo: 'E32', route: 'invoices', idempotencyKey: answer.documentId, estadoECF: 'En Proceso', estatus: 'in_process',
      billingsoftDocumentId: answer.documentId, eNCF: answer.encf, totalFactura: 118, totalImpuestos: 18, generatedBy: new mongoose.Types.ObjectId(), generationSource: 'manual',
    });
    return { answer, detail, record };
  };

  beforeAll(async () => {
    process.env.BILLINGSOFT_PARTNER_API_KEY = 'test-partner-key';
    process.env.ECF_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    ready = await connectTestDb('pilloto_fiscal_webhook');
    if (ready) await Promise.all([FiscalWebhookEvent.init(), ElectronicInvoice.init()]); // unique indexes exist before the first write
    if (!ready) console.warn('Mongo unreachable — skipping fiscal webhook DB tests');
  });
  afterAll(async () => {
    setBillingSoftClient(null);
    delete process.env.BILLINGSOFT_PARTNER_API_KEY;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    if (!ready) return;
    jest.clearAllMocks();
    fake = createFakeBillingSoft();
    setBillingSoftClient(fake.client);
    await Promise.all([Tenant.collection.deleteMany({}), ElectronicInvoice.collection.deleteMany({}), FiscalWebhookEvent.collection.deleteMany({})]);
    fake.organizations.set('org-1', { id: 'org-1', externalRef: String(tenantId), isActive: true, environment: 'testecf', certification: 'in_progress', plan: 'essential' } as any);
    await Tenant.collection.insertOne({
      _id: tenantId, name: 'Hotel Prueba', slug: 'prueba', plan: 'pro', ownerEmail: 'dueno@prueba.com', isActive: true, products: ['pms'],
      fiscal: { organizationId: 'org-1', environment: 'testecf', certification: 'in_progress', isActive: true, plan: 'essential', webhookSecret: encrypt(SECRET) },
    });
  });

  describe('route', () => {
    itDb('answers 200 for a correctly signed event of this company', async () => {
      const r = await post(event({ type: 'document.received' }));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ success: true, outcome: 'ignored' });
    });

    itDb('answers 401 for a bad signature, an unknown company and a company with no webhook — the same way', async () => {
      const e = event();
      expect((await post(e, sign(JSON.stringify(e), Math.floor(Date.now() / 1000), 'whsec_wrong'))).status).toBe(401);
      expect((await post(e, undefined, new mongoose.Types.ObjectId())).status).toBe(401);
      expect((await post(e, undefined, 'not-an-id')).status).toBe(401);
      await Tenant.collection.updateOne({ _id: tenantId }, { $unset: { 'fiscal.webhookSecret': '' } });
      expect((await post(e)).status).toBe(401);
      expect(await FiscalWebhookEvent.countDocuments({})).toBe(0);
    });

    itDb('refuses an event from another company\'s Organization even when it is correctly signed', async () => {
      const r = await post(event({ organizationId: 'org-999' }));
      expect(r.status).toBe(400);
    });

    itDb('refuses a stale delivery (replay)', async () => {
      const e = event();
      const r = await post(e, sign(JSON.stringify(e), Math.floor(Date.now() / 1000) - 3600));
      expect(r.status).toBe(401);
    });

    itDb('refuses a body that is not JSON', async () => {
      const raw = '{not json';
      const r = await request(app).post(`/api/webhooks/billingsoft/${tenantId}`).set('Content-Type', 'application/json').set('BillingSoft-Signature', sign(raw, Math.floor(Date.now() / 1000))).send(raw);
      expect(r.status).toBe(400);
    });
  });

  describe('events', () => {
    itDb('a verdict makes Pilloto read the document from BillingSoft — what the event says is not trusted', async () => {
      const { answer, record } = await issued();
      fake.setStatus(answer.documentId, 'accepted');
      // the event even lies about the status; only BillingSoft's document counts
      const r = await post(event({ type: 'document.rejected', data: { documentId: answer.documentId, status: 'rejected' } }));
      expect(r.status).toBe(200);
      expect(await ElectronicInvoice.findById(record._id)).toMatchObject({ estadoECF: 'Aceptado' });
    });

    itDb('a rejection tells the owner', async () => {
      const { answer } = await issued();
      fake.setStatus(answer.documentId, 'rejected');
      await post(event({ type: 'document.rejected', data: { documentId: answer.documentId } }));
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect((sendEmail as jest.Mock).mock.calls[0][0].to).toBe('dueno@prueba.com');
    });

    itDb('handles a repeated delivery once', async () => {
      const { answer, record } = await issued();
      fake.setStatus(answer.documentId, 'accepted');
      const e = event({ id: 'evt_dup', type: 'document.accepted', data: { documentId: answer.documentId } });
      expect((await post(e)).body.outcome).toBe('handled');
      await ElectronicInvoice.updateOne({ _id: record._id }, { $set: { estadoECF: 'En Proceso' } });
      expect((await post(e)).body.outcome).toBe('duplicate');
      expect(await ElectronicInvoice.findById(record._id)).toMatchObject({ estadoECF: 'En Proceso' }); // not applied twice
    });

    itDb('releases the event when handling fails, so BillingSoft\'s retry is handled instead of dropped', async () => {
      const { answer, record } = await issued();
      fake.setStatus(answer.documentId, 'accepted');
      const e = event({ id: 'evt_retry', data: { documentId: answer.documentId } });
      fake.failNext('getDocument', new Error('database blip'));
      expect((await post(e)).status).toBe(500);
      expect(await FiscalWebhookEvent.countDocuments({ eventId: 'evt_retry' })).toBe(0);
      expect((await post(e)).body.outcome).toBe('handled');
      expect(await ElectronicInvoice.findById(record._id)).toMatchObject({ estadoECF: 'Aceptado' });
    });

    itDb('an event for a document Pilloto does not know is acknowledged, not an error', async () => {
      const r = await post(event({ data: { documentId: 'doc-unknown' } }));
      expect(r.body.outcome).toBe('ignored');
    });

    itDb('"organization.certified" moves the company to production at once', async () => {
      fake.organizations.get('org-1')!.environment = 'ecf';
      fake.organizations.get('org-1')!.certification = 'certified';
      const r = await post(event({ type: 'organization.certified', data: { environment: 'ecf' } }));
      expect(r.body.outcome).toBe('handled');
      const tenant = await Tenant.findById(tenantId);
      expect(tenant?.fiscal).toMatchObject({ certification: 'certified', environment: 'ecf' });
    });

    itDb('"sequence.low" emails the owner, saying whether the range is exhausted', async () => {
      await handleEvent((await Tenant.findById(tenantId))!, event({ type: 'sequence.low', data: { documentType: '32', remaining: 12, exhausted: false } }) as any);
      await handleEvent((await Tenant.findById(tenantId))!, event({ type: 'sequence.low', data: { documentType: '31', remaining: 0, exhausted: true } }) as any);
      const subjects = (sendEmail as jest.Mock).mock.calls.map((c) => c[0].subject);
      expect(subjects[0]).toContain('Queda poco');
      expect(subjects[1]).toContain('Se agotó');
    });
  });
});
