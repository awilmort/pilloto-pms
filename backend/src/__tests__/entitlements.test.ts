/**
 * Plans & entitlements (PLANS_AND_SUBSCRIPTIONS_PLAN.md phase 1): the Accounting modules each tier
 * unlocks, the numeric limits (seats, warehouses, rooms), non-stock catalog items, the shared
 * plan-denial body, and the public plan list.
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
import publicPlansRoutes from '../routes/publicPlans';
import { tenantLocalStorage } from '../middleware/tenantContext';
import { connectTestDb, dropTestDb } from './helpers/testDb';
import User from '../models/User';
import Warehouse from '../models/Warehouse';
import Product from '../models/Product';
import { ACCOUNTING_PLANS, smallestAccountingPlanWith } from '../config/accountingPlans';
import { PLANS, smallestPlanWith } from '../config/plans';
import {
  holdsSeat, limitDenial, limitViolations, lostFeatures, planDirection, seatFilter, seatsIn, smallestPlanAbove,
} from '../services/entitlements';
import { ACCOUNTING_INCLUDED_FISCAL_PLAN, PMS_INCLUDED_FISCAL_PLAN } from '../config/fiscal';
/* eslint-enable import/first */

describe('plan configuration', () => {
  it('sells four Accounting tiers in order, from Facturación to Plus, with the approved list prices', () => {
    expect(Object.values(ACCOUNTING_PLANS).map((p) => [p.slug, p.name, p.listPriceDop])).toEqual([
      ['invoicing', 'Facturación', 1590],
      ['essentials', 'Esencial', 4090],
      ['pro', 'Pro', 6890],
      ['plus', 'Plus', 10690],
    ]);
  });

  it('unlocks inventory, ledger and bank reconciliation at Esencial and multi-currency at Pro', () => {
    expect(smallestAccountingPlanWith('inventory')).toBe('essentials');
    expect(smallestAccountingPlanWith('generalLedger')).toBe('essentials');
    expect(smallestAccountingPlanWith('bankReconciliation')).toBe('essentials');
    expect(smallestAccountingPlanWith('multiCurrency')).toBe('pro');
  });

  it('includes e-CF in every plan of both products', () => {
    expect(Object.keys(PLANS).every((p) => PMS_INCLUDED_FISCAL_PLAN[p as keyof typeof PMS_INCLUDED_FISCAL_PLAN])).toBe(true);
    expect(Object.keys(ACCOUNTING_PLANS).every((p) => ACCOUNTING_INCLUDED_FISCAL_PLAN[p as keyof typeof ACCOUNTING_INCLUDED_FISCAL_PLAN])).toBe(true);
  });

  it('suggests the smallest plan that lifts a limit', () => {
    expect(smallestPlanAbove('accounting', 'users', 2)).toBe('essentials'); // 3 seats
    expect(smallestPlanAbove('accounting', 'users', 6)).toBe('plus');
    expect(smallestPlanAbove('accounting', 'warehouses', 3)).toBe('plus'); // unlimited
    expect(smallestPlanAbove('pms', 'rooms', 15)).toBe('pro');
    expect(smallestPlanAbove('pms', 'rooms', 100)).toBeUndefined(); // no plan has more than 100
    expect(smallestPlanWith('channelManager')).toBe('pro');
  });

  it('limit denials carry the code, the limit and the plan to upgrade to', () => {
    expect(limitDenial('accounting', 'users', 2, 'invoicing')).toMatchObject({
      success: false, code: 'PLAN_LIMIT', plan: { product: 'accounting', limit: 'users', max: 2, currentPlan: 'invoicing', requiredPlan: 'essentials' },
    });
  });

  it('a downgrade is blocked by usage above the smaller plan and warns about lost modules', () => {
    const usage = { pms: { users: 4, rooms: 20 }, accounting: { users: 3, warehouses: 2 } };
    expect(limitViolations('pms', 'basic', usage)).toEqual([{ limit: 'rooms', max: 15, current: 20 }, { limit: 'users', max: 2, current: 4 }]);
    expect(limitViolations('accounting', 'essentials', usage)).toEqual([{ limit: 'warehouses', max: 1, current: 2 }]);
    expect(limitViolations('accounting', 'pro', usage)).toEqual([]);
    expect(lostFeatures('accounting', 'pro', 'invoicing')).toEqual(['inventory', 'generalLedger', 'bankReconciliation', 'multiCurrency']);
    expect(planDirection('accounting', 'invoicing', 'plus')).toBeGreaterThan(0);
    expect(planDirection('pms', 'enterprise', 'basic')).toBeLessThan(0);
  });

  it('a PMS seat is a pms role assignment or a legacy staff role; customers hold none', () => {
    expect(holdsSeat({ role: 'customer', appRoles: [] }, 'pms')).toBe(false);
    expect(holdsSeat({ role: 'staff', appRoles: [] }, 'pms')).toBe(true);
    expect(holdsSeat({ role: 'customer', appRoles: [{ app: 'pms' }] }, 'pms')).toBe(true);
    expect(holdsSeat({ role: 'admin', appRoles: [] }, 'accounting')).toBe(false);
    expect(seatFilter('accounting')).toMatchObject({ 'appRoles.app': 'accounting' });
  });
});

