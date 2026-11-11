/**
 * /api/fiscal against a local Mongo: who may do what (through either app's roles), the activation
 * flow, issuing from a PMS folio, notes, files and email. Only `authenticate` is replaced — it
 * stands in for the JWT; role and permission resolution is the real `userHasPermission`.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

let currentUser: any;
let currentTenantId: string;
let currentProducts: string[];
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = currentUser;
      req.tenantId = currentTenantId;
      req.tenant = { products: currentProducts };
      next();
    },
  };
});
jest.mock('../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue('email-id') }));

/* eslint-disable import/first */
import { sendEmail } from '../utils/email';
import Charge from '../models/Charge';
import ElectronicInvoice from '../models/ElectronicInvoice';
import FiscalStatement from '../models/FiscalStatement';
import Folio from '../models/Folio';
import Payment from '../models/Payment';
import Reservation from '../models/Reservation';
import Role from '../models/Role';
import Tenant from '../models/Tenant';
import fiscalRoutes from '../routes/fiscal';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { setBillingSoftClient } from '../services/fiscal/fiscalClient';
import { resetPlanCatalogCache } from '../services/fiscal/fiscalPlans';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import { createFakeBillingSoft, FakeBillingSoft } from './helpers/fakeBillingSoft';
/* eslint-enable import/first */

