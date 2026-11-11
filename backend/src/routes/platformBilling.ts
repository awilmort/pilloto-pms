/**
 * Platform billing — /api/platform/billing/*
 *
 * How Pilloto charges its tenants: the price list, each tenant's contract, the monthly charges,
 * the payments recorded against them and the e-CF each payment issues, and Pilloto's own link to
 * BillingSoft. Mounted under `routes/platform.ts`, so it is superadmin-only on the platform host.
 *
 *   GET    /overview
 *   GET    /settings            PUT /settings
 *   GET    /plans               PUT /plans/:product/:plan        ({ price })
 *   GET    /tenants             GET /tenants/:id        PATCH /tenants/:id
 *   POST   /tenants/:id/price-changes       DELETE /tenants/:id/price-changes/:changeId
 *   POST   /tenants/:id/discounts           DELETE /tenants/:id/discounts/:discountId
 *   GET    /charges             GET /charges/:id
 *   POST   /charges/generate    POST /charges/run
 *   POST   /charges/:id/void    POST /charges/:id/notify    POST /charges/:id/payments
 *   GET    /payments
 *   POST   /payments/:id/ecf    POST /payments/:id/refresh  POST /payments/:id/reverse
 *   GET    /payments/:id/ecf/pdf | xml     POST /payments/:id/ecf/email
 *   GET    /issuer              GET /issuer/readiness       POST /issuer/link | sync
 *   GET    /issuer/sequences    POST /issuer/sequences
 */
