/**
 * The one way an e-CF is issued, for both apps (PMS folios and payments; Accounting invoices and
 * credit/debit notes).
 *
 * The pipeline never loses a document and never issues one twice:
 *   1. the intent is saved first — the exact request and an idempotency key;
 *   2. BillingSoft is called with that key;
 *   3. the record is updated from the answer.
 * If BillingSoft cannot be reached the record stays `Pendiente` and the sweep job sends it again
 * with the same key, so a timeout can never turn into two fiscal invoices. A request BillingSoft
 * refuses outright (validation) issued nothing, so its record is removed and the caller is told why.
 */
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import ElectronicInvoice, { EcfGenerationSource, EcfRoute, IElectronicInvoice } from '../../models/ElectronicInvoice';
import { FiscalIssuer } from './platformIssuer';
import { BillingSoftError } from './billingsoftClient';
import { getBillingSoftClient } from './fiscalClient';
import { assertCanIssue, FiscalError, tipoOfType, totalsOfLines } from './fiscalCore';
import { applyDetail, fieldsFromAnswer } from './fiscalSync';
import { BsDocumentAnswer, BsDocumentRequest } from './billingsoftTypes';

/** A document that BillingSoft has not confirmed after this long is marked `Error`. */
export const PENDING_GIVE_UP_MS = 24 * 60 * 60 * 1000;

export interface IssueInput {
  /** Who issues: a tenant, or Pilloto itself. */
  tenant: FiscalIssuer;
  route: EcfRoute;
  request: BsDocumentRequest;
  actorId: Types.ObjectId | string;
  source: EcfGenerationSource;
  links?: {
    folioId?: Types.ObjectId | string;
    paymentId?: Types.ObjectId | string;
    reservationId?: Types.ObjectId | string;
    invoiceId?: Types.ObjectId | string;
    billingPaymentId?: Types.ObjectId | string;
  };
  /** The company's own reference for the document (reservation code, invoice number). */
  numeroFacturaInterna?: string;
  /** For notes: the e-NCF being modified and DGII's modification code. */
  original?: { eNCF: string; codigoModificacion: string };
  /** A key derived from the source document makes a double click harmless; otherwise one is generated. */
  idempotencyKey?: string;
}

export interface IssueResult {
  record: IElectronicInvoice;
  /** True when BillingSoft could not be reached: the record is saved and will be sent automatically. */
  queued: boolean;
}

/** What a failed BillingSoft call means to our caller. */
export function toFiscalError(err: BillingSoftError): FiscalError {
  switch (err.statusCode) {
    case 400:
    case 422:
      return new FiscalError(400, 'FISCAL_REJECTED', err.message, err.fields);
    case 401:
    case 403:
      return new FiscalError(502, 'BILLINGSOFT_AUTH', 'Electronic invoicing is misconfigured. Contact support.');
    case 404:
      return new FiscalError(502, 'BILLINGSOFT_ORGANIZATION', 'The company is not set up in BillingSoft. Contact support.');
    case 409:
      return new FiscalError(409, 'FISCAL_CONFLICT', err.message);
    case 0:
      return new FiscalError(503, 'BILLINGSOFT_UNREACHABLE', err.message);
    default:
      return new FiscalError(502, 'BILLINGSOFT_ERROR', err.message);
  }
}

async function findByKey(tenantId: Types.ObjectId | string, key: string) {
  return ElectronicInvoice.findOne({ tenantId, idempotencyKey: key });
}