describe('/api/fiscal (local Mongo)', () => {
  let ready = false;
  let fake: FakeBillingSoft;
  const tenantId = new mongoose.Types.ObjectId();
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => tenantLocalStorage.run({ tenantId: String(currentTenantId) }, next));
  app.use('/api/fiscal', fiscalRoutes);

  const roles: Record<string, mongoose.Types.ObjectId> = {};
  const mkRole = async (key: string, app: string, permissions: string[]) => {
    roles[key] = new mongoose.Types.ObjectId();
    await Role.collection.insertOne({ _id: roles[key], tenantId, name: key, app, permissions, isSystem: false });
  };
  const userWith = (...appRoles: [string, string][]) => ({
    _id: new mongoose.Types.ObjectId(), email: 'u@prueba.com', role: 'staff', isSuperAdmin: false,
    appRoles: appRoles.map(([app, key]) => ({ app, role: roles[key] })),
  });
  const as = (user: any, products: string[] = ['pms']) => { currentUser = user; currentProducts = products; };

  const seedTenant = (fiscal: Record<string, unknown> | null, over: Record<string, unknown> = {}) =>
    Tenant.collection.insertOne({
      _id: tenantId, name: 'Hotel Prueba', slug: 'prueba', plan: 'pro', ownerEmail: 'dueno@prueba.com', isActive: true, products: ['pms'], plans: {},
      profile: { legalName: 'Hotel Prueba SRL', rnc: '131880681', address: 'Av. Principal 1' },
      ...(fiscal ? { fiscal } : {}), ...over,
    });
  const certified = { organizationId: 'org-1', environment: 'ecf', certification: 'certified', isActive: true, plan: 'essential', provisionedAt: new Date('2026-10-01T12:00:00Z'), lastSyncedAt: new Date() };

  beforeAll(async () => {
    process.env.BILLINGSOFT_PARTNER_API_KEY = 'test-partner-key';
    process.env.BACKEND_PUBLIC_URL = 'https://backend.test';
    process.env.ECF_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    currentTenantId = String(tenantId);
    ready = await connectTestDb('pilloto_fiscal_routes');
    if (ready) await Promise.all([ElectronicInvoice.init(), FiscalStatement.init()]); // unique indexes exist before the first write
    if (!ready) { console.warn('Mongo unreachable — skipping fiscal route DB tests'); return; }
    await mkRole('pms-viewer', 'pms', ['admin.ecf.view']);
    await mkRole('pms-cashier', 'pms', ['cashier']);
    await mkRole('pms-settings', 'pms', ['admin.settings']);
    await mkRole('pms-nothing', 'pms', ['admin.guests']);
    await mkRole('acct-viewer', 'accounting', ['accounting.invoices.view']);
    await mkRole('acct-invoicer', 'accounting', ['accounting.invoices.manage']);
    await mkRole('acct-settings', 'accounting', ['accounting.settings.manage']);
    await mkRole('acct-admin', 'accounting', ['accounting.access']);
  });
  afterAll(async () => {
    setBillingSoftClient(null);
    delete process.env.BILLINGSOFT_PARTNER_API_KEY;
    delete process.env.BACKEND_PUBLIC_URL;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    if (!ready) return;
    jest.clearAllMocks();
    resetPlanCatalogCache();
    fake = createFakeBillingSoft();
    fake.organizations.set('org-1', { id: 'org-1', externalRef: String(tenantId), isActive: true, plan: 'essential', environment: 'ecf', certification: 'certified', rnc: '131880681' } as any);
    setBillingSoftClient(fake.client);
    await Promise.all([Tenant, ElectronicInvoice, Folio, Charge, Payment, Reservation, FiscalStatement].map((m: any) => m.collection.deleteMany({})));
  });

  // ── Access ──────────────────────────────────────────────────────────────────

  describe('access', () => {
    itDb('a PMS role with e-CF access can view', async () => {
      await seedTenant(certified);
      as(userWith(['pms', 'pms-viewer']));
      expect((await request(app).get('/api/fiscal/status')).status).toBe(200);
    });

    itDb('an Accounting-only company can use e-CF — through its Accounting roles', async () => {
      await seedTenant(certified, { products: ['accounting'], plans: { accounting: 'pro' } });
      as(userWith(['accounting', 'acct-viewer']), ['accounting']);
      const r = await request(app).get('/api/fiscal/status');
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ state: 'ready', canIssue: true, includedPlan: 'essential' });
    });

    itDb('a user with no relevant role in any app is refused', async () => {
      await seedTenant(certified);
      as(userWith(['pms', 'pms-nothing']));
      expect((await request(app).get('/api/fiscal/status')).status).toBe(403);
      as(userWith());
      expect((await request(app).get('/api/fiscal/documents')).status).toBe(403);
    });

    itDb('a PMS role does not open e-CF in a company that never bought PMS', async () => {
      await seedTenant(certified, { products: ['accounting'] });
      as(userWith(['pms', 'pms-viewer']), ['accounting']);
      expect((await request(app).get('/api/fiscal/status')).status).toBe(403);
    });

    itDb('viewing is not managing: plan, activation, sequences and approvals need settings access', async () => {
      await seedTenant(certified);
      as(userWith(['pms', 'pms-viewer']));
      expect((await request(app).get('/api/fiscal/plans')).status).toBe(403);
      expect((await request(app).put('/api/fiscal/plan').send({ plan: 'pro' })).status).toBe(403);
      expect((await request(app).post('/api/fiscal/sequences').send({})).status).toBe(403);
      expect((await request(app).post('/api/fiscal/received/x/decision').send({ decision: 'approved' })).status).toBe(403);
      expect((await request(app).get('/api/fiscal/statements')).status).toBe(403);
      as(userWith(['pms', 'pms-settings']));
      expect((await request(app).get('/api/fiscal/plans')).status).toBe(200);
    });

    itDb('the same holds from Accounting: settings access manages, invoice access issues, view only views', async () => {
      await seedTenant(certified, { products: ['accounting'], plans: { accounting: 'pro' } });
      as(userWith(['accounting', 'acct-viewer']), ['accounting']);
      expect((await request(app).get('/api/fiscal/plans')).status).toBe(403);
      expect((await request(app).post('/api/fiscal/documents/other').send({})).status).toBe(403);
      as(userWith(['accounting', 'acct-invoicer']), ['accounting']);
      expect((await request(app).post('/api/fiscal/documents/other').send({ type: '99' })).status).toBe(400); // allowed in, then validated
      as(userWith(['accounting', 'acct-settings']), ['accounting']);
      expect((await request(app).get('/api/fiscal/plans')).status).toBe(200);
      as(userWith(['accounting', 'acct-admin']), ['accounting']);
      expect((await request(app).get('/api/fiscal/plans')).status).toBe(200);
    });

    itDb('a cashier can issue from a folio but not manage the company\'s e-CF', async () => {
      await seedTenant(certified);
      as(userWith(['pms', 'pms-cashier']));
      expect((await request(app).post('/api/fiscal/documents/from-folio').send({})).status).toBe(400); // allowed in; folioId missing
      expect((await request(app).put('/api/fiscal/plan').send({ plan: 'pro' })).status).toBe(403);
    });
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  describe('activation and plans', () => {
    const body = (over: Record<string, unknown> = {}) => ({
      plan: 'essential', rnc: '131880681', razonSocial: 'Hotel Prueba SRL', address: 'Av. Principal 1, Sosúa',
      admin: { name: 'Carla Pérez', email: 'carla@prueba.com' }, confirmPreviousPostulationConcluded: true, ...over,
    });

    itDb('shows an inactive company what it can start from: its profile, the owner as administrator, the plan it includes', async () => {
      await seedTenant(null);
      as(userWith(['pms', 'pms-settings']));
      const r = await request(app).get('/api/fiscal/status');
      expect(r.body.data).toMatchObject({
        configured: true, state: 'inactive', canIssue: false, organization: null, includedPlan: 'essential',
        defaults: { rnc: '131880681', razonSocial: 'Hotel Prueba SRL', adminEmail: 'dueno@prueba.com' },
      });
      expect(r.body.data.links.certification).toBe('https://app.billingsoft.net/certificacion');
    });

    itDb('activates, and from then on both apps see the same state — configured once', async () => {
      await seedTenant(null, { products: ['pms', 'accounting'], plans: { accounting: 'starter' } });
      fake.organizations.clear();
      as(userWith(['pms', 'pms-settings']), ['pms', 'accounting']);
      const activated = await request(app).post('/api/fiscal/activate').send(body());
      expect(activated.status).toBe(201);
      expect(activated.body.data).toMatchObject({ state: 'not_started', canIssue: false, organization: { rnc: '131880681', plan: 'essential', webhookRegistered: true } });

      // the other app, with its own role, sees the very same company state without configuring anything
      as(userWith(['accounting', 'acct-viewer']), ['pms', 'accounting']);
      const seen = await request(app).get('/api/fiscal/status');
      expect(seen.body.data.organization.id).toBe(activated.body.data.organization.id);
      expect(seen.body.data.state).toBe('not_started');
    });

    itDb('says why activation was refused, field by field', async () => {
      await seedTenant(null);
      as(userWith(['pms', 'pms-settings']));
      const r = await request(app).post('/api/fiscal/activate').send(body({ rnc: '12', confirmPreviousPostulationConcluded: false }));
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ success: false, code: 'FISCAL_REJECTED', fields: { rnc: expect.any(String), confirmPreviousPostulationConcluded: expect.any(String) } }); // every problem at once
    });

    itDb('lists the plans with what each costs this company, and which it may choose', async () => {
      await seedTenant(certified, { plan: 'enterprise' }); // includes Pro
      as(userWith(['pms', 'pms-settings']));
      const r = await request(app).get('/api/fiscal/plans');
      const byId = Object.fromEntries(r.body.data.plans.map((p: any) => [p.id, p]));
      expect(r.body.data).toMatchObject({ includedPlan: 'pro', currentPlan: 'essential' });
      expect(byId.essential).toMatchObject({ selectable: false, monthlyCharge: 0 });
      expect(byId.pro).toMatchObject({ selectable: true, included: true, monthlyCharge: 0, change: 1 });
      expect(byId.max).toMatchObject({ selectable: true, monthlyCharge: 700, monthlyPrice: 1500 });
    });

    itDb('changes plan: an upgrade applies, and the answer says so', async () => {
      await seedTenant(certified);
      as(userWith(['pms', 'pms-settings']));
      const r = await request(app).put('/api/fiscal/plan').send({ plan: 'max' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ outcome: 'applied' });
      expect(r.body.data.organization.plan).toBe('max');
    });

    itDb('usage shows this month against the plan and what the overage costs', async () => {
      await seedTenant(certified);
      fake.usage.used = 320;
      as(userWith(['pms', 'pms-settings']));
      const r = await request(app).get('/api/fiscal/usage');
      expect(r.body.data).toMatchObject({ plan: 'essential', transactions: { included: 300, used: 320, extra: 20 }, overageAmount: 95, total: 95, currency: 'DOP' });
    });

    itDb('readiness reports the onboarding checklist live', async () => {
      await seedTenant(certified);
      as(userWith(['pms', 'pms-viewer']));
      const r = await request(app).get('/api/fiscal/readiness');
      expect(r.body.data).toMatchObject({ certification: 'certified', certificate: 'valid', usableTypes: ['31', '32'], complete: false });
      expect(r.body.data.steps.map((s: any) => s.step)).toEqual(['profile', 'certificate', 'sequences', 'directory', 'first_document']);
    });

    itDb('before activation there is nothing to read from BillingSoft', async () => {
      await seedTenant(null);
      as(userWith(['pms', 'pms-viewer']));
      expect((await request(app).get('/api/fiscal/readiness')).body).toMatchObject({ success: false, code: 'FISCAL_NOT_ACTIVATED' });
    });
  });

  // ── Issuing from a PMS folio ────────────────────────────────────────────────

  describe('issuing from a folio', () => {
    const seedFolio = async (amounts = [11800, 590]) => {
      const reservationId = new mongoose.Types.ObjectId();
      const folioId = new mongoose.Types.ObjectId();
      const paymentId = new mongoose.Types.ObjectId();
      await Reservation.collection.insertOne({ _id: reservationId, tenantId, reservationCode: 'RES-2026-001' });
      await Folio.collection.insertOne({ _id: folioId, tenantId, reservationId, status: 'open' });
      if (amounts.length) await Charge.collection.insertMany(amounts.map((amount, i) => ({ tenantId, folioId, description: `Cargo ${i + 1}`, amount, type: 'base' })));
      await Payment.collection.insertOne({ _id: paymentId, tenantId, folioId, amount: amounts.reduce((a, b) => a + b, 0), method: 'cash', status: 'completed' });
      return { folioId: String(folioId), paymentId: String(paymentId), reservationId };
    };

    itDb('issues a consumer invoice (32) for the folio and links it to the payment and reservation', async () => {
      await seedTenant(certified);
      const { folioId, paymentId, reservationId } = await seedFolio();
      as(userWith(['pms', 'pms-cashier']));
      const r = await request(app).post('/api/fiscal/documents/from-folio').send({ folioId, paymentId, buyerName: 'Ana Gómez', buyerEmail: 'ana@gmail.com' });
      expect(r.status).toBe(201);
      expect(r.body.queued).toBe(false);
      expect(r.body.data).toMatchObject({
        tipo: 'E32', estadoECF: 'En Proceso', generationSource: 'payment_screen', numeroFacturaInterna: 'RES-2026-001',
        totalFactura: 12390, buyerName: 'Ana Gómez', folioId, paymentId, reservationId: String(reservationId),
      });
      // the stored request and idempotency key stay server-side
      expect(r.body.data.request).toBeUndefined();
      expect(r.body.data.idempotencyKey).toBeUndefined();
    });

    itDb('is a credit-fiscal invoice (31) when the buyer gives an RNC', async () => {
      await seedTenant(certified);
      const { folioId } = await seedFolio();
      as(userWith(['pms', 'pms-cashier']));
      const r = await request(app).post('/api/fiscal/documents/from-folio').send({ folioId, buyerRnc: '101-01010-1', buyerRazonSocial: 'Grupo Caribe SRL' });
      expect(r.body.data).toMatchObject({ tipo: 'E31', buyerRnc: '101010101', buyerName: 'Grupo Caribe SRL' });
    });

    itDb('asking again for the same payment returns the e-CF instead of issuing another', async () => {
      await seedTenant(certified);
      const { folioId, paymentId } = await seedFolio();
      as(userWith(['pms', 'pms-cashier']));
      const first = await request(app).post('/api/fiscal/documents/from-folio').send({ folioId, paymentId });
      const second = await request(app).post('/api/fiscal/documents/from-folio').send({ folioId, paymentId });
      expect(second.status).toBe(200);
      expect(second.body.data._id).toBe(first.body.data._id);
      expect(fake.created()).toBe(1);
    });

    itDb('after DGII rejects it, the payment can be invoiced again as a new document', async () => {
      await seedTenant(certified);
      const { folioId, paymentId } = await seedFolio();
      as(userWith(['pms', 'pms-cashier']));
      const first = await request(app).post('/api/fiscal/documents/from-folio').send({ folioId, paymentId });
      await ElectronicInvoice.updateOne({ _id: first.body.data._id }, { $set: { estadoECF: 'Rechazado' } });
      const again = await request(app).post('/api/fiscal/documents/from-folio').send({ folioId, paymentId, buyerName: 'Ana Gómez' });
      expect(again.status).toBe(201);
      expect(again.body.data._id).not.toBe(first.body.data._id);
      expect(fake.created()).toBe(2);
    });

    itDb('says "queued" when BillingSoft cannot be reached — the payment is never affected', async () => {
      await seedTenant(certified);
      const { folioId, paymentId } = await seedFolio();
      fake.failNext('issue', new (require('../services/fiscal/billingsoftClient').BillingSoftError)('down', 0, 'NETWORK', undefined, true));
      as(userWith(['pms', 'pms-cashier']));
      const r = await request(app).post('/api/fiscal/documents/from-folio').send({ folioId, paymentId });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ queued: true });
      expect(r.body.data).toMatchObject({ estadoECF: 'Pendiente' });
    });

    itDb('is blocked until DGII certifies the company, with a code the UI can show', async () => {
      await seedTenant({ ...certified, certification: 'in_progress', environment: 'certecf' });
      const { folioId } = await seedFolio();
      as(userWith(['pms', 'pms-cashier']));
      const r = await request(app).post('/api/fiscal/documents/from-folio').send({ folioId });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('FISCAL_NOT_CERTIFIED');
      expect(fake.created()).toBe(0);
    });

    itDb('refuses an empty or unknown folio', async () => {
      await seedTenant(certified);
      const { folioId } = await seedFolio([]);
      as(userWith(['pms', 'pms-cashier']));
      expect((await request(app).post('/api/fiscal/documents/from-folio').send({ folioId })).status).toBe(400);
      expect((await request(app).post('/api/fiscal/documents/from-folio').send({ folioId: String(new mongoose.Types.ObjectId()) })).status).toBe(404);
      expect((await request(app).post('/api/fiscal/documents/from-folio').send({ folioId: 'nope' })).status).toBe(400);
    });

    itDb('relays BillingSoft\'s reason when it refuses the request', async () => {
      await seedTenant(certified);
      const { folioId } = await seedFolio();
      fake.failNext('issue', new (require('../services/fiscal/billingsoftClient').BillingSoftError)('El RNC del comprador no es válido', 400, 'VALIDATION_ERROR', { 'buyer.rnc': 'inválido' }));
      as(userWith(['pms', 'pms-cashier']));
      const r = await request(app).post('/api/fiscal/documents/from-folio').send({ folioId, buyerRnc: '101010101', buyerName: 'X' });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'FISCAL_REJECTED', message: 'El RNC del comprador no es válido', fields: { 'buyer.rnc': 'inválido' } });
      expect(await ElectronicInvoice.countDocuments({})).toBe(0);
    });
  });

  // ── Documents, notes, files, email ──────────────────────────────────────────

  describe('documents', () => {
    const issueOne = async (over: Record<string, unknown> = {}) => {
      const answer = await fake.client.issue('org-1', 'invoices', { type: '31', payment: { type: 'cash' }, lines: [{ name: 'x', kind: 'service', quantity: '1', unitPrice: '100.00', tax: 'itbis18' }] } as any, `k${Math.random()}`);
      return ElectronicInvoice.create({
        tenantId, tipo: 'E31', route: 'invoices', idempotencyKey: answer.documentId, estadoECF: 'Aceptado', estatus: 'accepted',
        billingsoftDocumentId: answer.documentId, eNCF: answer.encf, environment: 'ecf', totalFactura: 118, totalImpuestos: 18,
        buyerRnc: '101010101', buyerName: 'Grupo Caribe', buyerEmail: 'cxc@caribe.com', generatedBy: new mongoose.Types.ObjectId(), generationSource: 'manual',
        issuedAt: new Date('2026-11-08T15:00:00Z'), ...over,
      });
    };

    itDb('lists with filters and never returns the stored request or key', async () => {
      await seedTenant(certified);
      const a = await issueOne({ buyerName: 'Grupo Caribe' });
      await issueOne({ buyerName: 'Otro Cliente', tipo: 'E32', estadoECF: 'Rechazado' });
      as(userWith(['pms', 'pms-viewer']));
      const all = await request(app).get('/api/fiscal/documents');
      expect(all.body.meta.total).toBe(2);
      expect(all.body.data[0].idempotencyKey).toBeUndefined();
      expect((await request(app).get('/api/fiscal/documents?estadoECF=Rechazado')).body.data).toHaveLength(1);
      expect((await request(app).get('/api/fiscal/documents?tipo=E31')).body.data[0]._id).toBe(String(a._id));
      expect((await request(app).get('/api/fiscal/documents?q=caribe')).body.data).toHaveLength(1);
      expect((await request(app).get(`/api/fiscal/documents?q=${encodeURIComponent('.*')}`)).body.data).toHaveLength(0); // regex input is escaped
    });

    itDb('another company\'s documents are not found', async () => {
      await seedTenant(certified);
      const other = await ElectronicInvoice.collection.insertOne({ tenantId: new mongoose.Types.ObjectId(), tipo: 'E32', route: 'invoices', idempotencyKey: 'x', estadoECF: 'Aceptado', estatus: 'accepted', totalFactura: 1, totalImpuestos: 0, generatedBy: new mongoose.Types.ObjectId(), generationSource: 'manual', issuedAt: new Date() });
      as(userWith(['pms', 'pms-viewer']));
      expect((await request(app).get(`/api/fiscal/documents/${other.insertedId}`)).status).toBe(404);
    });

    itDb('refreshes a document from BillingSoft on demand', async () => {
      await seedTenant(certified);
      const doc = await issueOne({ estadoECF: 'En Proceso' });
      fake.setStatus(doc.billingsoftDocumentId!, 'accepted');
      as(userWith(['pms', 'pms-viewer']));
      const r = await request(app).post(`/api/fiscal/documents/${doc._id}/refresh`);
      expect(r.body.data.estadoECF).toBe('Aceptado');
      expect(fake.calls).toContain(`refreshDocument ${doc.billingsoftDocumentId}`);
    });

    itDb('serves the official PDF and XML from BillingSoft', async () => {
      await seedTenant(certified);
      const doc = await issueOne();
      as(userWith(['pms', 'pms-viewer']));
      const pdf = await request(app).get(`/api/fiscal/documents/${doc._id}/pdf`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['content-disposition']).toContain(`${doc.eNCF}.pdf`);
      expect((pdf.body as Buffer).toString()).toContain('%PDF');
      const xml = await request(app).get(`/api/fiscal/documents/${doc._id}/xml`);
      expect(xml.headers['content-type']).toContain('application/xml');
      expect(xml.text).toContain('<ECF');
    });

    itDb('has no files for a document BillingSoft has not confirmed', async () => {
      await seedTenant(certified);
      const doc = await issueOne({ estadoECF: 'Pendiente', billingsoftDocumentId: undefined, eNCF: undefined, idempotencyKey: 'p1' });
      as(userWith(['pms', 'pms-viewer']));
      expect((await request(app).get(`/api/fiscal/documents/${doc._id}/pdf`)).body.code).toBe('FISCAL_NO_DOCUMENT');
    });

    itDb('emails the PDF to the buyer, or to an address given', async () => {
      await seedTenant(certified);
      const doc = await issueOne();
      as(userWith(['pms', 'pms-cashier']));
      expect((await request(app).post(`/api/fiscal/documents/${doc._id}/email`).send({})).status).toBe(200);
      expect((sendEmail as jest.Mock).mock.calls[0][0]).toMatchObject({ to: 'cxc@caribe.com', subject: `e-CF ${doc.eNCF}` });
      expect((sendEmail as jest.Mock).mock.calls[0][0].attachments[0]).toMatchObject({ filename: `${doc.eNCF}.pdf`, contentType: 'application/pdf' });
      await request(app).post(`/api/fiscal/documents/${doc._id}/email`).send({ email: 'otra@persona.com' });
      expect((sendEmail as jest.Mock).mock.calls[1][0].to).toBe('otra@persona.com');
    });

    itDb('never emails a document issued in a DGII test environment — it has no fiscal value', async () => {
      await seedTenant(certified);
      const doc = await issueOne({ environment: 'testecf' });
      as(userWith(['pms', 'pms-cashier']));
      const r = await request(app).post(`/api/fiscal/documents/${doc._id}/email`).send({});
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('FISCAL_TEST_DOCUMENT');
      expect(sendEmail).not.toHaveBeenCalled();
    });

    itDb('refuses a bad address and a missing one', async () => {
      await seedTenant(certified);
      const doc = await issueOne({ buyerEmail: undefined });
      as(userWith(['pms', 'pms-cashier']));
      expect((await request(app).post(`/api/fiscal/documents/${doc._id}/email`).send({ email: 'no' })).status).toBe(400);
      expect((await request(app).post(`/api/fiscal/documents/${doc._id}/email`).send({})).status).toBe(400);
    });

    itDb('issues a credit note on an accepted invoice, referencing its e-NCF', async () => {
      await seedTenant(certified);
      const doc = await issueOne();
      as(userWith(['pms', 'pms-cashier']));
      const r = await request(app).post('/api/fiscal/documents/credit-note').send({ originalId: String(doc._id), codigoModificacion: '3', razonModificacion: 'Descuento acordado', totalAmount: 59 });
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ tipo: 'E34', originalENCF: doc.eNCF, codigoModificacion: '3', totalFactura: 59, generationSource: 'credit_note' });
      const sent = fake.calls.find((c) => c.startsWith('issue credit-notes'));
      expect(sent).toBeDefined();
    });

    itDb('refuses a note on a document that is not accepted, and one without a reason', async () => {
      await seedTenant(certified);
      const rejected = await issueOne({ estadoECF: 'Rechazado' });
      const ok = await issueOne();
      as(userWith(['pms', 'pms-cashier']));
      expect((await request(app).post('/api/fiscal/documents/credit-note').send({ originalId: String(rejected._id), codigoModificacion: '1', razonModificacion: 'x', totalAmount: 10 })).status).toBe(409);
      expect((await request(app).post('/api/fiscal/documents/credit-note').send({ originalId: String(ok._id), codigoModificacion: '1', razonModificacion: ' ', totalAmount: 10 })).status).toBe(400);
      expect((await request(app).post('/api/fiscal/documents/credit-note').send({ originalId: String(ok._id), codigoModificacion: '9', razonModificacion: 'x', totalAmount: 10 })).status).toBe(400);
      expect((await request(app).post('/api/fiscal/documents/credit-note').send({ originalId: String(ok._id), codigoModificacion: '1', razonModificacion: 'x' })).status).toBe(400);
    });

    itDb('issues a debit note', async () => {
      await seedTenant(certified);
      const doc = await issueOne();
      as(userWith(['pms', 'pms-cashier']));
      const r = await request(app).post('/api/fiscal/documents/debit-note').send({ originalId: String(doc._id), razonModificacion: 'Late checkout', items: [{ description: 'Late checkout', amount: 59 }] });
      expect(r.body.data).toMatchObject({ tipo: 'E33', codigoModificacion: '3', totalFactura: 59 });
    });

    itDb('sends a document BillingSoft never confirmed again; only those', async () => {
      await seedTenant(certified);
      const pending = await issueOne({ estadoECF: 'Pendiente', billingsoftDocumentId: undefined, eNCF: undefined, idempotencyKey: 'p2', route: 'invoices',
        request: { type: '32', payment: { type: 'cash' }, lines: [{ name: 'x', kind: 'service', quantity: '1', unitPrice: '100.00', tax: 'itbis18' }] } });
      const accepted = await issueOne();
      as(userWith(['pms', 'pms-cashier']));
      const r = await request(app).post(`/api/fiscal/documents/${pending._id}/retry`);
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ estadoECF: 'En Proceso' });
      expect((await request(app).post(`/api/fiscal/documents/${accepted._id}/retry`)).status).toBe(409);
    });
  });

  // ── Reports, alerts, sequences, received ────────────────────────────────────

  describe('operations', () => {
    itDb('alerts: rejected documents, queued ones, and a certificate that is expiring', async () => {
      await seedTenant(certified);
      const base = { tenantId, tipo: 'E32', route: 'invoices', estatus: 'x', totalFactura: 1, totalImpuestos: 0, generatedBy: new mongoose.Types.ObjectId(), generationSource: 'manual', issuedAt: new Date(), createdAt: new Date() };
      await ElectronicInvoice.collection.insertMany([
        { ...base, idempotencyKey: 'a', estadoECF: 'Rechazado' },
        { ...base, idempotencyKey: 'b', estadoECF: 'Pendiente', createdAt: new Date(Date.now() - 3600_000) },
      ]);
      as(userWith(['pms', 'pms-viewer']));
      const types = (await request(app).get('/api/fiscal/alerts')).body.data.map((a: any) => a.type);
      expect(types).toEqual(expect.arrayContaining(['rejected', 'queued']));
      expect(types).not.toContain('certificate_expiring');
    });

    itDb('alerts a company that is not certified yet, as information', async () => {
      await seedTenant({ ...certified, certification: 'in_progress' });
      as(userWith(['pms', 'pms-viewer']));
      const alerts = (await request(app).get('/api/fiscal/alerts')).body.data;
      expect(alerts).toContainEqual({ type: 'certification_in_progress', severity: 'info' });
    });

    itDb('the monthly tax report adds up accepted documents only', async () => {
      await seedTenant(certified);
      const base = { tenantId, route: 'invoices', estatus: 'x', generatedBy: new mongoose.Types.ObjectId(), generationSource: 'manual', issuedAt: new Date('2026-11-08T15:00:00Z') };
      await ElectronicInvoice.collection.insertMany([
        { ...base, idempotencyKey: '1', tipo: 'E32', estadoECF: 'Aceptado', totalFactura: 118, totalImpuestos: 18 },
        { ...base, idempotencyKey: '2', tipo: 'E32', estadoECF: 'Aceptado Condicional', totalFactura: 236, totalImpuestos: 36 },
        { ...base, idempotencyKey: '3', tipo: 'E31', estadoECF: 'Rechazado', totalFactura: 999, totalImpuestos: 99 },
      ]);
      as(userWith(['pms', 'pms-viewer']));
      const r = await request(app).get('/api/fiscal/reports/monthly-tax?year=2026');
      expect(r.body.data).toEqual([{ year: 2026, month: 11, byTipo: [{ tipo: 'E32', totalFactura: 354, totalImpuestos: 54, count: 2 }], totalFactura: 354, totalImpuestos: 54, totalInvoices: 2 }]);
    });

    itDb('records an authorized e-NCF range, from either app', async () => {
      await seedTenant(certified, { products: ['accounting'] });
      as(userWith(['accounting', 'acct-settings']), ['accounting']);
      const r = await request(app).post('/api/fiscal/sequences').send({ documentType: '31', rangeStart: 1, rangeEnd: 500, expiresOn: '2027-12-31' });
      expect(r.status).toBe(201);
      expect((await request(app).get('/api/fiscal/sequences')).body.data).toHaveLength(1);
    });

    itDb('approving or rejecting a received document: a rejection needs its reason', async () => {
      await seedTenant(certified);
      as(userWith(['pms', 'pms-settings']));
      expect((await request(app).post('/api/fiscal/received/r1/decision').send({ decision: 'maybe' })).status).toBe(400);
      expect((await request(app).post('/api/fiscal/received/r1/decision').send({ decision: 'rejected' })).status).toBe(400);
      expect((await request(app).post('/api/fiscal/received/r1/decision').send({ decision: 'approved' })).status).toBe(201);
      expect((await request(app).post('/api/fiscal/received/r1/decision').send({ decision: 'rejected', reason: 'No recibido' })).status).toBe(201);
    });

    itDb('looks up an issuer in the DGII directory; an unlisted one is an empty answer, not an error', async () => {
      await seedTenant(certified);
      as(userWith(['pms', 'pms-viewer']));
      expect((await request(app).get('/api/fiscal/directory?rnc=12')).status).toBe(400);
      const r = await request(app).get('/api/fiscal/directory?rnc=101010101');
      expect(r.status).toBe(200);
      expect(r.body.data).toBeNull();
    });

    itDb('statements are listed for the company that owns them', async () => {
      await seedTenant(certified);
      await mongoose.connection.collection('fiscalstatements').insertMany([
        { tenantId, period: '2026-10', status: 'closed', plan: 'essential', total: 0 },
        { tenantId: new mongoose.Types.ObjectId(), period: '2026-10', status: 'closed', plan: 'max', total: 1500 },
      ]);
      as(userWith(['pms', 'pms-settings']));
      const r = await request(app).get('/api/fiscal/statements');
      expect(r.body.data).toHaveLength(1);
      expect(r.body.data[0].plan).toBe('essential');
    });
  });
});
