/** The tenant's Pilloto subscription (backend routes/subscription.ts). Money is DOP before ITBIS. */

export type SubscriptionProduct = 'pms' | 'accounting';
export type SubscriptionStatus = 'trial' | 'active' | 'cancelling' | 'ended';
export type LimitKey = 'users' | 'rooms' | 'warehouses';

export interface SubscriptionProductView {
  product: SubscriptionProduct;
  plan: string;
  planName: string;
  status: SubscriptionStatus;
  startedOn: string;
  billableFrom: string;
  endsOn: string | null;
  pendingPlan: { plan: string; planName: string; effectiveOn: string } | null;
  price: number;
  discount: { kind: 'operator' | 'suite'; type: 'percent' | 'amount'; value: number; amount: number } | null;
  monthly: number;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
}

export interface SubscriptionOverview {
  today: string;
  currency: 'DOP';
  taxPercent: number;
  suiteDiscountPercent: number;
  products: SubscriptionProductView[];
  available: SubscriptionProduct[];
  usage: { pms: { users: number; rooms: number }; accounting: { users: number; warehouses: number } };
  ecf: { includedPlan: string | null; plan: string | null; state: string };
  billingEmail: string;
  paymentInstructions: string;
}

export interface LimitViolation { limit: LimitKey; max: number; current: number }

export interface CatalogOption {
  product: SubscriptionProduct;
  slug: string;
  name: string;
  monthlyPrice: number;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  includedEcf: { plan: string; transactions: number | null };
  current: boolean;
  direction: number | null;
  tenantPrice: number;
  violations: LimitViolation[];
  lostFeatures: string[];
}

export interface TenantCatalog {
  currency: 'DOP';
  taxPercent: number;
  suiteDiscountPercent: number;
  pms: CatalogOption[];
  accounting: CatalogOption[];
}

export interface SubscriptionChargeLine {
  kind: 'subscription' | 'fiscal_plan' | 'fiscal_overage';
  product?: SubscriptionProduct;
  description: string;
  amount: number;
  discount?: { type: 'percent' | 'amount'; value: number; amount: number; kind?: 'operator' | 'suite' };
}

export interface SubscriptionCharge {
  id: string;
  number: string;
  period: string;
  lines: SubscriptionChargeLine[];
  subtotal: number;
  itbis: number;
  total: number;
  paidAmount: number;
  balance: number;
  status: 'open' | 'partial' | 'paid' | 'void';
  dueDate: string;
  overdue: boolean;
  payments?: { id: string; amount: number; paidAt: string; method: string; source: string; ecf: { eNCF: string | null; estado: string; hasDocument: boolean } | null }[];
}

export type ChargeStatusFilter = 'all' | 'pending' | 'paid';

/** One page of the tenant's charges, with the totals over all of them. */
export interface SubscriptionChargesPage {
  success: true;
  data: SubscriptionCharge[];
  meta: { total: number; page: number; limit: number; pages: number };
  summary: { outstanding: number; overdueCount: number; overdueBalance: number };
}
