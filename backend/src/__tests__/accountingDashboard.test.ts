/**
 * Accounting dashboard (services/accounting/dashboard.service.ts): the pure helpers (periods,
 * DGII deadlines, DSO) and, against a local Mongo, every block computed from seeded ledger and
 * document data at a fixed "now", plus the permission gating of the endpoint.
 */
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

let mockAllowed: (permissions: string[]) => boolean = () => true;
jest.mock('../middleware/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: '64b000000000000000000001', role: 'admin' }; next(); },
    authorize: () => pass,
    authorizePermission: () => pass,
    authorizeAppAccess: () => pass,
    userHasPermission: async (_user: any, _app: string, permissions: string[]) => mockAllowed(permissions),
  };
});

/* eslint-disable import/first */
import {
  resolvePeriod, monthStarts, monthKey, nextTaxDeadlines, computeDso, getDashboard, DashboardAccess,
} from '../services/accounting/dashboard.service';
import dashboardRoutes from '../routes/accounting/dashboard.routes';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import Account from '../models/Account';
import JournalEntry from '../models/JournalEntry';
import Invoice from '../models/Invoice';
import Bill from '../models/Bill';
import Product from '../models/Product';
import ElectronicInvoice from '../models/ElectronicInvoice';
/* eslint-enable import/first */

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

describe('resolvePeriod', () => {
  const now = at(2026, 11, 18);

  it('month: month-to-date against the same days of the previous month', () => {
    const p = resolvePeriod('month', now);
    expect([ymd(p.from), ymd(p.to)]).toEqual(['2026-11-1', '2026-11-18']);
    expect([ymd(p.prevFrom), ymd(p.prevTo)]).toEqual(['2026-10-1', '2026-10-18']);
  });

  it('lastMonth: the whole previous month against the one before it', () => {
    const p = resolvePeriod('lastMonth', now);
    expect([ymd(p.from), ymd(p.to)]).toEqual(['2026-10-1', '2026-10-31']);
    expect([ymd(p.prevFrom), ymd(p.prevTo)]).toEqual(['2026-9-1', '2026-9-30']);
  });

  it('quarter and year compare with the same elapsed days of the previous quarter / year', () => {
    const q = resolvePeriod('quarter', now);
    expect([ymd(q.from), ymd(q.prevFrom), ymd(q.prevTo)]).toEqual(['2026-10-1', '2026-7-1', '2026-8-18']);
    const y = resolvePeriod('year', now);
    expect([ymd(y.from), ymd(y.prevFrom), ymd(y.prevTo)]).toEqual(['2026-1-1', '2025-1-1', '2025-11-18']);
  });

  it('never runs the comparison past the end of a shorter previous month', () => {
    const p = resolvePeriod('month', at(2026, 3, 31));
    expect([ymd(p.prevFrom), ymd(p.prevTo)]).toEqual(['2026-2-1', '2026-2-28']);
  });

  it('January wraps to December of the previous year', () => {
    expect(ymd(resolvePeriod('month', at(2026, 1, 10)).prevFrom)).toBe('2025-12-1');
    expect(ymd(resolvePeriod('lastMonth', at(2026, 1, 10)).from)).toBe('2025-12-1');
  });
});

