/**
 * Emails an issued e-CF to its buyer. BillingSoft has no email endpoint, so Pilloto downloads the
 * printed representation (PDF with its QR) and sends it itself, from the company's own sender.
 */
import { IElectronicInvoice } from '../../models/ElectronicInvoice';
import { ITenant } from '../../models/Tenant';
import { sendEmail } from '../../utils/email';
import { getBillingSoftClient } from './fiscalClient';
import { FiscalError } from './fiscalCore';
import { dgiiEmail } from './mappers';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/** Sends the document to `override` or, by default, the buyer's email. Returns the address used. */
export async function emailFiscalDocument(
  tenant: Pick<ITenant, 'fiscal'>,
  record: IElectronicInvoice,
  override?: string,
): Promise<string> {
  const organizationId = tenant.fiscal?.organizationId;
  if (!organizationId) throw new FiscalError(409, 'FISCAL_NOT_ACTIVATED', 'Electronic invoicing is not activated');
  if (!record.billingsoftDocumentId || !record.eNCF) {
    throw new FiscalError(409, 'FISCAL_NO_DOCUMENT', 'This e-CF has not been confirmed by BillingSoft yet');
  }
  if (record.environment && record.environment !== 'ecf') {
    // Test-environment documents have no fiscal value: a guest must never receive one as if it did.
    throw new FiscalError(409, 'FISCAL_TEST_DOCUMENT', 'This document was issued in a DGII test environment and has no fiscal value');
  }

  const requested = (override ?? '').trim().toLowerCase();
  if (requested && !EMAIL_PATTERN.test(requested)) {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'The email address is invalid', { email: 'Correo inválido' });
  }
  const to = requested || (record.buyerEmail && EMAIL_PATTERN.test(record.buyerEmail) ? record.buyerEmail : dgiiEmail(record.buyerEmail));
  if (!to) {
    throw new FiscalError(400, 'FISCAL_REJECTED', 'There is no recipient email. Provide one.', { email: 'Requerido' });
  }

  const pdf = await getBillingSoftClient().getDocumentPdf(organizationId, record.billingsoftDocumentId);
  try {
    await sendEmail({
      to,
      subject: `e-CF ${record.eNCF}`,
      html: `<p>Hola,</p><p>Adjuntamos su comprobante fiscal electrónico <strong>${record.eNCF}</strong>.</p><p>Si tiene alguna pregunta, responda a este correo.</p>`,
      text: `Adjuntamos su comprobante fiscal electrónico ${record.eNCF}.`,
      attachments: [{ filename: `${record.eNCF}.pdf`, content: pdf, contentType: 'application/pdf' }],
      _logMeta: { emailType: 'ecf_invoice', referenceId: String(record._id) },
    });
  } catch (err: any) {
    throw new FiscalError(502, 'EMAIL_FAILED', `Failed to send email: ${err?.message ?? 'unknown error'}`);
  }
  return to;
}
