/**
 * ECF Routes — /api/ecf/*
 *
 * Phase 1: Tenant e-CF configuration management.
 * Phase 2: Invoice generation, listing, status management, and async polling.
 * Phase 5: Received invoices, commercial approval, other invoice types,
 *           health check, directory cache, notifications, and audit.
 *
 * - PUT    /api/ecf/config                      — save/update Citrus configuration + token
 * - GET    /api/ecf/config                      — retrieve config (token masked)
 * - DELETE /api/ecf/config/token                — revoke token
 * - POST   /api/ecf/config/test                 — validate token via lightweight Citrus call
 * - POST   /api/ecf/invoices                    — generate invoice from folio/payment
 * - GET    /api/ecf/invoices                    — list invoices (filtered, paginated)
 * - GET    /api/ecf/invoices/pending            — list En Proceso invoices
 * - GET    /api/ecf/invoices/:id                — single invoice detail
 * - POST   /api/ecf/invoices/:id/refresh-status — re-poll Citrus for status
 * - GET    /api/ecf/health                      — Citrus connectivity check
 * - GET    /api/ecf/directory                   — electronic billers directory (24h cache)
 * - GET    /api/ecf/received-invoices           — Comprobantes Recibidos from Citrus
 * - POST   /api/ecf/commercial-approval         — approve/reject received invoice
 * - POST   /api/ecf/invoices/other              — generate other invoice types (E41/E43/E44/E45/E46/E47)
 */

import express, { Response } from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import Tenant from '../models/Tenant';
import Folio from '../models/Folio';
import Charge from '../models/Charge';
import Payment from '../models/Payment';
import Reservation from '../models/Reservation';
import ElectronicInvoice, { EcfEstadoECF, EcfTipo, IEcfLineItem } from '../models/ElectronicInvoice';
import { encrypt, decrypt } from '../utils/encryption';
import { citrusEcfService, CitrusError, CitrusInvoiceResponse } from '../services/citrusEcf';
import { sendEmail } from '../utils/email';
import {
  mapToFacturaConsumo,
  mapToFacturaCreditoFiscal,
  mapToNotaCredito,
  mapToNotaDebito,
  mapToCompras,
  mapToGastoMenor,
  mapToRegimenEspecial,
  mapToExportacion,
  mapToPagoExterior,
  EcfMapperError,
  type EcfBuyerInfo,
  type EcfOtherBuyerInfo,
  type OtherInvoiceItem,
} from '../utils/ecfMapper';
import type { EcfAmbiente } from '../models/Tenant';
import { generateFallbackPdf } from '../utils/ecfPdfFallback';
import { postFolioCreditNoteEntry, postFolioDebitNoteEntry } from '../services/accounting/pmsLedgerHooks';

const router = express.Router();

// ─── Rate limiter specific to ECF endpoints ──────────────────────────────────

const ecfLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 minutes
  max: 60,
  message: 'Too many ECF requests, please slow down.',
  keyGenerator: (req) => (req as AuthRequest).user?._id?.toString() ?? req.ip ?? 'unknown',
});

router.use(ecfLimiter);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ALLOWED_AMBIENTES: EcfAmbiente[] = [
  'Simulacion', 'Pruebas', 'Certificacion', 'Produccion',
];

const RNC_REGEX = /^\d{9}$|^\d{11}$/;
const CITRUS_URL_REGEX = /^https:\/\/.+/;

function maskConfig(ecfConfig: any) {
  if (!ecfConfig) return null;
  const { citrusToken: _t, ...rest } = ecfConfig.toObject ? ecfConfig.toObject() : ecfConfig;
  return {
    ...rest,
    hasToken: Boolean(_t),
  };
}

function resolveRecipientEmail(value?: string): string | null {
  const email = String(value ?? '').trim().toLowerCase();
  if (!email) return null;
  return /^\S+@\S+\.\S+$/.test(email) ? email : null;
}

/**
 * Thrown when Citrus acknowledges the invoice but returns no content for
 * representacionImpresa (Base64 and Url are both absent). This is normal in
 * the Simulación environment — DGII is not contacted so no PDF is generated.
 */
class EcfPdfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcfPdfUnavailableError';
  }
}

/**
 * Fetches a PDF from a URL returned by Citrus, attaching the Citrus auth token
 * when the URL belongs to the tenant's configured Citrus base URL.
 * Validates that the response body is a valid PDF before returning.
 */
async function fetchPdfFromCitrusUrl(
  url: string,
  filename: string,
  citrusBaseUrl: string | undefined,
  encryptedToken: string | undefined,
): Promise<{ filename: string; content: Buffer; contentType: string }> {
  const headers: Record<string, string> = {};

  // Include auth only for requests to the tenant's own Citrus base URL
  if (citrusBaseUrl && url.startsWith(citrusBaseUrl) && encryptedToken) {
    try {
      headers['Authorization'] = decrypt(encryptedToken);
    } catch {
      // Token decryption failure — attempt without auth (may be a public CDN URL)
      console.warn('[ECF] Failed to decrypt token for PDF URL fetch; trying without auth');
    }
  }

  // Use a local alias to avoid collision with the express Response type in scope
  type FetchResponse = Awaited<ReturnType<typeof fetch>>;
  let fetchRes: FetchResponse;
  try {
    fetchRes = await fetch(url, Object.keys(headers).length > 0 ? { headers } : {});
  } catch (networkError: any) {
    throw new Error(`Network error fetching Citrus PDF URL: ${networkError.message}`);
  }

  if (!fetchRes.ok) {
    throw new Error(`Failed to fetch PDF from Citrus URL (HTTP ${fetchRes.status})`);
  }

  const arrayBuffer = await fetchRes.arrayBuffer();
  const content = Buffer.from(arrayBuffer);

  if (content.length < 4 || content.subarray(0, 4).toString('ascii') !== '%PDF') {
    const preview = content.toString('utf8', 0, 120).replace(/[\r\n]+/g, ' ');
    throw new Error(`Citrus URL did not return a valid PDF. Content preview: "${preview.substring(0, 80)}"`);
  }

  return { filename, content, contentType: 'application/pdf' };
}

async function buildEcfPdfAttachment(tenant: any, invoice: any): Promise<{ filename: string; content: Buffer; contentType: string }> {
  const pdfResponse = await citrusEcfService.getRepresentacionImpresa(tenant, invoice.eNCF, invoice.tipo);

  const filename = `${invoice.eNCF || invoice._id}.pdf`;
  const citrusBaseUrl = tenant?.ecfConfig?.citrusBaseUrl as string | undefined;
  const encryptedToken = tenant?.ecfConfig?.citrusToken as string | undefined;

  // ── Case 1: Binary PDF returned directly from Citrus ─────────────────────
  if (Buffer.isBuffer(pdfResponse)) {
    if (pdfResponse.length >= 4 && pdfResponse.subarray(0, 4).toString('ascii') === '%PDF') {
      return { filename, content: pdfResponse, contentType: 'application/pdf' };
    }
    throw new Error('Citrus returned binary data that is not a valid PDF (missing %PDF header)');
  }

  if (typeof pdfResponse === 'string') {
    // ── Case 2: data URI (data:application/pdf;base64,...) ─────────────────
    if (pdfResponse.startsWith('data:application/pdf;base64,')) {
      const decoded = Buffer.from(pdfResponse.replace(/^data:application\/pdf;base64,/, ''), 'base64');
      return { filename, content: decoded, contentType: 'application/pdf' };
    }

    // ── Case 3: JSON response from Citrus ──────────────────────────────────
    // Citrus's representacionImpresa endpoint always returns JSON regardless of
    // the Accept header:
    //   { NombreArchivo: string, Extension: string, Base64: string|null,
    //     Url: string|null, Messages: any[] }
    // The Extension field is the authoritative format discriminator.
    if (pdfResponse.trimStart().startsWith('{')) {
      let parsed: Record<string, unknown> | null = null;
      try {
        const candidate = JSON.parse(pdfResponse);
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          parsed = candidate as Record<string, unknown>;
        }
      } catch {
        // Not valid JSON — fall through to other handlers
      }

      if (parsed) {
        // ── Citrus representacionImpresa response shape ──────────────────
        const extension = (typeof parsed['Extension'] === 'string' ? parsed['Extension'] : '').toLowerCase().trim();
        const nombreArchivo = typeof parsed['NombreArchivo'] === 'string' ? parsed['NombreArchivo'] : undefined;
        const base64Val = parsed['Base64'];
        const urlVal = parsed['Url'];
        const messages = parsed['Messages'];
        const hasBase64 = typeof base64Val === 'string' && (base64Val as string).length > 0;
        const hasUrl = typeof urlVal === 'string' && ((urlVal as string).startsWith('http://') || (urlVal as string).startsWith('https://'));

        console.info(
          `[ECF] Citrus representacionImpresa: Extension="${extension}", file="${nombreArchivo ?? ''}", ` +
          `hasBase64=${hasBase64}, hasUrl=${hasUrl}, eNCF=${invoice.eNCF}`,
        );
        if (Array.isArray(messages) && messages.length > 0) {
          console.warn('[ECF] Citrus representacionImpresa messages:', messages);
        }

        // Try the URL first if present (any extension)
        if (hasUrl) {
          return fetchPdfFromCitrusUrl(urlVal as string, nombreArchivo ?? filename, citrusBaseUrl, encryptedToken);
        }

        // Handle Base64 content by Extension discriminator
        if (hasBase64) {
          const decoded = Buffer.from((base64Val as string).replace(/\s+/g, ''), 'base64');

          if (extension === 'pdf') {
            // Trust Citrus: extension says PDF — return as-is (no %PDF magic check)
            return { filename: nombreArchivo ?? filename, content: decoded, contentType: 'application/pdf' };
          }

          if (extension === 'html' || extension === 'htm') {
            // Citrus returned the official HTML representation — serve it directly so the
            // browser renders it natively, preserving the DGII QR code and Citrus branding.
            console.info('[ECF] Citrus provided HTML representation — serving as text/html');
            const htmlFilename = (nombreArchivo ?? filename).replace(/\.pdf$/i, '.html');
            return { filename: htmlFilename, content: decoded, contentType: 'text/html; charset=utf-8' };
          }

          // Unknown extension but has content — try magic-byte detection
          if (decoded.length >= 4 && decoded.subarray(0, 4).toString('ascii') === '%PDF') {
            return { filename: nombreArchivo ?? filename, content: decoded, contentType: 'application/pdf' };
          }

          // Has content but unrecognised format — throw so the caller surfaces a real error
          throw new Error(
            `Citrus returned Base64 content with unrecognised Extension "${extension}" for ${invoice.eNCF}. ` +
            'Cannot determine format. Contact Citrus support.',
          );
        }

        // No Base64 and no URL — Citrus has not generated the representation yet
        const msgSummary = Array.isArray(messages) && messages.length > 0
          ? messages.map((m: unknown) => (typeof m === 'string' ? m : JSON.stringify(m))).join('; ')
          : 'no messages';
        const ambiente = tenant?.ecfConfig?.ambiente;
        if (!ambiente || ambiente === 'Simulacion') {
          throw new EcfPdfUnavailableError(
            'La representación impresa no está disponible en el ambiente de Simulación. ' +
            'Citrus no contacta a la DGII en este ambiente y no genera PDFs reales. ' +
            'Cambie al ambiente Pruebas o superior para obtener el PDF oficial.',
          );
        }
        throw new EcfPdfUnavailableError(
          `Citrus no proporcionó contenido para ${invoice.eNCF} ` +
          `(Base64 y Url ausentes, Extension="${extension}"). ` +
          `Mensajes Citrus: ${msgSummary}`,
        );
      }
    }

    // ── Case 4: Bare base64-encoded PDF ────────────────────────────────────
    const compact = pdfResponse.replace(/\s+/g, '');
    if (compact.length > 32 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
      const decoded = Buffer.from(compact, 'base64');
      if (decoded.subarray(0, 4).toString('ascii') === '%PDF') {
        return { filename, content: decoded, contentType: 'application/pdf' };
      }
    }

    // ── Case 5: Plain URL to PDF ────────────────────────────────────────────
    if (pdfResponse.startsWith('http://') || pdfResponse.startsWith('https://')) {
      return fetchPdfFromCitrusUrl(pdfResponse.trim(), filename, citrusBaseUrl, encryptedToken);
    }
  }

  throw new Error('Citrus did not return a usable PDF representation for this invoice');
}

