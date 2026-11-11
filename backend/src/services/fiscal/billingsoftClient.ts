/**
 * BillingSoftClient — the only place that knows BillingSoft's wire format.
 *
 * Pilloto is a partner Organization: one API key (a server secret) authenticates every call, and a
 * call about a tenant names that tenant's Organization in the `BillingSoft-Organization` header.
 * The partner's own routes (provisioning, plans) are called without it.
 *
 * Failures are typed (`BillingSoftError`) with `retryable` set for what is worth sending again with
 * the same idempotency key: network errors, timeouts, 429 and 5xx. The API key is never logged.
 */
import {
  BsAnnulAnswer,
  BsAnnulRequest,
  BsApprovalDecision,
  BsConfigTest,
  BsDecideRequest,
  BsDirectoryEntry,
  BsDocumentAnswer,
  BsDocumentDetail,
  BsDocumentRequest,
  BsDocumentRoute,
  BsDocumentSummary,
  BsOnboarding,
  BsPage,
  BsPartnerOrganization,
  BsPlanId,
  BsPlans,
  BsProvisionAnswer,
  BsProvisionRequest,
  BsReceivedDetail,
  BsReceivedSummary,
  BsRecordSequence,
  BsSequence,
  BsSubscription,
  BsWebhookSecret,
  BsWebhookState,
} from './billingsoftTypes';

export const ORGANIZATION_HEADER = 'BillingSoft-Organization';
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export class BillingSoftError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when BillingSoft could not be reached. */
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly fields?: Record<string, string>,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'BillingSoftError';
  }
}

export interface BillingSoftClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Per-request time limit. */
  timeoutMs?: number;
}

/**
 * The `organizationId` that means Pilloto itself: the partner key, with no customer header, acts for
 * the partner's own Organization (the one that issues Pilloto's e-CF).
 */
