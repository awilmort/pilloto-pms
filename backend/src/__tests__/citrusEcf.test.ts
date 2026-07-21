/**
 * Citrus e-CF service tests.
 *
 * These verify that representation-impresa responses are treated as binary PDF bytes
 * when Citrus returns a PDF, and as plain text when Citrus returns a URL or text body.
 *
 * Regression coverage for the PDF-rendering bug:
 *   When the old code sent Accept: application/json, Citrus could return a JSON
 *   wrapper like {"url":"https://..."} that fell through to a dangerous fallback
 *   converting the JSON string to fake "PDF" bytes, causing the browser to show
 *   "Failed to load PDF document."  The fix changes the Accept header to
 *   "application/pdf, application/octet-stream, text/plain, *\/*" so Citrus
 *   returns binary PDF or a plain-text URL directly.
 */

jest.mock('../utils/encryption', () => ({
  __esModule: true,
  decrypt: jest.fn(() => 'decrypted-token'),
}));

import { citrusEcfService } from '../services/citrusEcf';

const tenant = {
  _id: '507f1f77bcf86cd799439011',
  ecfConfig: {
    citrusBaseUrl: 'https://citrus.example',
    citrusToken: 'encrypted-token',
  },
} as any;

function mockFetch(body: string, contentType: string, status = 200) {
  const bytes = new TextEncoder().encode(body);
  const response = {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  } as any;

  const fetchMock = jest.fn().mockResolvedValue(response);
  (global as any).fetch = fetchMock;
  return fetchMock;
}

describe('citrusEcfService.getRepresentacionImpresa', () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete (global as any).fetch;
  });

  it('returns a Buffer when Citrus responds with PDF bytes', async () => {
    const pdfBody = '%PDF-1.4\nfake pdf content';
    const fetchMock = mockFetch(pdfBody, 'application/pdf');

    const result = await citrusEcfService.getRepresentacionImpresa(tenant, 'E3100000001', 'E31');

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString('utf8')).toBe(pdfBody);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://citrus.example/api/v1/facturas/E3100000001/representacionImpresa',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns plain text when Citrus responds with a URL', async () => {
    const url = 'https://cdn.example.com/invoices/E3100000001.pdf';
    mockFetch(url, 'text/plain');

    const result = await citrusEcfService.getRepresentacionImpresa(tenant, 'E3100000001', 'E31');

    expect(typeof result).toBe('string');
    expect(result).toBe(url);
  });

  it('sends PDF-aware Accept header (not application/json) for representacionImpresa', async () => {
    // Regression: old code sent Accept: application/json causing Citrus to wrap
    // the PDF URL in a JSON object, which the route then sent as fake "PDF" bytes.
    const pdfBody = '%PDF-1.4\nfake pdf content';
    const fetchMock = mockFetch(pdfBody, 'application/pdf');

    await citrusEcfService.getRepresentacionImpresa(tenant, 'E3100000001', 'E31');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining('application/pdf'),
        }),
      }),
    );

    // Must NOT request JSON (the root cause of the original bug)
    const callHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(callHeaders['Accept']).not.toContain('application/json');
  });

  it('returns plain text when Citrus responds with a JSON string body containing a URL (regression: old code would throw or send bad PDF)', async () => {
    // Citrus may return JSON even when asked for PDF if the server ignores Accept.
    // The service layer should return the raw JSON string; buildEcfPdfAttachment
    // in the route layer is responsible for parsing it.
    const jsonBody = JSON.stringify({ url: 'https://citrus.example/pdfs/E3100000001.pdf' });
    mockFetch(jsonBody, 'application/json');

    const result = await citrusEcfService.getRepresentacionImpresa(tenant, 'E3100000001', 'E31');

    // requestPdfOrText returns the raw text — the JSON string starts with '{' so
    // it is not detected as PDF bytes; the route layer must parse it.
    expect(typeof result).toBe('string');
    expect(result).toBe(jsonBody);
  });

  it('uses the E32 factura-consumo path for tipo E32', async () => {
    const pdfBody = '%PDF-1.4\nfake';
    const fetchMock = mockFetch(pdfBody, 'application/pdf');

    await citrusEcfService.getRepresentacionImpresa(tenant, 'E3200000001', 'E32');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://citrus.example/api/v1/factura-consumo/E3200000001/representacionImpresa',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});