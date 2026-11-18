/**
 * Bank accounts & reconciliation (PLANS_AND_SUBSCRIPTIONS_PLAN.md phase 3): the default account on
 * "Bancos", a new account with its own GL account, payments landing in the chosen bank, statement
 * import (dedupe), match suggestions, matching, an entry from a bank-only movement, and closing a
 * reconciliation.
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
import { suggestMatches } from '../services/accounting/bank.service';
/* eslint-enable import/first */

describe('match suggestions (pure)', () => {
  it('offers book lines of the same amount within a week, closest first, never cleared ones', () => {
    const book = [
      { entry: 'e1', entryNumber: 'JE-1', line: 'l1', date: '2026-10-01', memo: '', amount: -1180, cleared: false },
      { entry: 'e2', entryNumber: 'JE-2', line: 'l2', date: '2026-10-09', memo: '', amount: -1180, cleared: false },
      { entry: 'e3', entryNumber: 'JE-3', line: 'l3', date: '2026-10-10', memo: '', amount: -1180, cleared: true },
      { entry: 'e4', entryNumber: 'JE-4', line: 'l4', date: '2026-10-10', memo: '', amount: 1180, cleared: false },
    ];
    expect(suggestMatches([{ amount: -1180, date: '2026-10-10' }], book)[0].map((b) => b.line)).toEqual(['l2']);
    expect(suggestMatches([{ amount: -1180, date: '2026-10-05' }], book)[0].map((b) => b.line)).toEqual(['l1', 'l2']);
  });
});

