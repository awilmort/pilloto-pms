/**
 * ChannexClient — HTTP client for the Channex API (CHANNEX_ARCHITECTURE.md §2, §5.2).
 *
 * Design principles:
 *   - One platform API key (`CHANNEX_API_KEY`) sent as the `user-api-key` header; it is
 *     NEVER logged, returned, or attached to thrown errors (errors carry no axios config).
 *   - Every failure is classified into a typed error the workers act on:
 *       429                 → ChannexRateLimitError   (pause + backoff)
 *       5xx, 408, network   → ChannexRetryableError   (pause + backoff)
 *       401 / 403           → ChannexAuthError        (bad key or IP allowlist)
 *       other 4xx w/ errors → ChannexValidationError  (do not retry as-is)
 *   - JSON:API unwrap helpers flatten `{ id, type, attributes }` resources.
 *   - Paths are relative to `/api/v1` (e.g. `client.get('/properties')`).
 */

import axios, { AxiosAdapter, AxiosError, AxiosInstance, Method } from 'axios';
import { ChannexConfig, getChannexConfig } from './config';

export const CHANNEX_TIMEOUT_MS = 20_000;
export const CHANNEX_PAGE_LIMIT = 100;
const MAX_PAGES = 1000;
const LOG_BODY_LIMIT = 500;

// ─── Errors ──────────────────────────────────────────────────────────────────

export interface ChannexErrorOptions {
  status?: number;
  code?: string;
  details?: unknown;
}

