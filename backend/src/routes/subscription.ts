/**
 * Subscription Routes — /api/subscription/* (the tenant's "Plan y facturación" page)
 *
 * The tenant's own view of what it buys from Pilloto, and the self-service changes. Open to the
 * tenant's owner and to users holding `admin.subscription` (PMS) or `accounting.subscription`
 * (Accounting) — or that app's full access. Not gated on a product: a tenant whose only product is
 * Accounting manages its subscription here too.
 *
 *   GET    /                       overview: products, prices, usage, e-CF, billing email
 *   GET    /catalog                plans with what changing to each would mean
 *   POST   /change                 { product, plan } upgrade now / downgrade next month
 *   POST   /products               { product, plan } add a product (free trial)
 *   DELETE /products/:product      cancel at the end of the month
 *   POST   /products/:product/keep withdraw a cancellation
 *   PUT    /billing-email          { billingEmail }
 *   GET    /charges                the tenant's charges, newest first, paged (?page, ?status, ?search)
 *   GET    /charges/:id            one charge with its payments
 *   GET    /payments/:id/ecf/pdf   the e-CF Pilloto issued for a payment
 *   POST   /charges/:id/pay        start an online payment (HandyPay)
 *   POST   /online-payments/:sessionId/confirm   check a returning payment (the webhook may be later)
 */
import express, { NextFunction, Response } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest, userHasPermission } from '../middleware/auth';
import BillingCharge from '../models/BillingCharge';
import BillingPayment from '../models/BillingPayment';
import ElectronicInvoice from '../models/ElectronicInvoice';
import Tenant, { BILLING_PRODUCTS, BillingProduct, ITenant } from '../models/Tenant';
import { AppCode } from '../constants/apps';
import { BillingSoftError, OWN_ORGANIZATION } from '../services/fiscal/billingsoftClient';
import { getBillingSoftClient } from '../services/fiscal/fiscalClient';
import { FiscalError } from '../services/fiscal/fiscalCore';
import { toFiscalError } from '../services/fiscal/fiscalIssuer';
import { PLATFORM_ISSUER_ID } from '../services/fiscal/platformIssuer';
import { round2 } from '../services/platformBilling/billingMath';
import { isOverdue } from '../services/platformBilling/billingCharges';
import { addProduct, cancelProduct, changePlan, keepProduct, subscriptionOverview, tenantCatalog } from '../services/platformBilling/tenantSubscription';
import { confirmOnlinePayment, startOnlinePayment } from '../services/platformBilling/onlinePayments';

const router = express.Router();

/** Owner, or `admin.subscription` / `accounting.subscription` (or full access) in an app the tenant has. */
async function canManageSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Access denied. Authentication required.' });
  if (req.user.isSuperAdmin) return next();
  const products = ((req.tenant as any)?.products ?? []) as AppCode[];
  const allowed =
    (await userHasPermission(req.user, 'pms', ['admin.subscription'], req.tenantId, products)) ||
    (await userHasPermission(req.user, 'accounting', ['accounting.subscription'], req.tenantId, products));
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have access to the subscription.' });
  next();
}

router.use(authenticate, canManageSubscription);

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;
const act = (fn: Handler, status = 200) => async (req: AuthRequest, res: Response) => {
  try {
    const data = await fn(req, res);
    if (res.headersSent) return;
    return res.status(status).json({ success: true, data });
  } catch (err) {
    const known = err instanceof BillingSoftError ? toFiscalError(err) : err;
    if (known instanceof FiscalError) {
      return res.status(known.statusCode).json({
        success: false, code: known.code, message: known.message,
        ...(known.fields ? { fields: known.fields } : {}),
        ...((known as any).violations ? { violations: (known as any).violations } : {}),
      });
    }
    console.error('Subscription error:', (err as Error)?.message ?? err);
    return res.status(500).json({ success: false, message: 'The subscription action failed.' });
  }
};

/** The tenant as a full document (req.tenant may be a lean copy). */
async function tenantOf(req: AuthRequest): Promise<ITenant> {
  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant) throw new FiscalError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
  return tenant;
}

const actor = (req: AuthRequest) => ({ email: req.user?.email });
const productParam = (value: unknown): BillingProduct => {
  if (!BILLING_PRODUCTS.includes(value as BillingProduct)) throw new FiscalError(400, 'BILLING_INVALID', 'Unknown product');
  return value as BillingProduct;
};

router.get('/', act(async (req) => subscriptionOverview(await tenantOf(req))));
router.get('/catalog', act(async (req) => tenantCatalog(await tenantOf(req))));

router.post('/change', act(async (req) => {
  const tenant = await tenantOf(req);
  const result = await changePlan(tenant, productParam(req.body?.product), req.body?.plan, actor(req));
  return { ...result, overview: await subscriptionOverview(tenant) };
}));

router.post('/products', act(async (req) => {
  const tenant = await tenantOf(req);
  await addProduct(tenant, productParam(req.body?.product), req.body?.plan, actor(req));
  return subscriptionOverview(tenant);
}, 201));

router.delete('/products/:product', act(async (req) => {
  const tenant = await tenantOf(req);
  await cancelProduct(tenant, productParam(req.params.product), actor(req));
  return subscriptionOverview(tenant);
}));