// ─── GET /api/ecf/config ─────────────────────────────────────────────────────

router.get(
  '/config',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const tenant = await Tenant.findById(req.tenantId).select('ecfConfig').lean();
      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant not found' });
      }

      const config = (tenant as any).ecfConfig;
      if (!config) {
        return res.status(200).json({ success: true, data: null });
      }

      const { citrusToken: _t, ...rest } = config;
      return res.status(200).json({
        success: true,
        data: { ...rest, hasToken: Boolean(_t) },
      });
    } catch (error: any) {
      console.error('[ECF] GET /config error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve ECF configuration' });
    }
  }
);

// ─── PUT /api/ecf/config ─────────────────────────────────────────────────────

router.put(
  '/config',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        rnc,
        razonSocial,
        nombreComercial,
        phone,
        ambiente,
        sucursal,
        citrusBaseUrl,
        citrusToken,
        isActive,
      } = req.body;

      // ── Validation ────────────────────────────────────────────
      if (rnc !== undefined && !RNC_REGEX.test(String(rnc))) {
        return res.status(400).json({ success: false, message: 'RNC must be 9 or 11 digits' });
      }
      if (ambiente !== undefined && !ALLOWED_AMBIENTES.includes(ambiente)) {
        return res.status(400).json({ success: false, message: `Ambiente must be one of: ${ALLOWED_AMBIENTES.join(', ')}` });
      }
      if (citrusBaseUrl !== undefined && !CITRUS_URL_REGEX.test(String(citrusBaseUrl))) {
        return res.status(400).json({ success: false, message: 'citrusBaseUrl must be a valid HTTPS URL' });
      }
      if (razonSocial !== undefined && String(razonSocial).trim().length === 0) {
        return res.status(400).json({ success: false, message: 'razonSocial cannot be empty' });
      }

      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant not found' });
      }

      // Build partial update
      const update: Record<string, unknown> = {};
      if (rnc !== undefined) update['ecfConfig.rnc'] = String(rnc).trim();
      if (razonSocial !== undefined) update['ecfConfig.razonSocial'] = String(razonSocial).trim();
      if (nombreComercial !== undefined) update['ecfConfig.nombreComercial'] = String(nombreComercial).trim();
      if (phone !== undefined) update['ecfConfig.phone'] = String(phone).trim();
      if (ambiente !== undefined) update['ecfConfig.ambiente'] = ambiente;
      if (sucursal !== undefined) update['ecfConfig.sucursal'] = String(sucursal).trim();
      if (citrusBaseUrl !== undefined) update['ecfConfig.citrusBaseUrl'] = String(citrusBaseUrl).trim();
      if (isActive !== undefined) update['ecfConfig.isActive'] = Boolean(isActive);

      // Encrypt token only when a new one is provided
      if (citrusToken && String(citrusToken).trim().length > 0) {
        update['ecfConfig.citrusToken'] = encrypt(String(citrusToken).trim());
      }

      // If no ecfConfig yet, set defaults for required fields
      if (!tenant.ecfConfig) {
        if (!rnc || !razonSocial) {
          return res.status(400).json({
            success: false,
            message: 'rnc and razonSocial are required when creating ECF configuration',
          });
        }
        if (!update['ecfConfig.citrusBaseUrl']) {
          update['ecfConfig.citrusBaseUrl'] = 'https://test.ecf.citrus.com.do';
        }
        if (!update['ecfConfig.ambiente']) {
          update['ecfConfig.ambiente'] = 'Simulacion';
        }
      }

      await Tenant.findByIdAndUpdate(req.tenantId, { $set: update });

      return res.status(200).json({ success: true, message: 'ECF configuration saved' });
    } catch (error: any) {
      console.error('[ECF] PUT /config error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to save ECF configuration' });
    }
  }
);

// ─── DELETE /api/ecf/config/token ────────────────────────────────────────────

router.delete(
  '/config/token',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      await Tenant.findByIdAndUpdate(req.tenantId, {
        $unset: { 'ecfConfig.citrusToken': '' },
      });
      return res.status(200).json({ success: true, message: 'ECF token revoked' });
    } catch (error: any) {
      console.error('[ECF] DELETE /config/token error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to revoke ECF token' });
    }
  }
);

// ─── POST /api/ecf/config/test ───────────────────────────────────────────────

router.post(
  '/config/test',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant not found' });
      }

      if (!tenant.ecfConfig?.citrusToken) {
        return res.status(400).json({ success: false, message: 'No Citrus token configured' });
      }

      await citrusEcfService.getDirectorio(tenant);

      return res.status(200).json({ success: true, message: 'Citrus connection successful' });
    } catch (error: any) {
      if (error instanceof CitrusError) {
        if (error.statusCode === 401) {
          return res.status(401).json({
            success: false,
            message: 'Citrus token is invalid or expired',
          });
        }
        return res.status(502).json({
          success: false,
          message: `Citrus connection failed: ${error.message}`,
        });
      }
      console.error('[ECF] POST /config/test error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to test ECF connection' });
    }
  }
);

// ─── Phase 2: Invoice generation ─────────────────────────────────────────────

/**
 * Map a raw Citrus invoice response to a normalized EcfEstadoECF value.
 * The API returns strings like "Aceptado", "En Proceso", etc.
 */
function normalizeEstadoECF(raw: string, estatus?: string, mensaje?: string): EcfEstadoECF {
  const map: Record<string, EcfEstadoECF> = {
    'Aceptado': 'Aceptado',
    'Aceptado Condicional': 'Aceptado Condicional',
    'Rechazado': 'Rechazado',
    'Error': 'Error',
    'Error Interno': 'Error',
    'En Proceso': 'En Proceso',
    'Emitido Contingencia': 'Emitido Contingencia',
  };

  if (map[raw]) return map[raw];

  const combined = `${raw || ''} ${estatus || ''} ${mensaje || ''}`.toLowerCase();
  if (combined.includes('error interno') || combined.includes('error')) {
    return 'Error';
  }

  return 'Pendiente';
}

/**
 * Persist a Citrus invoice response into the ElectronicInvoice collection.
 */
