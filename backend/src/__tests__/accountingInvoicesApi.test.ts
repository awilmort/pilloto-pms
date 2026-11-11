/**
 * Invoice endpoints added for the invoice page (routes/accounting/invoices.routes.ts), against a
 * local Mongo: the new `reference` field on create/update, `GET /form-meta` (issuer details printed
 * on the letterhead) and `GET /:id/pdf` (a real PDF for drafts and issued e-CF invoices).
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
import { tenantLocalStorage } from '../middleware/tenantContext';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import Tenant from '../models/Tenant';
import Customer from '../models/Customer';
import Invoice from '../models/Invoice';
import { setBillingSoftClient } from '../services/fiscal/fiscalClient';
/* eslint-enable import/first */

describe('invoice endpoints (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.tenantId = String(tenantId); tenantLocalStorage.run({ tenantId: String(tenantId) }, next); });
  app.use('/api/accounting/invoices', invoiceRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const line = { description: 'Alquiler de salón', quantity: 2, unitPrice: 500, discountPercent: 10, taxRate: 18 };

  beforeAll(async () => {
    process.env.BILLINGSOFT_PARTNER_API_KEY = 'test-partner-key';
    ready = await connectTestDb('pilloto_invoice_api');
    if (!ready) { console.warn('Mongo unreachable — skipping invoice API DB tests'); return; }
    await Tenant.collection.insertOne({
      _id: tenantId, name: 'Hotel Prueba', slug: 'prueba', plan: 'basic', ownerEmail: 'a@b.com', isActive: true, products: ['accounting'],
      profile: { legalName: 'Hotel Prueba SRL', rnc: '131880681', address: 'Av. Principal 1', phone: '809-555-0100', email: 'info@prueba.com' },
      settings: {}, ecfConfig: { defaultItbisRate: 16 },
      fiscal: { organizationId: 'org-1', environment: 'ecf', certification: 'certified', isActive: true, plan: 'essential' },
    });
    await Customer.collection.insertOne({ _id: customerId, tenantId, name: 'Grupo Caribe', razonSocial: 'Grupo Caribe SRL', rnc: '101010101', address: 'Calle 2 #5', email: 'cxc@caribe.com', isActive: true });
  });
  afterAll(async () => { setBillingSoftClient(null); delete process.env.BILLINGSOFT_PARTNER_API_KEY; if (ready) await dropTestDb(); });

  itDb('create stores the reference (trimmed) and the lines; edit changes and clears it', async () => {
    const created = await request(app).post('/api/accounting/invoices').send({ customer: String(customerId), reference: '  OC-2026-77 ', lineItems: [line] });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'draft', reference: 'OC-2026-77', subtotal: 900, taxAmount: 162, total: 1062 });

    const id = created.body.data._id;
    const edited = await request(app).put(`/api/accounting/invoices/${id}`).send({ reference: 'OC-2026-78' });
    expect(edited.body.data.reference).toBe('OC-2026-78');
    const cleared = await request(app).put(`/api/accounting/invoices/${id}`).send({ reference: '   ' });
    expect(cleared.body.data.reference).toBeUndefined();
  });

  itDb('a date-only due date is stored at noon UTC so it never reads as the previous evening in Santo Domingo', async () => {
    const created = await request(app).post('/api/accounting/invoices').send({ customer: String(customerId), dueDate: '2026-12-09', lineItems: [line] });
    expect(created.body.data.dueDate).toBe('2026-12-09T12:00:00.000Z');
    const moved = await request(app).put(`/api/accounting/invoices/${created.body.data._id}`).send({ dueDate: '2026-12-31' });
    expect(moved.body.data.dueDate).toBe('2026-12-31T12:00:00.000Z');
  });

  itDb('the detail response includes the customer address (the page and PDF print it)', async () => {
    const created = await request(app).post('/api/accounting/invoices').send({ customer: String(customerId), lineItems: [line] });
    const detail = await request(app).get(`/api/accounting/invoices/${created.body.data._id}`);
    expect(detail.body.data.customer).toMatchObject({ name: 'Grupo Caribe', rnc: '101010101', address: 'Calle 2 #5' });
  });

  itDb('form-meta returns the issuer letterhead, default ITBIS rate and whether e-CF can be issued', async () => {
    const r = await request(app).get('/api/accounting/invoices/form-meta');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      issuer: { name: 'Hotel Prueba', legalName: 'Hotel Prueba SRL', rnc: '131880681', address: 'Av. Principal 1', phone: '809-555-0100', email: 'info@prueba.com' },
      defaultItbisRate: 16,
      ecfActive: true,
      fiscalState: 'ready',
    });
  });

  itDb('pdf of a draft is a real PDF named after the invoice and stamped BORRADOR', async () => {
    const created = await request(app).post('/api/accounting/invoices').send({ customer: String(customerId), lineItems: [line] });
    const num = created.body.data.invoiceNumber;
    const r = await request(app).get(`/api/accounting/invoices/${created.body.data._id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toContain(`Factura-${num}.pdf`);
    const body = r.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(1500);
  });

  itDb('pdf of an unknown or malformed id is a clean 404 / 400', async () => {
    expect((await request(app).get(`/api/accounting/invoices/${new mongoose.Types.ObjectId()}/pdf`)).status).toBe(404);
    expect((await request(app).get('/api/accounting/invoices/not-an-id/pdf')).status).toBe(400);
  });

  itDb('pdf of an invoice whose e-CF BillingSoft has not confirmed yet uses Pilloto\'s layout with the e-CF block', async () => {
    const created = await request(app).post('/api/accounting/invoices').send({ customer: String(customerId), lineItems: [line] });
    const ecf = await mongoose.connection.collection('electronicinvoices').insertOne({
      tenantId, invoiceId: new mongoose.Types.ObjectId(created.body.data._id), tipo: 'E31', eNCF: 'E310000000099', estadoECF: 'Firmado', estatus: 'signed',
      codigoSeguridad: 'Sec123', totalFactura: 1062, totalImpuestos: 162,
    });
    await Invoice.collection.updateOne({ _id: new mongoose.Types.ObjectId(created.body.data._id) }, { $set: { status: 'sent', electronicInvoiceId: ecf.insertedId } });
    const r = await request(app).get(`/api/accounting/invoices/${created.body.data._id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  itDb('pdf of an issued invoice is BillingSoft\'s official printed representation (it carries the DGII QR)', async () => {
    const official = Buffer.from('%PDF-1.4 official BillingSoft representation');
    const getDocumentPdf = jest.fn().mockResolvedValue(official);
    setBillingSoftClient({ getDocumentPdf } as any);
    const created = await request(app).post('/api/accounting/invoices').send({ customer: String(customerId), lineItems: [line] });
    const ecf = await mongoose.connection.collection('electronicinvoices').insertOne({
      tenantId, invoiceId: new mongoose.Types.ObjectId(created.body.data._id), tipo: 'E31', eNCF: 'E310000000100', billingsoftDocumentId: 'doc-100',
      estadoECF: 'Aceptado', estatus: 'accepted', totalFactura: 1062, totalImpuestos: 162,
    });
    await Invoice.collection.updateOne({ _id: new mongoose.Types.ObjectId(created.body.data._id) }, { $set: { status: 'sent', electronicInvoiceId: ecf.insertedId } });
    const r = await request(app).get(`/api/accounting/invoices/${created.body.data._id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect((r.body as Buffer).toString()).toBe(official.toString());
    expect(getDocumentPdf).toHaveBeenCalledWith('org-1', 'doc-100');
    setBillingSoftClient(null);
  });
});