router.post('/products/:product/keep', act(async (req) => {
  const tenant = await tenantOf(req);
  await keepProduct(tenant, productParam(req.params.product), actor(req));
  return subscriptionOverview(tenant);
}));

router.put('/billing-email', act(async (req) => {
  const email = typeof req.body?.billingEmail === 'string' ? req.body.billingEmail.trim().toLowerCase() : '';
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new FiscalError(400, 'BILLING_INVALID', 'Invalid email', { billingEmail: 'Correo inválido' });
  await Tenant.updateOne({ _id: req.tenantId }, { $set: { 'billing.billingEmail': email } });
  return subscriptionOverview(await tenantOf(req));
}));

// ─── Charges and payments ────────────────────────────────────────────────────

const chargeView = (c: any, now = new Date()) => ({
  id: String(c._id), number: c.number, period: c.period, lines: c.lines, subtotal: c.subtotal, itbis: c.itbis, total: c.total,
  paidAmount: c.paidAmount, balance: c.balance, status: c.status, dueDate: c.dueDate, overdue: isOverdue(c, now), createdAt: c.createdAt,
});

const CHARGE_PAGE_SIZE = 12;
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The tenant's charges, newest first, one page at a time (a charge is added every month, so the
 * list only grows). `status` is `all` | `pending` (open or partly paid) | `paid`; `search` matches
 * the charge number or the month (`COB-000012`, `2026-03`, `2026`). `summary` covers every charge,
 * not just the page: an unpaid charge on a later page must not go unnoticed.
 */
router.get('/charges', act(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const base = { tenantId: req.tenantId, status: { $ne: 'void' } };
  const filter: Record<string, unknown> = { ...base };
  if (q.status === 'pending') filter.status = { $in: ['open', 'partial'] };
  else if (q.status === 'paid') filter.status = 'paid';
  const search = typeof q.search === 'string' ? q.search.trim().slice(0, 40) : '';
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ number: rx }, { period: rx }];
  }
  const limit = Math.min(50, Math.max(1, Math.floor(Number(q.limit)) || CHARGE_PAGE_SIZE));
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);
  const now = new Date();
  const [items, total, unpaid] = await Promise.all([
    BillingCharge.find(filter).sort({ period: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    BillingCharge.countDocuments(filter),
    BillingCharge.find({ ...base, status: { $in: ['open', 'partial'] } }).select('status dueDate balance'),
  ]);
  const overdue = unpaid.filter((c) => isOverdue(c, now));
  res.json({
    success: true,
    data: items.map((c) => chargeView(c, now)),
    meta: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
    summary: {
      outstanding: round2(unpaid.reduce((sum, c) => sum + c.balance, 0)),
      overdueCount: overdue.length,
      overdueBalance: round2(overdue.reduce((sum, c) => sum + c.balance, 0)),
    },
  });
}));

router.get('/charges/:id', act(async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Charge not found');
  const charge = await BillingCharge.findOne({ _id: req.params.id, tenantId: req.tenantId, status: { $ne: 'void' } });
  if (!charge) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Charge not found');
  const payments = await BillingPayment.find({ chargeId: charge._id, tenantId: req.tenantId, status: 'recorded' }).sort({ paidAt: 1 });
  const ecfIds = payments.map((p) => p.electronicInvoiceId).filter(Boolean);
  const ecfs = ecfIds.length ? await ElectronicInvoice.find({ _id: { $in: ecfIds }, tenantId: PLATFORM_ISSUER_ID }) : [];
  const byId = new Map(ecfs.map((r) => [String(r._id), r]));
  return {
    ...chargeView(charge),
    payments: payments.map((p) => {
      const ecf = p.electronicInvoiceId ? byId.get(String(p.electronicInvoiceId)) : undefined;
      return {
        id: String(p._id), amount: p.amount, paidAt: p.paidAt, method: p.method, source: p.source,
        ecf: ecf ? { eNCF: ecf.eNCF ?? null, estado: ecf.estadoECF, hasDocument: Boolean(ecf.billingsoftDocumentId) } : null,
      };
    }),
  };
}));

router.get('/payments/:id/ecf/pdf', act(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Payment not found');
  const payment = await BillingPayment.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!payment?.electronicInvoiceId) throw new FiscalError(404, 'FISCAL_NO_DOCUMENT', 'This payment has no e-CF yet');
  const record = await ElectronicInvoice.findOne({ _id: payment.electronicInvoiceId, tenantId: PLATFORM_ISSUER_ID });
  if (!record?.billingsoftDocumentId) throw new FiscalError(409, 'FISCAL_NO_DOCUMENT', 'The e-CF is not ready yet');
  const pdf = await getBillingSoftClient().getDocumentPdf(OWN_ORGANIZATION, record.billingsoftDocumentId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${record.eNCF ?? record._id}.pdf"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.send(pdf);
}));

router.post('/online-payments/:sessionId/confirm', act(async (req) => {
  const { outcome } = await confirmOnlinePayment(String(req.params.sessionId), { tenantId: String(req.tenantId) });
  return { outcome };
}));

router.post('/charges/:id/pay', act(async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Charge not found');
  return startOnlinePayment(String(req.tenantId), req.params.id, { email: req.user?.email, returnBase: req.body?.returnUrl });
}));

export default router;