async function createElectronicInvoiceRecord(params: {
  tenantId: string;
  folioId: string;
  paymentId?: string;
  reservationId?: string;
  tipo: 'E31' | 'E32';
  buyer: EcfBuyerInfo;
  grossTotal: number;
  itbisTotal: number;
  numFacturaInterna?: string;
  lineItems?: IEcfLineItem[];
  tipoPago?: string;
  generatedBy: string;
  generationSource: 'payment_screen' | 'manual';
  citrusResponse: CitrusInvoiceResponse;
  isContingency?: boolean;
}) {
  const estadoECF = params.isContingency
    ? 'Emitido Contingencia' as EcfEstadoECF
    : normalizeEstadoECF(
      params.citrusResponse.EstadoeCF,
      params.citrusResponse.Estatus,
      params.citrusResponse.Mensaje,
    );

  const doc = new ElectronicInvoice({
    tenantId: new mongoose.Types.ObjectId(params.tenantId),
    folioId: new mongoose.Types.ObjectId(params.folioId),
    ...(params.paymentId ? { paymentId: new mongoose.Types.ObjectId(params.paymentId) } : {}),
    ...(params.reservationId ? { reservationId: new mongoose.Types.ObjectId(params.reservationId) } : {}),

    tipo: params.tipo,
    eNCF: params.citrusResponse.eNCF,
    transaccionId: params.citrusResponse.TransaccionId,
    ...(params.citrusResponse.TrackId ? { trackId: params.citrusResponse.TrackId } : {}),
    numeroFacturaInterna: params.numFacturaInterna,

    estadoECF,
    estatus: params.citrusResponse.Estatus ?? '',
    mensaje: params.citrusResponse.Mensaje || undefined,

    totalFactura: params.grossTotal,
    totalImpuestos: params.itbisTotal,
    currency: 'DOP',

    buyerRnc: params.buyer.rnc,
    buyerName: params.buyer.name,
    buyerEmail: params.buyer.email,

    urlCodigoQr: params.citrusResponse.UrlCodigoQr ?? undefined,
    codigoSeguridad: params.citrusResponse.CodigoSeguridad ?? undefined,
    fechaFirmaDigital: params.citrusResponse.FechaFirmaDigital
      ? new Date(params.citrusResponse.FechaFirmaDigital)
      : undefined,
    fechaVencimientoSecuencia: params.citrusResponse.FechaVencimientoSecuencia
      ? new Date(params.citrusResponse.FechaVencimientoSecuencia)
      : undefined,

    ...(params.lineItems ? { lineItems: params.lineItems } : {}),
    ...(params.tipoPago  ? { tipoPago: params.tipoPago }   : {}),

    generatedBy: new mongoose.Types.ObjectId(params.generatedBy),
    generationSource: params.generationSource,
    issuedAt: new Date(),
    retryCount: 0,
  });

  return doc.save();
}

/**
 * Background polling loop for an En Proceso invoice.
 * Runs up to 10 attempts with exponential-ish backoff.
 * Updates the ElectronicInvoice record in-place.
 */
function startStatusPolling(invoiceId: string, tenant: any) {
  // Delays in milliseconds: 5s, 10s, 30s, 60s, 120s, 300s, 300s, 300s, 300s, 300s
  const delays = [5000, 10000, 30000, 60000, 120000, 300000, 300000, 300000, 300000, 300000];
  const TERMINAL_STATES: EcfEstadoECF[] = ['Aceptado', 'Aceptado Condicional', 'Rechazado'];

  let attempt = 0;

  const poll = async () => {
    if (attempt >= delays.length) {
      console.warn(`[ECF Polling] Max attempts reached for invoice ${invoiceId}`);
      return;
    }

    try {
      const invoice = await ElectronicInvoice.findById(invoiceId);
      if (!invoice) {
        console.warn(`[ECF Polling] Invoice ${invoiceId} not found — stopping poll`);
        return;
      }

      if (TERMINAL_STATES.includes(invoice.estadoECF)) {
        console.info(`[ECF Polling] Invoice ${invoiceId} already in terminal state ${invoice.estadoECF}`);
        return;
      }

      let estadoResponse;
      try {
        estadoResponse = await citrusEcfService.consultarEstado(tenant, invoice.eNCF);
      } catch (err: any) {
        console.warn(`[ECF Polling] consultarEstado failed for ${invoiceId}: ${err.message}`);
        attempt++;
        if (attempt < delays.length) setTimeout(poll, delays[attempt]);
        return;
      }

      const newEstado = normalizeEstadoECF(
        estadoResponse.EstadoeCF ?? '',
        estadoResponse.Estatus,
        estadoResponse.Mensaje,
      );

      await ElectronicInvoice.findByIdAndUpdate(invoiceId, {
        $set: {
          estadoECF: newEstado,
          estatus: estadoResponse.Estatus ?? invoice.estatus,
          mensaje: estadoResponse.Mensaje ?? invoice.mensaje,
          lastStatusCheck: new Date(),
          ...(estadoResponse.TrackId ? { trackId: estadoResponse.TrackId } : {}),
        },
        $inc: { retryCount: 1 },
      });

      console.info(`[ECF Polling] Invoice ${invoiceId} updated to ${newEstado} (attempt ${attempt + 1})`);

      // Phase 5.5: Email notification when invoice is rejected
      if (newEstado === 'Rechazado' && tenant?.ownerEmail) {
        try {
          await sendEmail({
            to: tenant.ownerEmail,
            subject: `[Pilloto] e-CF Invoice Rejected — ${invoice.eNCF || invoiceId}`,
            html: `<p>An electronic invoice has been <strong>rejected</strong> by the DGII.</p>
<ul>
<li><strong>e-NCF:</strong> ${invoice.eNCF || 'N/A'}</li>
<li><strong>Type:</strong> ${invoice.tipo}</li>
<li><strong>Amount:</strong> ${invoice.currency} ${invoice.totalFactura?.toFixed(2)}</li>
<li><strong>Reason:</strong> ${estadoResponse.Mensaje ?? 'No reason provided'}</li>
</ul>
<p>Please review and correct the invoice in your Pilloto dashboard.</p>`,
          });
        } catch (emailErr: any) {
          console.warn(`[ECF Polling] Failed to send rejection email for ${invoiceId}: ${emailErr.message}`);
        }
      }

      if (!TERMINAL_STATES.includes(newEstado)) {
        attempt++;
        if (attempt < delays.length) setTimeout(poll, delays[attempt]);
      }
    } catch (err: any) {
      console.error(`[ECF Polling] Unexpected error for ${invoiceId}: ${err.message}`);
      attempt++;
      if (attempt < delays.length) setTimeout(poll, delays[attempt]);
    }
  };

  // Kick off after the first delay
  setTimeout(poll, delays[0]);
}

// ─── POST /api/ecf/invoices ───────────────────────────────────────────────────

