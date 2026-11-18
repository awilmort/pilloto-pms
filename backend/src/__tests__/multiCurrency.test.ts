/**
 * Multi-currency (PLANS_AND_SUBSCRIPTIONS_PLAN.md phase 4): the plan gate, document rates,
 * DOP postings with rounding kept balanced, realised exchange differences on payments, and DOP
 * figures in aging and the 606.
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
import Customer from '../models/Customer';
import Invoice from '../models/Invoice';
import JournalEntry from '../models/JournalEntry';
import { seedDefaultChartOfAccounts } from '../utils/seedChartOfAccounts';
import { inFunctional } from '../services/accounting/ledger.service';
/* eslint-enable import/first */

describe('inFunctional (pure)', () => {
  it('converts at the rate and keeps the entry balanced by putting the rounding on the plug line', () => {
    const lines = inFunctional([
      { account: 'ar', debit: 118.33 },
      { account: 'rev', credit: 100.28 },
      { account: 'tax', credit: 18.05 },
    ], 58.6125);
    expect(lines.map((l) => l.debit || -(l.credit || 0))).toEqual([6935.62, -5877.66, -1057.96]);
    expect(lines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)).toBeCloseTo(0, 6);
  });

  it('puts a rounding difference on the plug line', () => {
    // 0.03 × 1.5 = 0.05 but each 0.01 credit rounds to 0.02 (0.06 in all): the receivable takes the cent.
    const lines = inFunctional([
      { account: 'ar', debit: 0.03 },
      { account: 'a', credit: 0.01 }, { account: 'b', credit: 0.01 }, { account: 'c', credit: 0.01 },
    ], 1.5);
    expect(lines.map((l) => l.debit || -(l.credit || 0))).toEqual([0.06, -0.02, -0.02, -0.02]);
  });

  it('leaves DOP entries untouched', () => {
    const lines = [{ account: 'a', debit: 10 }, { account: 'b', credit: 10 }];
    expect(inFunctional(lines, 1)).toBe(lines);
  });
});

describe('foreign-currency documents (local Mongo)', () => {
  let ready = false;
  let plan = 'pro';
  const tenantId = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = String(tenantId);
    req.tenant = { _id: tenantId, plan: 'basic', products: ['accounting'], plans: { accounting: plan }, profile: { rnc: '101010101' }, ecfConfig: { defaultItbisRate: 18 } };
    tenantLocalStorage.run({ tenantId: String(tenantId) }, next);
  });
  app.use('/api/accounting', accountingRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const inTenant = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);
  const accountId = async (code: string) => String((await inTenant(() => Account.findOne({ code }).lean()))!._id);
  const byCode = async (source: string) => {
    const je = await inTenant(() => JournalEntry.findOne({ source }).sort({ createdAt: -1 }).populate('lines.account', 'code').lean());
    return Object.fromEntries((je!.lines as any[]).map((l) => [l.account.code, l.debit || -l.credit]));
  };
  let supplier: string;

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_multicurrency');
    if (!ready) { console.warn('Mongo unreachable — skipping multi-currency tests'); return; }
    await inTenant(() => seedDefaultChartOfAccounts());
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    if (!ready) return;
    plan = 'pro';
    for (const c of ['bills', 'invoices', 'journalentries', 'suppliers', 'exchangerates', 'customers']) await mongoose.connection.collection(c).deleteMany({});
    supplier = (await request(app).post('/api/accounting/suppliers').send({ name: 'Amazon Web Services', taxId: '131880681' })).body.data._id;
  });

  const usdBill = async (over: Record<string, unknown> = {}) =>
    request(app).post('/api/accounting/bills').send({
      supplier, issueDate: '2026-10-05', dueDate: '2026-10-20', ncf: 'B0100000099', currency: 'USD',
      lineItems: [{ lineType: 'expense', description: 'Servidores', account: await accountId('6090'), lineTotal: 100, taxRate: 18 }],
      ...over,
    });

  itDb('another currency needs the Pro plan and a rate', async () => {
    plan = 'essentials';
    const gated = await usdBill();
    expect(gated.status).toBe(403);
    expect(gated.body).toMatchObject({ code: 'PLAN_FEATURE', plan: { feature: 'multiCurrency', requiredPlan: 'pro' } });
    plan = 'pro';
    const noRate = await usdBill();
    expect(noRate.status).toBe(400);
    expect(noRate.body.message).toMatch(/exchange rate/);
    expect((await request(app).post('/api/accounting/exchange-rates').send({ currency: 'USD', date: '2026-10-01', rate: 60 })).status).toBe(201);
    const ok = await usdBill();
    expect(ok.body.data).toMatchObject({ currency: 'USD', exchangeRate: 60, total: 118 });
    const explicit = await usdBill({ exchangeRate: 61.5 });
    expect(explicit.body.data.exchangeRate).toBe(61.5);
  });

  itDb('a USD bill posts in DOP and its payment at a higher rate books an exchange loss', async () => {
    const bill = await usdBill({ exchangeRate: 60 });
    await request(app).post(`/api/accounting/bills/${bill.body.data._id}/receive`);
    expect(await byCode('bill_received')).toEqual({ '6090': 6000, '1300': 1080, '2000': -7080 });

    const pay = await request(app).post(`/api/accounting/bills/${bill.body.data._id}/payments`).send({ amount: 118, method: 'transfer', exchangeRate: 62 });
    expect(pay.status).toBe(200);
    expect(await byCode('bill_payment')).toEqual({ '2000': 7080, '1010': -7316, '6080': 236 });

    const report = await request(app).get('/api/accounting/reports/dgii-606?period=2026-10');
    expect(report.body.data.rows[0]).toMatchObject({ totalAmount: 6000, itbisBilled: 1080, itbisAdvance: 1080 });
  });

  itDb('a USD invoice paid at a higher rate books an exchange gain; aging is in DOP', async () => {
    const customer = await inTenant(() => Customer.create({ name: 'Tour Operator Inc', isActive: true }));
    const inv = await request(app).post('/api/accounting/invoices').send({
      customer: String(customer._id), currency: 'USD', exchangeRate: 60,
      lineItems: [{ description: 'Paquete', quantity: 1, unitPrice: 100, taxRate: 18 }],
    });
    expect(inv.body.data).toMatchObject({ currency: 'USD', exchangeRate: 60, total: 118 });
    // Sending issues an e-CF (covered by its own tests); mark it sent here.
    await Invoice.collection.updateOne({ _id: new mongoose.Types.ObjectId(inv.body.data._id) }, { $set: { status: 'sent' } });

    const aging = await request(app).get('/api/accounting/reports/ar-aging');
    expect(aging.body.data.grandTotal ?? aging.body.data.totals).toBeDefined();
    expect(JSON.stringify(aging.body.data)).toContain('7080');

    const pay = await request(app).post(`/api/accounting/invoices/${inv.body.data._id}/payments`).send({ amount: 118, method: 'transfer', exchangeRate: 61 });
    expect(pay.status).toBe(200);
    expect(await byCode('invoice_payment')).toEqual({ '1010': 7198, '1100': -7080, '4300': -118 });
  });

  itDb('a DOP document is always at rate 1, whatever is sent', async () => {
    const r = await request(app).post('/api/accounting/bills').send({
      supplier, issueDate: '2026-10-05', dueDate: '2026-10-20', currency: 'DOP', exchangeRate: 55,
      lineItems: [{ lineType: 'expense', description: 'Local', account: await accountId('6090'), lineTotal: 100, taxRate: 0 }],
    });
    expect(r.body.data).toMatchObject({ currency: 'DOP', exchangeRate: 1 });
  });
});
