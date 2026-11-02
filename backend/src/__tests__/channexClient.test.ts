/**
 * Unit tests for services/channex/channexClient.ts, config.ts and health.ts
 * (CHANNEX_IMPLEMENTATION_PLAN.md Phase 2.1). HTTP is faked with an axios adapter,
 * so requests go through real axios (params, headers, status handling).
 */

import { AxiosAdapter, AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import {
  createChannexClient, classifyChannexError, unwrapOne, unwrapMany, redact, loggableBody,
  ChannexRateLimitError, ChannexRetryableError, ChannexAuthError, ChannexValidationError,
  ChannexError, ChannexNotConfiguredError, CHANNEX_PAGE_LIMIT,
} from '../services/channex/channexClient';
import {
  getChannexConfig, validateChannexConfig, assertCurrentEnvironment, ChannexEnvironmentMismatchError, ChannexConfig,
} from '../services/channex/config';
import { checkChannexHealth } from '../services/channex/health';

const API_KEY = 'test-key-1234567890-secret';

const config = (over: Partial<ChannexConfig> = {}): ChannexConfig => ({
  environment: 'staging',
  baseUrl: 'https://staging.channex.io',
  apiKey: API_KEY,
  workersDisabled: false,
  ...over,
});

const silentLogger = { info: jest.fn(), warn: jest.fn() };

type Reply = { status: number; data?: unknown; headers?: Record<string, string> } | { networkError: string };

/** Fake axios adapter: replies in order, records every request config. */
function fakeAdapter(replies: Reply[]) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (cfg) => {
    calls.push(cfg);
    const reply = replies.shift();
    if (!reply) throw new Error('No more fake replies');
    if ('networkError' in reply) {
      throw new AxiosError('socket hang up', reply.networkError, cfg);
    }
    const response = {
      data: reply.data, status: reply.status, statusText: String(reply.status),
      headers: new AxiosHeaders(reply.headers ?? {}), config: cfg,
    };
    if (reply.status >= 200 && reply.status < 300) return response;
    throw new AxiosError(`Request failed with status code ${reply.status}`, 'ERR_BAD_RESPONSE', cfg, null, response);
  };
  return { adapter, calls };
}

beforeEach(() => jest.clearAllMocks());

// ── Error classification ──────────────────────────────────────────────────────

describe('error classification', () => {
  async function failWith(reply: Reply) {
    const { adapter } = fakeAdapter([reply]);
    const client = createChannexClient(config(), { adapter, logger: silentLogger });
    return client.get('/properties').then(() => { throw new Error('expected failure'); }, (e) => e);
  }

  it('429 → ChannexRateLimitError with retry-after', async () => {
    const err = await failWith({ status: 429, data: { errors: { code: 'http_too_many_requests', title: 'Too Many Requests' } }, headers: { 'retry-after': '60' } });
    expect(err).toBeInstanceOf(ChannexRateLimitError);
    expect(err.status).toBe(429);
    expect(err.code).toBe('http_too_many_requests');
    expect(err.retryAfterSeconds).toBe(60);
  });

  it.each([500, 502, 503, 504, 408])('%i → ChannexRetryableError', async (status) => {
    const err = await failWith({ status, data: 'Bad gateway' });
    expect(err).toBeInstanceOf(ChannexRetryableError);
    expect(err.status).toBe(status);
  });

  it.each(['ECONNABORTED', 'ECONNRESET', 'ENOTFOUND', 'ERR_NETWORK'])('network error %s → ChannexRetryableError', async (code) => {
    const err = await failWith({ networkError: code });
    expect(err).toBeInstanceOf(ChannexRetryableError);
    expect(err.status).toBeUndefined();
    expect(err.code).toBe(code);
  });

  it.each([401, 403])('%i → ChannexAuthError', async (status) => {
    const err = await failWith({ status, data: { errors: { code: 'unauthorized', title: 'Unauthorized' } } });
    expect(err).toBeInstanceOf(ChannexAuthError);
    expect(err.message).toMatch(/API key/);
  });

  it('422 with errors → ChannexValidationError carrying details', async () => {
    const err = await failWith({
      status: 422,
      data: { errors: { code: 'validation_error', title: 'Validation Error', details: { title: ["can't be blank"] } } },
    });
    expect(err).toBeInstanceOf(ChannexValidationError);
    expect(err.code).toBe('validation_error');
    expect(err.details).toEqual({ title: ["can't be blank"] });
    expect(err.message).toContain('validation_error: Validation Error');
  });

  it('array-shaped errors are understood too', async () => {
    const err = await failWith({ status: 400, data: { errors: [{ code: 'bad_request', title: 'Bad' }] } });
    expect(err).toBeInstanceOf(ChannexValidationError);
    expect(err.code).toBe('bad_request');
  });

  it('4xx without an errors body → plain ChannexError', async () => {
    const err = await failWith({ status: 404, data: '' });
    expect(err).toBeInstanceOf(ChannexError);
    expect(err).not.toBeInstanceOf(ChannexValidationError);
    expect(err.status).toBe(404);
  });

  it('never leaks the API key — not in message, details, or attached config', async () => {
    const err = await failWith({ status: 422, data: { errors: { code: 'x', title: `bad key ${API_KEY}`, details: { echo: API_KEY } } } });
    const serialized = JSON.stringify({ ...err, message: err.message, stack: err.stack });
    expect(serialized).not.toContain(API_KEY);
    expect((err as any).config).toBeUndefined();
    expect((err as any).response).toBeUndefined();
  });

  it('classify passes through ChannexErrors and wraps unknown throwables', () => {
    const original = new ChannexAuthError('x');
    expect(classifyChannexError(original)).toBe(original);
    const wrapped = classifyChannexError(new Error(`boom ${API_KEY}`), API_KEY);
    expect(wrapped).toBeInstanceOf(ChannexError);
    expect(wrapped.message).toBe('boom [REDACTED]');
  });
});