router.post(
  '/invoices',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        folioId,
        paymentId,
        tipoECF,
        buyerRnc,
        buyerName,
        buyerEmail,
        buyerRazonSocial,
      } = req.body as {
        folioId: string;
        paymentId?: string;
        tipoECF?: 'E31' | 'E32';
        buyerRnc?: string;
        buyerName?: string;
        buyerEmail?: string;
        buyerRazonSocial?: string;
      };

      if (!folioId || !mongoose.Types.ObjectId.isValid(folioId)) {
        return res.status(400).json({ success: false, message: 'folioId is required and must be a valid ObjectId' });
      }

      const [tenant, folio] = await Promise.all([
        Tenant.findById(req.tenantId),
        Folio.findById(folioId),
      ]);

      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant not found' });
      }
      if (!folio) {
        return res.status(404).json({ success: false, message: 'Folio not found' });
      }
      if (!tenant.ecfConfig?.isActive) {
        return res.status(400).json({ success: false, message: 'e-CF invoicing is not active for this tenant' });
      }
      if (!tenant.ecfConfig?.citrusToken) {
        return res.status(400).json({ success: false, message: 'Citrus API token is not configured' });
      }

      // ── Idempotency check ──────────────────────────────────────────────────
      // If a payment is specified, check if a non-rejected invoice already exists for it.
      if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
        const existing = await ElectronicInvoice.findOne({
          tenantId: req.tenantId,
          paymentId,
          estadoECF: { $in: ['Aceptado', 'Aceptado Condicional', 'En Proceso', 'Emitido Contingencia'] },
        });
        if (existing) {
          return res.status(200).json({
            success: true,
            data: existing,
            message: 'Invoice already exists for this payment',
          });
        }
      }

      // ── Load charges, payments, reservation ───────────────────────────────
      const [charges, payments, reservation] = await Promise.all([
        Charge.find({ folioId }),
        Payment.find({ folioId, status: { $ne: 'reversed' } }),
        Reservation.findById(folio.reservationId).select('reservationCode guestRecord').lean(),
      ]);

      if (charges.length === 0) {
        return res.status(400).json({ success: false, message: 'No charges on this folio' });
      }

      // ── Determine tipo based on RNC ────────────────────────────────────────
      const resolvedRnc = buyerRnc?.trim() || undefined;
      const tipo: 'E31' | 'E32' = tipoECF ?? (resolvedRnc ? 'E31' : 'E32');

      const buyer: EcfBuyerInfo = {
        rnc: resolvedRnc,
        name: buyerName?.trim() || undefined,
        email: buyerEmail?.trim().toLowerCase() || undefined,
        razonSocial: buyerRazonSocial?.trim() || undefined,
      };

      // ── Build payload ──────────────────────────────────────────────────────
      let payload;
      let grossTotal = 0;
      let itbisTotal = 0;
      let numFacturaInterna: string | undefined;
      let invoiceLineItems: IEcfLineItem[] | undefined;
      let invoiceTipoPago: string | undefined;

      try {
        if (tipo === 'E31') {
          const mapped = mapToFacturaCreditoFiscal(folio, charges, payments, buyer, tenant, reservation as any);
          payload = mapped;
          grossTotal = mapped.totalFactura;
          itbisTotal = mapped.totalImpuestos;
          numFacturaInterna = mapped.NumeroFacturaInterna;
          invoiceTipoPago = mapped.Encabezado.TipoPago;
          invoiceLineItems = mapped.DetalleBienesOServicios.map(item => {
            const itbisAmount = Math.round(item.PrecioUnitarioItem * (item.TasaITBIS ?? 0) / 100 * 100) / 100;
            return {
              description: item.NombreItem,
              qty: item.CantidadItem,
              netPrice: item.PrecioUnitarioItem,
              itbisRate: item.TasaITBIS ?? 0,
              itbisAmount,
              grossAmount: Math.round((item.PrecioUnitarioItem + itbisAmount) * 100) / 100,
            };
          });
        } else {
          const mapped = mapToFacturaConsumo(folio, charges, payments, buyer, tenant, reservation as any);
          payload = mapped;
          grossTotal = mapped.totalFactura;
          itbisTotal = mapped.totalImpuestos;
          numFacturaInterna = mapped.NumeroFacturaInterna;
          invoiceTipoPago = mapped.Encabezado.TipoPago;
          invoiceLineItems = mapped.DetalleBienesOServicios.map(item => {
            const itbisAmount = Math.round(item.PrecioUnitarioItem * (item.TasaITBIS ?? 0) / 100 * 100) / 100;
            return {
              description: item.NombreItem,
              qty: item.CantidadItem,
              netPrice: item.PrecioUnitarioItem,
              itbisRate: item.TasaITBIS ?? 0,
              itbisAmount,
              grossAmount: Math.round((item.PrecioUnitarioItem + itbisAmount) * 100) / 100,
            };
          });
        }
      } catch (err: any) {
        if (err instanceof EcfMapperError) {
          return res.status(400).json({ success: false, message: err.message });
        }
        throw err;
      }

      // ── Call Citrus API ────────────────────────────────────────────────────
      let citrusResponse: CitrusInvoiceResponse;
      let isContingency = false;

      try {
        if (tipo === 'E31') {
          citrusResponse = await citrusEcfService.generateFactura(tenant, payload);
        } else {
          citrusResponse = await citrusEcfService.generateFacturaConsumo(tenant, payload);
        }
      } catch (err: any) {
        // Network error → contingency mode
        if (err instanceof CitrusError && err.statusCode === 503) {
          console.warn(`[ECF] Citrus unreachable — issuing contingency invoice | tenant=${req.tenantId}`);
          isContingency = true;
          // Create a stub response for contingency
          citrusResponse = {
            TransaccionId: 0,
            eNCF: `CONTINGENCIA-${Date.now()}`,
            FechaVencimientoSecuencia: null,
            TrackId: `contingency-${Date.now()}`,
            Estatus: 'Contingencia',
            EstadoeCF: 'Emitido Contingencia',
            Mensaje: 'Issued in contingency mode — will be auto-submitted within 72h',
            UrlCodigoQr: null,
            CodigoSeguridad: null,
            SecuenciaUtilizada: false,
            FechaFirmaDigital: null,
            Url: null,
          };
        } else if (err instanceof CitrusError) {
          if (err.statusCode === 401) {
            return res.status(401).json({
              success: false,
              message: 'Citrus API token is invalid or expired — please update the token in settings',
            });
          }
          if (err.statusCode === 400) {
            return res.status(400).json({
              success: false,
              message: err.message,
              detail: err.citrusResponse,
            });
          }
          return res.status(502).json({ success: false, message: `Citrus error: ${err.message}` });
        } else {
          throw err;
        }
      }

      // ── Persist invoice ────────────────────────────────────────────────────
      const invoiceDoc = await createElectronicInvoiceRecord({
        tenantId: String(req.tenantId),
        folioId,
        paymentId: paymentId && mongoose.Types.ObjectId.isValid(paymentId) ? paymentId : undefined,
        reservationId: folio.reservationId ? String(folio.reservationId) : undefined,
        tipo,
        buyer,
        grossTotal,
        itbisTotal,
        numFacturaInterna,
        lineItems: invoiceLineItems,
        tipoPago: invoiceTipoPago,
        generatedBy: String(req.user!._id),
        generationSource: paymentId ? 'payment_screen' : 'manual',
        citrusResponse,
        isContingency,
      });

      // ── Start background polling for En Proceso invoices ──────────────────
      if (invoiceDoc.estadoECF === 'En Proceso') {
        startStatusPolling(String(invoiceDoc._id), tenant);
      }

      return res.status(201).json({ success: true, data: invoiceDoc });
    } catch (error: any) {
      console.error('[ECF] POST /invoices error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to generate invoice' });
    }
  },
);

// ─── GET /api/ecf/invoices ────────────────────────────────────────────────────

router.get(
  '/invoices',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        folioId,
        paymentId,
        estadoECF,
        tipo,
        fechaInicio,
        fechaFin,
        eNCF,
        buyerRnc,
        page = '1',
        limit = '50',
      } = req.query as Record<string, string | undefined>;

      const filter: Record<string, unknown> = { tenantId: req.tenantId };

      if (folioId && mongoose.Types.ObjectId.isValid(folioId)) {
        filter.folioId = new mongoose.Types.ObjectId(folioId);
      }
      if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
        filter.paymentId = new mongoose.Types.ObjectId(paymentId);
      }
      if (estadoECF) filter.estadoECF = estadoECF;
      if (tipo) filter.tipo = tipo;
      if (eNCF) filter.eNCF = { $regex: eNCF, $options: 'i' };
      if (buyerRnc) filter.buyerRnc = { $regex: buyerRnc, $options: 'i' };

      if (fechaInicio || fechaFin) {
        const dateFilter: Record<string, Date> = {};
        if (fechaInicio) dateFilter.$gte = new Date(fechaInicio);
        if (fechaFin) dateFilter.$lte = new Date(fechaFin);
        filter.issuedAt = dateFilter;
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
      const skip = (pageNum - 1) * limitNum;

      const [invoices, total] = await Promise.all([
        ElectronicInvoice.find(filter)
          .sort({ issuedAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        ElectronicInvoice.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        data: invoices,
        meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
      });
    } catch (error: any) {
      console.error('[ECF] GET /invoices error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve invoices' });
    }
  },
);

// ─── GET /api/ecf/invoices/pending ───────────────────────────────────────────
// Must be declared BEFORE /invoices/:id to avoid route shadowing.

router.get(
  '/invoices/pending',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const pending = await ElectronicInvoice.find({
        tenantId: req.tenantId,
        estadoECF: { $in: ['En Proceso', 'Emitido Contingencia'] },
      }).sort({ issuedAt: -1 }).lean();

      return res.status(200).json({ success: true, data: pending });
    } catch (error: any) {
      console.error('[ECF] GET /invoices/pending error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve pending invoices' });
    }
  },
);

// ─── GET /api/ecf/invoices/:id ────────────────────────────────────────────────

router.get(
  '/invoices/:id',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
      }

      const invoice = await ElectronicInvoice.findOne({
        _id: req.params.id,
        tenantId: req.tenantId,
      }).lean();

      if (!invoice) {
        return res.status(404).json({ success: false, message: 'Invoice not found' });
      }

      return res.status(200).json({ success: true, data: invoice });
    } catch (error: any) {
      console.error('[ECF] GET /invoices/:id error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve invoice' });
    }
  },
);

// ─── POST /api/ecf/invoices/:id/refresh-status ───────────────────────────────

router.post(
  '/invoices/:id/refresh-status',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
      }

      const invoice = await ElectronicInvoice.findOne({
        _id: req.params.id,
        tenantId: req.tenantId,
      });

      if (!invoice) {
        return res.status(404).json({ success: false, message: 'Invoice not found' });
      }

      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant not found' });
      }
      if (!tenant.ecfConfig?.citrusToken) {
        return res.status(400).json({ success: false, message: 'Citrus token not configured' });
      }

      let estadoResponse;
      try {
        estadoResponse = await citrusEcfService.consultarEstado(tenant, invoice.eNCF);
      } catch (err: any) {
        if (err instanceof CitrusError) {
          return res.status(502).json({ success: false, message: `Citrus error: ${err.message}` });
        }
        throw err;
      }

      const newEstado = normalizeEstadoECF(
        estadoResponse.EstadoeCF ?? '',
        estadoResponse.Estatus,
        estadoResponse.Mensaje,
      );

      const updated = await ElectronicInvoice.findByIdAndUpdate(
        invoice._id,
        {
          $set: {
            estadoECF: newEstado,
            estatus: estadoResponse.Estatus ?? invoice.estatus,
            mensaje: estadoResponse.Mensaje ?? invoice.mensaje,
            lastStatusCheck: new Date(),
          },
          $inc: { retryCount: 1 },
        },
        { new: true },
      );

      return res.status(200).json({ success: true, data: updated });
    } catch (error: any) {
      console.error('[ECF] POST /invoices/:id/refresh-status error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to refresh invoice status' });
    }
  },
);

// ─── POST /api/ecf/invoices/:id/send-email ───────────────────────────────────

