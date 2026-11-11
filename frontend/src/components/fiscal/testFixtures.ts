import type { ElectronicInvoice, FiscalPlans, FiscalStatus } from '../../types';

export const LINKS = {
  dashboard: 'https://app.billingsoft.test',
  onboarding: 'https://app.billingsoft.test/primeros-pasos',
  certification: 'https://app.billingsoft.test/certificacion',
  certificate: 'https://app.billingsoft.test/certificado',
  sequences: 'https://app.billingsoft.test/secuencias',
  received: 'https://app.billingsoft.test/recibidos',
};

export const org = (over: Partial<NonNullable<FiscalStatus['organization']>> = {}): NonNullable<FiscalStatus['organization']> => ({
  id: 'org-1', rnc: '131880681', adminEmail: 'carla@hotel.test', environment: 'testecf', certification: 'not_started', isActive: true,
  plan: 'essential', pendingPlan: null, webhookRegistered: true, provisionedAt: '2026-11-01T12:00:00Z', ...over,
});

export const status = (over: Partial<FiscalStatus> = {}): FiscalStatus => ({
  configured: true, state: 'inactive', canIssue: false, allowUncertified: false, includedPlan: 'essential', organization: null,
  defaults: { rnc: '131880681', razonSocial: 'Hotel Prueba SRL', address: 'Av. Principal 1, Sosúa', adminEmail: 'dueno@hotel.test' },
  links: LINKS, ...over,
});

export const readyStatus = (over: Partial<FiscalStatus> = {}): FiscalStatus =>
  status({ state: 'ready', canIssue: true, organization: org({ environment: 'ecf', certification: 'certified' }), ...over });

export const plans = (over: Partial<FiscalPlans> = {}): FiscalPlans => ({
  currency: 'DOP', annualDiscountPercent: 10, includedPlan: 'essential', currentPlan: 'essential', pendingPlan: null,
  plans: [
    { id: 'essential', users: 1, transactions: 300, monthlyPrice: 475, monthlyCharge: 0, overageUnitPrice: 4.75, selectable: true, included: true, change: 0 },
    { id: 'pro', users: 3, transactions: 1000, monthlyPrice: 800, monthlyCharge: 325, overageUnitPrice: 2.4, selectable: true, included: false, change: 1 },
    { id: 'max', users: 5, transactions: 3000, monthlyPrice: 1500, monthlyCharge: 1025, overageUnitPrice: 1.5, selectable: true, included: false, change: 1 },
  ],
  ...over,
});

export const doc = (over: Partial<ElectronicInvoice> = {}): ElectronicInvoice => ({
  _id: 'd1', tenantId: 't1', tipo: 'E32', eNCF: 'E320000000001', billingsoftDocumentId: 'bs-1', route: 'invoices', estadoECF: 'Aceptado', estatus: 'accepted',
  environment: 'ecf', totalFactura: 11800, totalImpuestos: 1800, currency: 'DOP', buyerName: 'Ana Gómez', buyerEmail: 'ana@gmail.com',
  generationSource: 'payment_screen', issuedAt: '2026-11-08T15:00:00Z', retryCount: 0, createdAt: '2026-11-08T15:00:00Z', updatedAt: '2026-11-08T15:00:00Z',
  lineItems: [{ description: 'Habitación 101', qty: 1, netPrice: 10000, itbisRate: 18, itbisAmount: 1800, grossAmount: 11800 }],
  ...over,
});

export const ok = <T,>(data: T, extra: object = {}) => Promise.resolve({ data: { success: true, data, ...extra } });
export const fail = (code: string, message = 'x', fields?: Record<string, string>) =>
  Promise.reject({ response: { data: { success: false, code, message, ...(fields ? { fields } : {}) } } });
