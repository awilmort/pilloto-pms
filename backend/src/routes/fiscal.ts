/**
 * /api/fiscal — electronic invoicing (e-CF) for the company, shared by PMS and Accounting.
 *
 * The capability belongs to the company, so one router serves both apps: a user passes when their
 * role in *either* app grants the permission, and the tenant must own that app (userHasPermission
 * checks both). Configuration is therefore done once, in whichever app the company prefers.
 *
 * Documents are issued through the shared pipeline (services/fiscal/fiscalIssuer.ts); this file
 * only validates input, builds the request with the right mapper and shapes the answer.
 */
import { NextFunction, Response, Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { AuthRequest, authenticate, userHasPermission } from '../middleware/auth';
import { AppCode } from '../constants/apps';
import { fiscalPlanRank, getFiscalConfig, includedFiscalPlan, isFiscalConfigured, isFiscalPlan } from '../config/fiscal';
import Charge from '../models/Charge';
import ElectronicInvoice, { ECF_VALID_ESTADOS, IElectronicInvoice } from '../models/ElectronicInvoice';
import FiscalStatement from '../models/FiscalStatement';
import Folio from '../models/Folio';
import Payment from '../models/Payment';
import Reservation from '../models/Reservation';
import Tenant, { ITenant } from '../models/Tenant';
import { postFolioCreditNoteEntry, postFolioDebitNoteEntry } from '../services/accounting/pmsLedgerHooks';
import { BillingSoftError } from '../services/fiscal/billingsoftClient';
import { BsDocumentRequest, BsEcfType, BsRecordSequence } from '../services/fiscal/billingsoftTypes';
import { getBillingSoftClient } from '../services/fiscal/fiscalClient';
import { assertCanIssue, FiscalError, fiscalState } from '../services/fiscal/fiscalCore';
import { issueFiscalDocument, sendIntent, toFiscalError } from '../services/fiscal/fiscalIssuer';
import { activateFiscal, changeFiscalPlan, ensureWebhook, syncFiscal } from '../services/fiscal/fiscalLifecycle';
import { getPlanCatalog, planCharge, selectablePlans, statementFigures } from '../services/fiscal/fiscalPlans';
import { refreshRecord } from '../services/fiscal/fiscalSync';
import { emailFiscalDocument } from '../services/fiscal/fiscalEmail';
import {
  folioInvoiceRequest,
  grossNoteLines,
  modificationOfCode,
  noteRequest,
  BuyerInfo,
} from '../services/fiscal/mappers';

const router = Router();

router.use(
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 300,
    message: { success: false, message: 'Too many electronic invoicing requests, please slow down.' },
    keyGenerator: (req) => (req as AuthRequest).user?._id?.toString() ?? req.ip ?? 'unknown',
  }),
);

// ─── Access ──────────────────────────────────────────────────────────────────

type Level = 'view' | 'issue' | 'manage';

/**
 * What each level needs, per app. A role in either app that grants one of them is enough, and a
 * higher level includes the lower: whoever manages the company's e-CF can also issue and view.
 */
const VIEW: Record<AppCode, string[]> = {
  pms: ['admin.ecf.view'],
  accounting: ['accounting.invoices.view', 'accounting.invoices.manage', 'accounting.creditNotes.view', 'accounting.debitNotes.view'],
};
const ISSUE: Record<AppCode, string[]> = {
  pms: ['admin.reservations.managePayments', 'cashier'],
  accounting: ['accounting.invoices.manage', 'accounting.creditNotes.manage', 'accounting.debitNotes.manage'],
};
const MANAGE: Record<AppCode, string[]> = {
  pms: ['admin.settings'],
  accounting: ['accounting.settings.manage'],
};
const join = (...parts: Record<AppCode, string[]>[]): Record<AppCode, string[]> => ({
  pms: parts.flatMap((p) => p.pms),
  accounting: parts.flatMap((p) => p.accounting),
});
const PERMISSIONS: Record<Level, Record<AppCode, string[]>> = {
  manage: MANAGE,
  issue: join(ISSUE, MANAGE),
  view: join(VIEW, ISSUE, MANAGE),
};