router.post(
  '/invoices/:id/send-email',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
      }

      const requestedEmail = resolveRecipientEmail(req.body?.email);

      const invoice = await ElectronicInvoice.findOne({
        _id: req.params.id,
        tenantId: req.tenantId,
      }).lean();

      if (!invoice) {
        return res.status(404).json({ success: false, message: 'Invoice not found' });
      }

      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant?.ecfConfig) {
        return res.status(400).json({ success: false, message: 'ECF not configured for this tenant' });
      }

      const recipientEmail = requestedEmail || resolveRecipientEmail(invoice.buyerEmail);
      if (!recipientEmail) {
        return res.status(400).json({
          success: false,
          message: 'Recipient email not available. Provide an email address or regenerate the invoice with a buyer email.',
        });
      }

      const isSimulacion = tenant.ecfConfig.ambiente === 'Simulacion';
      const filename = `${invoice.eNCF || invoice._id}.pdf`;

      // Mirror the /pdf endpoint: skip Citrus in Simulación and fall back to local generator.
      // In other environments, try Citrus first and fall back only on EcfPdfUnavailableError.
      let attachment: { filename: string; content: Buffer; contentType: string } | null = null;

      if (!isSimulacion && tenant.ecfConfig.citrusToken) {
        try {
          attachment = await buildEcfPdfAttachment(tenant, invoice);
        } catch (err: any) {
          if (err instanceof CitrusError) {
            return res.status(502).json({ success: false, message: `Citrus error: ${err.message}` });
          }
          if (!(err instanceof EcfPdfUnavailableError)) {
            throw err;
          }
          // EcfPdfUnavailableError → fall through to local fallback below
          console.info(`[ECF] Citrus PDF unavailable for ${invoice.eNCF} — using fallback generator for email`);
        }
      }

      if (!attachment) {
        const tenantInfo = {
          razonSocial:     tenant.ecfConfig.razonSocial,
          rnc:             tenant.ecfConfig.rnc,
          phone:           tenant.ecfConfig.phone,
          nombreComercial: tenant.ecfConfig.nombreComercial,
        };
        const pdfBuffer = await generateFallbackPdf(invoice, tenantInfo);
        attachment = { filename, content: pdfBuffer, contentType: 'application/pdf' };
      }

      const subject = `e-CF ${invoice.eNCF || ''}`.trim();
      const html = `<p>Hola,</p><p>Adjuntamos su comprobante e-CF <strong>${invoice.eNCF}</strong>.</p><p>Si tiene alguna pregunta, responda a este correo.</p>`;
      const text = `Adjuntamos su comprobante e-CF ${invoice.eNCF}.`;

      try {
        await sendEmail({
          to: recipientEmail,
          subject,
          html,
          text,
          attachments: [attachment],
          _logMeta: { emailType: 'ecf_invoice', referenceId: String(invoice._id) },
        });
      } catch (err: any) {
        return res.status(502).json({ success: false, message: `Failed to send email: ${err.message}` });
      }

      return res.status(200).json({ success: true, message: `Invoice emailed to ${recipientEmail}` });
    } catch (error: any) {
      console.error('[ECF] POST /invoices/:id/send-email error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to send invoice email' });
    }
  },
);

// ─── GET /api/ecf/invoices/:id/xml ───────────────────────────────────────────

router.get(
  '/invoices/:id/xml',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
      }

      const invoice = await ElectronicInvoice.findOne({
        _id: req.params.id,
        tenantId: req.tenantId,
      }).lean();

      if (!invoice) {
        return res.status(404).json({ success: false, message: 'Invoice not found' });
      }

      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant?.ecfConfig?.citrusToken) {
        return res.status(400).json({ success: false, message: 'Citrus token not configured' });
      }

      let xml: string;
      try {
        xml = await citrusEcfService.getXML(tenant, invoice.transaccionId);
      } catch (err: any) {
        if (err instanceof CitrusError) {
          return res.status(502).json({ success: false, message: `Citrus error: ${err.message}` });
        }
        throw err;
      }

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${invoice.eNCF}.xml"`);
      return res.send(xml);
    } catch (error: any) {
      console.error('[ECF] GET /invoices/:id/xml error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to download XML' });
    }
  },
);

// ─── GET /api/ecf/invoices/:id/pdf ───────────────────────────────────────────

router.get(
  '/invoices/:id/pdf',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
      }

      const invoice = await ElectronicInvoice.findOne({
        _id: req.params.id,
        tenantId: req.tenantId,
      }).lean();

      if (!invoice) {
        return res.status(404).json({ success: false, message: 'Invoice not found' });
      }

      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant?.ecfConfig) {
        return res.status(400).json({ success: false, message: 'ECF not configured for this tenant' });
      }

      const isSimulacion = tenant.ecfConfig.ambiente === 'Simulacion';
      const filename = `${invoice.eNCF || invoice._id}.pdf`;

      // In Simulación, Citrus never produces a PDF — skip straight to fallback.
      // In other environments, try Citrus first and fall back only on unavailability.
      let attachment: { filename: string; content: Buffer; contentType: string } | null = null;

      if (!isSimulacion && tenant.ecfConfig.citrusToken) {
        try {
          attachment = await buildEcfPdfAttachment(tenant, invoice);
        } catch (err: any) {
          if (err instanceof CitrusError) {
            return res.status(502).json({ success: false, message: `Citrus error: ${err.message}` });
          }
          if (!(err instanceof EcfPdfUnavailableError)) {
            throw err;
          }
          // EcfPdfUnavailableError → fall through to local fallback below
          console.info(`[ECF] Citrus PDF unavailable for ${invoice.eNCF} — using fallback generator`);
        }
      }

      if (!attachment) {
        // Generate a local PDF fallback
        const tenantInfo = {
          razonSocial:    tenant.ecfConfig.razonSocial,
          rnc:            tenant.ecfConfig.rnc,
          phone:          tenant.ecfConfig.phone,
          nombreComercial: tenant.ecfConfig.nombreComercial,
        };
        const pdfBuffer = await generateFallbackPdf(invoice, tenantInfo);
        attachment = { filename, content: pdfBuffer, contentType: 'application/pdf' };
      }

      res.setHeader('Content-Type', attachment.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
      res.setHeader('Content-Length', String(attachment.content.length));
      return res.send(attachment.content);
    } catch (error: any) {
      console.error('[ECF] GET /invoices/:id/pdf error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve PDF' });
    }
  },
);

// ─── Phase 3: Credit & Debit Notes ───────────────────────────────────────────

// ─── POST /api/ecf/credit-notes ──────────────────────────────────────────────

router.post(
  '/credit-notes',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        originalEcfId,
        codigoModificacion,
        razonModificacion,
        items,
        totalAmount,
      } = req.body as {
        originalEcfId: string;
        codigoModificacion: string;
        razonModificacion: string;
        items?: Array<{ description: string; amount: number }>;
        totalAmount?: number;
      };

      // ── Input validation ──────────────────────────────────────────────────
      if (!originalEcfId || !mongoose.Types.ObjectId.isValid(originalEcfId)) {
        return res.status(400).json({ success: false, message: 'originalEcfId is required and must be a valid ObjectId' });
      }
      const VALID_CODIGO_MOD = ['1', '2', '3', '4', '5'];
      if (!codigoModificacion || !VALID_CODIGO_MOD.includes(String(codigoModificacion))) {
        return res.status(400).json({
          success: false,
          message: `codigoModificacion must be one of: ${VALID_CODIGO_MOD.join(', ')}`,
        });
      }
      if (!razonModificacion?.trim()) {
        return res.status(400).json({ success: false, message: 'razonModificacion is required' });
      }

      // ── Load original invoice ─────────────────────────────────────────────
      const originalInvoice = await ElectronicInvoice.findOne({
        _id: originalEcfId,
        tenantId: req.tenantId,
      });

      if (!originalInvoice) {
        return res.status(404).json({ success: false, message: 'Original invoice not found' });
      }
      if (originalInvoice.estadoECF !== 'Aceptado' && originalInvoice.estadoECF !== 'Aceptado Condicional') {
        return res.status(400).json({
          success: false,
          message: `Cannot issue a credit note for an invoice with status "${originalInvoice.estadoECF}". Invoice must be Aceptado.`,
        });
      }

      // ── Build items list ──────────────────────────────────────────────────
      // If explicit items provided, use them. Otherwise build a single line from totalAmount.
      let resolvedItems: Array<{ description: string; amount: number }>;
      if (items && Array.isArray(items) && items.length > 0) {
        resolvedItems = items.map(i => ({
          description: String(i.description || '').trim() || 'Nota de crédito',
          amount: Number(i.amount),
        }));
      } else if (totalAmount && totalAmount > 0) {
        resolvedItems = [{
          description: razonModificacion.trim().slice(0, 200),
          amount: Number(totalAmount),
        }];
      } else {
        return res.status(400).json({ success: false, message: 'Either items or totalAmount must be provided' });
      }

      // Validate amounts
      for (const item of resolvedItems) {
        if (isNaN(item.amount) || item.amount <= 0) {
          return res.status(400).json({ success: false, message: 'All item amounts must be positive numbers' });
        }
      }

      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant not found' });
      }
      if (!tenant.ecfConfig?.isActive) {
        return res.status(400).json({ success: false, message: 'e-CF invoicing is not active for this tenant' });
      }
      if (!tenant.ecfConfig?.citrusToken) {
        return res.status(400).json({ success: false, message: 'Citrus API token is not configured' });
      }

      // ── Build and send payload ────────────────────────────────────────────
      let payload;
      let grossTotal: number;
      let itbisTotal: number;

      try {
        const mapped = mapToNotaCredito(
          {
            eNCF: originalInvoice.eNCF,
            tipo: originalInvoice.tipo,
            buyerRnc: originalInvoice.buyerRnc,
            buyerName: originalInvoice.buyerName,
            buyerEmail: originalInvoice.buyerEmail,
            issuedAt: originalInvoice.issuedAt,
          },
          codigoModificacion as import('../utils/ecfMapper').CodigoModificacion,
          razonModificacion.trim(),
          resolvedItems,
          tenant,
        );
        payload = mapped;
        grossTotal = mapped.totalFactura;
        itbisTotal = mapped.totalImpuestos;
      } catch (err: any) {
        if (err instanceof EcfMapperError) {
          return res.status(400).json({ success: false, message: err.message });
        }
        throw err;
      }

      let citrusResponse: CitrusInvoiceResponse;
      try {
        citrusResponse = await citrusEcfService.generateNotaCredito(tenant, payload);
      } catch (err: any) {
        if (err instanceof CitrusError) {
          if (err.statusCode === 401) {
            return res.status(401).json({
              success: false,
              message: 'Citrus API token is invalid or expired — please update the token in settings',
            });
          }
          if (err.statusCode === 400) {
            return res.status(400).json({ success: false, message: err.message, detail: err.citrusResponse });
          }
          return res.status(502).json({ success: false, message: `Citrus error: ${err.message}` });
        }
        throw err;
      }

      // ── Persist credit note ───────────────────────────────────────────────
      const estadoECF = normalizeEstadoECF(
        citrusResponse.EstadoeCF,
        citrusResponse.Estatus,
        citrusResponse.Mensaje,
      );
      const creditNoteDoc = new ElectronicInvoice({
        tenantId: new mongoose.Types.ObjectId(String(req.tenantId)),
        folioId: originalInvoice.folioId,
        reservationId: originalInvoice.reservationId,

        tipo: 'E34',
        eNCF: citrusResponse.eNCF,
        transaccionId: citrusResponse.TransaccionId,
        trackId: citrusResponse.TrackId,

        estadoECF,
        estatus: citrusResponse.Estatus ?? '',
        mensaje: citrusResponse.Mensaje || undefined,

        totalFactura: grossTotal,
        totalImpuestos: itbisTotal,
        currency: 'DOP',

        buyerRnc: originalInvoice.buyerRnc,
        buyerName: originalInvoice.buyerName,
        buyerEmail: originalInvoice.buyerEmail,

        originalENCF: originalInvoice.eNCF,
        codigoModificacion: String(codigoModificacion),

        urlCodigoQr: citrusResponse.UrlCodigoQr ?? undefined,
        codigoSeguridad: citrusResponse.CodigoSeguridad ?? undefined,
        fechaFirmaDigital: citrusResponse.FechaFirmaDigital ? new Date(citrusResponse.FechaFirmaDigital) : undefined,
        fechaVencimientoSecuencia: citrusResponse.FechaVencimientoSecuencia ? new Date(citrusResponse.FechaVencimientoSecuencia) : undefined,

        generatedBy: new mongoose.Types.ObjectId(String(req.user!._id)),
        generationSource: 'credit_note',
        issuedAt: new Date(),
        retryCount: 0,
      });

      await creditNoteDoc.save();

      if (creditNoteDoc.estadoECF === 'En Proceso') {
        startStatusPolling(String(creditNoteDoc._id), tenant);
      }

      await postFolioCreditNoteEntry(tenant, creditNoteDoc, req.user!._id as any);

      return res.status(201).json({ success: true, data: creditNoteDoc });
    } catch (error: any) {
      console.error('[ECF] POST /credit-notes error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to generate credit note' });
    }
  },
);

