/**
 * Accounting issues e-CF through the shared pipeline: sending an invoice, and credit/debit notes on
 * a sent invoice. Local Mongo; BillingSoft is a stateful fake. Permission checks are bypassed here
 * (they are covered by the route tests) so the focus stays on what reaches BillingSoft and what is
 * saved.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

const mockUserId = new (require('mongoose').Types.ObjectId)();
jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { _id: mockUserId, id: String(mockUserId), role: 'admin' }; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
    userHasPermission: async () => true,
  };
});

/* eslint-disable import/first */
import invoiceRoutes from '../routes/accounting/invoices.routes';
import creditNoteRoutes from '../routes/accounting/creditNotes.routes';
import debitNoteRoutes from '../routes/accounting/debitNotes.routes';
import { tenantLocalStorage } from '../middleware/tenantContext';
import ElectronicInvoice from '../models/ElectronicInvoice';
import Customer from '../models/Customer';
import Invoice from '../models/Invoice';
import CreditNote from '../models/CreditNote';
import DebitNote from '../models/DebitNote';
import Tenant from '../models/Tenant';
import { setBillingSoftClient } from '../services/fiscal/fiscalClient';
import { BillingSoftError } from '../services/fiscal/billingsoftClient';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import { createFakeBillingSoft, FakeBillingSoft } from './helpers/fakeBillingSoft';
/* eslint-enable import/first */

// Each test seeds a database and runs the e-CF pipeline: allow for a busy machine.
jest.setTimeout(30_000);