describe('bank accounts & reconciliation (local Mongo)', () => {
  let ready = false;
  let plan = 'essentials';
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
  let supplier: string;

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_bank_rec');
    if (!ready) { console.warn('Mongo unreachable — skipping bank tests'); return; }
    await inTenant(() => seedDefaultChartOfAccounts());
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(async () => {
    if (!ready) return;
    plan = 'essentials';
    for (const c of ['bills', 'journalentries', 'suppliers', 'bankaccounts', 'bankstatementlines', 'bankreconciliations']) await mongoose.connection.collection(c).deleteMany({});
    await inTenant(() => Account.deleteMany({ code: { $regex: /^10(1[1-9]|[2-9]\d)$/ } }));
    supplier = (await request(app).post('/api/accounting/suppliers').send({ name: 'Edenorte', taxId: '101821248' })).body.data._id;
  });

  /** A received expense bill paid by transfer from `bankAccount` (default bank when absent). */
  const paidBill = async (amount: number, bankAccount?: string, date = '2026-10-08') => {
    const b = await request(app).post('/api/accounting/bills').send({
      supplier, issueDate: '2026-10-05', dueDate: '2026-10-20', ncf: 'B0100000012',
      lineItems: [{ lineType: 'expense', description: 'Energía', account: await accountId('6020'), lineTotal: amount, taxRate: 0 }],
    });
    await request(app).post(`/api/accounting/bills/${b.body.data._id}/receive`);
    const pay = await request(app).post(`/api/accounting/bills/${b.body.data._id}/payments`).send({ amount, method: 'transfer', date, ...(bankAccount ? { bankAccount } : {}) });
    expect(pay.status).toBe(200);
    return b.body.data._id as string;
  };

  itDb('Facturación has no bank module', async () => {
    plan = 'invoicing';
    const r = await request(app).get('/api/accounting/bank-accounts');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PLAN_FEATURE');
  });

  itDb('the default account sits on Bancos (1010); a new one gets its own GL account', async () => {
    const list = await request(app).get('/api/accounting/bank-accounts');
    expect(list.body.data).toEqual([expect.objectContaining({ name: 'Cuenta principal', isDefault: true, glAccount: expect.objectContaining({ code: '1010' }) })]);
    const created = await request(app).post('/api/accounting/bank-accounts').send({ name: 'Popular USD', bankName: 'Banco Popular', accountNumberLast4: '4321', currency: 'USD' });
    expect(created.status).toBe(201);
    const gl = await inTenant(() => Account.findById(created.body.data.glAccount).lean());
    expect(gl).toMatchObject({ code: '1011', name: 'Banco — Popular USD', type: 'asset' });
  });

  itDb('a payment leaves from the chosen bank, or the default one; an unknown bank is refused', async () => {
    const bhd = (await request(app).post('/api/accounting/bank-accounts').send({ name: 'BHD' })).body.data;
    await paidBill(500, bhd._id);
    await paidBill(300);
    const payments = await inTenant(() => JournalEntry.find({ source: 'bill_payment' }).populate('lines.account', 'code').lean());
    const credited = payments.map((e: any) => e.lines.find((l: any) => l.credit > 0).account.code).sort();
    expect(credited).toEqual(['1010', '1011']);
    const b = await request(app).post('/api/accounting/bills').send({
      supplier, issueDate: '2026-10-05', dueDate: '2026-10-20', lineItems: [{ lineType: 'expense', description: 'X', account: await accountId('6020'), lineTotal: 10, taxRate: 0 }],
    });
    await request(app).post(`/api/accounting/bills/${b.body.data._id}/receive`);
    const bad = await request(app).post(`/api/accounting/bills/${b.body.data._id}/payments`).send({ amount: 10, method: 'transfer', bankAccount: String(new mongoose.Types.ObjectId()) });
    expect(bad.status).toBe(400);
  });

  itDb('imports a statement once, suggests matches, matches, posts a fee and closes the reconciliation', async () => {
    const bankId = (await request(app).get('/api/accounting/bank-accounts')).body.data[0]._id;
    await paidBill(1180, undefined, '2026-10-08');

    const rows = [
      { date: '2026-10-09', description: 'TRANSF EDENORTE', amount: -1180, reference: 'T-1' },
      { date: '2026-10-31', description: 'COMISION MANEJO', amount: -150 },
      { date: '2026-10-31', description: 'bad', amount: 0 },
    ];
    expect((await request(app).post(`/api/accounting/bank-accounts/${bankId}/statement-lines/import`).send({ rows })).body.data).toEqual({ added: 2, duplicates: 0, invalid: 1 });
    expect((await request(app).post(`/api/accounting/bank-accounts/${bankId}/statement-lines/import`).send({ rows })).body.data).toMatchObject({ added: 0, duplicates: 2 });

    const lines = (await request(app).get(`/api/accounting/bank-accounts/${bankId}/statement-lines`)).body.data;
    const transfer = lines.find((l: any) => l.amount === -1180);
    const fee = lines.find((l: any) => l.amount === -150);
    expect(transfer.suggestions).toHaveLength(1);
    expect(fee.suggestions).toHaveLength(0);

    const matched = await request(app).post(`/api/accounting/bank-accounts/${bankId}/statement-lines/${transfer._id}/match`).send({ lines: [transfer.suggestions[0].line] });
    expect(matched.body.data.status).toBe('matched');
    const twice = await request(app).post(`/api/accounting/bank-accounts/${bankId}/statement-lines/${fee._id}/match`).send({ lines: [transfer.suggestions[0].line] });
    expect(twice.status).toBe(409);

    const entry = await request(app).post(`/api/accounting/bank-accounts/${bankId}/statement-lines/${fee._id}/entry`).send({ account: await accountId('6090'), memo: 'Comisión bancaria octubre' });
    expect(entry.body.data.status).toBe('matched');
    const je = await inTenant(() => JournalEntry.findOne({ source: 'bank_entry' }).populate('lines.account', 'code').lean());
    expect(Object.fromEntries((je!.lines as any[]).map((l) => [l.account.code, l.debit || -l.credit]))).toEqual({ '1010': -150, '6090': 150 });

    // Opening 5,000; movements −1,330: the statement must end at 3,670.
    const wrong = await request(app).post(`/api/accounting/bank-accounts/${bankId}/reconciliation`).send({ statementDate: '2026-10-31', statementEndingBalance: 3600, openingBalance: 5000 });
    expect(wrong.body.data).toMatchObject({ beginningBalance: 5000, statementTotal: -1330, difference: -70, canClose: false });
    const right = await request(app).post(`/api/accounting/bank-accounts/${bankId}/reconciliation`).send({ statementDate: '2026-10-31', statementEndingBalance: 3670 });
    expect(right.body.data).toMatchObject({ difference: 0, pendingLines: 0, canClose: true });
    const closed = await request(app).post(`/api/accounting/bank-accounts/${bankId}/reconciliation/${right.body.data.reconciliation._id}/close`);
    expect(closed.body.data.reconciliation.status).toBe('closed');

    // Closed lines are locked; the next reconciliation starts from 3,670.
    expect((await request(app).post(`/api/accounting/bank-accounts/${bankId}/statement-lines/${fee._id}/unmatch`)).status).toBe(409);
    const next = await request(app).post(`/api/accounting/bank-accounts/${bankId}/reconciliation`).send({ statementDate: '2026-11-30', statementEndingBalance: 3670 });
    expect(next.body.data).toMatchObject({ beginningBalance: 3670, statementTotal: 0, canClose: true });
  });

  itDb('closing is refused while a line up to the date is still unmatched', async () => {
    const bankId = (await request(app).get('/api/accounting/bank-accounts')).body.data[0]._id;
    await request(app).post(`/api/accounting/bank-accounts/${bankId}/statement-lines`).send({ date: '2026-10-15', description: 'DEPOSITO', amount: 200 });
    const rec = await request(app).post(`/api/accounting/bank-accounts/${bankId}/reconciliation`).send({ statementDate: '2026-10-31', statementEndingBalance: 200 });
    expect(rec.body.data).toMatchObject({ difference: 0, pendingLines: 1, canClose: false });
    const close = await request(app).post(`/api/accounting/bank-accounts/${bankId}/reconciliation/${rec.body.data.reconciliation._id}/close`);
    expect(close.body.code).toBe('BANK_PENDING_LINES');
  });
});
