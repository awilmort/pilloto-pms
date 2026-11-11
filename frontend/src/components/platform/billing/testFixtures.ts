/** Shared builders for the billing console's tests (kept outside `__tests__` so Jest does not run it). */
import type { AxiosResponse } from 'axios';
import type { BillingCharge, BillingEcf, BillingPayment, BillingTenant, BillingTenantProduct } from '../../../types/billing';

export const ok = <T,>(data: T, extra: object = {}) => ({ data: { success: true, data, ...extra } }) as unknown as AxiosResponse;
export const fail = (code: string, message: string, fields?: Record<string, string>) =>
  Object.assign(new Error(message), { response: { data: { success: false, code, message, ...(fields ? { fields } : {}) } } });

export const ecf = (over: Partial<BillingEcf> = {}): BillingEcf => ({
  id: 'e1', eNCF: 'E310000000001', tipo: 'E31', estado: 'Aceptado', mensaje: null, environment: 'ecf', hasDocument: true, total: 17593.8, issuedAt: '2026-11-04T15:00:00Z', ...over,
});

export const payment = (over: Partial<BillingPayment> = {}): BillingPayment => ({
  id: 'p1', tenantId: 't1', chargeId: 'c1', chargeNumber: 'COB-000001', tenant: { id: 't1', name: 'Hotel Prueba', slug: 'prueba' },
  amount: 17593.8, paidAt: '2026-11-04T15:00:00Z', method: 'transfer', reference: 'TRF-1', source: 'manual', status: 'recorded', ecf: ecf(), ecfError: null, createdAt: '2026-11-04T15:00:00Z', ...over,
});

export const charge = (over: Partial<BillingCharge> = {}): BillingCharge => ({
  id: 'c1', number: 'COB-000001', tenantId: 't1', tenant: { id: 't1', name: 'Hotel Prueba', slug: 'prueba' }, period: '2026-10', currency: 'DOP',
  lines: [
    { kind: 'subscription', product: 'pms', description: 'Suscripción Pilloto PMS — plan pro (octubre 2026)', amount: 5540 },
    { kind: 'subscription', product: 'accounting', description: 'Suscripción Pilloto Accounting — plan plus (octubre 2026)', amount: 9370 },
  ],
  subtotal: 14910, tax: 'itbis18', itbis: 2683.8, total: 17593.8, paidAmount: 0, balance: 17593.8, status: 'open', overdue: false, dueDate: '2026-11-15', createdAt: '2026-11-01T10:00:00Z', ...over,
});

const product = (over: Partial<BillingTenantProduct> = {}): BillingTenantProduct => ({
  product: 'pms', plan: 'pro', listPrice: 5540, contractPrice: 5540, contractSource: 'catalog', contractSince: null, ...over,
});

export const tenant = (over: Partial<BillingTenant> = {}): BillingTenant => ({
  id: 't1', name: 'Hotel Prueba', slug: 'prueba', isActive: true, ownerEmail: 'dueno@prueba.com', billingEmail: '', paused: false, legalName: 'Hotel Prueba SRL', rnc: '131880681',
  createdAt: '2025-01-01T12:00:00Z', products: [product(), product({ product: 'accounting', plan: 'plus', listPrice: 9370, contractPrice: 9370 })], priceChanges: [], discounts: [],
  outstanding: 0, openCharges: 0, lastPayment: null, ...over,
});