describe('entitlements against the Accounting API (local Mongo)', () => {
  let ready = false;
  const tenantId = new mongoose.Types.ObjectId();
  let plan = 'invoicing';
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = String(tenantId);
    req.tenant = { _id: tenantId, plan: 'basic', products: ['accounting'], plans: { accounting: plan }, settings: {}, ecfConfig: { defaultItbisRate: 18 } };
    tenantLocalStorage.run({ tenantId: String(tenantId) }, next);
  });
  app.use('/api/accounting', accountingRoutes);
  app.use('/api/public/plans', publicPlansRoutes);
  const itDb = (name: string, fn: () => Promise<void>) => it(name, async () => { if (ready) await fn(); });
  const inTenant = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ tenantId: String(tenantId) }, fn);

  beforeAll(async () => {
    ready = await connectTestDb('pilloto_entitlements');
    if (!ready) console.warn('Mongo unreachable — skipping entitlements DB tests');
  });
  afterAll(async () => { if (ready) await dropTestDb(); });
  beforeEach(() => { plan = 'invoicing'; });

  itDb('Facturación answers PLAN_FEATURE for the ledger and inventory, naming Esencial', async () => {
    const je = await request(app).get('/api/accounting/journal-entries');
    expect(je.status).toBe(403);
    expect(je.body).toMatchObject({ code: 'PLAN_FEATURE', plan: { product: 'accounting', feature: 'generalLedger', currentPlan: 'invoicing', requiredPlan: 'essentials' } });
    expect((await request(app).get('/api/accounting/warehouses')).body.code).toBe('PLAN_FEATURE');
    expect((await request(app).get('/api/accounting/reports/profit-and-loss')).body.code).toBe('PLAN_FEATURE');
    expect((await request(app).post('/api/accounting/accounts').send({ code: '6100', name: 'X', type: 'expense' })).body.code).toBe('PLAN_FEATURE');
  });

  itDb('Facturación keeps receivables reports and the chart of accounts (read) for expense coding', async () => {
    expect((await request(app).get('/api/accounting/reports/ar-aging')).status).toBe(200);
    expect((await request(app).get('/api/accounting/accounts')).status).toBe(200);
  });

  itDb('Esencial opens the ledger', async () => {
    plan = 'essentials';
    expect((await request(app).get('/api/accounting/journal-entries')).status).toBe(200);
    expect((await request(app).get('/api/accounting/warehouses')).status).toBe(200);
  });

  itDb('without inventory a new item is a non-stock one, and a stocked item is refused', async () => {
    const svc = await request(app).post('/api/accounting/products').send({ name: 'Consultoría', sku: 'SRV-1', unitOfMeasure: 'unit', defaultUnitPrice: 1500, isSellable: true });
    expect(svc.status).toBe(201);
    expect(svc.body.data.tracksStock).toBe(false);
    const stocked = await request(app).post('/api/accounting/products').send({ name: 'Toalla', sku: 'INV-1', unitOfMeasure: 'unit', tracksStock: true });
    expect(stocked.status).toBe(403);
    expect(stocked.body.code).toBe('PLAN_FEATURE');
  });

  itDb('a non-stock item never moves stock, even on a plan with inventory', async () => {
    plan = 'essentials';
    const svc = await request(app).post('/api/accounting/products').send({ name: 'Instalación', sku: 'SRV-2', unitOfMeasure: 'unit', tracksStock: false });
    expect(svc.body.data.tracksStock).toBe(false);
    await inTenant(() => Warehouse.create({ name: 'Principal', code: 'PRI', isDefault: true }));
    const adjust = await request(app).post(`/api/accounting/products/${svc.body.data._id}/adjust`).send({ quantityDelta: 5, reason: 'count' });
    expect(adjust.status).toBe(400);
    const stocked = await request(app).post('/api/accounting/products').send({ name: 'Jabón', sku: 'INV-2', unitOfMeasure: 'unit' });
    expect(stocked.body.data.tracksStock).toBe(true); // default when the plan has inventory
    await inTenant(() => Warehouse.deleteMany({}));
  });

  itDb('a bill with an inventory line needs the inventory module', async () => {
    const supplier = await request(app).post('/api/accounting/suppliers').send({ name: 'Distribuidora X', rnc: '101010101' });
    const r = await request(app).post('/api/accounting/bills').send({
      supplier: supplier.body.data._id, dueDate: '2026-12-31',
      lineItems: [{ lineType: 'inventory', product: String(new mongoose.Types.ObjectId()), purchaseQuantity: 1 }],
    });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'PLAN_FEATURE', plan: { feature: 'inventory' } });
  });

  itDb('the warehouse limit counts active warehouses only', async () => {
    plan = 'essentials'; // 1 warehouse
    const first = await request(app).post('/api/accounting/warehouses').send({ name: 'A', code: 'A' });
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/accounting/warehouses').send({ name: 'B', code: 'B' });
    expect(second.status).toBe(403);
    expect(second.body).toMatchObject({ code: 'PLAN_LIMIT', plan: { limit: 'warehouses', max: 1, requiredPlan: 'pro' } });
    await inTenant(() => Warehouse.updateOne({ code: 'A' }, { $set: { isActive: false } }));
    expect((await request(app).post('/api/accounting/warehouses').send({ name: 'B', code: 'B' })).status).toBe(201);
    // Reactivating A would make two active warehouses
    const a = await inTenant(() => Warehouse.findOne({ code: 'A' }).lean());
    const reactivate = await request(app).put(`/api/accounting/warehouses/${a!._id}`).send({ isActive: true });
    expect(reactivate.body.code).toBe('PLAN_LIMIT');
    await inTenant(() => Warehouse.deleteMany({}));
  });

  itDb('seats are counted per app, inactive users excluded', async () => {
    await inTenant(async () => {
      const roleId = new mongoose.Types.ObjectId();
      await User.collection.insertMany([
        { tenantId, email: 'a@x.com', firstName: 'A', lastName: 'A', password: 'x', role: 'customer', appRoles: [{ app: 'accounting', role: roleId }] },
        { tenantId, email: 'b@x.com', firstName: 'B', lastName: 'B', password: 'x', role: 'staff', appRoles: [] },
        { tenantId, email: 'c@x.com', firstName: 'C', lastName: 'C', password: 'x', role: 'staff', appRoles: [], isActive: false },
        { tenantId, email: 'd@x.com', firstName: 'D', lastName: 'D', password: 'x', role: 'customer', appRoles: [] },
      ]);
      expect(await seatsIn('accounting')).toBe(1);
      expect(await seatsIn('pms')).toBe(1);
      await User.deleteMany({});
    });
  });

  itDb('the public plan list has both products with prices from the price list and the suite discount', async () => {
    const r = await request(app).get('/api/public/plans');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ currency: 'DOP', taxPercent: 18, suiteDiscountPercent: 20 });
    expect(r.body.data.pms.map((p: any) => [p.slug, p.monthlyPrice, p.includedEcf.plan])).toEqual([
      ['basic', 2450, 'essential'], ['pro', 5540, 'essential'], ['enterprise', 9370, 'pro'],
    ]);
    expect(r.body.data.accounting.map((p: any) => [p.slug, p.monthlyPrice, p.includedEcf.plan])).toEqual([
      ['invoicing', 1590, 'essential'], ['essentials', 4090, 'essential'], ['pro', 6890, 'pro'], ['plus', 10690, 'max'],
    ]);
    expect(r.body.data.accounting[0].limits).toEqual({ maxUsers: 2, maxWarehouses: 0 });
  });
});