describe('Accounting → e-CF (local Mongo)', () => {
  let ready = false;
  let fake: FakeBillingSoft;
  const tenantId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const noRncCustomerId = new mongoose.Types.ObjectId();
  const certified = { organizationId: 'org-1', environment: 'ecf', certification: 'certified', isActive: true, plan: 'essential' };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.tenantId = String(tenantId); tenantLocalStorage.run({ tenantId: String(tenantId) }, next); });
  app.use('/api/accounting/invoices', invoiceRoutes);
  app.use('/api/accounting/credit-notes', creditNoteRoutes);
  app.use('/api/accounting/debit-notes', debitNoteRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const line = { description: 'Consultoría', quantity: 2, unitPrice: 500, discountPercent: 0, taxRate: 18 };

  const draft = async (customer = customerId) => {
    const r = await request(app).post('/api/accounting/invoices').send({ customer: String(customer), dueDate: '2026-12-30', lineItems: [line] });
    expect(r.status).toBe(201);
    return r.body.data;
  };
  const sent = async () => {
    const d = await draft();
    const r = await request(app).post(`/api/accounting/invoices/${d._id}/send`).send({});
    expect(r.status).toBe(200);
    return r.body.data.invoice;
  };

  beforeAll(async () => {
    process.env.BILLINGSOFT_PARTNER_API_KEY = 'test-partner-key';
    ready = await connectTestDb('pilloto_acct_fiscal');
    if (!ready) { console.warn('Mongo unreachable — skipping Accounting e-CF DB tests'); return; }
    await Promise.all([ElectronicInvoice.init(), Invoice.init(), CreditNote.init(), DebitNote.init()]);
    await Customer.collection.insertMany([
      { _id: customerId, tenantId, name: 'Grupo Caribe', razonSocial: 'Grupo Caribe SRL', rnc: '101010101', email: 'cxc@caribe.com', isActive: true },
      { _id: noRncCustomerId, tenantId, name: 'Ana Gómez', email: 'ana@gmail.com', isActive: true },
    ]);
  });
  afterAll(async () => {
    setBillingSoftClient(null);
    delete process.env.BILLINGSOFT_PARTNER_API_KEY;
    if (ready) await dropTestDb();
  });
  beforeEach(async () => {
    if (!ready) return;
    fake = createFakeBillingSoft();
    setBillingSoftClient(fake.client);
    await Promise.all([Tenant, ElectronicInvoice, Invoice, CreditNote, DebitNote].map((m: any) => m.collection.deleteMany({})));
    await Tenant.collection.insertOne({
      _id: tenantId, name: 'Contable SRL', slug: 'contable', plan: 'basic', ownerEmail: 'a@b.com', isActive: true, products: ['accounting'], plans: { accounting: 'pro' },
      ecfConfig: { defaultItbisRate: 18 }, fiscal: certified,
    });
  });

  describe('sending an invoice', () => {
    itDb('issues a credit-fiscal invoice (31) for a customer with an RNC and links it to the invoice', async () => {
      const d = await draft();
      const r = await request(app).post(`/api/accounting/invoices/${d._id}/send`).send({});
      expect(r.status).toBe(200);
      expect(r.body.queued).toBe(false);
      expect(r.body.data.invoice).toMatchObject({ status: 'sent', electronicInvoiceId: expect.any(String) });
      const ecf = await ElectronicInvoice.findById(r.body.data.invoice.electronicInvoiceId);
      expect(ecf).toMatchObject({
        tipo: 'E31', route: 'invoices', generationSource: 'accounting_invoice', estadoECF: 'En Proceso', numeroFacturaInterna: d.invoiceNumber,
        totalFactura: d.total, totalImpuestos: d.taxAmount, buyerRnc: '101010101', buyerName: 'Grupo Caribe SRL',
      });
      expect(String(ecf?.invoiceId)).toBe(d._id);
      expect(ecf?.idempotencyKey).toBe(`acct-invoice-${d._id}`);
    });

    itDb('is a consumer invoice (32) for a customer without an RNC', async () => {
      const d = await draft(noRncCustomerId);
      const r = await request(app).post(`/api/accounting/invoices/${d._id}/send`).send({});
      expect((await ElectronicInvoice.findById(r.body.data.invoice.electronicInvoiceId))?.tipo).toBe('E32');
    });

    itDb('is blocked, before anything changes, until DGII certifies the company', async () => {
      await Tenant.collection.updateOne({ _id: tenantId }, { $set: { 'fiscal.certification': 'in_progress' } });
      const d = await draft();
      const r = await request(app).post(`/api/accounting/invoices/${d._id}/send`).send({});
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('FISCAL_NOT_CERTIFIED');
      expect((await Invoice.findById(d._id))?.status).toBe('draft');
      expect(await ElectronicInvoice.countDocuments({})).toBe(0);
      expect(fake.created()).toBe(0);
    });

    itDb('is blocked for a company that never activated e-CF', async () => {
      await Tenant.collection.updateOne({ _id: tenantId }, { $unset: { fiscal: '' } });
      const d = await draft();
      const r = await request(app).post(`/api/accounting/invoices/${d._id}/send`).send({});
      expect(r.body.code).toBe('FISCAL_NOT_ACTIVATED');
    });

    itDb('when BillingSoft refuses, the invoice stays a draft and the reason is shown', async () => {
      fake.failNext('issue', new BillingSoftError('El RNC del comprador no existe', 400, 'VALIDATION_ERROR', { 'buyer.rnc': 'inválido' }));
      const d = await draft();
      const r = await request(app).post(`/api/accounting/invoices/${d._id}/send`).send({});
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'FISCAL_REJECTED', message: 'El RNC del comprador no existe' });
      expect((await Invoice.findById(d._id))?.status).toBe('draft');
      expect(await ElectronicInvoice.countDocuments({})).toBe(0);
      // fixing it and sending again works, as one document
      const again = await request(app).post(`/api/accounting/invoices/${d._id}/send`).send({});
      expect(again.status).toBe(200);
      expect(fake.created()).toBe(1);
    });

    itDb('when BillingSoft is unreachable the invoice is still sent and its e-CF is queued to go out by itself', async () => {
      fake.failNext('issue', new BillingSoftError('down', 0, 'NETWORK', undefined, true));
      const d = await draft();
      const r = await request(app).post(`/api/accounting/invoices/${d._id}/send`).send({});
      expect(r.status).toBe(200);
      expect(r.body.queued).toBe(true);
      expect(r.body.data.invoice.status).toBe('sent');
      expect(r.body.data.electronicInvoice).toMatchObject({ estadoECF: 'Pendiente' });
      expect(fake.created()).toBe(0);
    });

    itDb('the invoice\'s own form-meta tells the page why it cannot issue', async () => {
      await Tenant.collection.updateOne({ _id: tenantId }, { $set: { 'fiscal.certification': 'not_started' } });
      const r = await request(app).get('/api/accounting/invoices/form-meta');
      expect(r.body.data).toMatchObject({ ecfActive: false, fiscalState: 'not_started' });
    });
  });

  describe('credit and debit notes', () => {
    itDb('a credit note references the invoice\'s e-NCF, with DGII\'s modification code', async () => {
      const invoice = await sent();
      const ecfOfInvoice = (await ElectronicInvoice.findById(invoice.electronicInvoiceId))!;
      const created = await request(app).post('/api/accounting/credit-notes').send({
        invoice: invoice._id, reason: 'price-adjustment', fiscalModificationCode: '3',
        lineItems: [{ lineType: 'allowance', description: 'Descuento acordado', lineTotal: 100, taxRate: 18 }],
      });
      expect(created.status).toBe(201);
      const issued = await request(app).post(`/api/accounting/credit-notes/${created.body.data._id}/issue`).send({});
      expect(issued.status).toBe(200);
      expect(issued.body.data.creditNote.status).toBe('issued');
      const ecf = await ElectronicInvoice.findById(issued.body.data.creditNote.electronicInvoiceId);
      expect(ecf).toMatchObject({ tipo: 'E34', route: 'credit-notes', originalENCF: ecfOfInvoice.eNCF, codigoModificacion: '3', generationSource: 'credit_note', totalFactura: 118 });
      expect(ecf?.idempotencyKey).toBe(`acct-credit-note-${created.body.data._id}`);
    });

    itDb('a debit note is issued the same way', async () => {
      const invoice = await sent();
      const created = await request(app).post('/api/accounting/debit-notes').send({
        invoice: invoice._id, reason: 'interest-on-overdue', fiscalModificationCode: '3',
        lineItems: [{ description: 'Intereses por mora', lineTotal: 50, taxRate: 0 }],
      });
      expect(created.status).toBe(201);
      const issued = await request(app).post(`/api/accounting/debit-notes/${created.body.data._id}/issue`).send({});
      expect(issued.status).toBe(200);
      expect(await ElectronicInvoice.findById(issued.body.data.debitNote.electronicInvoiceId)).toMatchObject({ tipo: 'E33', route: 'debit-notes', codigoModificacion: '3' });
    });

    itDb('a note is blocked, and stays a draft, when the company cannot issue', async () => {
      const invoice = await sent();
      const created = await request(app).post('/api/accounting/credit-notes').send({
        invoice: invoice._id, reason: 'goodwill', fiscalModificationCode: '3',
        lineItems: [{ lineType: 'allowance', description: 'Cortesía', lineTotal: 10, taxRate: 18 }],
      });
      await Tenant.collection.updateOne({ _id: tenantId }, { $set: { 'fiscal.isActive': false } });
      const issued = await request(app).post(`/api/accounting/credit-notes/${created.body.data._id}/issue`).send({});
      expect(issued.status).toBe(409);
      expect(issued.body.code).toBe('FISCAL_SUSPENDED');
      expect((await CreditNote.findById(created.body.data._id))?.status).toBe('draft');
    });
  });
});