export async function issueFiscalDocument(input: IssueInput): Promise<IssueResult> {
  const { tenant, request } = input;
  assertCanIssue(tenant);

  const key = input.idempotencyKey ?? randomUUID();
  const existing = await findByKey(tenant._id as Types.ObjectId, key);
  if (existing) {
    // The same source document, asked twice: hand back what is there (and finish sending it if needed).
    return existing.estadoECF === 'Pendiente' ? sendIntent(existing, tenant, true) : { record: existing, queued: false };
  }

  const totals = totalsOfLines(request.lines);
  const buyer = request.buyer;
  const paymentCode = request.payment.type === 'credit' ? '2' : request.payment.type === 'free' ? '3' : '1';
  let record: IElectronicInvoice;
  try {
    record = await ElectronicInvoice.create({
      tenantId: tenant._id,
      ...(input.links?.folioId ? { folioId: input.links.folioId } : {}),
      ...(input.links?.paymentId ? { paymentId: input.links.paymentId } : {}),
      ...(input.links?.reservationId ? { reservationId: input.links.reservationId } : {}),
      ...(input.links?.invoiceId ? { invoiceId: input.links.invoiceId } : {}),
      ...(input.links?.billingPaymentId ? { billingPaymentId: input.links.billingPaymentId } : {}),
      tipo: tipoOfType(request.type),
      route: input.route,
      idempotencyKey: key,
      request,
      estadoECF: 'Pendiente',
      estatus: 'pending',
      environment: tenant.fiscal?.environment,
      totalFactura: totals.totalFactura,
      totalImpuestos: totals.totalImpuestos,
      currency: 'DOP',
      lineItems: totals.lineItems,
      tipoPago: paymentCode,
      numeroFacturaInterna: input.numeroFacturaInterna,
      buyerRnc: buyer?.rnc,
      buyerName: buyer?.name,
      buyerEmail: buyer?.email,
      originalENCF: input.original?.eNCF,
      codigoModificacion: input.original?.codigoModificacion,
      generatedBy: input.actorId,
      generationSource: input.source,
      issuedAt: new Date(),
      retryCount: 0,
    });
  } catch (err: any) {
    // Two requests with the same key at once: the other one saved first.
    if (err?.code === 11000) {
      const raced = await findByKey(tenant._id as Types.ObjectId, key);
      if (raced) return { record: raced, queued: raced.estadoECF === 'Pendiente' };
    }
    throw err;
  }
  return sendIntent(record, tenant, true);
}

/**
 * Sends a saved intent to BillingSoft. `interactive` is a person waiting: a refusal removes the
 * record and is thrown. In the background (the sweep) a refusal marks the record `Error` instead.
 */
export async function sendIntent(
  record: IElectronicInvoice,
  tenant: FiscalIssuer,
  interactive: boolean,
  now: Date = new Date(),
): Promise<IssueResult> {
  const organizationId = tenant.fiscal?.organizationId;
  if (!organizationId) throw new FiscalError(409, 'FISCAL_NOT_ACTIVATED', 'Electronic invoicing is not activated');

  let answer: BsDocumentAnswer;
  try {
    answer = await getBillingSoftClient().issue(
      organizationId,
      record.route,
      record.request as BsDocumentRequest,
      record.idempotencyKey,
    );
  } catch (err) {
    if (!(err instanceof BillingSoftError)) throw err;

    if (err.retryable) {
      const tooOld = now.getTime() - record.createdAt.getTime() > PENDING_GIVE_UP_MS;
      const updated = await ElectronicInvoice.findOneAndUpdate(
        { _id: record._id, tenantId: record.tenantId },
        {
          $set: {
            lastStatusCheck: now,
            mensaje: tooOld ? 'No se pudo enviar a BillingSoft en 24 horas' : 'Pendiente de envío a BillingSoft',
            ...(tooOld ? { estadoECF: 'Error', estatus: 'error' } : {}),
          },
          $inc: { retryCount: 1 },
        },
        { new: true },
      );
      return { record: updated ?? record, queued: !tooOld };
    }

    if (interactive) {
      await ElectronicInvoice.deleteOne({ _id: record._id, tenantId: record.tenantId });
      throw toFiscalError(err);
    }
    const updated = await ElectronicInvoice.findOneAndUpdate(
      { _id: record._id, tenantId: record.tenantId },
      { $set: { estadoECF: 'Error', estatus: 'error', mensaje: err.message.slice(0, 500), lastStatusCheck: now } },
      { new: true },
    );
    return { record: updated ?? record, queued: false };
  }

  let updated: IElectronicInvoice =
    ((await ElectronicInvoice.findOneAndUpdate(
      { _id: record._id, tenantId: record.tenantId },
      { $set: { ...fieldsFromAnswer(answer, tenant.fiscal?.environment), lastStatusCheck: now } },
      { new: true },
    )) as IElectronicInvoice | null) ?? record;

  // The answer carries no totals or security code; fetch the document for them. The document is
  // already issued, so a failure here is not the caller's problem — the sweep fills it in later.
  try {
    const detail = await getBillingSoftClient().getDocument(organizationId, answer.documentId);
    updated = await applyDetail(updated, detail, tenant);
  } catch (err: any) {
    console.warn(`[Fiscal] Issued ${answer.encf} but could not read it back: ${err?.message}`);
  }
  return { record: updated, queued: false };
}