describe('monthStarts', () => {
  it('lists the last N months oldest first, across a year boundary', () => {
    expect(monthStarts(at(2026, 2, 9), 4).map(monthKey)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('nextTaxDeadlines', () => {
  const summary = (d: Date) => nextTaxDeadlines(d).map((x) => [x.key, ymd(x.date), x.daysLeft]);

  it('counts down to the 15th and the 20th', () => {
    expect(summary(at(2026, 11, 10))).toEqual([['informativeReturns', '2026-11-15', 5], ['itbisReturn', '2026-11-20', 10]]);
  });

  it('is still due on the day itself', () => {
    expect(summary(at(2026, 11, 15, 18))[0]).toEqual(['informativeReturns', '2026-11-15', 0]);
  });

  it('rolls to next month once the day has passed, and across a year end', () => {
    expect(summary(at(2026, 11, 18))).toEqual([['informativeReturns', '2026-12-15', 27], ['itbisReturn', '2026-11-20', 2]]);
    expect(summary(at(2026, 12, 21))).toEqual([['informativeReturns', '2027-1-15', 25], ['itbisReturn', '2027-1-20', 30]]);
  });
});

describe('computeDso', () => {
  it('scales open receivables by the last 90 days of invoicing', () => {
    expect(computeDso(540, 640)).toBe(76);
    expect(computeDso(0, 640)).toBe(0);
  });
  it('is unknown when nothing was invoiced', () => {
    expect(computeDso(500, 0)).toBeNull();
  });
});

describe('dashboard (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  const id = () => new mongoose.Types.ObjectId();
  const now = at(2026, 11, 18);
  const everything: DashboardAccess = { financial: true, receivables: true, payables: true, cityLedger: true, inventory: true, ecf: true };
  const run = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });

  const acc: Record<string, mongoose.Types.ObjectId> = {};
  const [custA, custB, supp1] = [id(), id(), id()];

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_acc_dashboard');
    if (!ready) { console.warn('Mongo unreachable — skipping dashboard DB tests'); return; }

    const defs: [string, string, string, string?][] = [
      ['1000', 'Caja', 'asset'], ['1010', 'Bancos', 'asset'], ['1100', 'Cuentas por Cobrar', 'asset'],
      ['2000', 'Cuentas por Pagar', 'liability'], ['2100', 'ITBIS por Pagar', 'liability'],
      ['4000', 'Ingresos por Ventas', 'revenue'], ['6000', 'Gastos Operativos', 'expense'], ['6010', 'Alquiler', 'expense', '6000'],
    ];
    defs.forEach(([code]) => { acc[code] = id(); });
    await Account.collection.insertMany(defs.map(([code, name, type, parent]) => ({
      _id: acc[code], tenantId, code, name, type, normalBalance: ['asset', 'expense'].includes(type) ? 'debit' : 'credit',
      isSystem: true, isActive: true, ...(parent ? { parentAccount: acc[parent] } : {}),
    })));

    const entry = (n: number, date: Date, lines: [string, number, number][]) => ({
      tenantId, entryNumber: `JE-${n}`, date, isVoid: false, description: `entry ${n}`,
      lines: lines.map(([code, debit, credit]) => ({ _id: id(), account: acc[code], debit, credit })),
    });
    await JournalEntry.collection.insertMany([
      entry(1, at(2026, 10, 5), [['1010', 1000, 0], ['4000', 0, 1000]]),                         // October cash sale
      entry(2, at(2026, 11, 3), [['1100', 590, 0], ['4000', 0, 500], ['2100', 0, 90]]),          // invoice with ITBIS
      entry(3, at(2026, 11, 10), [['1000', 200, 0], ['1100', 0, 200]]),                          // collection
      entry(4, at(2026, 11, 12), [['6010', 300, 0], ['1010', 0, 300]]),                          // rent paid from the bank
      entry(5, at(2026, 11, 14), [['1010', 100, 0], ['1000', 0, 100]]),                          // cash → bank transfer
    ]);

    const line = { description: 'x', quantity: 1, unitPrice: 1, taxRate: 0, lineTotal: 1, taxAmount: 0, total: 1 };
    const inv = (n: number, extra: object) => ({ tenantId, invoiceNumber: `INV-${n}`, lineItems: [line], createdBy: id(), isIndividual: false, payments: [], ...extra });
    await Invoice.collection.insertMany([
      inv(1, { customer: custA, status: 'partial', issueDate: at(2026, 11, 3), dueDate: at(2026, 11, 8), total: 590, amountPaid: 200, balanceDue: 390,
        payments: [{ amount: 200, method: 'cash', date: at(2026, 11, 10), recordedBy: id() }] }),
      inv(2, { customer: custB, status: 'sent', issueDate: at(2026, 8, 1), dueDate: at(2026, 8, 31), total: 100, balanceDue: 100 }),
      inv(3, { customer: custA, status: 'sent', issueDate: at(2026, 11, 10), dueDate: at(2026, 11, 25), total: 50, balanceDue: 50 }),
      inv(4, { isIndividual: true, individualCustomer: { name: 'Walk-in' }, status: 'draft', issueDate: at(2026, 11, 16), total: 80, balanceDue: 80,
        cityLedger: { sourceReservationId: id(), sourceFolioId: id(), preApproved: false, authorizationStatus: 'pending' } }),
    ]);
    // Customers / suppliers for the display names
    await mongoose.connection.collection('customers').insertMany([
      { _id: custA, tenantId, name: 'Hotel Alfa', razonSocial: 'Alfa SRL' }, { _id: custB, tenantId, name: 'Beta' },
    ]);
    await mongoose.connection.collection('suppliers').insertOne({ _id: supp1, tenantId, name: 'Proveedor Uno' });

    const bill = (n: number, extra: object) => ({ tenantId, billNumber: `BILL-${n}`, supplier: supp1, lineItems: [], createdBy: id(), payments: [], ...extra });
    await Bill.collection.insertMany([
      bill(1, { status: 'received', issueDate: at(2026, 11, 5), dueDate: at(2026, 11, 20), total: 354, taxAmount: 54, balanceDue: 354 }),
      bill(2, { status: 'received', issueDate: at(2026, 10, 20), dueDate: at(2026, 11, 1), total: 200, taxAmount: 0, balanceDue: 200 }),
      bill(3, { status: 'paid', issueDate: at(2026, 11, 2), dueDate: at(2026, 11, 30), total: 80, taxAmount: 0, balanceDue: 0,
        payments: [{ amount: 80, method: 'transfer', date: at(2026, 11, 12), recordedBy: id() }] }),
    ]);

    const prod = (sku: string, onHandQty: number, reorderPoint: number, isActive = true) => ({ tenantId, name: sku, sku, onHandQty, reorderPoint, isActive });
    await Product.collection.insertMany([prod('LOW', 2, 5), prod('OK', 10, 5), prod('OFF', 0, 5, false), prod('NOPOINT', 0, 0)]);

    const ecf = (estadoECF: string, createdAt: Date) => ({ tenantId, estadoECF, createdAt });
    await ElectronicInvoice.collection.insertMany([
      ecf('Aceptado', at(2026, 11, 1)), ecf('Rechazado', at(2026, 11, 10)), ecf('En Proceso', at(2026, 11, 15)), ecf('Rechazado', at(2026, 8, 1)),
    ]);
  });
  afterAll(async () => { if (ready) await dropTestDb(); });

  itDb('financial block: cash, period P&L with comparison, ITBIS, top expenses', async () => {
    const d = await run(() => getDashboard(now, 'month', everything));
    const f = d.financial!;
    expect(f.cash.total).toBe(900);
    expect(f.cash.accounts).toEqual([{ code: '1000', name: 'Caja', balance: 100 }, { code: '1010', name: 'Bancos', balance: 800 }]);
    expect(f.current).toEqual({ revenue: 500, expenses: 300, netIncome: 200 });
    expect(f.previous).toEqual({ revenue: 1000, expenses: 0, netIncome: 1000 });
    expect(f.itbis).toEqual({ sales: 90, purchases: 54, net: 36 });
    // Parent "Gastos Operativos" is a roll-up: only the leaf account is listed
    expect(f.topExpenses).toEqual([{ code: '6010', name: 'Alquiler', amount: 300 }]);
  });

  itDb('trend: six months, cash flow netted per entry (a transfer is neither in nor out), closing balances chain back', async () => {
    const t = (await run(() => getDashboard(now, 'month', everything))).financial!.trend;
    expect(t.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(t[4]).toMatchObject({ revenue: 1000, expenses: 0, cashIn: 1000, cashOut: 0, cashClosing: 1000 });
    expect(t[5]).toMatchObject({ revenue: 500, expenses: 300, net: 200, cashIn: 200, cashOut: 300, cashNet: -100, cashClosing: 900 });
    expect(t[0].cashClosing).toBe(0);
  });

  itDb('lastMonth period compares October with September', async () => {
    const f = (await run(() => getDashboard(now, 'lastMonth', everything))).financial!;
    expect(f.current).toEqual({ revenue: 1000, expenses: 0, netIncome: 1000 });
    expect(f.previous.revenue).toBe(0);
  });

  itDb('receivables: aging buckets, overdue list oldest first, DSO', async () => {
    const r = (await run(() => getDashboard(now, 'month', everything))).receivables!;
    expect(r.total).toBe(540);
    expect(r.buckets).toEqual({ current: 50, d1_30: 390, d31_60: 0, d61_90: 100, d90_plus: 0 });
    expect(r).toMatchObject({ overdue: 490, overdueCount: 2, openCount: 3, dsoDays: 76 });
    expect(r.invoices.map((i) => [i.invoiceNumber, i.customerName, i.daysOverdue, i.balanceDue])).toEqual([
      ['INV-2', 'Beta', 79, 100], ['INV-1', 'Alfa SRL', 10, 390],
    ]);
  });

  itDb('payables: overdue and due-within-7-days, most urgent first', async () => {
    const p = (await run(() => getDashboard(now, 'month', everything))).payables!;
    expect(p).toMatchObject({ total: 554, overdue: 200, overdueCount: 1, dueSoon: 354, dueSoonCount: 1, openCount: 2 });
    expect(p.bills.map((b) => [b.billNumber, b.supplierName, b.daysOverdue])).toEqual([['BILL-2', 'Proveedor Uno', 17], ['BILL-1', 'Proveedor Uno', -2]]);
  });

  itDb('attention counts, e-CF health (last 30 days), recent payments and deadlines', async () => {
    const d = await run(() => getDashboard(now, 'month', everything));
    expect(d.attention).toEqual({ cityLedgerPending: 1, lowStock: 1 });
    expect(d.ecf).toEqual({ accepted: 1, inProcess: 1, contingency: 0, rejected: 1, total: 3, windowDays: 30 });
    expect(d.recentPayments!.map((p) => [p.kind, p.party, p.amount, p.docNumber])).toEqual([
      ['out', 'Proveedor Uno', 80, 'BILL-3'], ['in', 'Alfa SRL', 200, 'INV-1'],
    ]);
    expect(d.deadlines.map((x) => x.daysLeft)).toEqual([27, 2]);
  });

  itDb('blocks the user may not see are left out entirely', async () => {
    const d = await run(() => getDashboard(now, 'month', { ...everything, financial: false, payables: false, cityLedger: false, inventory: false, ecf: false }));
    expect(d.financial).toBeUndefined();
    expect(d.payables).toBeUndefined();
    expect(d.ecf).toBeUndefined();
    expect(d.attention).toEqual({ cityLedgerPending: undefined, lowStock: undefined });
    expect(d.receivables).toBeDefined();
    // only the invoice side of recent payments
    expect(d.recentPayments!.map((p) => p.kind)).toEqual(['in']);
  });

  describe('endpoint', () => {
    const app = express();
    app.use((_req, _res, next) => tenantLocalStorage.run({ tenantId: String(tenantId) }, next));
    app.use('/api/accounting/dashboard', dashboardRoutes);

    afterEach(() => { mockAllowed = () => true; });

    itDb('maps module permissions to blocks and falls back to "month" for an unknown period', async () => {
      mockAllowed = (perms) => perms.some((p) => p.startsWith('accounting.invoices'));
      const r = await request(app).get('/api/accounting/dashboard').query({ period: 'bogus' });
      expect(r.status).toBe(200);
      expect(r.body.data.period.key).toBe('month');
      expect(r.body.data.access).toEqual({ financial: false, receivables: true, payables: false, cityLedger: false, inventory: false, ecf: true });
      expect(r.body.data.financial).toBeUndefined();
      expect(r.body.data.receivables.openCount).toBe(3);
    });
  });
});