// ── Requests, logging, unwrap ─────────────────────────────────────────────────

describe('requests', () => {
  it('sends the user-api-key header under /api/v1 with a 20 s timeout', async () => {
    const { adapter, calls } = fakeAdapter([{ status: 200, data: { data: [] } }]);
    await createChannexClient(config(), { adapter, logger: silentLogger }).get('/properties', { 'pagination[limit]': 1 });
    expect(calls[0].baseURL).toBe('https://staging.channex.io/api/v1');
    expect(calls[0].url).toBe('/properties');
    expect(calls[0].params).toEqual({ 'pagination[limit]': 1 });
    expect(calls[0].headers['user-api-key']).toBe(API_KEY);
    expect(calls[0].timeout).toBe(20_000);
  });

  it('refuses to call Channex without an API key', async () => {
    const { adapter, calls } = fakeAdapter([]);
    await expect(createChannexClient(config({ apiKey: undefined }), { adapter, logger: silentLogger }).get('/properties'))
      .rejects.toBeInstanceOf(ChannexNotConfiguredError);
    expect(calls).toHaveLength(0);
  });

  it('logs without the key and truncates long bodies', async () => {
    const long = 'x'.repeat(5000);
    const { adapter } = fakeAdapter([{ status: 422, data: { errors: { code: 'v', title: long } } }]);
    const logger = { info: jest.fn(), warn: jest.fn() };
    await createChannexClient(config(), { adapter, logger }).post('/restrictions', { key: API_KEY, values: [{ note: long }] }).catch(() => undefined);
    const line: string = logger.warn.mock.calls[0][0];
    expect(line).not.toContain(API_KEY);
    expect(line).toContain('[REDACTED]');
    expect(line.length).toBeLessThan(2000);
    expect(line).toMatch(/chars\)/);
  });

  it('never exposes part of the key when a body is cut at the truncation boundary', () => {
    for (let offset = 480; offset < 510; offset++) {
      const text = loggableBody('y'.repeat(offset) + API_KEY, API_KEY);
      expect(text).not.toContain(API_KEY.slice(0, 8));
    }
  });

  it('unwraps JSON:API resources', () => {
    const one = unwrapOne({ data: { id: 'p1', type: 'property', attributes: { title: 'Hotel' }, relationships: { group: { data: { id: 'g1' } } } } });
    expect(one).toEqual({ id: 'p1', type: 'property', title: 'Hotel', relationships: { group: { data: { id: 'g1' } } } });
    expect(unwrapMany({ data: [{ id: 'a', type: 't', attributes: { n: 1 } }] })).toEqual([{ id: 'a', type: 't', n: 1 }]);
    expect(() => unwrapOne({ data: [] as any })).toThrow(ChannexError);
    expect(() => unwrapMany({} as any)).toThrow(ChannexError);
  });

  it('redact replaces every occurrence and is a no-op without a secret', () => {
    expect(redact('a s b s', 's')).toBe('a [REDACTED] b [REDACTED]');
    expect(redact('abc')).toBe('abc');
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe('paginateAll', () => {
  const page = (from: number, count: number, total?: number) => ({
    status: 200,
    data: {
      data: Array.from({ length: count }, (_, i) => ({ id: `r${from + i}`, type: 'room_type', attributes: { title: `Room ${from + i}` } })),
      meta: total === undefined ? {} : { total, limit: CHANNEX_PAGE_LIMIT },
    },
  });

  it('walks pages of 100 until a short page', async () => {
    const { adapter, calls } = fakeAdapter([page(0, 100), page(100, 100), page(200, 7)]);
    const items = await createChannexClient(config(), { adapter, logger: silentLogger })
      .paginateAll('/room_types', { 'filter[property_id]': 'p1' });
    expect(items).toHaveLength(207);
    expect(items[206]).toEqual({ id: 'r206', type: 'room_type', title: 'Room 206' });
    expect(calls.map((c) => c.params['pagination[page]'])).toEqual([1, 2, 3]);
    expect(calls.every((c) => c.params['pagination[limit]'] === 100 && c.params['filter[property_id]'] === 'p1')).toBe(true);
  });

  it('stops when meta.total is reached on a full page', async () => {
    const { adapter, calls } = fakeAdapter([page(0, 100, 200), page(100, 100, 200)]);
    const items = await createChannexClient(config(), { adapter, logger: silentLogger }).paginateAll('/rate_plans');
    expect(items).toHaveLength(200);
    expect(calls).toHaveLength(2);
  });

  it('handles an empty list in one call', async () => {
    const { adapter, calls } = fakeAdapter([page(0, 0, 0)]);
    expect(await createChannexClient(config(), { adapter, logger: silentLogger }).paginateAll('/channels')).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('propagates a classified error from a middle page', async () => {
    const { adapter } = fakeAdapter([page(0, 100), { status: 429, data: {} }]);
    await expect(createChannexClient(config(), { adapter, logger: silentLogger }).paginateAll('/properties'))
      .rejects.toBeInstanceOf(ChannexRateLimitError);
  });
});

// ── Config ────────────────────────────────────────────────────────────────────

describe('config', () => {
  it('defaults to staging and derives the base URL from the environment', () => {
    expect(getChannexConfig({})).toMatchObject({ environment: 'staging', baseUrl: 'https://staging.channex.io', apiKey: undefined });
    expect(getChannexConfig({ CHANNEX_ENV: 'production' }).baseUrl).toBe('https://app.channex.io');
    expect(getChannexConfig({ CHANNEX_BASE_URL: 'https://staging.channex.io/' }).baseUrl).toBe('https://staging.channex.io');
  });

  it('parses the workers switch', () => {
    expect(getChannexConfig({ CHANNEX_WORKERS_DISABLED: 'true' }).workersDisabled).toBe(true);
    expect(getChannexConfig({}).workersDisabled).toBe(false);
  });

  it('only warns — missing key, env/url mismatch, unknown env — and never echoes secrets', () => {
    expect(validateChannexConfig({})).toEqual([expect.stringMatching(/CHANNEX_API_KEY is not set/)]);
    const warnings = validateChannexConfig({
      CHANNEX_ENV: 'prod', CHANNEX_API_KEY: API_KEY, CHANNEX_BASE_URL: 'https://app.channex.io',
    });
    expect(warnings.join('\n')).toMatch(/not 'staging' or 'production'/);
    expect(warnings.join('\n')).toMatch(/points at Channex production/);
    expect(warnings.join('\n')).toMatch(/CHANNEX_WEBHOOK_SECRET is not set/);
    expect(warnings.join('\n')).not.toContain(API_KEY);
    expect(validateChannexConfig({
      CHANNEX_API_KEY: API_KEY, CHANNEX_WEBHOOK_SECRET: 's', CHANNEX_WEBHOOK_URL: 'https://x/api/webhooks/channex',
    })).toEqual([]);
  });

  it('assertCurrentEnvironment rejects records stamped for another environment', () => {
    const doc = { environment: 'staging', channexPropertyId: 'p1' };
    expect(assertCurrentEnvironment(doc, config())).toBe(doc);
    expect(() => assertCurrentEnvironment(doc, config({ environment: 'production' }))).toThrow(ChannexEnvironmentMismatchError);
    expect(() => assertCurrentEnvironment({ environment: undefined }, config())).toThrow(ChannexEnvironmentMismatchError);
  });
});

// ── Health ────────────────────────────────────────────────────────────────────

describe('checkChannexHealth', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('reports not_configured without calling Channex', async () => {
    delete process.env.CHANNEX_API_KEY;
    const { adapter, calls } = fakeAdapter([]);
    const health = await checkChannexHealth({ adapter, logger: silentLogger });
    expect(health).toMatchObject({ configured: false, ok: false, error: { kind: 'not_configured' } });
    expect(calls).toHaveLength(0);
  });

  it('succeeds with one GET /properties?pagination[limit]=1', async () => {
    process.env.CHANNEX_API_KEY = API_KEY;
    process.env.CHANNEX_ENV = 'staging';
    delete process.env.CHANNEX_BASE_URL;
    const { adapter, calls } = fakeAdapter([{ status: 200, data: { data: [], meta: { total: 0 } } }]);
    const health = await checkChannexHealth({ adapter, logger: silentLogger });
    expect(health).toMatchObject({ environment: 'staging', baseUrl: 'https://staging.channex.io', configured: true, ok: true });
    expect(calls[0].url).toBe('/properties');
    expect(calls[0].params).toEqual({ 'pagination[limit]': 1 });
    expect(JSON.stringify(health)).not.toContain(API_KEY);
  });

  it('reports a clear auth error for a wrong key', async () => {
    process.env.CHANNEX_API_KEY = API_KEY;
    const { adapter } = fakeAdapter([{ status: 401, data: { errors: { code: 'unauthorized', title: 'Unauthorized' } } }]);
    const health = await checkChannexHealth({ adapter, logger: silentLogger });
    expect(health).toMatchObject({ ok: false, error: { kind: 'auth', status: 401 } });
    expect(health.error!.message).toMatch(/rejected the API key/);
    expect(JSON.stringify(health)).not.toContain(API_KEY);
  });
});