import express, { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth';
import BillingCharge, { BILLING_CHARGE_STATUSES, IBillingCharge } from '../models/BillingCharge';
import BillingPayment, { IBillingPayment } from '../models/BillingPayment';
import ElectronicInvoice, { IElectronicInvoice } from '../models/ElectronicInvoice';
import PlatformSettings, { BILLING_TAXES, PLATFORM_KEY } from '../models/PlatformSettings';
import Tenant, { BILLING_PRODUCTS, ITenant } from '../models/Tenant';
import { getFiscalConfig, isFiscalConfigured } from '../config/fiscal';
import { BillingSoftError } from '../services/fiscal/billingsoftClient';
import { BsEcfType, BsRecordSequence } from '../services/fiscal/billingsoftTypes';
import { getBillingSoftClient } from '../services/fiscal/fiscalClient';
import { dominicanDate, dominicanPeriod, FiscalError, fiscalState } from '../services/fiscal/fiscalCore';
import { toFiscalError } from '../services/fiscal/fiscalIssuer';
import { ensureWebhook } from '../services/fiscal/fiscalLifecycle';
import { refreshRecord } from '../services/fiscal/fiscalSync';
import { getPlatformIssuer, getPlatformSettings, PLATFORM_ISSUER_ID, syncPlatformFiscal } from '../services/fiscal/platformIssuer';
import { OWN_ORGANIZATION } from '../services/fiscal/billingsoftClient';
import { emailFiscalDocument } from '../services/fiscal/fiscalEmail';
import { runMonthlyBilling, generateCharge, isOverdue, notifyCharge, voidCharge } from '../services/platformBilling/billingCharges';
import { cancelPriceChange, discountCovers, endDiscount, grantDiscount, schedulePriceChange } from '../services/platformBilling/billingContracts';
import { isPeriod, round2 } from '../services/platformBilling/billingMath';
import { getCatalog, listPrice, setPlanPrice } from '../services/platformBilling/billingPlans';
import { ecfOf, recordPayment, retryEcf, reversePayment, sendReceipt } from '../services/platformBilling/billingPayments';

const router = express.Router();

// ─── Plumbing ────────────────────────────────────────────────────────────────

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

/** Runs `fn` and answers `{ success, data }`; a FiscalError (or BillingSoft refusal) becomes its status. */
const act = (fn: Handler, status = 200) => async (req: AuthRequest, res: Response) => {
  try {
    const data = await fn(req, res);
    if (res.headersSent) return;
    return res.status(status).json({ success: true, data });
  } catch (err) {
    const known = err instanceof BillingSoftError ? toFiscalError(err) : err;
    if (known instanceof FiscalError) {
      return res.status(known.statusCode).json({ success: false, code: known.code, message: known.message, ...(known.fields ? { fields: known.fields } : {}) });
    }
    console.error('Platform billing error:', (err as Error)?.message ?? err);
    return res.status(500).json({ success: false, message: 'The billing action failed.' });
  }
};

const actor = (req: AuthRequest) => ({ userId: req.user?._id, email: req.user?.email });

const objectId = (value: string, what = 'record') => {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new FiscalError(404, 'BILLING_NOT_FOUND', `${what} not found`);
  return value;
};

const pageOf = (req: AuthRequest) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  return { limit, page, skip: (page - 1) * limit };
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// ─── Serialisers ─────────────────────────────────────────────────────────────

const tenantBrief = (t: Pick<ITenant, 'name' | 'slug'> & { _id: unknown } | null | undefined) =>
  t ? { id: String(t._id), name: t.name, slug: t.slug } : null;

const ecfBrief = (r: IElectronicInvoice | null | undefined) =>
  r
    ? { id: String(r._id), eNCF: r.eNCF ?? null, tipo: r.tipo, estado: r.estadoECF, mensaje: r.mensaje ?? null, environment: r.environment ?? null, hasDocument: Boolean(r.billingsoftDocumentId), total: r.totalFactura, issuedAt: r.issuedAt ?? r.createdAt }
    : null;

const publicCharge = (c: IBillingCharge, tenant?: ReturnType<typeof tenantBrief>, now = new Date()) => {
  const o = c.toObject();
  return { ...o, id: String(c._id), overdue: isOverdue(c, now), tenant: tenant ?? null };
};

const publicPayment = (p: IBillingPayment, ecf: IElectronicInvoice | null, extra: { tenant?: ReturnType<typeof tenantBrief>; chargeNumber?: string } = {}) => {
  const o = p.toObject();
  return { ...o, id: String(p._id), ecf: ecfBrief(ecf), ecfError: p.ecfError ?? null, tenant: extra.tenant ?? null, chargeNumber: extra.chargeNumber ?? null };
};

async function paymentsWithEcf(payments: IBillingPayment[]) {
  const ids = payments.map((p) => p.electronicInvoiceId).filter(Boolean);
  const records = ids.length ? await ElectronicInvoice.find({ _id: { $in: ids }, tenantId: PLATFORM_ISSUER_ID }) : [];
  const byId = new Map(records.map((r) => [String(r._id), r]));
  const tenants = await Tenant.find({ _id: { $in: payments.map((p) => p.tenantId) } }).select('name slug').lean();
  const tById = new Map(tenants.map((t: any) => [String(t._id), t]));
  const charges = await BillingCharge.find({ _id: { $in: payments.map((p) => p.chargeId) } }).select('number').lean();
  const cById = new Map(charges.map((c: any) => [String(c._id), c.number]));
  return payments.map((p) =>
    publicPayment(p, p.electronicInvoiceId ? byId.get(String(p.electronicInvoiceId)) ?? null : null, {
      tenant: tenantBrief(tById.get(String(p.tenantId)) as any),
      chargeNumber: cById.get(String(p.chargeId)),
    }),
  );
}

async function loadTenantDoc(id: string): Promise<ITenant> {
  const tenant = mongoose.Types.ObjectId.isValid(id) ? await Tenant.findById(id) : null;
  if (!tenant) throw new FiscalError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
  return tenant;
}

async function loadPayment(id: string): Promise<IBillingPayment> {
  const payment = mongoose.Types.ObjectId.isValid(id) ? await BillingPayment.findById(id) : null;
  if (!payment) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Payment not found');
  return payment;
}

// ─── Overview ────────────────────────────────────────────────────────────────

router.get('/overview', act(async () => {
  const today = dominicanDate(new Date());
  const period = dominicanPeriod(new Date());
  const monthStart = new Date(`${period}-01T04:00:00Z`); // midnight Dominican time

  const [open, overdue, collected, unissued, issuer] = await Promise.all([
    BillingCharge.aggregate([{ $match: { status: { $in: ['open', 'partial'] } } }, { $group: { _id: null, count: { $sum: 1 }, balance: { $sum: '$balance' } } }]),
    BillingCharge.aggregate([{ $match: { status: { $in: ['open', 'partial'] }, dueDate: { $lt: today } } }, { $group: { _id: null, count: { $sum: 1 }, balance: { $sum: '$balance' } } }]),
    BillingPayment.aggregate([{ $match: { status: 'recorded', paidAt: { $gte: monthStart } } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    BillingPayment.countDocuments({ status: 'recorded', electronicInvoiceId: { $exists: false } }),
    getPlatformIssuer(),
  ]);
  // Payments whose e-CF exists but DGII rejected it or BillingSoft never confirmed it.
  const problemIds = await ElectronicInvoice.find({ tenantId: PLATFORM_ISSUER_ID, generationSource: 'platform_payment', estadoECF: { $in: ['Rechazado', 'Error', 'Pendiente'] } }).select('_id').lean();
  return {
    period,
    outstanding: { count: open[0]?.count ?? 0, balance: round2(open[0]?.balance ?? 0) },
    overdue: { count: overdue[0]?.count ?? 0, balance: round2(overdue[0]?.balance ?? 0) },
    collectedThisMonth: { count: collected[0]?.count ?? 0, amount: round2(collected[0]?.amount ?? 0) },
    ecf: { notIssued: unissued, needAttention: problemIds.length },
    issuer: { state: fiscalState(issuer), configured: isFiscalConfigured() },
  };
}));

// ─── Settings and price list ─────────────────────────────────────────────────

const publicSettings = async () => {
  const s = await getPlatformSettings();
  return { tax: s.billing?.tax ?? 'itbis18', dueDays: s.billing?.dueDays ?? 10, notifyEmail: s.billing?.notifyEmail ?? '', paymentInstructions: s.billing?.paymentInstructions ?? '' };
};

router.get('/settings', act(publicSettings));

router.put('/settings', act(async (req) => {
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  const set: Record<string, unknown> = {};
  if (b.tax !== undefined) {
    if (!BILLING_TAXES.includes(b.tax)) errors.tax = 'Impuesto inválido';
    else set['billing.tax'] = b.tax;
  }
  if (b.dueDays !== undefined) {
    const days = Number(b.dueDays);
    if (!Number.isInteger(days) || days < 0 || days > 90) errors.dueDays = 'Entre 0 y 90 días';
    else set['billing.dueDays'] = days;
  }
  if (b.notifyEmail !== undefined) {
    const email = text(b.notifyEmail).toLowerCase();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.notifyEmail = 'Correo inválido';
    else set['billing.notifyEmail'] = email;
  }
  if (b.paymentInstructions !== undefined) {
    const t = text(b.paymentInstructions);
    if (t.length > 2000) errors.paymentInstructions = 'Máximo 2000 caracteres';
    else set['billing.paymentInstructions'] = t;
  }
  if (Object.keys(errors).length) throw new FiscalError(400, 'BILLING_INVALID', 'Review the highlighted fields', errors);
  if (Object.keys(set).length) {
    await getPlatformSettings();
    await PlatformSettings.updateOne({ key: PLATFORM_KEY }, { $set: set });
  }
  return publicSettings();
}));

router.get('/plans', act(async () => getCatalog()));

router.put('/plans/:product/:plan', act(async (req) => {
  if (!BILLING_PRODUCTS.includes(req.params.product as any)) throw new FiscalError(404, 'BILLING_PLAN_UNKNOWN', 'Unknown product');
  return setPlanPrice(req.params.product as any, req.params.plan, req.body?.price, actor(req));
}));

// ─── Tenants ─────────────────────────────────────────────────────────────────

async function tenantBilling(tenant: ITenant) {
  const period = dominicanPeriod(new Date());
  const [catalog, balance, lastPayment] = await Promise.all([
    getCatalog(),
    BillingCharge.aggregate([{ $match: { tenantId: tenant._id, status: { $in: ['open', 'partial'] } } }, { $group: { _id: null, balance: { $sum: '$balance' }, count: { $sum: 1 } } }]),
    BillingPayment.findOne({ tenantId: tenant._id, status: 'recorded' }).sort({ paidAt: -1 }).select('paidAt amount'),
  ]);
  const products = BILLING_PRODUCTS.filter((p) => tenant.products?.includes(p)).map((product) => {
    const plan = product === 'pms' ? tenant.plan : tenant.plans?.accounting;
    const contract = tenant.billing?.contracts?.[product];
    const list = catalog.find((c) => c.product === product && c.plan === plan)?.monthlyPrice ?? null;
    return {
      product,
      plan: plan ?? null,
      listPrice: list,
      // Until the first charge fixes a contract, the tenant is on the list price.
      contractPrice: contract && contract.plan === plan ? contract.price : list,
      contractSource: contract && contract.plan === plan ? contract.source : 'catalog',
      contractSince: contract && contract.plan === plan ? contract.since : null,
    };
  });
  return {
    id: String(tenant._id),
    name: tenant.name,
    slug: tenant.slug,
    isActive: tenant.isActive,
    ownerEmail: tenant.ownerEmail,
    billingEmail: tenant.billing?.billingEmail ?? '',
    paused: Boolean(tenant.billing?.paused),
    legalName: tenant.profile?.legalName ?? '',
    rnc: tenant.profile?.rnc ?? '',
    createdAt: tenant.createdAt,
    products,
    priceChanges: (tenant.billing?.priceChanges ?? []).map((c) => ({ id: String(c._id), product: c.product, price: c.price, effectiveFrom: c.effectiveFrom, reason: c.reason, createdByEmail: c.createdByEmail, createdAt: c.createdAt, notifiedAt: c.notifiedAt, appliedAt: c.appliedAt })),
    discounts: (tenant.billing?.discounts ?? [])
      .map((d) => ({
        id: String(d._id), product: d.product, type: d.type, value: d.value, effectiveFrom: d.effectiveFrom, effectiveUntil: d.effectiveUntil ?? null, reason: d.reason, createdByEmail: d.createdByEmail, createdAt: d.createdAt,
        status: discountCovers(d, period) ? 'active' : d.effectiveFrom > period ? 'scheduled' : 'ended',
      }))
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)),
    outstanding: round2(balance[0]?.balance ?? 0),
    openCharges: balance[0]?.count ?? 0,
    lastPayment: lastPayment ? { paidAt: lastPayment.paidAt, amount: lastPayment.amount } : null,
  };
}

router.get('/tenants', act(async () => {
  const tenants = await Tenant.find({}).sort({ name: 1 });
  return Promise.all(tenants.map(tenantBilling));
}));

router.get('/tenants/:id', act(async (req) => {
  const tenant = await loadTenantDoc(req.params.id);
  const [billing, charges, payments] = await Promise.all([
    tenantBilling(tenant),
    BillingCharge.find({ tenantId: tenant._id }).sort({ period: -1, createdAt: -1 }).limit(24),
    BillingPayment.find({ tenantId: tenant._id }).sort({ paidAt: -1 }).limit(50),
  ]);
  const brief = tenantBrief(tenant);
  return { ...billing, charges: charges.map((c) => publicCharge(c, brief)), payments: await paymentsWithEcf(payments) };
}));

router.patch('/tenants/:id', act(async (req) => {
  const tenant = await loadTenantDoc(req.params.id);
  const b = req.body ?? {};
  const set: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  if (b.billingEmail !== undefined) {
    const email = text(b.billingEmail).toLowerCase();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.billingEmail = 'Correo inválido';
    else set['billing.billingEmail'] = email;
  }
  if (b.paused !== undefined) set['billing.paused'] = Boolean(b.paused);
  if (Object.keys(errors).length) throw new FiscalError(400, 'BILLING_INVALID', 'Review the highlighted fields', errors);
  if (Object.keys(set).length) await Tenant.updateOne({ _id: tenant._id }, { $set: set });
  return tenantBilling(await loadTenantDoc(req.params.id));
}));

router.post('/tenants/:id/price-changes', act(async (req) => {
  const tenant = await loadTenantDoc(req.params.id);
  const b = req.body ?? {};
  const updated = await schedulePriceChange(tenant, { product: b.product, price: b.price, effectiveFrom: text(b.effectiveFrom), reason: text(b.reason) }, actor(req));
  return tenantBilling(updated);
}, 201));

router.delete('/tenants/:id/price-changes/:changeId', act(async (req) => {
  const tenant = await loadTenantDoc(req.params.id);
  return tenantBilling(await cancelPriceChange(tenant, req.params.changeId));
}));

router.post('/tenants/:id/discounts', act(async (req) => {
  const tenant = await loadTenantDoc(req.params.id);
  const b = req.body ?? {};
  const updated = await grantDiscount(
    tenant,
    { product: b.product, type: b.type, value: b.value, effectiveFrom: text(b.effectiveFrom), effectiveUntil: text(b.effectiveUntil), reason: text(b.reason) },
    actor(req),
  );
  return tenantBilling(updated);
}, 201));

router.delete('/tenants/:id/discounts/:discountId', act(async (req) => {
  const tenant = await loadTenantDoc(req.params.id);
  return tenantBilling(await endDiscount(tenant, req.params.discountId));
}));

// ─── Charges ─────────────────────────────────────────────────────────────────

router.get('/charges', act(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (q.status && (BILLING_CHARGE_STATUSES as readonly string[]).includes(q.status)) filter.status = q.status;
  if (q.tenantId && mongoose.Types.ObjectId.isValid(q.tenantId)) filter.tenantId = q.tenantId;
  if (q.period && isPeriod(q.period)) filter.period = q.period;
  if (q.overdue === 'true') {
    filter.status = { $in: ['open', 'partial'] };
    filter.dueDate = { $lt: dominicanDate(new Date()) };
  }
  const { limit, page, skip } = pageOf(req);
  const [items, total] = await Promise.all([BillingCharge.find(filter).sort({ period: -1, createdAt: -1 }).skip(skip).limit(limit), BillingCharge.countDocuments(filter)]);
  const tenants = await Tenant.find({ _id: { $in: items.map((c) => c.tenantId) } }).select('name slug').lean();
  const byId = new Map(tenants.map((t: any) => [String(t._id), tenantBrief(t)]));
  const now = new Date();
  res.json({ success: true, data: items.map((c) => publicCharge(c, byId.get(String(c.tenantId)), now)), meta: { total, page, limit, pages: Math.ceil(total / limit) } });
}));

router.get('/charges/:id', act(async (req) => {
  const charge = await BillingCharge.findById(objectId(req.params.id, 'Charge'));
  if (!charge) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Charge not found');
  const [tenant, payments] = await Promise.all([Tenant.findById(charge.tenantId).select('name slug'), BillingPayment.find({ chargeId: charge._id }).sort({ createdAt: 1 })]);
  return { ...publicCharge(charge, tenantBrief(tenant as any)), payments: await paymentsWithEcf(payments) };
}));

/** One tenant, one month — for catching up a month the automatic run did not cover. */
router.post('/charges/generate', act(async (req) => {
  const b = req.body ?? {};
  const tenant = await loadTenantDoc(String(b.tenantId ?? ''));
  const result = await generateCharge(tenant, text(b.period), { notify: b.notify !== false, actorEmail: req.user?.email });
  if (!result.charge) {
    const why = result.reason === 'before_start' ? 'The tenant did not exist yet in that month' : 'There is nothing to charge for that month';
    throw new FiscalError(409, 'BILLING_NOTHING_TO_CHARGE', why);
  }
  return { created: result.created, charge: publicCharge(result.charge, tenantBrief(tenant)) };
}, 201));

/** The same run the scheduler makes on the 1st, on demand. */
router.post('/charges/run', act(async () => runMonthlyBilling()));

router.post('/charges/:id/void', act(async (req) => voidCharge(objectId(req.params.id, 'Charge'), text(req.body?.reason), actor(req)).then((c) => publicCharge(c))));

router.post('/charges/:id/notify', act(async (req) => {
  const charge = await BillingCharge.findById(objectId(req.params.id, 'Charge'));
  if (!charge) throw new FiscalError(404, 'BILLING_NOT_FOUND', 'Charge not found');
  if (charge.status === 'void') throw new FiscalError(409, 'BILLING_STATE', 'This charge is void');
  const tenant = await loadTenantDoc(String(charge.tenantId));
  const sent = await notifyCharge(charge, tenant, (await getPlatformSettings()).billing?.paymentInstructions);
  if (!sent) throw new FiscalError(502, 'EMAIL_FAILED', 'The email could not be sent');
  return { sent: true };
}));

router.post('/charges/:id/payments', act(async (req) => {
  const { payment, charge } = await recordPayment(objectId(req.params.id, 'Charge'), req.body ?? {}, actor(req));
  const [shaped] = await paymentsWithEcf([payment]);
  return { payment: shaped, charge: publicCharge(charge) };
}, 201));

// ─── Payments and their e-CF ─────────────────────────────────────────────────

router.get('/payments', act(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (q.status === 'recorded' || q.status === 'reversed') filter.status = q.status;
  if (q.tenantId && mongoose.Types.ObjectId.isValid(q.tenantId)) filter.tenantId = q.tenantId;
  if (q.ecf === 'missing') {
    filter.status = 'recorded';
    filter.electronicInvoiceId = { $exists: false };
  }
  const { limit, page, skip } = pageOf(req);
  const [items, total] = await Promise.all([BillingPayment.find(filter).sort({ paidAt: -1, createdAt: -1 }).skip(skip).limit(limit), BillingPayment.countDocuments(filter)]);
  res.json({ success: true, data: await paymentsWithEcf(items), meta: { total, page, limit, pages: Math.ceil(total / limit) } });
}));

