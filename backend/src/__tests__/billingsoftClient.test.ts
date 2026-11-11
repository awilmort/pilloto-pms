/**
 * BillingSoftClient: what goes on the wire (key, tenant header, idempotency key) and how failures
 * are classified — which of them are worth sending again.
 */
import { BillingSoftError, createBillingSoftClient } from '../services/fiscal/billingsoftClient';

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const isBuffer = Buffer.isBuffer(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => {
      if (isBuffer || typeof body === 'string') throw new Error('not json');
      return body;
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => (isBuffer ? (body as Buffer).buffer.slice((body as Buffer).byteOffset, (body as Buffer).byteOffset + (body as Buffer).byteLength) : new ArrayBuffer(0)),
  } as unknown as Response;
}

const make = (fetchImpl: jest.Mock, apiKey = 'bs_live_secret') =>
  createBillingSoftClient({ baseUrl: 'https://api.billingsoft.test/', apiKey, fetchImpl: fetchImpl as any });

const lastCall = (f: jest.Mock) => {
  const [url, init] = f.mock.calls[f.mock.calls.length - 1];
  return { url: url as string, init: init as RequestInit & { headers: Record<string, string> } };
};

describe('requests', () => {
  it('sends the partner key and, when acting for a company, its Organization', async () => {
    const f = jest.fn().mockResolvedValue(response(200, { sequences: [] }));
    await make(f).listSequences('org-42');
    const { url, init } = lastCall(f);
    expect(url).toBe('https://api.billingsoft.test/v1/sequences');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer bs_live_secret');
    expect(init.headers['BillingSoft-Organization']).toBe('org-42');
  });

  it('does not name an Organization on the partner\'s own routes', async () => {
    const f = jest.fn().mockResolvedValue(response(200, { currency: 'DOP', annualDiscountPercent: 10, plans: [] }));
    await make(f).plans();
    expect(lastCall(f).init.headers['BillingSoft-Organization']).toBeUndefined();
  });

  it('sends the idempotency key and the JSON body when issuing', async () => {
    const f = jest.fn().mockResolvedValue(response(201, { documentId: 'd1', encf: 'E320000000001', type: '32', status: 'in_process' }));
    const body = { type: '32', payment: { type: 'cash' }, lines: [] } as any;
    const answer = await make(f).issue('org-42', 'invoices', body, 'key-1');
    const { url, init } = lastCall(f);
    expect(url).toBe('https://api.billingsoft.test/v1/invoices');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('key-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(answer.documentId).toBe('d1');
  });

  it('encodes query parameters and drops empty ones', async () => {
    const f = jest.fn().mockResolvedValue(response(200, { documents: [], page: 1, pageSize: 25, total: 0 }));
    await make(f).listDocuments('org', { type: '32', q: 'E32 0001', status: undefined });
    expect(lastCall(f).url).toBe('https://api.billingsoft.test/v1/documents?type=32&q=E32%200001');
  });

  it('returns binary files as Buffers', async () => {
    const pdf = Buffer.from('%PDF-1.4 hello');
    const f = jest.fn().mockResolvedValue(response(200, pdf));
    const out = await make(f).getDocumentPdf('org', 'doc');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe('%PDF-1.4 hello');
  });

  it('never calls out without a key', async () => {
    const f = jest.fn();
    await expect(make(f, '').plans()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  const failure = async (f: jest.Mock) => {
    try {
      await make(f).issue('org', 'invoices', {} as any, 'k');
    } catch (e) {
      return e as BillingSoftError;
    }
    throw new Error('expected a failure');
  };

  it('reads BillingSoft\'s error shape and does not retry a refusal', async () => {
    const err = await failure(jest.fn().mockResolvedValue(response(400, { error: { code: 'VALIDATION_ERROR', message: 'Revise los datos', fields: { 'buyer.rnc': 'RNC inválido' } } })));
    expect(err).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Revise los datos', retryable: false });
    expect(err.fields).toEqual({ 'buyer.rnc': 'RNC inválido' });
  });

  it.each([429, 500, 502, 503])('treats %i as worth sending again', async (status) => {
    expect((await failure(jest.fn().mockResolvedValue(response(status, { error: { message: 'busy' } })))).retryable).toBe(true);
  });

  it.each([401, 403, 404, 409])('treats %i as final', async (status) => {
    expect((await failure(jest.fn().mockResolvedValue(response(status, { error: { message: 'no' } })))).retryable).toBe(false);
  });

  it('classifies a network failure as retryable, with status 0', async () => {
    const err = await failure(jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));
    expect(err).toMatchObject({ statusCode: 0, code: 'NETWORK', retryable: true });
  });

  it('classifies a timeout as retryable', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const err = await failure(jest.fn().mockRejectedValue(abort));
    expect(err).toMatchObject({ statusCode: 0, code: 'TIMEOUT', retryable: true });
  });

  it('survives an error body that is not JSON', async () => {
    const err = await failure(jest.fn().mockResolvedValue(response(502, '<html>Bad gateway</html>')));
    expect(err).toMatchObject({ statusCode: 502, retryable: true });
    expect(err.message).toContain('502');
  });

  it('never puts the key in an error message', async () => {
    const err = await failure(jest.fn().mockRejectedValue(new Error('boom')));
    expect(err.message).not.toContain('bs_live_secret');
  });
});
