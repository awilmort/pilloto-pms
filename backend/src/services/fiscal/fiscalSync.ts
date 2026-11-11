/**
 * Keeps Pilloto's `ElectronicInvoice` records in step with BillingSoft's documents.
 *
 * Three things move a record forward, all through `applyDetail`: BillingSoft's webhook, a person
 * pressing "refresh", and the sweep job — so a lost webhook never leaves a document stuck.
 */
import ElectronicInvoice, { ECF_TERMINAL_ESTADOS, IElectronicInvoice } from '../../models/ElectronicInvoice';
import { ITenant } from '../../models/Tenant';
import { sendEmail } from '../../utils/email';
import { BillingSoftError } from './billingsoftClient';
import { getBillingSoftClient } from './fiscalClient';
import { estadoOfStatus, FiscalError } from './fiscalCore';
import { BsDocumentAnswer, BsDocumentDetail, BsEnvironment } from './billingsoftTypes';

/** The fields of a record that BillingSoft's document decides. */
export function fieldsFromDetail(detail: BsDocumentDetail, environment?: BsEnvironment) {
  const last = detail.submissions[detail.submissions.length - 1];
  const messages = last?.messages ?? [];
  return {
    billingsoftDocumentId: detail.id,
    eNCF: detail.encf,
    estadoECF: estadoOfStatus(detail.status),
    estatus: detail.status,
    ...(last?.trackId ? { trackId: last.trackId } : {}),
    dgiiMessages: messages,
    mensaje: messages.length ? messages.map((m) => m.message).join(' · ').slice(0, 1000) : undefined,
    codigoSeguridad: detail.securityCode,
    totalFactura: Number(detail.total),
    ...(environment ? { environment } : {}),
  };
}

/** The fields the issue answer alone gives (before the full document is fetched). */
export function fieldsFromAnswer(answer: BsDocumentAnswer, environment?: BsEnvironment) {
  return {
    billingsoftDocumentId: answer.documentId,
    eNCF: answer.encf,
    estadoECF: estadoOfStatus(answer.status),
    estatus: answer.status,
    ...(answer.trackId ? { trackId: answer.trackId } : {}),
    mensaje: answer.dgiiError,
    ...(environment ? { environment } : {}),
  };
}

/**
 * Writes BillingSoft's current view of a document onto its record and, when DGII has just rejected
 * it, tells the company's owner. Returns the updated record.
 */
export async function applyDetail(
  record: IElectronicInvoice,
  detail: BsDocumentDetail,
  tenant: Pick<ITenant, 'ownerEmail' | 'fiscal'>,
): Promise<IElectronicInvoice> {
  const before = record.estadoECF;
  const set = fieldsFromDetail(detail, tenant.fiscal?.environment);
  const updated = await ElectronicInvoice.findOneAndUpdate(
    { _id: record._id, tenantId: record.tenantId },
    { $set: { ...set, lastStatusCheck: new Date() }, $inc: { retryCount: 1 } },
    { new: true },
  );
  const result = updated ?? record;
  if (before !== 'Rechazado' && result.estadoECF === 'Rechazado') {
    await notifyRejection(result, tenant.ownerEmail);
  }
  return result;
}

async function notifyRejection(record: IElectronicInvoice, ownerEmail?: string): Promise<void> {
  if (!ownerEmail) return;
  try {
    await sendEmail({
      to: ownerEmail,
      subject: `[Pilloto] e-CF rechazado por la DGII — ${record.eNCF ?? ''}`.trim(),
      html:
        `<p>La DGII <strong>rechazó</strong> un comprobante fiscal electrónico.</p>` +
        `<ul><li><strong>e-NCF:</strong> ${record.eNCF ?? 'N/D'}</li>` +
        `<li><strong>Tipo:</strong> ${record.tipo}</li>` +
        `<li><strong>Monto:</strong> ${record.currency} ${record.totalFactura.toFixed(2)}</li>` +
        `<li><strong>Motivo:</strong> ${record.mensaje ?? 'Sin motivo indicado'}</li></ul>` +
        `<p>Revise el comprobante en Pilloto y emita uno nuevo si corresponde.</p>`,
      _logMeta: { emailType: 'ecf_rejected', referenceId: String(record._id) },
    });
  } catch (err: any) {
    console.warn(`[Fiscal] Could not send the rejection notice for ${record._id}: ${err?.message}`);
  }
}

/** Fetches the document from BillingSoft and applies it. `force` asks BillingSoft to query DGII first. */
export async function refreshRecord(
  record: IElectronicInvoice,
  tenant: Pick<ITenant, 'ownerEmail' | 'fiscal'>,
  { force = false }: { force?: boolean } = {},
): Promise<IElectronicInvoice> {
  const organizationId = tenant.fiscal?.organizationId;
  if (!organizationId || !record.billingsoftDocumentId) {
    throw new FiscalError(409, 'FISCAL_NO_DOCUMENT', 'This e-CF has not been confirmed by BillingSoft yet');
  }
  const client = getBillingSoftClient();
  try {
    const detail = force
      ? await client.refreshDocument(organizationId, record.billingsoftDocumentId)
      : await client.getDocument(organizationId, record.billingsoftDocumentId);
    return await applyDetail(record, detail, tenant);
  } catch (err) {
    if (err instanceof BillingSoftError) {
      throw new FiscalError(err.statusCode === 0 ? 503 : 502, 'BILLINGSOFT_ERROR', err.message);
    }
    throw err;
  }
}

/** States the sweep keeps asking BillingSoft about. */
export const OPEN_ESTADOS = ['Firmado', 'En Proceso', 'Sin Resolver'] as const;

export const isTerminal = (record: Pick<IElectronicInvoice, 'estadoECF'>): boolean =>
  (ECF_TERMINAL_ESTADOS as readonly string[]).includes(record.estadoECF);
