/**
 * HandyPay (handypay.me) — the gateway tenants pay Pilloto's charges through.
 *
 * Pilloto creates a hosted checkout session for a charge (`POST /v1/payment-sessions`, amounts in
 * centavos), sends the tenant to its `url`, and learns of the payment from a signed webhook
 * (`X-HandyPay-Signature: sha256=<hex>`, HMAC-SHA256 of the raw body with the endpoint's signing
 * secret). The webhook is only a hint: the session is always read back (`GET
 * /v1/payment-sessions/:id`) before a payment is recorded.
 *
 * Configuration (server environment, like BillingSoft's partner key):
 *   HANDYPAY_API_KEY         `hp_live_…` or `hp_test_…` (sandbox)
 *   HANDYPAY_WEBHOOK_SECRET  the signing secret HandyPay showed when the webhook endpoint was created
 *   HANDYPAY_API_URL         default https://api.handypay.me/api
 *   HANDYPAY_CURRENCY        default dop
 */
import crypto from 'crypto';

export interface HandyPayConfig {
  apiUrl: string;
  apiKey: string;
  webhookSecret: string;
  currency: string;
}

export function getHandyPayConfig(env: NodeJS.ProcessEnv = process.env): HandyPayConfig {
  return {
    apiUrl: (env.HANDYPAY_API_URL || 'https://api.handypay.me/api').trim().replace(/\/+$/, ''),
    apiKey: (env.HANDYPAY_API_KEY || '').trim(),
    webhookSecret: (env.HANDYPAY_WEBHOOK_SECRET || '').trim(),
    currency: (env.HANDYPAY_CURRENCY || 'dop').trim().toLowerCase(),
  };
}

export const isHandyPayConfigured = (cfg: HandyPayConfig = getHandyPayConfig()): boolean => cfg.apiKey.length > 0;
export const isHandyPaySandbox = (cfg: HandyPayConfig = getHandyPayConfig()): boolean => cfg.apiKey.startsWith('hp_test_');

export class HandyPayError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'HandyPayError';
  }
}

export interface CreateSessionInput {
  /** Smallest currency unit (centavos). */
  amount: number;
  currency: string;
  name: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

export interface HandyPaySession {
  id: string;
  url?: string;
  /** `open` | `complete` | `expired` (Stripe-style), when HandyPay reports it. */
  status?: string;
  /** `paid` | `unpaid` | `no_payment_required`, when reported. */
  paymentStatus?: string;
  /** Smallest currency unit. */
  amountTotal?: number;
  currency?: string;
  paymentIntent?: string;
  metadata?: Record<string, string>;
}

export interface HandyPayClient {
  createSession(input: CreateSessionInput): Promise<HandyPaySession>;
  getSession(id: string): Promise<HandyPaySession>;
}

/** HandyPay answers either the object itself or `{ success, data }`; sessions may name fields either way. */
export function parseSession(body: any): HandyPaySession {
  const o = body?.data?.session ?? body?.session ?? body?.data ?? body ?? {};
  const id = o.id ?? o.session_id ?? o.sessionId;
  if (!id) throw new HandyPayError(502, 'handypay_bad_response', 'HandyPay did not return a session id');
  const pi = o.payment_intent ?? o.paymentIntent;
  return {
    id: String(id),
    url: o.url ?? o.checkout_url ?? o.checkoutUrl,
    status: o.status,
    paymentStatus: o.payment_status ?? o.paymentStatus,
    amountTotal: typeof (o.amount_total ?? o.amountTotal) === 'number' ? (o.amount_total ?? o.amountTotal) : undefined,
    currency: o.currency,
    paymentIntent: typeof pi === 'string' ? pi : pi?.id,
    metadata: o.metadata ?? undefined,
  };
}

/** A session HandyPay considers paid. */
export const isSessionPaid = (s: HandyPaySession): boolean => s.paymentStatus === 'paid' || (s.status === 'complete' && s.paymentStatus === undefined);

export function createHandyPayClient(cfg: HandyPayConfig = getHandyPayConfig(), fetchImpl: typeof fetch = fetch): HandyPayClient {
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    if (!cfg.apiKey) throw new HandyPayError(503, 'handypay_not_configured', 'Online payments are not configured');
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.apiUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err: any) {
      throw new HandyPayError(503, 'handypay_unreachable', `HandyPay could not be reached: ${err?.message ?? err}`);
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok || json?.success === false) {
      const code = json?.error?.code ?? `http_${res.status}`;
      throw new HandyPayError(res.status >= 500 ? 502 : res.status, code, json?.error?.message ?? `HandyPay answered ${res.status}`);
    }
    return json;
  };

  return {
    async createSession(input) {
      const body = {
        line_items: [{ name: input.name, amount: input.amount, currency: input.currency, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      };
      return parseSession(await call('POST', '/v1/payment-sessions', body));
    },
    async getSession(id) {
      return parseSession(await call('GET', `/v1/payment-sessions/${encodeURIComponent(id)}`));
    },
  };
}

/** Constant-time check of `X-HandyPay-Signature: sha256=<hex>` over the raw body. */
export function verifyHandyPaySignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const given = header.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(given.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
}

// ─── Test seam ───────────────────────────────────────────────────────────────

let override: HandyPayClient | null = null;
export const setHandyPayClient = (client: HandyPayClient | null): void => { override = client; };
export const getHandyPayClient = (): HandyPayClient => override ?? createHandyPayClient();