// ─── POST /api/ecf/debit-notes ───────────────────────────────────────────────

router.post(
  '/debit-notes',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        originalEcfId,
        reason,
        items,
        totalAmount,
      } = req.body as {
        originalEcfId: string;
        reason: string;
        items?: Array<{ description: string; amount: number }>;
        totalAmount?: number;
      };

      // ── Input validation ──────────────────────────────────────────────────
      if (!originalEcfId || !mongoose.Types.ObjectId.isValid(originalEcfId)) {
        return res.status(400).json({ success: false, message: 'originalEcfId is required and must be a valid ObjectId' });
      }
      if (!reason?.trim()) {
        return res.status(400).json({ success: false, message: 'reason is required' });
      }

      // ── Load original invoice ─────────────────────────────────────────────
      const originalInvoice = await ElectronicInvoice.findOne({
        _id: originalEcfId,
        tenantId: req.tenantId,
      });

      if (!originalInvoice) {
        return res.status(404).json({ success: false, message: 'Original invoice not found' });
      }
      if (originalInvoice.estadoECF !== 'Aceptado' && originalInvoice.estadoECF !== 'Aceptado Condicional') {
        return res.status(400).json({
          success: false,
          message: `Cannot issue a debit note for an invoice with status "${originalInvoice.estadoECF}". Invoice must be Aceptado.`,
        });
      }

      // ── Build items list ──────────────────────────────────────────────────
      let resolvedItems: Array<{ description: string; amount: number }>;
      if (items && Array.isArray(items) && items.length > 0) {
        resolvedItems = items.map(i => ({
          description: String(i.description || '').trim() || 'Nota de débito',
          amount: Number(i.amount),
        }));
      } else if (totalAmount && totalAmount > 0) {
        resolvedItems = [{
          description: reason.trim().slice(0, 200),
          amount: Number(totalAmount),
        }];
      } else {
        return res.status(400).json({ success: false, message: 'Either items or totalAmount must be provided' });
      }

      for (const item of resolvedItems) {
        if (isNaN(item.amount) || item.amount <= 0) {
          return res.status(400).json({ success: false, message: 'All item amounts must be positive numbers' });
        }
      }

      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant not found' });
      }
      if (!tenant.ecfConfig?.isActive) {
        return res.status(400).json({ success: false, message: 'e-CF invoicing is not active for this tenant' });
      }
      if (!tenant.ecfConfig?.citrusToken) {
        return res.status(400).json({ success: false, message: 'Citrus API token is not configured' });
      }

      // ── Build and send payload ────────────────────────────────────────────
      let payload;
      let grossTotal: number;
      let itbisTotal: number;

      try {
        const mapped = mapToNotaDebito(
          {
            eNCF: originalInvoice.eNCF,
            tipo: originalInvoice.tipo,
            buyerRnc: originalInvoice.buyerRnc,
            buyerName: originalInvoice.buyerName,
            buyerEmail: originalInvoice.buyerEmail,
            issuedAt: originalInvoice.issuedAt,
          },
          reason.trim(),
          resolvedItems,
          tenant,
        );
        payload = mapped;
        grossTotal = mapped.totalFactura;
        itbisTotal = mapped.totalImpuestos;
      } catch (err: any) {
        if (err instanceof EcfMapperError) {
          return res.status(400).json({ success: false, message: err.message });
        }
        throw err;
      }

      let citrusResponse: CitrusInvoiceResponse;
      try {
        citrusResponse = await citrusEcfService.generateNotaDebito(tenant, payload);
      } catch (err: any) {
        if (err instanceof CitrusError) {
          if (err.statusCode === 401) {
            return res.status(401).json({
              success: false,
              message: 'Citrus API token is invalid or expired — please update the token in settings',
            });
          }
          if (err.statusCode === 400) {
            return res.status(400).json({ success: false, message: err.message, detail: err.citrusResponse });
          }
          return res.status(502).json({ success: false, message: `Citrus error: ${err.message}` });
        }
        throw err;
      }

      // ── Persist debit note ────────────────────────────────────────────────
      const estadoECF = normalizeEstadoECF(
        citrusResponse.EstadoeCF,
        citrusResponse.Estatus,
        citrusResponse.Mensaje,
      );
      const debitNoteDoc = new ElectronicInvoice({
        tenantId: new mongoose.Types.ObjectId(String(req.tenantId)),
        folioId: originalInvoice.folioId,
        reservationId: originalInvoice.reservationId,

        tipo: 'E33',
        eNCF: citrusResponse.eNCF,
        transaccionId: citrusResponse.TransaccionId,
        trackId: citrusResponse.TrackId,

        estadoECF,
        estatus: citrusResponse.Estatus ?? '',
        mensaje: citrusResponse.Mensaje || undefined,

        totalFactura: grossTotal,
        totalImpuestos: itbisTotal,
        currency: 'DOP',

        buyerRnc: originalInvoice.buyerRnc,
        buyerName: originalInvoice.buyerName,
        buyerEmail: originalInvoice.buyerEmail,

        originalENCF: originalInvoice.eNCF,
        codigoModificacion: '1',

        urlCodigoQr: citrusResponse.UrlCodigoQr ?? undefined,
        codigoSeguridad: citrusResponse.CodigoSeguridad ?? undefined,
        fechaFirmaDigital: citrusResponse.FechaFirmaDigital ? new Date(citrusResponse.FechaFirmaDigital) : undefined,
        fechaVencimientoSecuencia: citrusResponse.FechaVencimientoSecuencia ? new Date(citrusResponse.FechaVencimientoSecuencia) : undefined,

        generatedBy: new mongoose.Types.ObjectId(String(req.user!._id)),
        generationSource: 'debit_note',
        issuedAt: new Date(),
        retryCount: 0,
      });

      await debitNoteDoc.save();

      if (debitNoteDoc.estadoECF === 'En Proceso') {
        startStatusPolling(String(debitNoteDoc._id), tenant);
      }

      await postFolioDebitNoteEntry(tenant, debitNoteDoc, req.user!._id as any);

      return res.status(201).json({ success: true, data: debitNoteDoc });
    } catch (error: any) {
      console.error('[ECF] POST /debit-notes error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to generate debit note' });
    }
  },
);

// ─── Phase 4: Reporting & Operational Tools ───────────────────────────────────

// ─── GET /api/ecf/reports/monthly-tax ────────────────────────────────────────
// Monthly tax report: totals grouped by year-month and tipo.
// Only counts Aceptado + Aceptado Condicional invoices.
// Query params: year (optional), limit (default 24 months)

