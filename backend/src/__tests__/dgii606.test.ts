/**
 * Purchases compliance (PLANS_AND_SUBSCRIPTIONS_PLAN.md phase 2): supplier RNC/cédula, the NCF and
 * 606 fields of a bill, ITBIS por adelantar and withholdings in the GL, the quick expense, the
 * Formato 606 (rows, issues, TXT) and the ITBIS summary.
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
import accountingRoutes from '../routes/accounting';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import Account from '../models/Account';
import JournalEntry from '../models/JournalEntry';
import { seedDefaultChartOfAccounts } from '../utils/seedChartOfAccounts';
import { billDay, paymentForm, render606Txt, Row606 } from '../services/accounting/dgii.service';
import { taxIdType } from '../constants/dgii';
/* eslint-enable import/first */

describe('606 pieces (pure)', () => {
  it('tells an RNC from a cédula', () => {
    expect(taxIdType('131880681')).toBe(1);
    expect(taxIdType('001-1234567-8')).toBe(2);
    expect(taxIdType('12345')).toBeNull();
  });

  it('reads a picked date as its day, a clock time in Dominican time', () => {
    expect(billDay(new Date('2026-10-31T00:00:00.000Z'))).toBe('2026-10-31');
    expect(billDay(new Date('2026-11-01T02:30:00.000Z'))).toBe('2026-10-31'); // 22:30 on the 31st in Santo Domingo
  });

  it('derives the payment form from the payments', () => {
    expect(paymentForm({ payments: [] } as any)).toBe('04');
    expect(paymentForm({ payments: [{ method: 'cash' }] } as any)).toBe('01');
    expect(paymentForm({ payments: [{ method: 'transfer' }, { method: 'check' }] } as any)).toBe('02');
    expect(paymentForm({ payments: [{ method: 'card' }] } as any)).toBe('03');
    expect(paymentForm({ payments: [{ method: 'cash' }, { method: 'card' }] } as any)).toBe('07');
  });

  it('writes the header and 23 pipe-separated fields per row, empty optional amounts', () => {
    const row: Row606 = {
      billId: 'x', billNumber: 'BILL-1', supplierName: 'S', rncCedula: '131880681', idType: '1', expenseType: '02', ncf: 'B0100000012', ncfModified: '',
      issueDate: '20261005', paymentDate: '20261010', servicesAmount: 1000, goodsAmount: 0, totalAmount: 1000, itbisBilled: 180, itbisWithheld: 54,
      itbisProportional: 0, itbisToCost: 0, itbisAdvance: 180, itbisPerceived: 0, isrType: '2', isrWithheld: 100, isrPerceived: 0, selectiveTax: 0,
      otherTaxes: 0, legalTip: 0, paymentForm: '02',
    };
    const txt = render606Txt('101010101', '2026-10', [row]);
    const [header, line] = txt.split('\r\n');
    expect(header).toBe('606|101010101|202610|1');
    expect(line.split('|')).toHaveLength(23);
    expect(line).toBe('131880681|1|02|B0100000012||20261005|20261010|1000.00|0.00|1000.00|180.00|54.00|||180.00||2|100.00|||||02');
    expect(txt.endsWith('\r\n')).toBe(true);
  });
});