export class ChannexError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, opts: ChannexErrorOptions = {}) {
    super(message);
    this.name = 'ChannexError';
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export class ChannexRateLimitError extends ChannexError {
  public readonly retryAfterSeconds?: number;

  constructor(message: string, opts: ChannexErrorOptions & { retryAfterSeconds?: number } = {}) {
    super(message, opts);
    this.name = 'ChannexRateLimitError';
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

export class ChannexRetryableError extends ChannexError {
  constructor(message: string, opts: ChannexErrorOptions = {}) {
    super(message, opts);
    this.name = 'ChannexRetryableError';
  }
}

export class ChannexAuthError extends ChannexError {
  constructor(message: string, opts: ChannexErrorOptions = {}) {
    super(message, opts);
    this.name = 'ChannexAuthError';
  }
}

export class ChannexValidationError extends ChannexError {
  constructor(message: string, opts: ChannexErrorOptions = {}) {
    super(message, opts);
    this.name = 'ChannexValidationError';
  }
}

export class ChannexNotConfiguredError extends ChannexError {
  constructor() {
    super('Channex is not configured (CHANNEX_API_KEY is missing).');
    this.name = 'ChannexNotConfiguredError';
  }
}

// ─── Redaction / truncation ──────────────────────────────────────────────────

/** Replace every occurrence of the secret in `text` (no-op without a secret). */
export function redact(text: string, secret?: string): string {
  if (!secret) return text;
  return text.split(secret).join('[REDACTED]');
}

export function truncate(text: string, limit = LOG_BODY_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}… (${text.length} chars)` : text;
}

const CARD_FIELDS_RE = /("(?:card_number|cvv|cvc|cvv2|card_cvv|cardholder_name|card_holder|card_token|token)"\s*:\s*)("(?:[^"\\]|\\.)*"|\d+)/gi;
/** 13–19 digits, optionally grouped by spaces/dashes: a card number (Luhn not checked: over-redacting is fine) */
const PAN_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

/** Card fields and anything shaped like a card number, masked (PCI: such data must never reach a log). */
export function redactCardData(text: string): string {
  return text.replace(CARD_FIELDS_RE, '$1"[REDACTED]"').replace(PAN_RE, '[CARD]');
}

/** A body as loggable text: redacted first (so a cut can never expose part of the secret), then truncated. */
export function loggableBody(value: unknown, secret?: string, limit = LOG_BODY_LIMIT): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  } catch {
    text = String(value);
  }
  return truncate(redactCardData(redact(text, secret)), limit);
}

// ─── Classification ──────────────────────────────────────────────────────────

const NETWORK_CODES = new Set([
  'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
  'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ERR_NETWORK', 'ERR_CANCELED',
]);

/** Channex error bodies: `{ errors: { code, title, details } }` (sometimes an array). */
function describeErrorBody(data: unknown): { code?: string; title?: string; details?: unknown; hasErrors: boolean } {
  const errors = (data as any)?.errors;
  if (!errors) return { hasErrors: false };
  const first = Array.isArray(errors) ? errors[0] : errors;
  return {
    hasErrors: true,
    code: typeof first?.code === 'string' ? first.code : undefined,
    title: typeof first?.title === 'string' ? first.title : undefined,
    details: first?.details ?? (Array.isArray(errors) ? errors : undefined),
  };
}

function parseRetryAfter(header: unknown): number | undefined {
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Turn any thrown value from an HTTP call into a typed ChannexError (secret-free). */
export function classifyChannexError(err: unknown, secret?: string): ChannexError {
  if (err instanceof ChannexError) return err;

  const axiosErr = err as AxiosError;
  if (!axios.isAxiosError(axiosErr)) {
    return new ChannexError(redact(err instanceof Error ? err.message : String(err), secret));
  }

  const response = axiosErr.response;
  if (!response) {
    const code = axiosErr.code;
    const reason = code && NETWORK_CODES.has(code) ? code : (code || 'network error');
    return new ChannexRetryableError(redact(`Channex unreachable (${reason})`, secret), { code });
  }

  const status = response.status;
  const body = describeErrorBody(response.data);
  const summary = truncate(redact([body.code, body.title].filter(Boolean).join(': '), secret), 300);
  const details = body.details !== undefined
    ? JSON.parse(redact(JSON.stringify(body.details), secret))
    : undefined;
  const opts = { status, code: body.code, details };
  const msg = (base: string) => (summary ? `${base} — ${summary}` : base);

  if (status === 429) {
    return new ChannexRateLimitError(msg('Channex rate limit reached (429)'), {
      ...opts, retryAfterSeconds: parseRetryAfter(response.headers?.['retry-after']),
    });
  }
  if (status === 401 || status === 403) {
    return new ChannexAuthError(msg(`Channex rejected the API key (${status}) — check CHANNEX_API_KEY and the key's IP allowlist`), opts);
  }
  if (status >= 500 || status === 408) {
    return new ChannexRetryableError(msg(`Channex server error (${status})`), opts);
  }
  if (body.hasErrors) {
    return new ChannexValidationError(msg(`Channex rejected the request (${status})`), opts);
  }
  return new ChannexError(msg(`Channex request failed (${status})`), opts);
}

// ─── JSON:API helpers ────────────────────────────────────────────────────────

export interface JsonApiResource<A = Record<string, any>> {
  id: string;
  type: string;
  attributes?: A;
  relationships?: Record<string, any>;
}

export type Unwrapped<A = Record<string, any>> = A & { id: string; type: string; relationships?: Record<string, any> };

/** `{ id, type, attributes, relationships }` → `{ id, type, ...attributes, relationships }` */
export function unwrapResource<A = Record<string, any>>(resource: JsonApiResource<A>): Unwrapped<A> {
  const { id, type, attributes, relationships } = resource;
  const out = { ...(attributes as A), id, type } as Unwrapped<A>;
  if (relationships) out.relationships = relationships;
  return out;
}

/** Unwrap a response body's `data` (single resource or list). */
export function unwrapOne<A = Record<string, any>>(body: { data?: JsonApiResource<A> }): Unwrapped<A> {
  if (!body?.data || Array.isArray(body.data)) throw new ChannexError('Unexpected Channex response: expected a single resource');
  return unwrapResource(body.data);
}

export function unwrapMany<A = Record<string, any>>(body: { data?: JsonApiResource<A>[] }): Unwrapped<A>[] {
  if (!Array.isArray(body?.data)) throw new ChannexError('Unexpected Channex response: expected a list');
  return body.data.map((r) => unwrapResource(r));
}

// ─── Client ──────────────────────────────────────────────────────────────────

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface ChannexClient {
  readonly config: ChannexConfig;
  request<T = any>(method: Method, path: string, opts?: { params?: QueryParams; data?: unknown }): Promise<T>;
  get<T = any>(path: string, params?: QueryParams): Promise<T>;
  post<T = any>(path: string, data?: unknown): Promise<T>;
  put<T = any>(path: string, data?: unknown): Promise<T>;
  delete<T = any>(path: string, params?: QueryParams): Promise<T>;
  /** Every page of a list endpoint (`pagination[limit]=100`), unwrapped. */
  paginateAll<A = Record<string, any>>(path: string, params?: QueryParams): Promise<Unwrapped<A>[]>;
}

export interface ChannexClientOptions {
  /** Test seam: a custom axios adapter. */
  adapter?: AxiosAdapter;
  logger?: Pick<Console, 'info' | 'warn'>;
}

export function createChannexClient(
  config: ChannexConfig = getChannexConfig(),
  options: ChannexClientOptions = {},
): ChannexClient {
  const logger = options.logger ?? console;
  const apiKey = config.apiKey;

  const http: AxiosInstance = axios.create({
    baseURL: `${config.baseUrl}/api/v1`,
    timeout: CHANNEX_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });

  async function request<T>(method: Method, path: string, opts: { params?: QueryParams; data?: unknown } = {}): Promise<T> {
    if (!apiKey) throw new ChannexNotConfiguredError();
    const label = `${method.toUpperCase()} ${path}`;
    const started = Date.now();
    try {
      const res = await http.request<T>({
        method,
        url: path,
        params: opts.params,
        data: opts.data,
        headers: { 'user-api-key': apiKey },
      });
      const size = opts.data === undefined ? '' : ` req=${loggableBody(opts.data, apiKey, Infinity).length}ch`;
      logger.info(`[Channex] ${label} → ${res.status} (${Date.now() - started}ms)${size}`);
      return res.data;
    } catch (err) {
      const classified = classifyChannexError(err, apiKey);
      const resBody = axios.isAxiosError(err) && err.response ? ` res=${loggableBody(err.response.data, apiKey)}` : '';
      const reqBody = opts.data === undefined ? '' : ` req=${loggableBody(opts.data, apiKey)}`;
      logger.warn(`[Channex] ${label} → ${classified.name}: ${classified.message} (${Date.now() - started}ms)${reqBody}${resBody}`);
      throw classified;
    }
  }

  async function paginateAll<A>(path: string, params: QueryParams = {}): Promise<Unwrapped<A>[]> {
    const out: Unwrapped<A>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await request<{ data?: JsonApiResource<A>[]; meta?: { total?: number } }>('get', path, {
        params: { ...params, 'pagination[page]': page, 'pagination[limit]': CHANNEX_PAGE_LIMIT },
      });
      const items = Array.isArray(body?.data) ? body.data : [];
      out.push(...items.map((r) => unwrapResource(r)));
      const total = body?.meta?.total;
      if (items.length < CHANNEX_PAGE_LIMIT || (typeof total === 'number' && out.length >= total)) break;
    }
    return out;
  }

  return {
    config,
    request,
    get: (path, params) => request('get', path, { params }),
    post: (path, data) => request('post', path, { data }),
    put: (path, data) => request('put', path, { data }),
    delete: (path, params) => request('delete', path, { params }),
    paginateAll,
  };
}