const require_ = (level: Level) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Access denied. Authentication required.' });
    const products = (req.tenant?.products ?? []) as AppCode[];
    for (const app of products) {
      if (await userHasPermission(req.user, app, PERMISSIONS[level][app], req.tenantId, products)) return next();
    }
    return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
  } catch (err) {
    console.error('[Fiscal] authorization error:', err);
    return res.status(500).json({ success: false, message: 'Authorization failure.' });
  }
};

const can = (level: Level) => [authenticate, require_(level)];

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

/** Turns FiscalError and BillingSoftError into the API's error shape; anything else is a 500. */
const handle = (name: string, fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    const fiscal = err instanceof BillingSoftError ? toFiscalError(err) : err;
    if (fiscal instanceof FiscalError) {
      return res.status(fiscal.statusCode).json({
        success: false,
        code: fiscal.code,
        message: fiscal.message,
        ...(fiscal.fields ? { fields: fiscal.fields } : {}),
      });
    }
    console.error(`[Fiscal] ${name} error:`, (err as Error)?.message ?? err);
    return res.status(500).json({ success: false, code: 'FISCAL_INTERNAL', message: 'Something went wrong with electronic invoicing' });
  }
};

const loadTenant = async (req: AuthRequest): Promise<ITenant> => {
  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant) throw new FiscalError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
  return tenant;
};

const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A document as the UI sees it: never the stored request or the idempotency key. */
const PUBLIC_FIELDS = '-request -idempotencyKey';

async function loadRecord(req: AuthRequest, id: string): Promise<IElectronicInvoice> {
  if (!validId(id)) throw new FiscalError(400, 'INVALID_ID', 'Invalid document ID');
  const record = await ElectronicInvoice.findOne({ _id: id, tenantId: req.tenantId });
  if (!record) throw new FiscalError(404, 'NOT_FOUND', 'Document not found');
  return record;
}

const orgOf = (tenant: ITenant): string => {
  const id = tenant.fiscal?.organizationId;
  if (!id) throw new FiscalError(409, 'FISCAL_NOT_ACTIVATED', 'Electronic invoicing is not activated');
  return id;
};

const publicRecord = (record: IElectronicInvoice) => {
  const o = record.toObject();
  delete o.request;
  delete o.idempotencyKey;
  return o;
};

// ─── Overview and lifecycle ──────────────────────────────────────────────────

function overview(tenant: ITenant) {
  const cfg = getFiscalConfig();
  const f = tenant.fiscal;
  const state = fiscalState(tenant);
  let canIssue = false;
  try {
    assertCanIssue(tenant, cfg);
    canIssue = true;
  } catch {
    canIssue = false;
  }
  return {
    configured: isFiscalConfigured(cfg),
    state,
    canIssue,
    allowUncertified: cfg.allowUncertified,
    includedPlan: includedFiscalPlan(tenant),
    organization: f?.organizationId
      ? {
          id: f.organizationId,
          rnc: f.rnc,
          adminEmail: f.adminEmail,
          environment: f.environment,
          certification: f.certification,
          isActive: f.isActive,
          plan: f.plan,
          pendingPlan: f.pendingPlan ?? null,
          provisionedAt: f.provisionedAt,
          lastSyncedAt: f.lastSyncedAt,
          webhookRegistered: Boolean(f.webhookSecret),
        }
      : null,
    defaults: {
      rnc: tenant.profile?.rnc ?? '',
      razonSocial: tenant.profile?.legalName ?? '',
      address: tenant.profile?.address ?? '',
      adminEmail: tenant.ownerEmail,
    },
    links: {
      dashboard: cfg.appUrl,
      onboarding: `${cfg.appUrl}/primeros-pasos`,
      certification: `${cfg.appUrl}/certificacion`,
      certificate: `${cfg.appUrl}/certificado`,
      sequences: `${cfg.appUrl}/secuencias`,
      received: `${cfg.appUrl}/recibidos`,
    },
  };
}

/** Certification can change without Pilloto being told (the company runs the wizard in BillingSoft). */
const STALE_WHILE_CERTIFYING_MS = 2 * 60 * 1000;
const STALE_WHEN_CERTIFIED_MS = 60 * 60 * 1000;