router.post('/payments/:id/ecf', act(async (req) => {
  const payment = await retryEcf(objectId(req.params.id, 'Payment'), actor(req));
  const [shaped] = await paymentsWithEcf([payment]);
  return shaped;
}));

router.post('/payments/:id/refresh', act(async (req) => {
  const payment = await loadPayment(req.params.id);
  const record = await ecfOf(payment);
  if (!record) throw new FiscalError(409, 'FISCAL_NO_DOCUMENT', 'This payment has no e-CF yet');
  await refreshRecord(record, await getPlatformIssuer(), { force: req.body?.force !== false });
  const [shaped] = await paymentsWithEcf([payment]);
  return shaped;
}));

router.post('/payments/:id/reverse', act(async (req) => {
  const { payment, charge } = await reversePayment(objectId(req.params.id, 'Payment'), text(req.body?.reason), actor(req));
  const [shaped] = await paymentsWithEcf([payment]);
  return { payment: shaped, charge: publicCharge(charge) };
}));

async function documentOf(req: AuthRequest) {
  const payment = await loadPayment(req.params.id);
  const record = await ecfOf(payment);
  if (!record?.billingsoftDocumentId) throw new FiscalError(409, 'FISCAL_NO_DOCUMENT', 'This payment has no e-CF confirmed by BillingSoft yet');
  return { payment, record };
}