router.get(
  '/reports/monthly-tax',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { year, limit = '24' } = req.query as Record<string, string | undefined>;
      const limitNum = Math.min(60, Math.max(1, parseInt(limit, 10) || 24));

      const matchStage: Record<string, unknown> = {
        tenantId: new mongoose.Types.ObjectId(String(req.tenantId)),
        estadoECF: { $in: ['Aceptado', 'Aceptado Condicional'] },
      };

      if (year) {
        const y = parseInt(year, 10);
        if (!isNaN(y)) {
          matchStage.issuedAt = {
            $gte: new Date(`${y}-01-01T00:00:00.000Z`),
            $lt: new Date(`${y + 1}-01-01T00:00:00.000Z`),
          };
        }
      }

      const pipeline: object[] = [
        { $match: matchStage },
        {
          $group: {
            _id: {
              year: { $year: '$issuedAt' },
              month: { $month: '$issuedAt' },
              tipo: '$tipo',
            },
            totalFactura: { $sum: '$totalFactura' },
            totalImpuestos: { $sum: '$totalImpuestos' },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: { year: '$_id.year', month: '$_id.month' },
            byTipo: {
              $push: {
                tipo: '$_id.tipo',
                totalFactura: '$totalFactura',
                totalImpuestos: '$totalImpuestos',
                count: '$count',
              },
            },
            totalFactura: { $sum: '$totalFactura' },
            totalImpuestos: { $sum: '$totalImpuestos' },
            totalInvoices: { $sum: '$count' },
          },
        },
        { $sort: { '_id.year': -1, '_id.month': -1 } },
        { $limit: limitNum },
        {
          $project: {
            _id: 0,
            year: '$_id.year',
            month: '$_id.month',
            byTipo: 1,
            totalFactura: 1,
            totalImpuestos: 1,
            totalInvoices: 1,
          },
        },
      ];

      const results = await ElectronicInvoice.aggregate(pipeline as any[]);
      return res.status(200).json({ success: true, data: results });
    } catch (error: any) {
      console.error('[ECF] GET /reports/monthly-tax error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to generate monthly tax report' });
    }
  },
);

// ─── GET /api/ecf/sequences ───────────────────────────────────────────────────
// Derives sequence status per invoice type from stored invoices.
// Returns per-tipo: latest eNCF, latest expiry date, count this month.

router.get(
  '/sequences',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const pipeline: object[] = [
        {
          $match: {
            tenantId: new mongoose.Types.ObjectId(String(req.tenantId)),
          },
        },
        {
          $group: {
            _id: '$tipo',
            latestENCF: { $last: '$eNCF' },
            latestIssuedAt: { $max: '$issuedAt' },
            latestExpiry: { $max: '$fechaVencimientoSecuencia' },
            totalIssued: { $sum: 1 },
            issuedThisMonth: {
              $sum: {
                $cond: [{ $gte: ['$issuedAt', monthStart] }, 1, 0],
              },
            },
            lastEstadoECF: { $last: '$estadoECF' },
          },
        },
        {
          $project: {
            _id: 0,
            tipo: '$_id',
            latestENCF: 1,
            latestIssuedAt: 1,
            latestExpiry: 1,
            totalIssued: 1,
            issuedThisMonth: 1,
            lastEstadoECF: 1,
          },
        },
        { $sort: { tipo: 1 } },
      ];

      const results = await ElectronicInvoice.aggregate(pipeline as any[]);
      return res.status(200).json({ success: true, data: results });
    } catch (error: any) {
      console.error('[ECF] GET /sequences error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to retrieve sequence information' });
    }
  },
);

// ─── POST /api/ecf/sequences/annul ───────────────────────────────────────────
// Proxy to Citrus AnulacionSecuencia.
// Body: { tipo: string; secuencias: string[] }

router.post(
  '/sequences/annul',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tipo, secuencias } = req.body as {
        tipo?: string;
        secuencias?: string[];
      };

      if (!tipo || !Array.isArray(secuencias) || secuencias.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'tipo and secuencias array are required',
        });
      }

      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant not found' });
      }
      if (!tenant.ecfConfig?.isActive) {
        return res.status(400).json({ success: false, message: 'e-CF invoicing is not active for this tenant' });
      }
      if (!tenant.ecfConfig?.citrusToken) {
        return res.status(400).json({ success: false, message: 'Citrus API token is not configured' });
      }

      try {
        await citrusEcfService.anularSecuencias(tenant, { TipoeCF: tipo, Secuencias: secuencias });
      } catch (err: any) {
        if (err instanceof CitrusError) {
          if (err.statusCode === 401) {
            return res.status(401).json({
              success: false,
              message: 'Citrus API token is invalid or expired',
            });
          }
          return res.status(502).json({ success: false, message: `Citrus error: ${err.message}` });
        }
        throw err;
      }

      return res.status(200).json({ success: true, message: 'Sequence annulment submitted to Citrus' });
    } catch (error: any) {
      console.error('[ECF] POST /sequences/annul error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to submit sequence annulment' });
    }
  },
);

// ─── POST /api/ecf/invoices/bulk-refresh ─────────────────────────────────────
// Re-polls Citrus for all invoices currently in En Proceso or Emitido Contingencia.
// Must be declared BEFORE /invoices/:id routes to avoid shadowing.

router.post(
  '/invoices/bulk-refresh',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const tenant = await Tenant.findById(req.tenantId);
      if (!tenant?.ecfConfig?.citrusToken) {
        return res.status(400).json({ success: false, message: 'Citrus token not configured' });
      }

      const pending = await ElectronicInvoice.find({
        tenantId: req.tenantId,
        estadoECF: { $in: ['En Proceso', 'Emitido Contingencia'] },
      }).lean();

      let refreshed = 0;
      let failed = 0;

      for (const invoice of pending) {
        try {
          const estadoResponse = await citrusEcfService.consultarEstado(tenant, invoice.eNCF);
          const newEstado = normalizeEstadoECF(
            estadoResponse.EstadoeCF ?? '',
            estadoResponse.Estatus,
            estadoResponse.Mensaje,
          );
          await ElectronicInvoice.findByIdAndUpdate(invoice._id, {
            $set: {
              estadoECF: newEstado,
              estatus: estadoResponse.Estatus ?? invoice.estatus,
              mensaje: estadoResponse.Mensaje ?? invoice.mensaje,
              lastStatusCheck: new Date(),
            },
            $inc: { retryCount: 1 },
          });
          refreshed++;
        } catch {
          failed++;
        }
      }

      return res.status(200).json({
        success: true,
        message: `Bulk refresh complete: ${refreshed} updated, ${failed} failed`,
        data: { total: pending.length, refreshed, failed },
      });
    } catch (error: any) {
      console.error('[ECF] POST /invoices/bulk-refresh error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to bulk refresh invoices' });
    }
  },
);

// =============================================================================
// Phase 5.1 — Received Invoices & Commercial Approval
// =============================================================================

/**
 * GET /api/ecf/received-invoices
 * Proxy to Citrus getComprobantesRecibidos().
 * Accepts query params forwarded to the Citrus API (e.g. fechaDesde, fechaHasta, rnc).
 */
router.get(
  '/received-invoices',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ success: false, message: 'Missing tenant context' });

    try {
      const tenant = await Tenant.findById(tenantId).lean();
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
      if (!tenant.ecfConfig?.isActive) {
        return res.status(400).json({ success: false, message: 'e-CF not configured for this tenant' });
      }

      const rawParams: Record<string, string> = {};
      if (req.query.fechaDesde) rawParams.fechaDesde = req.query.fechaDesde as string;
      if (req.query.fechaHasta) rawParams.fechaHasta = req.query.fechaHasta as string;
      if (req.query.rnc) rawParams.rnc = req.query.rnc as string;
      if (req.query.page) rawParams.page = req.query.page as string;
      if (req.query.limit) rawParams.limit = req.query.limit as string;

      const data = await citrusEcfService.getComprobantesRecibidos(tenant, rawParams);
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      const status = error instanceof CitrusError ? error.statusCode : 500;
      return res.status(status).json({ success: false, message: error.message ?? 'Failed to fetch received invoices' });
    }
  },
);

/**
 * POST /api/ecf/commercial-approval
 * Submit commercial approval (Aprobación Comercial) to Citrus.
 * Body: { trackId: string, aprobado: boolean, motivoRechazo?: string }
 */
router.post(
  '/commercial-approval',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ success: false, message: 'Missing tenant context' });

    const { trackId, aprobado, motivoRechazo } = req.body as {
      trackId?: string;
      aprobado?: boolean;
      motivoRechazo?: string;
    };

    if (!trackId || typeof aprobado !== 'boolean') {
      return res.status(400).json({ success: false, message: 'trackId and aprobado are required' });
    }
    if (!aprobado && !motivoRechazo) {
      return res.status(400).json({ success: false, message: 'motivoRechazo is required when rejecting' });
    }

    try {
      const tenant = await Tenant.findById(tenantId).lean();
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
      if (!tenant.ecfConfig?.isActive) {
        return res.status(400).json({ success: false, message: 'e-CF not configured for this tenant' });
      }

      const result = await citrusEcfService.aprobacionComercial(tenant, {
        TrackId: trackId,
        Estado: aprobado ? 'Aceptado' : 'Rechazado',
        ...(motivoRechazo ? { MotivoRechazo: motivoRechazo } : {}),
      });
      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      const status = error instanceof CitrusError ? error.statusCode : 500;
      return res.status(status).json({ success: false, message: error.message ?? 'Failed to submit commercial approval' });
    }
  },
);

// =============================================================================
// Phase 5.2 — Other Invoice Types (E41/E43/E44/E45/E46/E47)
// =============================================================================

/**
 * POST /api/ecf/invoices/other
 * Generate one of the less-common invoice types.
 * Body:
 *   tipo: '41'|'43'|'44'|'45'|'46'|'47'
 *   items: OtherInvoiceItem[]
 *   buyer?: EcfOtherBuyerInfo
 *   tipoPago: number
 *   refNumber?: string  (used as NumeroFacturaInterna)
 */
