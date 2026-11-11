/**
 * A stateful stand-in for BillingSoft's API, shaped like the real client (`BillingSoftClient`).
 * It honours what the tests rely on: an `Idempotency-Key` returns the original answer, documents
 * keep their status, partner provisioning is idempotent on `externalRef`, and any call can be made
 * to fail once with a chosen error.
 */
import { BillingSoftClient, BillingSoftError } from '../../services/fiscal/billingsoftClient';
import {
  BsDocumentAnswer,
  BsDocumentDetail,
  BsDocumentRequest,
  BsPartnerOrganization,
  BsPlans,
  BsSequence,
  BsSubscription,
} from '../../services/fiscal/billingsoftTypes';

export const PLANS: BsPlans = {
  currency: 'DOP',
  annualDiscountPercent: 10,
  plans: [
    { id: 'essential', users: 1, transactions: 300, price: { monthly: 475, annual: 5130 }, overageUnitPrice: 4.75 },
    { id: 'pro', users: 3, transactions: 1000, price: { monthly: 800, annual: 8640 }, overageUnitPrice: 2.4 },
    { id: 'max', users: 5, transactions: 3000, price: { monthly: 1500, annual: 16200 }, overageUnitPrice: 1.5 },
  ],
};

export interface FakeBillingSoft {
  client: BillingSoftClient;
  documents: Map<string, BsDocumentDetail>;
  organizations: Map<string, BsPartnerOrganization>;
  /** Number of documents actually created (an idempotent replay creates none). */
  created: () => number;
  calls: string[];
  /** Make the next call to `method` fail with `error`. */
  failNext: (method: string, error: Error) => void;
  /** Set what `subscription()` reports. */
  usage: { used: number; periodStart?: string };
  /** Move a document to a new status, as DGII's answer would. */
  setStatus: (documentId: string, status: BsDocumentDetail['status']) => void;
  webhookSecret: string | undefined;
  sequences: BsSequence[];
  /** Pilloto's own Organization (`self`): certified by default, as a partner that has completed DGII's process. */
  own: { environment: 'testecf' | 'certecf' | 'ecf'; certification: 'not_started' | 'in_progress' | 'certified' };
}

