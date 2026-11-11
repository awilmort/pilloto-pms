/**
 * The shapes of BillingSoft's public API (`/v1`) that Pilloto uses. BillingSoft is a separate
 * system with its own repository, so these are written out here rather than imported; its OpenAPI
 * document (`/v1/openapi.json`) is the source of truth. Amounts are decimal strings.
 */

export type BsEcfType = '31' | '32' | '33' | '34' | '41' | '43' | '44' | '45' | '46' | '47';
export type BsLineTax = 'itbis18' | 'itbis16' | 'itbis0' | 'exempt';
export type BsLineKind = 'good' | 'service';
export type BsModification =
  | 'void'
  | 'correctsText'
  | 'correctsAmounts'
  | 'replacesContingency'
  | 'consumerInvoice';
export type BsDocumentRoute = 'invoices' | 'credit-notes' | 'debit-notes' | 'other';
export type BsEnvironment = 'testecf' | 'certecf' | 'ecf';
export type BsCertification = 'not_started' | 'in_progress' | 'certified';

export type BsDocumentStatus =
  | 'signed'
  | 'in_process'
  | 'accepted'
  | 'conditionally_accepted'
  | 'rejected'
  | 'unresolved'
  | 'annulled';

export interface BsLine {
  name: string;
  kind: BsLineKind;
  quantity: string;
  /** Before ITBIS. */
  unitPrice: string;
  tax: BsLineTax;
  withholding?: { itbis?: string; isr?: string };
}

export interface BsBuyer {
  name: string;
  rnc?: string;
  foreignId?: string;
  email?: string;
  address?: string;
}

export type BsPayment =
  | { type: 'cash' }
  | { type: 'credit'; dueOn: string }
  | { type: 'free' };

export interface BsReference {
  ncf: string;
  /** `YYYY-MM-DD`. */
  issuedOn: string;
  modification: BsModification;
  reason?: string;
}

/** The body of `POST /v1/{invoices,credit-notes,debit-notes,other}`. */
export interface BsDocumentRequest {
  type: BsEcfType;
  buyer?: BsBuyer;
  reference?: BsReference;
  incomeType?: '01' | '02' | '03' | '04' | '05' | '06';
  payment: BsPayment;
  lines: BsLine[];
}

export interface BsDocumentAnswer {
  documentId: string;
  encf: string;
  type: BsEcfType;
  status: BsDocumentStatus;
  trackId?: string;
  dgiiError?: string;
}

export interface BsSubmission {
  route: 'ecf' | 'rfce';
  trackId?: string;
  status: Exclude<BsDocumentStatus, 'signed' | 'annulled'>;
  messages: { code?: string; message: string }[];
  submittedAt: string;
  resolvedAt?: string;
}

export interface BsDocumentSummary {
  id: string;
  type: BsEcfType;
  encf: string;
  issuedOn: string;
  buyerName?: string;
  buyerRnc?: string;
  buyerForeignId?: string;
  referencedNcf?: string;
  total: string;
  status: BsDocumentStatus;
  createdAt: string;
  contingency?: boolean;
}

export interface BsDocumentDetail extends BsDocumentSummary {
  securityCode: string;
  fileName: string;
  submissions: BsSubmission[];
  buyerApproval?: { decision: 'approved' | 'rejected'; reason?: string; decidedAt: string; receivedAt: string };
  incomeType?: string;
  lines: BsLine[];
  referencedDocumentId?: string;
  notes: Pick<BsDocumentSummary, 'id' | 'type' | 'encf' | 'issuedOn' | 'total' | 'status'>[];
  creditable: string;
}

export interface BsPage<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

export interface BsOnboarding {
  environment: BsEnvironment;
  certification: BsCertification;
  onboarding: {
    steps: { step: 'profile' | 'certificate' | 'sequences' | 'directory' | 'first_document'; done: boolean }[];
    complete: boolean;
  };
}

export interface BsConfigTest {
  organization: { rnc: string; razonSocial: string };
  environment: string;
  certificate: 'valid' | 'expiring' | 'expired' | 'not_yet_valid' | 'none';
  usableTypes: BsEcfType[];
}