export const OWN_ORGANIZATION = 'self';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface CallOptions {
  /** The customer Organization to act for; omit for the partner's own routes. */
  organizationId?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  /** What the caller expects back. */
  as?: 'json' | 'buffer' | 'text' | 'none';
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Issuing signs and sends to DGII before answering, so it gets longer. */
const ISSUE_TIMEOUT_MS = 45_000;

export function createBillingSoftClient(options: BillingSoftClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(method: Method, path: string, opts: CallOptions = {}): Promise<T> {
    if (!options.apiKey) {
      throw new BillingSoftError('Electronic invoicing is not configured on this server', 503, 'NOT_CONFIGURED');
    }
    const qs = opts.query
      ? Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    const url = `${baseUrl}/v1${path}${qs ? `?${qs}` : ''}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: opts.as === 'buffer' ? '*/*' : 'application/json',
    };
    if (opts.organizationId && opts.organizationId !== OWN_ORGANIZATION) headers[ORGANIZATION_HEADER] = opts.organizationId;
    if (opts.idempotencyKey) headers[IDEMPOTENCY_HEADER] = opts.idempotencyKey;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      throw new BillingSoftError(
        aborted ? 'BillingSoft did not answer in time' : `Could not reach BillingSoft: ${err?.message ?? 'network error'}`,
        0,
        aborted ? 'TIMEOUT' : 'NETWORK',
        undefined,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw await toError(response);
    if (response.status === 204 || opts.as === 'none') return undefined as T;
    if (opts.as === 'buffer') return Buffer.from(await response.arrayBuffer()) as unknown as T;
    if (opts.as === 'text') return (await response.text()) as unknown as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new BillingSoftError('BillingSoft returned an unreadable answer', response.status, 'BAD_RESPONSE', undefined, true);
    }
  }

  async function toError(response: Response): Promise<BillingSoftError> {
    let code: string | undefined;
    let message = `BillingSoft answered ${response.status}`;
    let fields: Record<string, string> | undefined;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
      if (body?.error) {
        code = body.error.code;
        message = body.error.message || message;
        fields = body.error.fields;
      }
    } catch {
      /* non-JSON error body: keep the generic message */
    }
    const retryable = response.status === 429 || response.status >= 500;
    return new BillingSoftError(message, response.status, code, fields, retryable);
  }

  const forOrg = (organizationId: string) => ({ organizationId });

  return {
    // ── Partner (Pilloto's own routes) ─────────────────────────────────────────
    plans: () => call<BsPlans>('GET', '/plans'),

    provisionOrganization: (body: BsProvisionRequest) =>
      call<BsProvisionAnswer>('POST', '/partner/organizations', { body }),

    getOrganization: (id: string) =>
      call<{ organization: BsPartnerOrganization }>('GET', `/partner/organizations/${encodeURIComponent(id)}`).then(
        (r) => r.organization,
      ),

    findOrganizationByRef: async (externalRef: string): Promise<BsPartnerOrganization | null> => {
      const r = await call<{ organizations: BsPartnerOrganization[] }>('GET', '/partner/organizations', {
        query: { externalRef },
      });
      return r.organizations[0] ?? null;
    },

    updateOrganization: (
      id: string,
      patch: { razonSocial?: string; address?: string; plan?: BsPlanId; isActive?: boolean },
    ) =>
      call<{ organization: BsPartnerOrganization }>('PATCH', `/partner/organizations/${encodeURIComponent(id)}`, {
        body: patch,
      }).then((r) => r.organization),

    // ── Acting for a tenant ────────────────────────────────────────────────────
    issue: (organizationId: string, route: BsDocumentRoute, body: BsDocumentRequest, idempotencyKey: string) =>
      call<BsDocumentAnswer>('POST', `/${route}`, {
        ...forOrg(organizationId),
        body,
        idempotencyKey,
        timeoutMs: ISSUE_TIMEOUT_MS,
      }),

    getDocument: (organizationId: string, documentId: string) =>
      call<{ document: BsDocumentDetail }>('GET', `/documents/${encodeURIComponent(documentId)}`, forOrg(organizationId)).then(
        (r) => r.document,
      ),

    listDocuments: async (
      organizationId: string,
      query: { page?: number; type?: string; status?: string; from?: string; to?: string; q?: string } = {},
    ): Promise<BsPage<BsDocumentSummary>> => {
      const r = await call<{ documents: BsDocumentSummary[]; page: number; pageSize: number; total: number }>(
        'GET',
        '/documents',
        { ...forOrg(organizationId), query },
      );
      return { page: r.page, pageSize: r.pageSize, total: r.total, items: r.documents };
    },

    getDocumentXml: (organizationId: string, documentId: string) =>
      call<Buffer>('GET', `/documents/${encodeURIComponent(documentId)}/xml`, { ...forOrg(organizationId), as: 'buffer' }),

    getDocumentPdf: (organizationId: string, documentId: string) =>
      call<Buffer>('GET', `/documents/${encodeURIComponent(documentId)}/pdf`, { ...forOrg(organizationId), as: 'buffer' }),

    refreshDocument: (organizationId: string, documentId: string) =>
      call<{ document: BsDocumentDetail }>('POST', `/documents/${encodeURIComponent(documentId)}/refresh-status`, forOrg(organizationId)).then(
        (r) => r.document,
      ),

    annulSequences: (organizationId: string, body: BsAnnulRequest) =>
      call<BsAnnulAnswer>('POST', '/sequences/annul', { ...forOrg(organizationId), body }),

    listSequences: (organizationId: string) =>
      call<{ sequences: BsSequence[] }>('GET', '/sequences', forOrg(organizationId)).then((r) => r.sequences),

    recordSequence: (organizationId: string, body: BsRecordSequence) =>
      call<{ sequence: BsSequence }>('POST', '/sequences', { ...forOrg(organizationId), body }).then((r) => r.sequence),

    onboarding: (organizationId: string) => call<BsOnboarding>('GET', '/onboarding', forOrg(organizationId)),

    configTest: (organizationId: string) => call<BsConfigTest>('GET', '/config/test', forOrg(organizationId)),

    directory: (organizationId: string, rnc: string) =>
      call<BsDirectoryEntry>('GET', '/directory', { ...forOrg(organizationId), query: { rnc } }),

    subscription: (organizationId: string, period?: string) =>
      call<{ subscription: BsSubscription }>('GET', '/subscription', {
        ...forOrg(organizationId),
        query: { period },
      }).then((r) => r.subscription),

    // ── Received documents and commercial approval ─────────────────────────────
    listReceived: async (
      organizationId: string,
      query: { page?: number; filter?: 'undecided' | 'approved' | 'rejected'; q?: string } = {},
    ): Promise<BsPage<BsReceivedSummary>> => {
      const r = await call<{ documents: BsReceivedSummary[]; page: number; pageSize: number; total: number }>(
        'GET',
        '/received',
        { ...forOrg(organizationId), query },
      );
      return { page: r.page, pageSize: r.pageSize, total: r.total, items: r.documents };
    },

    getReceived: (organizationId: string, id: string) =>
      call<{ document: BsReceivedDetail }>('GET', `/received/${encodeURIComponent(id)}`, forOrg(organizationId)).then(
        (r) => r.document,
      ),

    getReceivedFile: (organizationId: string, id: string, file: 'xml' | 'pdf' | 'acknowledgment') =>
      call<Buffer>('GET', `/received/${encodeURIComponent(id)}/${file}`, { ...forOrg(organizationId), as: 'buffer' }),

    decideReceived: (organizationId: string, id: string, body: BsDecideRequest) =>
      call<{ document: BsReceivedDetail }>('POST', `/received/${encodeURIComponent(id)}/decision`, {
        ...forOrg(organizationId),
        body,
      }).then((r) => r.document),

    retryReceivedDelivery: (organizationId: string, id: string, target: 'dgii' | 'issuer') =>
      call<{ document: BsReceivedDetail }>('POST', `/received/${encodeURIComponent(id)}/deliveries/${target}/retry`, forOrg(organizationId)).then(
        (r) => r.document,
      ),

    // ── Webhook ────────────────────────────────────────────────────────────────
    getWebhook: (organizationId: string) => call<BsWebhookState>('GET', '/webhook', forOrg(organizationId)),

    setWebhook: (organizationId: string, url: string) =>
      call<BsWebhookSecret>('PUT', '/webhook', { ...forOrg(organizationId), body: { url } }),

    rotateWebhookSecret: (organizationId: string) =>
      call<BsWebhookSecret>('POST', '/webhook/rotate-secret', forOrg(organizationId)),

    deleteWebhook: (organizationId: string) =>
      call<void>('DELETE', '/webhook', { ...forOrg(organizationId), as: 'none' }),
  };
}

export type BillingSoftClient = ReturnType<typeof createBillingSoftClient>;
export type { BsApprovalDecision };