export function createFakeBillingSoft(): FakeBillingSoft {
  const documents = new Map<string, BsDocumentDetail>();
  const answers = new Map<string, BsDocumentAnswer>();
  const organizations = new Map<string, BsPartnerOrganization>();
  const failures = new Map<string, Error>();
  const calls: string[] = [];
  let counter = 0;
  let createdCount = 0;
  const fake: Partial<FakeBillingSoft> = { usage: { used: 0 }, webhookSecret: undefined, sequences: [], own: { environment: 'ecf', certification: 'certified' } };
  let webhookUrl: string | undefined;

  const hit = (method: string, ...args: unknown[]) => {
    calls.push(`${method}${args.length ? ` ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}` : ''}`);
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
  };

  const totalOf = (request: BsDocumentRequest) =>
    request.lines.reduce((sum, l) => {
      const rate = l.tax === 'itbis18' ? 0.18 : l.tax === 'itbis16' ? 0.16 : 0;
      const amount = Math.round(Number(l.quantity) * Number(l.unitPrice) * 100) / 100;
      return sum + amount + Math.round(amount * rate * 100) / 100;
    }, 0);

  const client = {
    plans: async () => (hit('plans'), PLANS),

    provisionOrganization: async (body: any) => {
      hit('provisionOrganization', body.externalRef);
      if ([...organizations.values()].some((o) => o.rnc === body.rnc)) {
        throw new BillingSoftError('Ya existe una organización con ese RNC.', 409, 'CONFLICT');
      }
      const organization: BsPartnerOrganization = {
        id: `org-${++counter}`,
        externalRef: body.externalRef,
        rnc: body.rnc,
        razonSocial: body.razonSocial,
        address: body.address,
        plan: body.plan,
        environment: 'testecf',
        certification: 'not_started',
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      organizations.set(organization.id, organization);
      return { organization, admin: { email: body.admin.email, invited: true } };
    },

    getOrganization: async (id: string) => {
      hit('getOrganization', id);
      const org = organizations.get(id);
      if (!org) throw new BillingSoftError('Organization not found.', 404, 'NOT_FOUND');
      return org;
    },

    findOrganizationByRef: async (externalRef: string) => {
      hit('findOrganizationByRef', externalRef);
      return [...organizations.values()].find((o) => o.externalRef === externalRef) ?? null;
    },

    updateOrganization: async (id: string, patch: any) => {
      hit('updateOrganization', id, patch);
      const org = organizations.get(id);
      if (!org) throw new BillingSoftError('Organization not found.', 404, 'NOT_FOUND');
      Object.assign(org, patch);
      return org;
    },

    issue: async (organizationId: string, route: string, body: BsDocumentRequest, key: string) => {
      hit('issue', route, key);
      const replay = answers.get(`${organizationId}:${key}`);
      if (replay) return replay;
      createdCount++;
      const id = `doc-${++counter}`;
      const encf = `E${body.type}${String(counter).padStart(10, '0')}`;
      const detail: BsDocumentDetail = {
        id,
        type: body.type,
        encf,
        issuedOn: new Date().toISOString().slice(0, 10),
        total: totalOf(body).toFixed(2),
        status: 'in_process',
        createdAt: new Date().toISOString(),
        securityCode: 'SEC123',
        fileName: `${encf}.xml`,
        submissions: [{ route: 'ecf', trackId: `track-${counter}`, status: 'in_process', messages: [], submittedAt: new Date().toISOString() }],
        incomeType: body.incomeType,
        lines: body.lines,
        notes: [],
        creditable: '0.00',
      };
      documents.set(id, detail);
      const answer: BsDocumentAnswer = { documentId: id, encf, type: body.type, status: 'in_process', trackId: `track-${counter}` };
      answers.set(`${organizationId}:${key}`, answer);
      return answer;
    },

    getDocument: async (_org: string, id: string) => {
      hit('getDocument', id);
      const doc = documents.get(id);
      if (!doc) throw new BillingSoftError('Not found', 404, 'NOT_FOUND');
      return doc;
    },

    refreshDocument: async (_org: string, id: string) => {
      hit('refreshDocument', id);
      const doc = documents.get(id);
      if (!doc) throw new BillingSoftError('Not found', 404, 'NOT_FOUND');
      return doc;
    },

    listDocuments: async (_org: string, query: { from?: string; to?: string }) => {
      hit('listDocuments', query);
      const items = [...documents.values()];
      return { page: 1, pageSize: 25, total: items.length, items };
    },

    getDocumentPdf: async (_org: string, id: string) => (hit('getDocumentPdf', id), Buffer.from(`%PDF-1.4 ${id}`)),
    getDocumentXml: async (_org: string, id: string) => (hit('getDocumentXml', id), Buffer.from(`<ECF id="${id}"/>`)),

    onboarding: async (id: string) => {
      hit('onboarding', id);
      const org = id === 'self' ? fake.own : organizations.get(id);
      return {
        environment: org?.environment ?? 'testecf',
        certification: org?.certification ?? 'not_started',
        onboarding: {
          steps: [
            { step: 'profile', done: true },
            { step: 'certificate', done: false },
            { step: 'sequences', done: false },
            { step: 'directory', done: false },
            { step: 'first_document', done: false },
          ],
          complete: false,
        },
      };
    },

    configTest: async (id: string) => {
      hit('configTest', id);
      const org = organizations.get(id);
      return {
        organization: id === 'self' ? { rnc: '131000000', razonSocial: 'Pilloto SRL' } : { rnc: org?.rnc ?? '', razonSocial: org?.razonSocial ?? '' },
        environment: org?.environment ?? 'testecf',
        certificate: 'valid' as const,
        usableTypes: ['31', '32'] as ('31' | '32')[],
      };
    },

    listSequences: async () => (hit('listSequences'), fake.sequences!),
    recordSequence: async (_org: string, body: any) => {
      hit('recordSequence', body);
      const seq: BsSequence = { id: `seq-${++counter}`, ...body, next: body.rangeStart, remaining: body.rangeEnd - body.rangeStart + 1, usable: true };
      fake.sequences!.push(seq);
      return seq;
    },
    annulSequences: async (_org: string, body: any) => (hit('annulSequences', body), { count: 1, outcome: 'confirmed', fileName: 'ANECF.xml' }),

    subscription: async (_org: string, period?: string): Promise<BsSubscription> => {
      hit('subscription', period ?? 'current');
      const start = fake.usage!.periodStart ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 4)).toISOString();
      const included = 300;
      const used = fake.usage!.used;
      return {
        plan: 'essential',
        billingInterval: 'monthly',
        status: 'active',
        billedBy: 'partner',
        period: { start, end: start },
        users: { used: 1, limit: 1 },
        transactions: { used, included, extra: Math.max(0, used - included), overageUnitPrice: 4.75, overageAmount: Math.max(0, used - included) * 4.75 },
      };
    },

    getWebhook: async () => (hit('getWebhook'), { webhook: webhookUrl ? { url: webhookUrl, createdAt: new Date().toISOString() } : null, deliveries: [] }),
    setWebhook: async (_org: string, url: string) => {
      hit('setWebhook', url);
      const first = !webhookUrl;
      webhookUrl = url;
      if (first) fake.webhookSecret = 'whsec_fake_secret';
      return { webhook: { url, createdAt: new Date().toISOString() }, ...(first ? { secret: fake.webhookSecret } : {}) };
    },
    rotateWebhookSecret: async () => {
      hit('rotateWebhookSecret');
      fake.webhookSecret = `whsec_rotated_${++counter}`;
      return { webhook: { url: webhookUrl!, createdAt: new Date().toISOString() }, secret: fake.webhookSecret };
    },
    deleteWebhook: async () => void hit('deleteWebhook'),

    listReceived: async () => (hit('listReceived'), { page: 1, pageSize: 25, total: 0, items: [] }),
    getReceived: async () => { throw new BillingSoftError('Not found', 404, 'NOT_FOUND'); },
    getReceivedFile: async () => Buffer.from(''),
    decideReceived: async (_org: string, id: string, body: any) => (hit('decideReceived', id, body), { id } as any),
    retryReceivedDelivery: async () => ({}) as any,
    directory: async (_org: string, rnc: string) => {
      hit('directory', rnc);
      throw new BillingSoftError('That issuer is not in the DGII directory.', 404, 'NOT_FOUND');
    },
  } as unknown as BillingSoftClient;

  return Object.assign(fake, {
    client,
    documents,
    organizations,
    calls,
    created: () => createdCount,
    failNext: (method: string, error: Error) => void failures.set(method, error),
    setStatus: (documentId: string, status: BsDocumentDetail['status']) => {
      const doc = documents.get(documentId)!;
      doc.status = status;
      doc.submissions = [{ ...doc.submissions[0], status: status as any, messages: status === 'rejected' ? [{ message: 'Rechazado por DGII' }] : [] }];
    },
  }) as FakeBillingSoft;
}

export const networkError = () => new BillingSoftError('Could not reach BillingSoft', 0, 'NETWORK', undefined, true);
export const serverError = () => new BillingSoftError('BillingSoft answered 503', 503, undefined, undefined, true);
export const validationError = (message = 'El comprador es obligatorio') =>
  new BillingSoftError(message, 400, 'VALIDATION_ERROR', { buyer: message });
