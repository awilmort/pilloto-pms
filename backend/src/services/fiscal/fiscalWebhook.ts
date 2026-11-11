/**
 * BillingSoft webhook: signature check and event handling.
 *
 * Deliveries carry `BillingSoft-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`,
 * signed with the secret BillingSoft returned when Pilloto registered the company's webhook.
 * Delivery is at least once and repeats the event id on a retry, so each id is claimed before it is
 * acted on. What an event says is never trusted: a document event only makes Pilloto read the
 * document from BillingSoft.
 */
import crypto from 'crypto';
import ElectronicInvoice from '../../models/ElectronicInvoice';
import FiscalWebhookEvent from '../../models/FiscalWebhookEvent';
import { sendEmail } from '../../utils/email';
import { BsWebhookEvent } from './billingsoftTypes';
import { syncIssuerFiscal } from './fiscalLifecycle';
import { FiscalIssuer } from './platformIssuer';
import { refreshRecord } from './fiscalSync';

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type SignatureResult = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

export function computeSignature(secret: string, timestamp: string, rawBody: Buffer): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export function verifySignature(opts: {
  rawBody: Buffer;
  header: string | undefined;
  secret: string;
  nowMs?: number;
}): SignatureResult {
  if (!opts.header) return { ok: false, reason: 'missing' };
  const parts = Object.fromEntries(
    opts.header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const timestamp = parts.t;
  const provided = parts.v1;
  if (!timestamp || !/^\d+$/.test(timestamp) || !provided || !/^[0-9a-f]{64}$/i.test(provided)) {
    return { ok: false, reason: 'malformed' };
  }
  const ageSeconds = Math.abs((opts.nowMs ?? Date.now()) / 1000 - Number(timestamp));
  if (ageSeconds > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(computeSignature(opts.secret, timestamp, opts.rawBody), 'hex');
  const given = Buffer.from(provided, 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}

export type EventOutcome = 'handled' | 'duplicate' | 'ignored';

/** Handles one verified event for `tenant`. Throws when it could not be handled, so BillingSoft retries. */
export async function handleEvent(tenant: FiscalIssuer, event: BsWebhookEvent): Promise<EventOutcome> {
  try {
    await FiscalWebhookEvent.create({ eventId: event.id, tenantId: tenant._id, type: event.type });
  } catch (err: any) {
    if (err?.code === 11000) return 'duplicate';
    throw err;
  }

  try {
    switch (event.type) {
      case 'document.accepted':
      case 'document.rejected':
      case 'document.conditionally_accepted': {
        const documentId = typeof event.data.documentId === 'string' ? event.data.documentId : undefined;
        if (!documentId) return 'ignored';
        const record = await ElectronicInvoice.findOne({ tenantId: tenant._id, billingsoftDocumentId: documentId });
        // Not (yet) known here: the sweep recovers it from the idempotency key.
        if (!record) return 'ignored';
        await refreshRecord(record, tenant);
        return 'handled';
      }
      case 'organization.certified':
        await syncIssuerFiscal(tenant);
        return 'handled';
      case 'sequence.low':
        await notifySequenceLow(tenant, event);
        return 'handled';
      default:
        // document.received, contingency.*: the app reads these live from BillingSoft.
        return 'ignored';
    }
  } catch (err) {
    // Release the claim so BillingSoft's retry is handled instead of being taken for a duplicate.
    await FiscalWebhookEvent.deleteOne({ eventId: event.id });
    throw err;
  }
}

async function notifySequenceLow(tenant: FiscalIssuer, event: BsWebhookEvent): Promise<void> {
  if (!tenant.ownerEmail) return;
  const type = String(event.data.documentType ?? '');
  const remaining = Number(event.data.remaining ?? 0);
  const exhausted = event.data.exhausted === true;
  try {
    await sendEmail({
      to: tenant.ownerEmail,
      subject: exhausted
        ? `[Pilloto] Se agotó un rango de e-NCF (tipo ${type})`
        : `[Pilloto] Queda poco de un rango de e-NCF (tipo ${type})`,
      html:
        `<p>${exhausted ? 'Se agotó' : 'Está por agotarse'} el rango de e-NCF autorizado por la DGII para los comprobantes tipo <strong>${type}</strong>` +
        `${exhausted ? '' : ` (quedan ${remaining})`}.</p>` +
        `<p>Solicite un nuevo rango en la Oficina Virtual de la DGII y regístrelo en Pilloto (Facturación electrónica → Secuencias).</p>`,
      _logMeta: { emailType: 'ecf_sequence_low', referenceId: String(tenant._id) },
    });
  } catch (err: any) {
    console.warn(`[Fiscal] Could not send the low-sequence notice for tenant ${tenant._id}: ${err?.message}`);
  }
}