describe('purchases compliance (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = String(tenantId);
    req.tenant = { _id: tenantId, plan: 'basic', products: ['accounting'], plans: { accounting: 'invoicing' }, profile: { rnc: '101010101' }, ecfConfig: { defaultItbisRate: 18 } };
    tenantLocalStorage.run({ tenantId: String(tenantId) }, next);
  });
  app.use('/api/accounting', accountingRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const inTenant = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);
  let expenseAccount: string;
  let supplier: string;

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_dgii606');
    if (!ready) { console.warn('Mongo unreachable — skipping 606 tests'); return; }
    await inTenant(() => seedDefaultChartOfAccounts());
    expenseAccount = String((await inTenant(() => Account.findOne({ code: '6020' }).lean()))!._id);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    if (!ready) return;
    await mongoose.connection.collection('bills').deleteMany({});
    await mongoose.connection.collection('journalentries').deleteMany({});
    await mongoose.connection.collection('suppliers').deleteMany({});
    await mongoose.connection.collection('electronicinvoices').deleteMany({});
    supplier = (await request(app).post('/api/accounting/suppliers').send({ name: 'Edenorte', taxId: '101-82124-8' })).body.data._id;
  });

  const expenseBill = (over: Record<string, unknown> = {}) => ({
    supplier, issueDate: '2026-10-05', dueDate: '2026-10-20', ncf: 'b01 0000 0012',
    lineItems: [{ lineType: 'expense', description: 'Energía octubre', account: expenseAccount, lineTotal: 1000, taxRate: 18 }],
    ...over,
  });

  itDb('a supplier tax id must be an RNC or a cédula', async () => {
    const bad = await request(app).post('/api/accounting/suppliers').send({ name: 'X', taxId: '1234' });
    expect(bad.status).toBe(400);
    const s = await request(app).post('/api/accounting/suppliers').send({ name: 'Y', taxId: '001-1234567-8', defaultExpenseType: '03' });
    expect(s.body.data).toMatchObject({ taxId: '00112345678', defaultExpenseType: '03' });
  });

  itDb('a bill keeps a normalised NCF and refuses a malformed one', async () => {
    const ok = await request(app).post('/api/accounting/bills').send(expenseBill());
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ ncf: 'B0100000012', expenseType: '02', itbisToCost: false, payableTotal: 1180 });
    const bad = await request(app).post('/api/accounting/bills').send(expenseBill({ ncf: 'B01123' }));
    expect(bad.status).toBe(400);
  });

  itDb('receiving posts ITBIS por adelantar and the withholdings; the supplier is owed the rest', async () => {
    const created = await request(app).post('/api/accounting/bills').send(expenseBill({ itbisWithheld: 54, isrWithheld: 100, isrWithholdingType: '2' }));
    expect(created.body.data).toMatchObject({ total: 1180, payableTotal: 1026, balanceDue: 1026 });
    await request(app).post(`/api/accounting/bills/${created.body.data._id}/receive`);
    const je = await inTenant(() => JournalEntry.findOne({ source: 'bill_received' }).populate('lines.account', 'code').lean());
    const byCode = Object.fromEntries((je!.lines as any[]).map((l) => [l.account.code, l.debit || -l.credit]));
    expect(byCode).toEqual({ '6020': 1000, '1300': 180, '2000': -1026, '2110': -54, '2120': -100 });
    const over = await request(app).post(`/api/accounting/bills/${created.body.data._id}/payments`).send({ amount: 1100, method: 'transfer' });
    expect(over.status).toBe(400); // more than the 1,026 owed
  });

  itDb('ITBIS taken to cost stays in the expense', async () => {
    const created = await request(app).post('/api/accounting/bills').send(expenseBill({ itbisToCost: true }));
    await request(app).post(`/api/accounting/bills/${created.body.data._id}/receive`);
    const je = await inTenant(() => JournalEntry.findOne({ source: 'bill_received' }).populate('lines.account', 'code').lean());
    expect(Object.fromEntries((je!.lines as any[]).map((l) => [l.account.code, l.debit || -l.credit]))).toEqual({ '6020': 1180, '2000': -1180 });
  });

  itDb('withholding validation: ISR needs its type and cannot exceed the base', async () => {
    expect((await request(app).post('/api/accounting/bills').send(expenseBill({ isrWithheld: 100 }))).status).toBe(400);
    expect((await request(app).post('/api/accounting/bills').send(expenseBill({ itbisWithheld: 500 }))).status).toBe(400);
  });

  itDb('a quick expense is created, received and paid in one step', async () => {
    const r = await request(app).post('/api/accounting/bills/expense').send({
      supplier, issueDate: '2026-10-07', ncf: 'E310000000045',
      lineItems: [{ description: 'Papelería', account: expenseAccount, lineTotal: 500, taxRate: 18, isGoods: true }],
      payment: { method: 'cash' },
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'paid', balanceDue: 0, ncf: 'E310000000045' });
    expect(await inTenant(() => JournalEntry.countDocuments({ source: { $in: ['bill_received', 'bill_payment'] } }))).toBe(2);
  });

  itDb('the 606 lists the month\'s bills, flags what is missing and gives the TXT once it is fixed', async () => {
    const good = await request(app).post('/api/accounting/bills').send(expenseBill());
    await request(app).post(`/api/accounting/bills/${good.body.data._id}/receive`);
    await request(app).post(`/api/accounting/bills/${good.body.data._id}/payments`).send({ amount: 1180, method: 'transfer', date: '2026-10-10' });
    const noNcf = await request(app).post('/api/accounting/bills').send(expenseBill({ ncf: '' }));
    await request(app).post(`/api/accounting/bills/${noNcf.body.data._id}/receive`);
    await request(app).post('/api/accounting/bills').send(expenseBill()); // draft: not reported
    await request(app).post('/api/accounting/bills').send(expenseBill({ issueDate: '2026-11-02' })).then((b) => request(app).post(`/api/accounting/bills/${b.body.data._id}/receive`)); // next month

    const report = await request(app).get('/api/accounting/reports/dgii-606?period=2026-10');
    expect(report.body.data.rows).toHaveLength(2);
    expect(report.body.data.rows[0]).toMatchObject({ rncCedula: '101821248', idType: '1', ncf: 'B0100000012', issueDate: '20261005', paymentDate: '20261010', servicesAmount: 1000, itbisAdvance: 180, paymentForm: '02' });
    expect(report.body.data.issues).toEqual([expect.objectContaining({ problem: 'missing_ncf', severity: 'error' })]);
    expect(report.body.data.totals).toMatchObject({ count: 2, totalAmount: 2000, itbisBilled: 360 });

    const blocked = await request(app).get('/api/accounting/reports/dgii-606/txt?period=2026-10');
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('DGII_606_ISSUES');

    await request(app).post(`/api/accounting/bills/${noNcf.body.data._id}/void`).send({ reason: 'Duplicada por error' });
    const txt = await request(app).get('/api/accounting/reports/dgii-606/txt?period=2026-10');
    expect(txt.status).toBe(200);
    expect(txt.headers['content-disposition']).toContain('DGII_F_606_101010101_202610.TXT');
    expect(txt.text.split('\r\n')[0]).toBe('606|101010101|202610|1');
  });

  itDb('the ITBIS summary nets sales e-CF, credit notes and deductible purchases', async () => {
    await mongoose.connection.collection('electronicinvoices').insertMany([
      { tenantId, tipo: 'E31', idempotencyKey: 'k1', estadoECF: 'Aceptado', totalFactura: 11800, totalImpuestos: 1800, issuedAt: new Date('2026-10-10T15:00:00Z') },
      { tenantId, tipo: 'E32', idempotencyKey: 'k2', estadoECF: 'Aceptado Condicional', totalFactura: 590, totalImpuestos: 90, issuedAt: new Date('2026-10-11T15:00:00Z') },
      { tenantId, tipo: 'E34', idempotencyKey: 'k3', estadoECF: 'Aceptado', totalFactura: 1180, totalImpuestos: 180, issuedAt: new Date('2026-10-12T15:00:00Z') },
      { tenantId, tipo: 'E31', idempotencyKey: 'k4', estadoECF: 'Rechazado', totalFactura: 99999, totalImpuestos: 9999, issuedAt: new Date('2026-10-12T15:00:00Z') },
      { tenantId, tipo: 'E31', idempotencyKey: 'k5', estadoECF: 'Aceptado', totalFactura: 1180, totalImpuestos: 180, issuedAt: new Date('2026-11-01T02:00:00Z') }, // 31 Oct 22:00 in DR
    ]);
    const b = await request(app).post('/api/accounting/bills').send(expenseBill({ itbisWithheld: 54 }));
    await request(app).post(`/api/accounting/bills/${b.body.data._id}/receive`);
    const r = await request(app).get('/api/accounting/reports/itbis-summary?period=2026-10');
    expect(r.body.data).toMatchObject({
      sales: { documents: 3, itbis: 2070, creditNotes: 1, creditNotesItbis: 180, netItbis: 1890 },
      purchases: { bills: 1, itbisAdvance: 180 },
      withheld: { itbis: 54, isr: 0 },
      itbisBalance: 1710,
      itbisToPay: 1764,
    });
  });
});