router.get('/payments/:id/ecf/pdf', act(async (req, res) => {
  const { record } = await documentOf(req);
  const pdf = await getBillingSoftClient().getDocumentPdf(OWN_ORGANIZATION, record.billingsoftDocumentId!);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${record.eNCF ?? record._id}.pdf"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.send(pdf);
}));

router.get('/payments/:id/ecf/xml', act(async (req, res) => {
  const { record } = await documentOf(req);
  const xml = await getBillingSoftClient().getDocumentXml(OWN_ORGANIZATION, record.billingsoftDocumentId!);
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${record.eNCF ?? record._id}.xml"`);
  res.send(xml);
}));

router.post('/payments/:id/ecf/email', act(async (req) => {
  const { payment, record } = await documentOf(req);
  const override = text(req.body?.email);
  if (override) {
    const to = await emailFiscalDocument(await getPlatformIssuer(), record, override);
    return { sentTo: to };
  }
  const sent = await sendReceipt(payment, new Date(), (await loadTenantDoc(String(payment.tenantId))).billing?.billingEmail || undefined).catch((e) => { throw e; });
  return { sentTo: sent ? 'tenant' : null };
}));

// ─── Pilloto's own e-CF ──────────────────────────────────────────────────────

async function issuerView() {
  const issuer = await getPlatformIssuer();
  const f = issuer.fiscal;
  const settings = await getPlatformSettings();
  const cfg = getFiscalConfig();
  return {
    configured: isFiscalConfigured(cfg),
    allowUncertified: cfg.allowUncertified,
    state: fiscalState(issuer),
    linked: Boolean(f?.organizationId),
    environment: f?.environment ?? null,
    certification: f?.certification ?? null,
    rnc: f?.rnc ?? null,
    webhookRegistered: Boolean(f?.webhookSecret),
    lastSyncedAt: f?.lastSyncedAt ?? null,
    appUrl: cfg.appUrl,
    notifyEmail: settings.billing?.notifyEmail ?? '',
  };
}