export interface BsSequence {
  id: string;
  documentType: BsEcfType;
  rangeStart: number;
  rangeEnd: number;
  next: number;
  expiresOn?: string;
  remaining: number;
  usable: boolean;
}

export interface BsRecordSequence {
  documentType: BsEcfType;
  rangeStart: number;
  rangeEnd: number;
  expiresOn?: string;
}

export interface BsAnnulRequest {
  ranges: { documentType: BsEcfType; from: number; to: number }[];
}

export interface BsAnnulAnswer {
  count: number;
  outcome: string;
  fileName: string;
}

export interface BsDirectoryEntry {
  rnc: string;
  name: string;
  receptionUrl?: string;
  approvalUrl?: string;
  authenticationUrl?: string;
}

export type BsApprovalDecision = 'approved' | 'rejected';
export type BsDeliveryTarget = 'dgii' | 'issuer';

export interface BsReceivedSummary {
  id: string;
  type: BsEcfType;
  encf: string;
  issuerRnc: string;
  issuerName: string;
  issuedOn: string;
  total: string;
  receivedAt: string;
  decision: BsApprovalDecision | null;
}

export interface BsReceivedDetail extends BsReceivedSummary {
  itbisTotal?: string;
  referencedNcf?: string;
  securityCode: string;
  fileName: string;
  approval: { decision: BsApprovalDecision; reason?: string; decidedAt: string; decidedBy: string } | null;
  deliveries: {
    target: BsDeliveryTarget;
    status: 'pending' | 'delivered' | 'refused' | 'failed';
    attempts: number;
    lastAttemptAt?: string;
    nextAttemptAt?: string;
    deliveredAt?: string;
    messages: string[];
  }[];
}

export type BsDecideRequest =
  | { decision: 'approved' }
  | { decision: 'rejected'; reason: string };

export type BsPlanId = 'essential' | 'pro' | 'max';

export interface BsPlanTerms {
  id: BsPlanId;
  users: number;
  transactions: number;
  price: { monthly: number; annual: number };
  overageUnitPrice: number;
}

export interface BsPlans {
  currency: 'DOP';
  annualDiscountPercent: number;
  plans: BsPlanTerms[];
}

export interface BsSubscription {
  plan: BsPlanId | 'custom';
  billingInterval: 'monthly' | 'annual';
  status: 'trial' | 'trial_expired' | 'active';
  trialEndsAt?: string;
  billedBy: 'billingsoft' | 'partner';
  period: { start: string; end: string };
  users: { used: number; limit: number | null };
  transactions: {
    used: number;
    included: number | null;
    extra: number;
    overageUnitPrice: number | null;
    overageAmount: number | null;
  };
}

export interface BsPartnerOrganization {
  id: string;
  externalRef: string;
  rnc: string;
  razonSocial: string;
  address?: string;
  plan: BsPlanId | 'custom';
  environment: BsEnvironment;
  certification: BsCertification;
  isActive: boolean;
  createdAt: string;
}

export interface BsProvisionRequest {
  externalRef: string;
  rnc: string;
  razonSocial: string;
  address: string;
  plan: BsPlanId;
  admin: { name: string; email: string };
}

export interface BsProvisionAnswer {
  organization: BsPartnerOrganization;
  admin: { email: string; invited: boolean };
}

export interface BsWebhookState {
  webhook: { url: string; createdAt: string } | null;
  deliveries: {
    id: string;
    eventId: string;
    type: string;
    status: 'pending' | 'delivered' | 'failed';
    attempts: number;
    lastStatus?: number;
    lastError?: string;
    nextAttemptAt?: string;
    createdAt: string;
  }[];
}

export interface BsWebhookSecret {
  webhook: { url: string; createdAt: string };
  /** Present only when just created or rotated: shown once. */
  secret?: string;
}

export type BsWebhookEventType =
  | 'document.accepted'
  | 'document.rejected'
  | 'document.conditionally_accepted'
  | 'document.received'
  | 'organization.certified'
  | 'contingency.entered'
  | 'contingency.regularized'
  | 'sequence.low';

export interface BsWebhookEvent {
  id: string;
  type: BsWebhookEventType;
  organizationId: string;
  createdAt: string;
  data: Record<string, unknown>;
}