router.get('/status', ...can('view'), handle('status', async (req, res) => {
  let tenant = await loadTenant(req);
  const f = tenant.fiscal;
  if (f?.organizationId && isFiscalConfigured()) {
    const age = Date.now() - (f.lastSyncedAt?.getTime() ?? 0);
    const limit = f.certification === 'certified' ? STALE_WHEN_CERTIFIED_MS : STALE_WHILE_CERTIFYING_MS;
    if (age > limit) {
      try {
        tenant = await syncFiscal(tenant);
      } catch {
        /* BillingSoft unreachable: show what is known */
      }
    }
    if (!tenant.fiscal?.webhookSecret) await ensureWebhook(tenant);
  }
  return res.json({ success: true, data: overview((await Tenant.findById(tenant._id)) ?? tenant) });
}));

router.get('/plans', ...can('manage'), handle('plans', async (req, res) => {
  const tenant = await loadTenant(req);
  const catalog = await getPlanCatalog();
  const included = includedFiscalPlan(tenant);
  const selectable = selectablePlans(tenant, catalog);
  const current = tenant.fiscal?.plan;
  return res.json({
    success: true,
    data: {
      currency: catalog.currency,
      annualDiscountPercent: catalog.annualDiscountPercent,
      includedPlan: included,
      currentPlan: current ?? null,
      pendingPlan: tenant.fiscal?.pendingPlan ?? null,
      plans: catalog.plans.map((p) => {
        const charge = planCharge(catalog, p.id, included);
        return {
          id: p.id,
          users: p.users,
          transactions: p.transactions,
          monthlyPrice: p.price.monthly,
          /** What the company pays each month for choosing this plan. */
          monthlyCharge: charge.planCharge,
          overageUnitPrice: p.overageUnitPrice,
          selectable: selectable.includes(p.id),
          included: included === p.id,
          change: current && isFiscalPlan(current) ? Math.sign(fiscalPlanRank(p.id) - fiscalPlanRank(current)) : 0,
        };
      }),
    },
  });
}));

router.post('/activate', ...can('manage'), handle('activate', async (req, res) => {
  const tenant = await loadTenant(req);
  const b = req.body ?? {};
  const updated = await activateFiscal(
    tenant,
    {
      plan: b.plan,
      rnc: String(b.rnc ?? ''),
      razonSocial: String(b.razonSocial ?? ''),
      address: String(b.address ?? ''),
      admin: { name: String(b.admin?.name ?? ''), email: String(b.admin?.email ?? '') },
      confirmPreviousPostulationConcluded: b.confirmPreviousPostulationConcluded === true,
    },
    { userId: req.user?._id, email: req.user?.email },
  );
  return res.status(201).json({ success: true, data: overview(updated) });
}));

router.put('/plan', ...can('manage'), handle('plan', async (req, res) => {
  const tenant = await loadTenant(req);
  const { tenant: updated, outcome } = await changeFiscalPlan(tenant, req.body?.plan);
  return res.json({ success: true, outcome, data: overview(updated) });
}));

router.post('/sync', ...can('view'), handle('sync', async (req, res) => {
  const tenant = await syncFiscal(await loadTenant(req));
  return res.json({ success: true, data: overview(tenant) });
}));

/** Live readiness: the onboarding checklist and what the company can sign and number today. */
router.get('/readiness', ...can('view'), handle('readiness', async (req, res) => {
  const tenant = await loadTenant(req);
  const organizationId = orgOf(tenant);
  const client = getBillingSoftClient();
  const [onboarding, config] = await Promise.all([client.onboarding(organizationId), client.configTest(organizationId).catch(() => null)]);
  return res.json({
    success: true,
    data: {
      environment: onboarding.environment,
      certification: onboarding.certification,
      steps: onboarding.onboarding.steps,
      complete: onboarding.onboarding.complete,
      certificate: config?.certificate ?? 'none',
      usableTypes: config?.usableTypes ?? [],
      organization: config?.organization ?? null,
    },
  });
}));