router.get('/issuer', act(issuerView));

/** Live: DGII onboarding steps, certificate state and the e-NCF ranges Pilloto can number with. */
router.get('/issuer/readiness', act(async () => {
  const issuer = await getPlatformIssuer();
  if (!issuer.fiscal?.organizationId) throw new FiscalError(409, 'FISCAL_NOT_ACTIVATED', "Pilloto's e-invoicing is not linked yet");
  const client = getBillingSoftClient();
  const [onboarding, config, sequences] = await Promise.all([
    client.onboarding(OWN_ORGANIZATION),
    client.configTest(OWN_ORGANIZATION).catch(() => null),
    client.listSequences(OWN_ORGANIZATION).catch(() => []),
  ]);
  return { environment: onboarding.environment, certification: onboarding.certification, steps: onboarding.onboarding.steps, complete: onboarding.onboarding.complete, certificate: config?.certificate ?? 'none', usableTypes: config?.usableTypes ?? [], organization: config?.organization ?? null, sequences };
}));

/** Links Pilloto's own BillingSoft Organization (the partner key acting for itself) and registers its webhook. */
router.post('/issuer/link', act(async () => {
  if (!isFiscalConfigured()) throw new FiscalError(503, 'FISCAL_NOT_CONFIGURED', 'Electronic invoicing is not available on this server');
  try {
    await syncPlatformFiscal();
  } catch (err) {
    if (err instanceof BillingSoftError) throw toFiscalError(err);
    throw err;
  }
  const config = await getBillingSoftClient().configTest(OWN_ORGANIZATION).catch(() => null);
  if (config?.organization?.rnc) {
    await getPlatformSettings();
    await PlatformSettings.updateOne({ key: PLATFORM_KEY }, { $set: { 'billing.fiscal.rnc': config.organization.rnc } });
  }
  await ensureWebhook(await getPlatformIssuer());
  return issuerView();
}));

router.post('/issuer/sync', act(async () => {
  try {
    await syncPlatformFiscal();
  } catch (err) {
    if (err instanceof BillingSoftError) throw toFiscalError(err);
    throw err;
  }
  return issuerView();
}));

router.get('/issuer/sequences', act(async () => getBillingSoftClient().listSequences(OWN_ORGANIZATION)));

router.post('/issuer/sequences', act(async (req) => {
  const b = req.body ?? {};
  const body: BsRecordSequence = {
    documentType: String(b.documentType) as BsEcfType,
    rangeStart: Number(b.rangeStart),
    rangeEnd: Number(b.rangeEnd),
    ...(b.expiresOn ? { expiresOn: String(b.expiresOn) } : {}),
  };
  return getBillingSoftClient().recordSequence(OWN_ORGANIZATION, body);
}, 201));

export default router;