router.post(
  '/invoices/other',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ success: false, message: 'Missing tenant context' });

    const {
      tipo,
      items,
      buyer,
      tipoPago = 1,
      refNumber,
    } = req.body as {
      tipo: string;
      items: OtherInvoiceItem[];
      buyer?: EcfOtherBuyerInfo;
      tipoPago?: number;
      refNumber?: string;
    };

    const VALID_TIPOS = ['41', '43', '44', '45', '46', '47'];
    if (!tipo || !VALID_TIPOS.includes(tipo)) {
      return res.status(400).json({ success: false, message: `tipo must be one of: ${VALID_TIPOS.join(', ')}` });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items array is required and must not be empty' });
    }

    try {
      const tenant = await Tenant.findById(tenantId);
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
      if (!tenant.ecfConfig?.isActive) {
        return res.status(400).json({ success: false, message: 'e-CF not configured for this tenant' });
      }

      let payload: unknown;
      let citrusResponse: CitrusInvoiceResponse;
      let contingency = false;

      try {
        switch (tipo) {
          case '41':
            payload = mapToCompras(items, buyer ?? {}, tipoPago, tenant, refNumber);
            citrusResponse = await citrusEcfService.generateCompras(tenant, payload);
            break;
          case '43':
            payload = mapToGastoMenor(items, tipoPago, tenant, refNumber);
            citrusResponse = await citrusEcfService.generateGastoMenor(tenant, payload);
            break;
          case '44':
          case '45':
            payload = mapToRegimenEspecial(tipo as '44' | '45', items, buyer ?? {}, tipoPago, tenant, refNumber);
            citrusResponse = await citrusEcfService.generateFactura(tenant, payload);
            break;
          case '46':
            payload = mapToExportacion(items, buyer ?? {}, tipoPago, tenant, refNumber);
            citrusResponse = await citrusEcfService.generateExportacion(tenant, payload);
            break;
          case '47':
            payload = mapToPagoExterior(items, buyer ?? {}, tipoPago, tenant, refNumber);
            citrusResponse = await citrusEcfService.generatePagoExterior(tenant, payload);
            break;
          default:
            return res.status(400).json({ success: false, message: 'Unknown invoice type' });
        }
      } catch (citrusErr: any) {
        if (citrusErr instanceof CitrusError && citrusErr.statusCode === 503) {
          // Contingency mode
          contingency = true;
          citrusResponse = {
            TrackId: `contingency-${Date.now()}`,
            eNCF: '',
            TransaccionId: 0,
            Estatus: 'Emitido Contingencia',
            EstadoeCF: 'Emitido Contingencia',
            Mensaje: 'Created in contingency mode — will sync when Citrus connectivity is restored',
            FechaVencimientoSecuencia: null,
            UrlCodigoQr: null,
            CodigoSeguridad: null,
            SecuenciaUtilizada: false,
            FechaFirmaDigital: null,
            Url: null,
          } as CitrusInvoiceResponse;
        } else {
          throw citrusErr;
        }
      }

      const estadoECF = normalizeEstadoECF(
        citrusResponse?.EstadoeCF ?? 'En Proceso',
        citrusResponse?.Estatus,
        citrusResponse?.Mensaje,
      );

      const totalAmount = items.reduce((s, i) => s + i.amount, 0);

      const invoiceRecord = await ElectronicInvoice.create({
        tenantId,
        tipo: `E${tipo}` as EcfTipo,
        eNCF: citrusResponse.eNCF ?? '',
        transaccionId: (citrusResponse as CitrusInvoiceResponse).TransaccionId ?? 0,
        trackId: citrusResponse.TrackId ?? '',
        estadoECF,
        estatus: citrusResponse.Estatus ?? '',
        mensaje: citrusResponse.Mensaje ?? '',
        buyerRnc: buyer?.rnc ?? '',
        buyerName: buyer?.razonSocial ?? buyer?.name ?? '',
        buyerEmail: buyer?.email ?? '',
        totalFactura: totalAmount,
        totalImpuestos: 0,
        currency: 'DOP',
        generatedBy: req.user!._id,
        generationSource: 'manual',
        lastStatusCheck: new Date(),
        retryCount: 0,
      });

      if (!contingency && estadoECF === 'En Proceso') {
        startStatusPolling(String(invoiceRecord._id), tenant);
      }

      return res.status(201).json({
        success: true,
        message: contingency ? 'Invoice created in contingency mode' : 'Invoice generated successfully',
        data: invoiceRecord.toObject(),
      });
    } catch (error: any) {
      if (error instanceof EcfMapperError) {
        return res.status(400).json({ success: false, message: error.message });
      }
      const status = error instanceof CitrusError ? error.statusCode : 500;
      console.error('[ECF] POST /invoices/other error:', error.message);
      return res.status(status).json({ success: false, message: error.message ?? 'Failed to generate invoice' });
    }
  },
);

// =============================================================================
// Phase 5.3 — Health Check (Citrus connectivity)
// =============================================================================

/**
 * GET /api/ecf/health
 * Lightweight connectivity check against the Citrus API.
 * Returns { online: boolean, checkedAt: string }
 */
router.get(
  '/health',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ success: false, message: 'Missing tenant context' });

    try {
      const tenant = await Tenant.findById(tenantId).lean();
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
      if (!tenant.ecfConfig?.isActive || !tenant.ecfConfig?.citrusToken) {
        return res.status(200).json({ success: true, data: { online: false, reason: 'not_configured', checkedAt: new Date().toISOString() } });
      }

      await citrusEcfService.getTrackId(tenant, 'health-check');
      return res.status(200).json({ success: true, data: { online: true, checkedAt: new Date().toISOString() } });
    } catch (error: any) {
      // Any CitrusError means Citrus is reachable but auth may have failed — still online for our purposes
      if (error instanceof CitrusError && error.statusCode !== 503) {
        return res.status(200).json({ success: true, data: { online: true, checkedAt: new Date().toISOString() } });
      }
      return res.status(200).json({ success: true, data: { online: false, checkedAt: new Date().toISOString() } });
    }
  },
);

// =============================================================================
// Phase 5.4 — Electronic Billers Directory (with 24h in-memory cache)
// =============================================================================

interface DirectoryCache {
  data: unknown;
  cachedAt: number;
}
const directoryCache = new Map<string, DirectoryCache>();
const DIRECTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * GET /api/ecf/directory
 * Returns the list of electronic billers from Citrus, cached per tenant for 24h.
 */
router.get(
  '/directory',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ success: false, message: 'Missing tenant context' });

    // Force-refresh if ?refresh=true
    const forceRefresh = req.query.refresh === 'true';

    const cached = directoryCache.get(tenantId);
    if (!forceRefresh && cached && Date.now() - cached.cachedAt < DIRECTORY_CACHE_TTL_MS) {
      return res.status(200).json({
        success: true,
        data: cached.data,
        meta: { cached: true, cachedAt: new Date(cached.cachedAt).toISOString() },
      });
    }

    try {
      const tenant = await Tenant.findById(tenantId).lean();
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
      if (!tenant.ecfConfig?.isActive) {
        return res.status(400).json({ success: false, message: 'e-CF not configured for this tenant' });
      }

      const data = await citrusEcfService.getDirectorio(tenant);
      directoryCache.set(tenantId, { data, cachedAt: Date.now() });

      return res.status(200).json({
        success: true,
        data,
        meta: { cached: false, cachedAt: new Date().toISOString() },
      });
    } catch (error: any) {
      const status = error instanceof CitrusError ? error.statusCode : 500;
      return res.status(status).json({ success: false, message: error.message ?? 'Failed to fetch directory' });
    }
  },
);

// =============================================================================
// Phase 5.5 — Alerts (expiry warnings + Rechazado count)
// =============================================================================

/**
 * GET /api/ecf/alerts
 * Surface pending alerts:
 *  - count of Rechazado invoices (last 30 days)
 *  - count of invoices En Proceso > 1 hour old
 *  - sequence expiry warnings (< 30 days remaining) — from sequences endpoint
 *  - token expiry warning (if citrusTokenExpiresAt is populated)
 */
router.get(
  '/alerts',
  authenticate,
  authorize('admin', 'staff'),
  async (req: AuthRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ success: false, message: 'Missing tenant context' });

    try {
      const tenant = await Tenant.findById(tenantId).lean();
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

      const alerts: Array<{
        type: string;
        severity: 'info' | 'warning' | 'error';
        message: string;
        count?: number;
      }> = [];

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const [rechazadoCount, stalePendingCount] = await Promise.all([
        ElectronicInvoice.countDocuments({
          tenantId,
          estadoECF: 'Rechazado',
          createdAt: { $gte: thirtyDaysAgo },
        }),
        ElectronicInvoice.countDocuments({
          tenantId,
          estadoECF: 'En Proceso',
          createdAt: { $lte: oneHourAgo },
        }),
      ]);

      if (rechazadoCount > 0) {
        alerts.push({
          type: 'rechazado_invoices',
          severity: 'error',
          message: `${rechazadoCount} invoice(s) were rejected by the DGII in the last 30 days`,
          count: rechazadoCount,
        });
      }

      if (stalePendingCount > 0) {
        alerts.push({
          type: 'stale_pending',
          severity: 'warning',
          message: `${stalePendingCount} invoice(s) have been pending for over 1 hour`,
          count: stalePendingCount,
        });
      }

      // Token expiry warning (if tenant stores token expiry)
      const tokenExpiresAt = (tenant.ecfConfig as any)?.citrusTokenExpiresAt;
      if (tokenExpiresAt) {
        const daysUntilExpiry = Math.ceil(
          (new Date(tokenExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        );
        if (daysUntilExpiry <= 30) {
          alerts.push({
            type: 'token_expiry',
            severity: daysUntilExpiry <= 7 ? 'error' : 'warning',
            message: daysUntilExpiry <= 0
              ? 'Citrus API token has expired — renew immediately'
              : `Citrus API token expires in ${daysUntilExpiry} day(s)`,
          });
        }
      }

      return res.status(200).json({ success: true, data: alerts });
    } catch (error: any) {
      console.error('[ECF] GET /alerts error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch alerts' });
    }
  },
);

export default router;
