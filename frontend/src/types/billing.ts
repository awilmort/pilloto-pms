/**
 * Pilloto's own subscription billing, as the platform console sees it: the price list, tenant
 * contracts, monthly charges, payments and the e-CF each payment issues.
 */
import type { EcfEstadoECF, EcfTipo, FiscalState } from './index';

export type BillingProduct = 'pms' | 'accounting';
export type BillingTax = 'itbis18' | 'itbis16' | 'itbis0' | 'exempt';
export type BillingChargeStatus = 'open' | 'partial' | 'paid' | 'void';
export type BillingPaymentMethod = 'transfer' | 'deposit' | 'cash' | 'check' | 'card' | 'other';

export const BILLING_PAYMENT_METHODS: BillingPaymentMethod[] = ['transfer', 'deposit', 'cash', 'check', 'card', 'other'];
/** Methods that leave a trace to quote: the payment needs its reference. */
export const METHODS_NEEDING_REFERENCE: BillingPaymentMethod[] = ['transfer', 'deposit', 'check'];

export interface BillingOverview {
  period: string;
  outstanding: { count: number; balance: number };
  overdue: { count: number; balance: number };
  collectedThisMonth: { count: number; amount: number };
  ecf: { notIssued: number; needAttention: number };
  issuer: { state: FiscalState; configured: boolean };
}

export interface BillingSettings {
  tax: BillingTax;
  dueDays: number;
  notifyEmail: string;
  paymentInstructions: string;
}

export interface PriceHistoryEntry { previous: number | null; price: number; changedAt: string; changedByEmail?: string }

export interface BillingPlanEntry {
  product: BillingProduct;
  plan: string;
  name: string;
  monthlyPrice: number;
  history: PriceHistoryEntry[];
  updatedAt?: string;
}

export interface BillingTenantRef { id: string; name: string; slug: string }

export interface BillingChargeLine {
  kind: 'subscription' | 'fiscal_plan' | 'fiscal_overage';
  product?: BillingProduct;
  description: string;
  amount: number;
  discount?: { type: 'percent' | 'amount'; value: number; amount: number };
  proration?: number;
}

export interface BillingCharge {
  id: string;
  number: string;
  tenantId: string;
  tenant: BillingTenantRef | null;
  period: string;
  currency: 'DOP';
  lines: BillingChargeLine[];
  subtotal: number;
  tax: BillingTax;
  itbis: number;
  total: number;
  paidAmount: number;
  balance: number;
  status: BillingChargeStatus;
  overdue: boolean;
  dueDate: string;
  notifiedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
  payments?: BillingPayment[];
}

export interface BillingEcf {
  id: string;
  eNCF: string | null;
  tipo: EcfTipo;
  estado: EcfEstadoECF;
  mensaje: string | null;
  environment: string | null;
  hasDocument: boolean;
  total: number;
  issuedAt: string;
}

export interface BillingPayment {
  id: string;
  tenantId: string;
  chargeId: string;
  chargeNumber: string | null;
  tenant: BillingTenantRef | null;
  amount: number;
  paidAt: string;
  method: BillingPaymentMethod;
  reference?: string;
  notes?: string;
  source: 'manual' | 'portaldom';
  status: 'recorded' | 'reversed';
  ecf: BillingEcf | null;
  ecfError: string | null;
  ecfEmailedAt?: string;
  ecfEmailError?: string;
  reversal?: { at: string; reason: string; byEmail?: string; creditNoteId?: string };
  recordedBy?: { email?: string };
  createdAt: string;
}

export interface BillingTenantProduct {
  product: BillingProduct;
  plan: string | null;
  listPrice: number | null;
  contractPrice: number | null;
  contractSource: 'catalog' | 'override';
  contractSince: string | null;
}

export interface BillingPriceChange {
  id: string;
  product: BillingProduct;
  price: number;
  effectiveFrom: string;
  reason: string;
  createdByEmail?: string;
  createdAt: string;
  notifiedAt?: string;
  appliedAt?: string;
}

export interface BillingDiscount {
  id: string;
  product: BillingProduct;
  type: 'percent' | 'amount';
  value: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string;
  createdByEmail?: string;
  createdAt: string;
  status: 'scheduled' | 'active' | 'ended';
}

export interface BillingTenant {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  ownerEmail: string;
  billingEmail: string;
  paused: boolean;
  legalName: string;
  rnc: string;
  createdAt: string;
  products: BillingTenantProduct[];
  priceChanges: BillingPriceChange[];
  discounts: BillingDiscount[];
  outstanding: number;
  openCharges: number;
  lastPayment: { paidAt: string; amount: number } | null;
}

export interface BillingTenantDetail extends BillingTenant {
  charges: BillingCharge[];
  payments: BillingPayment[];
}

export interface BillingIssuer {
  configured: boolean;
  allowUncertified: boolean;
  state: FiscalState;
  linked: boolean;
  environment: 'testecf' | 'certecf' | 'ecf' | null;
  certification: 'not_started' | 'in_progress' | 'certified' | null;
  rnc: string | null;
  webhookRegistered: boolean;
  lastSyncedAt: string | null;
  appUrl: string;
  notifyEmail: string;
}

export interface BillingIssuerReadiness {
  environment: 'testecf' | 'certecf' | 'ecf';
  certification: 'not_started' | 'in_progress' | 'certified';
  steps: { step: 'profile' | 'certificate' | 'sequences' | 'directory' | 'first_document'; done: boolean }[];
  complete: boolean;
  certificate: 'valid' | 'expiring' | 'expired' | 'not_yet_valid' | 'none';
  usableTypes: string[];
  organization: { rnc: string; razonSocial: string } | null;
  sequences: BillingSequence[];
}

export interface BillingSequence {
  id: string;
  documentType: string;
  rangeStart: number;
  rangeEnd: number;
  next: number;
  expiresOn?: string;
  remaining: number;
  usable: boolean;
}

export interface Paged<T> { data: T[]; meta: { total: number; page: number; limit: number; pages: number } }

export interface RecordPaymentBody {
  amount: number;
  method: BillingPaymentMethod;
  paidAt?: string;
  reference?: string;
  notes?: string;
}