/** This month's usage against the plan, and what it costs so far. */
router.get('/usage', ...can('manage'), handle('usage', async (req, res) => {
  const tenant = await loadTenant(req);
  const organizationId = orgOf(tenant);
  const [subscription, catalog] = await Promise.all([getBillingSoftClient().subscription(organizationId), getPlanCatalog()]);
  const plan = tenant.fiscal!.plan;
  const figures = statementFigures(planCharge(catalog, plan, includedFiscalPlan(tenant)), subscription.transactions.used);
  return res.json({
    success: true,
    data: {
      currency: 'DOP',
      period: subscription.period,
      plan,
      includedPlan: figures.includedPlan,
      transactions: { included: figures.transactions, used: figures.used, extra: figures.extra },
      overageUnitPrice: figures.overageUnitPrice,
      overageAmount: figures.overageAmount,
      planCharge: figures.planCharge,
      total: figures.total,
      users: subscription.users,
    },
  });
}));

router.get('/statements', ...can('manage'), handle('statements', async (req, res) => {
  const statements = await FiscalStatement.find({ tenantId: req.tenantId }).sort({ period: -1 }).limit(36).lean();
  return res.json({ success: true, data: statements });
}));

// ─── Documents ───────────────────────────────────────────────────────────────

router.get('/documents', ...can('view'), handle('documents', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = { tenantId: req.tenantId };
  if (validId(q.folioId)) filter.folioId = new mongoose.Types.ObjectId(q.folioId);
  if (validId(q.paymentId)) filter.paymentId = new mongoose.Types.ObjectId(q.paymentId);
  if (validId(q.invoiceId)) filter.invoiceId = new mongoose.Types.ObjectId(q.invoiceId);
  if (q.estadoECF) filter.estadoECF = { $in: q.estadoECF.split(',') };
  if (q.tipo) filter.tipo = { $in: q.tipo.split(',') };
  if (q.q) {
    const re = { $regex: escapeRegex(q.q.trim()), $options: 'i' };
    filter.$or = [{ eNCF: re }, { buyerName: re }, { buyerRnc: re }, { numeroFacturaInterna: re }];
  }
  if (q.fechaInicio || q.fechaFin) {
    const range: Record<string, Date> = {};
    if (q.fechaInicio) range.$gte = new Date(q.fechaInicio);
    if (q.fechaFin) range.$lte = new Date(q.fechaFin);
    filter.issuedAt = range;
  }
  const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
  const [data, total] = await Promise.all([
    ElectronicInvoice.find(filter).select(PUBLIC_FIELDS).sort({ issuedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ElectronicInvoice.countDocuments(filter),
  ]);
  return res.json({ success: true, data, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
}));

router.get('/documents/:id', ...can('view'), handle('document', async (req, res) => {
  const record = await loadRecord(req, req.params.id);
  return res.json({ success: true, data: publicRecord(record) });
}));

/** Asks BillingSoft for the document's current state (`force`: have it query DGII first). */
router.post('/documents/:id/refresh', ...can('view'), handle('refresh', async (req, res) => {
  const tenant = await loadTenant(req);
  const record = await loadRecord(req, req.params.id);
  const updated = await refreshRecord(record, tenant, { force: req.body?.force !== false });
  return res.json({ success: true, data: publicRecord(updated) });
}));

/** Sends a document BillingSoft never confirmed again (same idempotency key: it cannot issue twice). */
router.post('/documents/:id/retry', ...can('issue'), handle('retry', async (req, res) => {
  const tenant = await loadTenant(req);
  assertCanIssue(tenant);
  const record = await loadRecord(req, req.params.id);
  if (record.estadoECF !== 'Pendiente' && record.estadoECF !== 'Error') {
    throw new FiscalError(409, 'FISCAL_STATE', 'Only a document that was not confirmed can be sent again');
  }
  if (record.billingsoftDocumentId) {
    throw new FiscalError(409, 'FISCAL_STATE', 'This document is already in BillingSoft');
  }
  if (record.estadoECF === 'Error') {
    record.estadoECF = 'Pendiente';
    record.estatus = 'pending';
    await record.save();
  }
  const { record: updated, queued } = await sendIntent(record, tenant, true);
  return res.json({ success: true, queued, data: publicRecord(updated) });
}));

router.get('/documents/:id/pdf', ...can('view'), handle('pdf', async (req, res) => {
  const tenant = await loadTenant(req);
  const record = await loadRecord(req, req.params.id);
  if (!record.billingsoftDocumentId) throw new FiscalError(409, 'FISCAL_NO_DOCUMENT', 'This e-CF has not been confirmed by BillingSoft yet');
  const pdf = await getBillingSoftClient().getDocumentPdf(orgOf(tenant), record.billingsoftDocumentId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${record.eNCF ?? record._id}.pdf"`);
  res.setHeader('Content-Length', String(pdf.length));
  return res.send(pdf);
}));

router.get('/documents/:id/xml', ...can('view'), handle('xml', async (req, res) => {
  const tenant = await loadTenant(req);
  const record = await loadRecord(req, req.params.id);
  if (!record.billingsoftDocumentId) throw new FiscalError(409, 'FISCAL_NO_DOCUMENT', 'This e-CF has not been confirmed by BillingSoft yet');
  const xml = await getBillingSoftClient().getDocumentXml(orgOf(tenant), record.billingsoftDocumentId);
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${record.eNCF ?? record._id}.xml"`);
  return res.send(xml);
}));

router.post('/documents/:id/email', ...can('issue'), handle('email', async (req, res) => {
  const tenant = await loadTenant(req);
  const record = await loadRecord(req, req.params.id);
  const to = await emailFiscalDocument(tenant, record, req.body?.email);
  return res.json({ success: true, message: `Document emailed to ${to}` });
}));

// Folio → e-CF (PMS) ----------------------------------------------------------

router.post('/documents/from-folio', ...can('issue'), handle('from-folio', async (req, res) => {
  const b = req.body ?? {};
  if (!validId(b.folioId)) throw new FiscalError(400, 'INVALID_ID', 'folioId is required and must be a valid ID');
  const tenant = await loadTenant(req);
  assertCanIssue(tenant);

  const folio = await Folio.findById(b.folioId);
  if (!folio) throw new FiscalError(404, 'NOT_FOUND', 'Folio not found');
  const paymentId = validId(b.paymentId) ? b.paymentId : undefined;

  // One valid e-CF per payment: asking again returns it instead of issuing another.
  if (paymentId) {
    const existing = await ElectronicInvoice.findOne({
      tenantId: req.tenantId,
      paymentId,
      tipo: { $in: ['E31', 'E32'] },
      estadoECF: { $nin: ['Rechazado', 'Anulado', 'Error'] },
    }).select(PUBLIC_FIELDS);
    if (existing) return res.json({ success: true, data: existing, message: 'Invoice already exists for this payment' });
  }

  const [charges, payments, reservation] = await Promise.all([
    Charge.find({ folioId: folio._id }),
    Payment.find({ folioId: folio._id, status: { $ne: 'reversed' } }),
    Reservation.findById(folio.reservationId).select('reservationCode').lean(),
  ]);

  const buyer: BuyerInfo = {
    rnc: b.buyerRnc,
    name: b.buyerName,
    email: b.buyerEmail,
    razonSocial: b.buyerRazonSocial,
  };
  const request = folioInvoiceRequest({
    charges,
    payments,
    buyer,
    type: b.tipoECF === 'E31' ? '31' : b.tipoECF === 'E32' ? '32' : undefined,
  });

  // A new key per attempt at the same payment, so a document DGII rejected can be issued again.
  const attempts = paymentId ? await ElectronicInvoice.countDocuments({ tenantId: req.tenantId, paymentId, tipo: { $in: ['E31', 'E32'] } }) : 0;
  const { record, queued } = await issueFiscalDocument({
    tenant,
    route: 'invoices',
    request,
    actorId: req.user._id,
    source: paymentId ? 'payment_screen' : 'manual',
    links: { folioId: folio._id as any, paymentId, reservationId: folio.reservationId as any },
    numeroFacturaInterna: reservation?.reservationCode ?? `FOLIO-${String(folio._id).slice(-6).toUpperCase()}`,
    idempotencyKey: paymentId ? `pms-payment-${paymentId}-${attempts}` : undefined,
  });
  return res.status(201).json({ success: true, queued, data: publicRecord(record) });
}));

// Notes on an issued e-CF ----------------------------------------------------

async function issueNote(req: AuthRequest, res: Response, kind: 'credit' | 'debit') {
  const b = req.body ?? {};
  const tenant = await loadTenant(req);
  assertCanIssue(tenant);
  const original = await loadRecord(req, String(b.originalId ?? ''));
  if (!ECF_VALID_ESTADOS.includes(original.estadoECF) || !['E31', 'E32'].includes(original.tipo)) {
    throw new FiscalError(409, 'FISCAL_STATE', `A ${kind} note needs an accepted invoice (31 or 32); this one is "${original.estadoECF}"`);
  }

  const code = String(b.codigoModificacion ?? (kind === 'debit' ? '3' : ''));
  modificationOfCode(code);
  const reason = String(b.razonModificacion ?? '').trim();

  let items: { description: string; amount: number }[];
  if (Array.isArray(b.items) && b.items.length > 0) {
    items = b.items.map((i: any) => ({ description: String(i.description ?? '').trim() || (kind === 'credit' ? 'Nota de crédito' : 'Nota de débito'), amount: Number(i.amount) }));
  } else if (Number(b.totalAmount) > 0) {
    items = [{ description: reason.slice(0, 80) || 'Ajuste', amount: Number(b.totalAmount) }];
  } else {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'Either items or totalAmount must be provided');
  }
  if (items.some((i) => !Number.isFinite(i.amount) || i.amount <= 0)) {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'All item amounts must be positive numbers');
  }

  const request = noteRequest({ note: kind, original, modificationCode: code, reason, lines: grossNoteLines(items) });
  const { record, queued } = await issueFiscalDocument({
    tenant,
    route: kind === 'credit' ? 'credit-notes' : 'debit-notes',
    request,
    actorId: req.user._id,
    source: kind === 'credit' ? 'credit_note' : 'debit_note',
    links: { folioId: original.folioId as any, reservationId: original.reservationId as any, invoiceId: original.invoiceId as any },
    original: { eNCF: original.eNCF!, codigoModificacion: code },
  });

  if (record.estadoECF !== 'Rechazado' && record.estadoECF !== 'Error') {
    if (kind === 'credit') await postFolioCreditNoteEntry(tenant, record, req.user._id);
    else await postFolioDebitNoteEntry(tenant, record, req.user._id);
  }
  return res.status(201).json({ success: true, queued, data: publicRecord(record) });
}

router.post('/documents/credit-note', ...can('issue'), handle('credit-note', (req, res) => issueNote(req, res, 'credit')));
router.post('/documents/debit-note', ...can('issue'), handle('debit-note', (req, res) => issueNote(req, res, 'debit')));

/** Other types (41, 43, 44, 45, 46, 47): the caller states the lines; BillingSoft applies the type's rules. */
router.post('/documents/other', ...can('issue'), handle('other', async (req, res) => {
  const tenant = await loadTenant(req);
  const b = req.body ?? {};
  if (!['41', '43', '44', '45', '46', '47'].includes(String(b.type))) {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'type must be one of 41, 43, 44, 45, 46, 47', { type: 'Tipo inválido' });
  }
  const request: BsDocumentRequest = {
    type: String(b.type) as BsEcfType,
    ...(b.buyer ? { buyer: b.buyer } : {}),
    ...(b.incomeType ? { incomeType: b.incomeType } : {}),
    payment: b.payment ?? { type: 'cash' },
    lines: Array.isArray(b.lines) ? b.lines : [],
  };
  const { record, queued } = await issueFiscalDocument({
    tenant,
    route: 'other',
    request,
    actorId: req.user._id,
    source: 'manual',
    numeroFacturaInterna: b.refNumber ? String(b.refNumber).slice(0, 40) : undefined,
  });
  return res.status(201).json({ success: true, queued, data: publicRecord(record) });
}));

// ─── Attention, alerts and reports ───────────────────────────────────────────

router.get('/alerts', ...can('view'), handle('alerts', async (req, res) => {
  const tenant = await loadTenant(req);
  const alerts: { type: string; severity: 'info' | 'warning' | 'error'; count?: number; params?: Record<string, unknown> }[] = [];
  const state = fiscalState(tenant);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const tenantId = req.tenantId;

  if (state === 'suspended') alerts.push({ type: 'suspended', severity: 'error' });
  if (state === 'not_started' || state === 'in_progress') alerts.push({ type: `certification_${state}`, severity: 'info' });

  const [rejected, stale, queued, failed] = await Promise.all([
    ElectronicInvoice.countDocuments({ tenantId, estadoECF: 'Rechazado', createdAt: { $gte: thirtyDaysAgo } }),
    ElectronicInvoice.countDocuments({ tenantId, estadoECF: { $in: ['Firmado', 'En Proceso', 'Sin Resolver'] }, createdAt: { $lte: hourAgo } }),
    ElectronicInvoice.countDocuments({ tenantId, estadoECF: 'Pendiente', createdAt: { $lte: fiveMinutesAgo } }),
    ElectronicInvoice.countDocuments({ tenantId, estadoECF: 'Error' }),
  ]);
  if (rejected) alerts.push({ type: 'rejected', severity: 'error', count: rejected });
  if (failed) alerts.push({ type: 'failed', severity: 'error', count: failed });
  if (queued) alerts.push({ type: 'queued', severity: 'warning', count: queued });
  if (stale) alerts.push({ type: 'stale', severity: 'warning', count: stale });

  const org = tenant.fiscal?.organizationId;
  if (org && isFiscalConfigured() && state === 'ready') {
    try {
      const cfg = await getBillingSoftClient().configTest(org);
      if (cfg.certificate === 'expired') alerts.push({ type: 'certificate_expired', severity: 'error' });
      else if (cfg.certificate === 'expiring') alerts.push({ type: 'certificate_expiring', severity: 'warning' });
      else if (cfg.certificate === 'none') alerts.push({ type: 'certificate_missing', severity: 'error' });
      if (cfg.usableTypes.length === 0) alerts.push({ type: 'no_sequences', severity: 'error' });
    } catch {
      /* BillingSoft unreachable: the local alerts still stand */
    }
  }
  return res.json({ success: true, data: alerts });
}));

router.get('/reports/monthly-tax', ...can('view'), handle('monthly-tax', async (req, res) => {
  const { year, limit = '24' } = req.query as Record<string, string | undefined>;
  const limitNum = Math.min(60, Math.max(1, parseInt(limit, 10) || 24));
  const match: Record<string, unknown> = {
    tenantId: new mongoose.Types.ObjectId(String(req.tenantId)),
    estadoECF: { $in: ['Aceptado', 'Aceptado Condicional'] },
  };
  const y = year ? parseInt(year, 10) : NaN;
  if (!isNaN(y)) match.issuedAt = { $gte: new Date(`${y}-01-01T00:00:00.000Z`), $lt: new Date(`${y + 1}-01-01T00:00:00.000Z`) };

  const data = await ElectronicInvoice.aggregate([
    { $match: match },
    { $group: { _id: { year: { $year: '$issuedAt' }, month: { $month: '$issuedAt' }, tipo: '$tipo' }, totalFactura: { $sum: '$totalFactura' }, totalImpuestos: { $sum: '$totalImpuestos' }, count: { $sum: 1 } } },
    {
      $group: {
        _id: { year: '$_id.year', month: '$_id.month' },
        byTipo: { $push: { tipo: '$_id.tipo', totalFactura: '$totalFactura', totalImpuestos: '$totalImpuestos', count: '$count' } },
        totalFactura: { $sum: '$totalFactura' },
        totalImpuestos: { $sum: '$totalImpuestos' },
        totalInvoices: { $sum: '$count' },
      },
    },
    { $sort: { '_id.year': -1, '_id.month': -1 } },
    { $limit: limitNum },
    { $project: { _id: 0, year: '$_id.year', month: '$_id.month', byTipo: 1, totalFactura: 1, totalImpuestos: 1, totalInvoices: 1 } },
  ]);
  return res.json({ success: true, data });
}));

// ─── Sequences ───────────────────────────────────────────────────────────────

router.get('/sequences', ...can('view'), handle('sequences', async (req, res) => {
  const tenant = await loadTenant(req);
  return res.json({ success: true, data: await getBillingSoftClient().listSequences(orgOf(tenant)) });
}));

router.post('/sequences', ...can('manage'), handle('record-sequence', async (req, res) => {
  const tenant = await loadTenant(req);
  const b = req.body ?? {};
  const body: BsRecordSequence = {
    documentType: String(b.documentType) as BsEcfType,
    rangeStart: Number(b.rangeStart),
    rangeEnd: Number(b.rangeEnd),
    ...(b.expiresOn ? { expiresOn: String(b.expiresOn) } : {}),
  };
  return res.status(201).json({ success: true, data: await getBillingSoftClient().recordSequence(orgOf(tenant), body) });
}));

router.post('/sequences/annul', ...can('manage'), handle('annul', async (req, res) => {
  const tenant = await loadTenant(req);
  const ranges = Array.isArray(req.body?.ranges) ? req.body.ranges : [];
  return res.json({ success: true, data: await getBillingSoftClient().annulSequences(orgOf(tenant), { ranges }) });
}));

// ─── Received documents and commercial approval ──────────────────────────────

router.get('/received', ...can('view'), handle('received', async (req, res) => {
  const tenant = await loadTenant(req);
  const q = req.query as Record<string, string | undefined>;
  const filter = q.filter === 'undecided' || q.filter === 'approved' || q.filter === 'rejected' ? q.filter : undefined;
  const page = await getBillingSoftClient().listReceived(orgOf(tenant), { page: Number(q.page) || 1, filter, q: q.q });
  return res.json({ success: true, data: page.items, meta: { total: page.total, page: page.page, limit: page.pageSize, pages: Math.ceil(page.total / page.pageSize) } });
}));

router.get('/received/:id', ...can('view'), handle('received-one', async (req, res) => {
  const tenant = await loadTenant(req);
  return res.json({ success: true, data: await getBillingSoftClient().getReceived(orgOf(tenant), req.params.id) });
}));

router.get('/received/:id/:file(xml|pdf|acknowledgment)', ...can('view'), handle('received-file', async (req, res) => {
  const tenant = await loadTenant(req);
  const file = req.params.file as 'xml' | 'pdf' | 'acknowledgment';
  const content = await getBillingSoftClient().getReceivedFile(orgOf(tenant), req.params.id, file);
  res.setHeader('Content-Type', file === 'pdf' ? 'application/pdf' : 'application/xml');
  res.setHeader('Content-Disposition', `${file === 'pdf' ? 'inline' : 'attachment'}; filename="received-${req.params.id}.${file === 'pdf' ? 'pdf' : 'xml'}"`);
  return res.send(content);
}));

router.post('/received/:id/decision', ...can('manage'), handle('decide', async (req, res) => {
  const tenant = await loadTenant(req);
  const b = req.body ?? {};
  if (b.decision !== 'approved' && b.decision !== 'rejected') {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'decision must be approved or rejected', { decision: 'Requerido' });
  }
  if (b.decision === 'rejected' && !String(b.reason ?? '').trim()) {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'A rejection needs its reason', { reason: 'Indique el motivo' });
  }
  const body = b.decision === 'approved' ? { decision: 'approved' as const } : { decision: 'rejected' as const, reason: String(b.reason).trim() };
  return res.status(201).json({ success: true, data: await getBillingSoftClient().decideReceived(orgOf(tenant), req.params.id, body) });
}));

router.post('/received/:id/deliveries/:target/retry', ...can('manage'), handle('retry-delivery', async (req, res) => {
  const tenant = await loadTenant(req);
  const target = req.params.target;
  if (target !== 'dgii' && target !== 'issuer') throw new FiscalError(400, 'FISCAL_REJECTED', 'target must be dgii or issuer');
  return res.json({ success: true, data: await getBillingSoftClient().retryReceivedDelivery(orgOf(tenant), req.params.id, target) });
}));

// ─── DGII directory ──────────────────────────────────────────────────────────

router.get('/directory', ...can('view'), handle('directory', async (req, res) => {
  const tenant = await loadTenant(req);
  const rnc = String(req.query.rnc ?? '').replace(/\D/g, '');
  if (!/^(\d{9}|\d{11})$/.test(rnc)) throw new FiscalError(400, 'FISCAL_REJECTED', 'rnc must have 9 digits (11 for a cédula)', { rnc: 'RNC inválido' });
  try {
    return res.json({ success: true, data: await getBillingSoftClient().directory(orgOf(tenant), rnc) });
  } catch (err) {
    if (err instanceof BillingSoftError && err.statusCode === 404) return res.json({ success: true, data: null });
    throw err;
  }
}));

export default router;
