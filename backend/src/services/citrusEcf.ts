/**
 * CitrusEcfService — HTTP client for the Citrus e-CF API (Dominican Republic e-invoicing).
 *
 * Design principles:
 *   - Stateless: accepts a tenant object and decrypts the token per-call.
 *   - All Citrus requests are logged (excluding token) with tenantId + eNCF for auditability.
 *   - Throws typed CitrusError on API failures; callers map these to HTTP status codes.
 *   - Token is NEVER logged, returned to the caller, or forwarded to the frontend.
 */

import { ITenant } from '../models/Tenant';
import { decrypt } from '../utils/encryption';

// ─── Types ───────────────────────────────────────────────────────────────────

export class CitrusError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly citrusResponse?: unknown,
  ) {
    super(message);
    this.name = 'CitrusError';
  }
}

export interface CitrusInvoiceResponse {
  TransaccionId: number;
  eNCF: string;
  FechaVencimientoSecuencia: string | null;
  TrackId: string | null;
  Estatus: string;
  EstadoeCF: string;
  Mensaje: string;
  UrlCodigoQr: string | null;
  CodigoSeguridad: string | null;
  SecuenciaUtilizada: boolean;
  FechaFirmaDigital: string | null;
  Url: string | null;
}

export interface CitrusEstadoResponse {
  EstadoeCF: string;
  Estatus: string;
  Mensaje?: string;
  TrackId?: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function getBaseUrl(tenant: ITenant): string {
  const url = tenant.ecfConfig?.citrusBaseUrl;
  if (!url) throw new CitrusError('Tenant ECF base URL not configured', 400);
  return url.replace(/\/$/, '');
}

function getDecryptedToken(tenant: ITenant): string {
  const encrypted = tenant.ecfConfig?.citrusToken;
  if (!encrypted) {
    throw new CitrusError('Tenant Citrus API token not configured', 400);
  }
  try {
    return decrypt(encrypted);
  } catch {
    throw new CitrusError('Failed to decrypt Citrus API token — token may be corrupt', 500);
  }
}

function buildHeaders(token: string): Record<string, string> {
  return {
    'Authorization': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function request<T>(
  method: 'GET' | 'POST',
  baseUrl: string,
  path: string,
  token: string,
  tenantId: string,
  body?: unknown,
  label?: string,
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const logLabel = label ?? path;

  console.info(`[CitrusECF] ${method} ${logLabel} | tenantId=${tenantId}`);

  const fetchOptions: RequestInit = {
    method,
    headers: buildHeaders(token),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (networkError: any) {
    console.error(`[CitrusECF] Network error | tenantId=${tenantId} | ${networkError.message}`);
    throw new CitrusError(`Network error connecting to Citrus: ${networkError.message}`, 503);
  }

  const rawText = await response.text();

  console.info(
    `[CitrusECF] Response ${response.status} | tenantId=${tenantId} | ${logLabel} | body_length=${rawText.length}`
  );

  if (response.status === 401) {
    throw new CitrusError('Citrus API token is invalid or expired', 401);
  }

  if (response.status === 400) {
    let detail = rawText;
    try { detail = JSON.parse(rawText); } catch { /* keep raw */ }
    throw new CitrusError('Citrus rejected the request (400)', 400, detail);
  }

  if (response.status === 202) {
    // Accepted but pending — parse body if possible
    try { return JSON.parse(rawText) as T; } catch { return {} as T; }
  }

  if (!response.ok) {
    throw new CitrusError(`Citrus returned HTTP ${response.status}`, response.status, rawText);
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    // Some Citrus endpoints (XML download, representation URL) may return plain text.
    return rawText as T;
  }
}

async function requestPdfOrText(
  method: 'GET' | 'POST',
  baseUrl: string,
  path: string,
  token: string,
  tenantId: string,
  label?: string,
): Promise<string | Buffer> {
  const url = `${baseUrl}${path}`;
  const logLabel = label ?? path;

  console.info(`[CitrusECF] ${method} ${logLabel} | tenantId=${tenantId}`);

  // Use PDF-aware Accept header so Citrus returns binary PDF or a plain-text URL
  // rather than a JSON-wrapped response.
  const pdfHeaders: Record<string, string> = {
    'Authorization': token,
    'Accept': 'application/pdf, application/octet-stream, text/plain, */*',
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: pdfHeaders,
    });
  } catch (networkError: any) {
    console.error(`[CitrusECF] Network error | tenantId=${tenantId} | ${networkError.message}`);
    throw new CitrusError(`Network error connecting to Citrus: ${networkError.message}`, 503);
  }

  const bodyBuffer = Buffer.from(await response.arrayBuffer());
  const rawText = bodyBuffer.toString('utf8');
  const contentType = response.headers.get('content-type') || '';

  console.info(
    `[CitrusECF] Response ${response.status} | tenantId=${tenantId} | ${logLabel} | body_length=${bodyBuffer.length}`
  );

  if (response.status === 401) {
    throw new CitrusError('Citrus API token is invalid or expired', 401);
  }

  if (response.status === 400) {
    let detail: unknown = rawText;
    try { detail = JSON.parse(rawText); } catch { /* keep raw */ }
    throw new CitrusError('Citrus rejected the request (400)', 400, detail);
  }

  if (response.status === 202) {
    try { return JSON.parse(rawText) as string; } catch { return {} as string; }
  }

  if (!response.ok) {
    throw new CitrusError(`Citrus returned HTTP ${response.status}`, response.status, rawText);
  }

  const looksLikePdf = contentType.includes('application/pdf') || bodyBuffer.subarray(0, 4).toString('ascii') === '%PDF';
  if (looksLikePdf) {
    return Buffer.from(bodyBuffer);
  }

  return rawText;
}

// ─── CitrusEcfService ─────────────────────────────────────────────────────────

export const citrusEcfService = {

  /** E31 — Factura de Crédito Fiscal (B2B) */
  generateFactura(tenant: ITenant, payload: unknown): Promise<CitrusInvoiceResponse> {
    const tid = String(tenant._id);
    return request<CitrusInvoiceResponse>(
      'POST', getBaseUrl(tenant), '/api/v1/Facturas',
      getDecryptedToken(tenant), tid, payload, 'generateFactura(E31)'
    );
  },

  /** E32 — Factura de Consumo (B2C) */
  generateFacturaConsumo(tenant: ITenant, payload: unknown): Promise<CitrusInvoiceResponse> {
    const tid = String(tenant._id);
    return request<CitrusInvoiceResponse>(
      'POST', getBaseUrl(tenant), '/api/v1/FacturaConsumo',
      getDecryptedToken(tenant), tid, payload, 'generateFacturaConsumo(E32)'
    );
  },

  /** E34 — Nota de Crédito (credit note / cancellation) */
  generateNotaCredito(tenant: ITenant, payload: unknown): Promise<CitrusInvoiceResponse> {
    const tid = String(tenant._id);
    return request<CitrusInvoiceResponse>(
      'POST', getBaseUrl(tenant), '/api/v1/NotaCredito',
      getDecryptedToken(tenant), tid, payload, 'generateNotaCredito(E34)'
    );
  },

  /** E33 — Nota de Débito */
  generateNotaDebito(tenant: ITenant, payload: unknown): Promise<CitrusInvoiceResponse> {
    const tid = String(tenant._id);
    return request<CitrusInvoiceResponse>(
      'POST', getBaseUrl(tenant), '/api/v1/NotaDebito',
      getDecryptedToken(tenant), tid, payload, 'generateNotaDebito(E33)'
    );
  },

  /** Check ENCF status by sequence number */
  consultarEstado(tenant: ITenant, encf: string): Promise<CitrusEstadoResponse> {
    const tid = String(tenant._id);
    return request<CitrusEstadoResponse>(
      'GET', getBaseUrl(tenant),
      `/api/v1/transacciones/${encodeURIComponent(encf)}/consultarEstadoENCF`,
      getDecryptedToken(tenant), tid, undefined, `consultarEstado(${encf})`
    );
  },

  /** Check e-CF state by TrackId */
  consultarEstadoECF(tenant: ITenant, trackId: string): Promise<CitrusEstadoResponse> {
    const tid = String(tenant._id);
    return request<CitrusEstadoResponse>(
      'GET', getBaseUrl(tenant),
      `/api/v1/estado-ecf/${encodeURIComponent(trackId)}`,
      getDecryptedToken(tenant), tid, undefined, `consultarEstadoECF(${trackId})`
    );
  },

  /** Download raw XML by transaccionId */
  getXML(tenant: ITenant, transaccionId: number): Promise<string> {
    const tid = String(tenant._id);
    return request<string>(
      'GET', getBaseUrl(tenant),
      `/api/v1/transacciones/${transaccionId}/xml`,
      getDecryptedToken(tenant), tid, undefined, `getXML(${transaccionId})`
    );
  },

  /** Representación Impresa (PDF endpoint) — routes by tipo per Citrus API v1 docs */
  getRepresentacionImpresa(tenant: ITenant, encf: string, tipo: string): Promise<string | Buffer> {
    const tid = String(tenant._id);
    const enc = encodeURIComponent(encf);
    const segmentMap: Record<string, string> = {
      E32: 'factura-consumo',
      E33: 'nota-debito',
      E34: 'nota-credito',
      E41: 'compras',
      E43: 'gasto-menor',
      E46: 'exportaciones',
      E47: 'pagos-exterior',
    };
    const segment = segmentMap[tipo] ?? 'facturas'; // E31, E44, E45 → facturas
    const path = `/api/v1/${segment}/${enc}/representacionImpresa`;
    return requestPdfOrText('GET', getBaseUrl(tenant), path, getDecryptedToken(tenant), tid, `getRepresentacionImpresa(${encf})`);
  },

  /** Email representación impresa — routes by tipo per Citrus API v1 docs */
  sendRepresentacionImpresa(tenant: ITenant, encf: string, tipo: string): Promise<unknown> {
    const tid = String(tenant._id);
    const enc = encodeURIComponent(encf);
    const segmentMap: Record<string, string> = {
      E32: 'factura-consumo',
      E33: 'nota-debito',
      E34: 'nota-credito',
      E41: 'compras',
      E43: 'gasto-menor',
      E46: 'exportaciones',
      E47: 'pagos-exterior',
    };
    const segment = segmentMap[tipo] ?? 'facturas';
    const path = `/api/v1/${segment}/${enc}/representacionImpresa/email`;
    return request<unknown>('GET', getBaseUrl(tenant), path, getDecryptedToken(tenant), tid);
  },

  /** Get TrackId history for a sequence */
  getTrackId(tenant: ITenant, encf: string): Promise<unknown> {
    const tid = String(tenant._id);
    return request<unknown>(
      'GET', getBaseUrl(tenant),
      `/api/v1/track-id/${encodeURIComponent(encf)}`,
      getDecryptedToken(tenant), tid
    );
  },

  /** Received invoices (Comprobantes Recibidos) */
  getComprobantesRecibidos(tenant: ITenant, filters?: Record<string, string>): Promise<unknown> {
    const tid = String(tenant._id);
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return request<unknown>(
      'GET', getBaseUrl(tenant), `/api/v1/ComprobanteElectronico${qs}`,
      getDecryptedToken(tenant), tid
    );
  },

  /** Sequence annulment */
  anularSecuencias(tenant: ITenant, payload: unknown): Promise<unknown> {
    const tid = String(tenant._id);
    return request<unknown>(
      'POST', getBaseUrl(tenant), '/api/v1/AnulacionSecuencia',
      getDecryptedToken(tenant), tid, payload
    );
  },

  /** Commercial approval */
  aprobacionComercial(tenant: ITenant, payload: unknown): Promise<unknown> {
    const tid = String(tenant._id);
    return request<unknown>(
      'POST', getBaseUrl(tenant), '/api/v1/AprobacionComercial',
      getDecryptedToken(tenant), tid, payload
    );
  },

  /** Electronic billers directory */
  getDirectorio(tenant: ITenant): Promise<unknown> {
    const tid = String(tenant._id);
    return request<unknown>(
      'GET', getBaseUrl(tenant), '/api/v1/Directorio',
      getDecryptedToken(tenant), tid
    );
  },

  // ─── Phase 5: Additional invoice types ────────────────────────────────────

  /** E41 — Comprobante de Compras (purchases from non-registered suppliers) */
  generateCompras(tenant: ITenant, payload: unknown): Promise<CitrusInvoiceResponse> {
    const tid = String(tenant._id);
    return request<CitrusInvoiceResponse>(
      'POST', getBaseUrl(tenant), '/api/v1/Compras',
      getDecryptedToken(tenant), tid, payload, 'generateCompras(E41)'
    );
  },

  /** E43 — Gastos Menores (minor expense receipts) */
  generateGastoMenor(tenant: ITenant, payload: unknown): Promise<CitrusInvoiceResponse> {
    const tid = String(tenant._id);
    return request<CitrusInvoiceResponse>(
      'POST', getBaseUrl(tenant), '/api/v1/GastoMenor',
      getDecryptedToken(tenant), tid, payload, 'generateGastoMenor(E43)'
    );
  },

  /** E46 — Exportaciones (foreign sales) */
  generateExportacion(tenant: ITenant, payload: unknown): Promise<CitrusInvoiceResponse> {
    const tid = String(tenant._id);
    return request<CitrusInvoiceResponse>(
      'POST', getBaseUrl(tenant), '/api/v1/Exportaciones',
      getDecryptedToken(tenant), tid, payload, 'generateExportacion(E46)'
    );
  },

  /** E47 — Pagos al Exterior (payments to foreign entities) */
  generatePagoExterior(tenant: ITenant, payload: unknown): Promise<CitrusInvoiceResponse> {
    const tid = String(tenant._id);
    return request<CitrusInvoiceResponse>(
      'POST', getBaseUrl(tenant), '/api/v1/PagosExterior',
      getDecryptedToken(tenant), tid, payload, 'generatePagoExterior(E47)'
    );
  },
};
