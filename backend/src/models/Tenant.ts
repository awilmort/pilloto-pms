import mongoose, { Document, Schema } from 'mongoose';
import { APP_CODES, AppCode } from '../constants/apps';
import { AccountingPlanSlug } from '../config/accountingPlans';

export type TenantPlan = 'basic' | 'pro' | 'enterprise';

/**
 * Per-product plan ladder. `plan` above remains the `pms` plan slug (kept as
 * a top-level field rather than renamed to `plans.pms`, to avoid touching
 * every existing `req.tenant.plan` call site). `plans.accounting` is the
 * independent ladder from `config/accountingPlans.ts`, only meaningful once
 * `'accounting'` is in `products`.
 */
export interface ITenantPlans {
  accounting?: AccountingPlanSlug;
}

export interface ITenantSettings {
  language?: string;   // e.g. 'es', 'en'
  currency?: string;   // e.g. 'DOP', 'USD'
  timezone?: string;   // e.g. 'America/Santo_Domingo'
  logoUrl?: string;
  primaryColor?: string;
}

/**
 * The property's own details (Settings → Property profile). Every module reads them from
 * here: booking engine, guest emails, e-invoicing, channel manager. The commercial name is
 * `name` and the currency/time zone are `settings.currency`/`settings.timezone`.
 */
export interface ITenantProfile {
  legalName?: string;  // Razón social
  rnc?: string;        // Dominican Tax ID: 9 or 11 digits
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;    // ISO 3166-1 alpha-2, e.g. 'DO'
  zipCode?: string;
}

/** Tax defaults the Accounting product starts new lines from. The e-CF link itself is `fiscal`. */
export interface ITenantEcfConfig {
  /** Default ITBIS rate (percent) for new Accounting-product invoice/quote/bill lines. Per §9.1. */
  defaultItbisRate: number;
}

/** BillingSoft plans a tenant can be on (BillingSoft `GET /v1/plans`). */
export const FISCAL_PLANS = ['essential', 'pro', 'max'] as const;
export type FiscalPlan = (typeof FISCAL_PLANS)[number];

/** Where DGII's certification of the tenant stands (BillingSoft `GET /v1/onboarding`). */
export const FISCAL_CERTIFICATIONS = ['not_started', 'in_progress', 'certified'] as const;
export type FiscalCertification = (typeof FISCAL_CERTIFICATIONS)[number];

export type FiscalEnvironment = 'testecf' | 'certecf' | 'ecf';

/**
 * The tenant's electronic invoicing (e-CF) link to BillingSoft. It belongs to the company, not to
 * either app: PMS and Accounting both read it, so it is configured once. Pilloto holds one partner
 * credential for every tenant (server environment), so nothing here is a tenant secret except the
 * webhook signing secret, which is stored encrypted.
 */
export interface ITenantFiscal {
  /** BillingSoft Organization id — sent as the `BillingSoft-Organization` header. */
  organizationId?: string;
  /** The taxpayer's RNC the Organization was provisioned with. */
  rnc?: string;
  /** The person BillingSoft invited to upload the certificate and run DGII's certification. */
  adminEmail?: string;
  environment: FiscalEnvironment;
  certification: FiscalCertification;
  /** False while the tenant's e-CF is suspended (BillingSoft `isActive: false`). */
  isActive: boolean;
  /** Confirmation that any earlier postulation with another provider is concluded. */
  previousPostulationConfirmed?: { at: Date; byUserId?: mongoose.Types.ObjectId; byEmail?: string };
  /** The BillingSoft plan in force. */
  plan: FiscalPlan;
  /** A downgrade waiting for the next month: applied on `effectiveOn` (YYYY-MM-DD, Dominican time). */
  pendingPlan?: { plan: FiscalPlan; effectiveOn: string };
  /** AES-256-GCM encrypted webhook signing secret — NEVER expose to frontend */
  webhookSecret?: string;
  webhookRegisteredAt?: Date;
  provisionedAt?: Date;
  lastSyncedAt?: Date;
}

/** The two products Pilloto charges a subscription for. */
export const BILLING_PRODUCTS = ['pms', 'accounting'] as const;
export type BillingProduct = (typeof BILLING_PRODUCTS)[number];

/**
 * What a tenant pays for one product, fixed when the subscription starts (or the plan changes) so
 * a later change of the price list never reaches an existing customer. Dominican pesos per month,
 * before ITBIS.
 */
export interface ITenantContract {
  plan: string;
  price: number;
  /** First period (`YYYY-MM`) the price applies to. */
  since: string;
  /** `catalog`: the list price when the contract was fixed. `override`: set by a platform operator. */
  source: 'catalog' | 'override';
}

/** A price an operator scheduled for a tenant, effective from a period. */
export interface ITenantPriceChange {
  _id: mongoose.Types.ObjectId;
  product: BillingProduct;
  price: number;
  /** `YYYY-MM`: the first period charged at the new price. */
  effectiveFrom: string;
  reason: string;
  createdByEmail?: string;
  createdAt: Date;
  /** When the tenant's owner was emailed about it. */
  notifiedAt?: Date;
  /** Set once the contract took the new price. */
  appliedAt?: Date;
}

/**
 * A discount an operator granted on one product's subscription, on top of whatever price the
 * contract has. `percent` takes that share off; `amount` takes a fixed sum (DOP, per month, before
 * ITBIS) off, prorated in the tenant's first month like the price.
 */
export interface ITenantDiscount {
  _id: mongoose.Types.ObjectId;
  product: BillingProduct;
  type: 'percent' | 'amount';
  /** 0–100 for `percent`; pesos for `amount`. */
  value: number;
  /** `YYYY-MM`: the first period charged with the discount. */
  effectiveFrom: string;
  /** `YYYY-MM`: the last period charged with the discount (inclusive). Empty: it has no end. */
  effectiveUntil?: string;
  reason: string;
  createdByEmail?: string;
  createdAt: Date;
}

/** Pilloto's own subscription billing for this tenant (platform operators manage it). */
export interface ITenantBilling {
  contracts: { pms?: ITenantContract; accounting?: ITenantContract };
  priceChanges: ITenantPriceChange[];
  discounts: ITenantDiscount[];
  /** Where charges and e-CF go; the owner's email when empty. */
  billingEmail?: string;
  /** No charges are generated while true (a complimentary account). */
  paused?: boolean;
}

export interface ITenant extends Document {
  name: string;
  slug: string;        // URL-safe unique identifier used for subdomain routing
  plan: TenantPlan;
  /** Which apps this tenant has bought. Gates access alongside User.appRoles. */
  products: AppCode[];
  /** Per-product plan tier, independent of `plan` (the pms tier). */
  plans: ITenantPlans;
  isActive: boolean;
  ownerEmail: string;  // Primary admin contact for this tenant
  settings: ITenantSettings;
  profile?: ITenantProfile;
  ecfConfig?: ITenantEcfConfig;
  fiscal?: ITenantFiscal;
  billing?: ITenantBilling;
  createdAt: Date;
  updatedAt: Date;
}

const ecfConfigSchema = new Schema<ITenantEcfConfig>(
  {
    defaultItbisRate: { type: Number, required: true, min: 0, max: 100, default: 18 },
  },
  { _id: false }
);

export const fiscalSchema = new Schema<ITenantFiscal>(
  {
    organizationId: { type: String, trim: true },
    rnc: { type: String, trim: true },
    adminEmail: { type: String, trim: true, lowercase: true },
    environment: { type: String, enum: ['testecf', 'certecf', 'ecf'], default: 'testecf' },
    certification: { type: String, enum: FISCAL_CERTIFICATIONS, default: 'not_started' },
    isActive: { type: Boolean, default: true },
    previousPostulationConfirmed: {
      type: new Schema(
        {
          at: { type: Date, required: true },
          byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
          byEmail: { type: String, trim: true, lowercase: true },
        },
        { _id: false }
      ),
    },
    plan: { type: String, enum: FISCAL_PLANS, default: 'essential' },
    pendingPlan: {
      type: new Schema(
        {
          plan: { type: String, enum: FISCAL_PLANS, required: true },
          effectiveOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        },
        { _id: false }
      ),
    },
    webhookSecret: { type: String }, // stored encrypted; never expose raw value
    webhookRegisteredAt: { type: Date },
    provisionedAt: { type: Date },
    lastSyncedAt: { type: Date },
  },
  { _id: false }
);

const contractSchema = new Schema<ITenantContract>(
  {
    plan: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    since: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    source: { type: String, enum: ['catalog', 'override'], default: 'catalog' },
  },
  { _id: false }
);

const billingSchema = new Schema<ITenantBilling>(
  {
    contracts: {
      type: new Schema({ pms: { type: contractSchema }, accounting: { type: contractSchema } }, { _id: false }),
      default: () => ({}),
    },
    priceChanges: {
      type: [
        new Schema<ITenantPriceChange>({
          product: { type: String, enum: BILLING_PRODUCTS, required: true },
          price: { type: Number, required: true, min: 0 },
          effectiveFrom: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
          reason: { type: String, required: true, trim: true, maxlength: 500 },
          createdByEmail: { type: String, trim: true },
          createdAt: { type: Date, default: Date.now },
          notifiedAt: { type: Date },
          appliedAt: { type: Date },
        }),
      ],
      default: [],
    },
    discounts: {
      type: [
        new Schema<ITenantDiscount>({
          product: { type: String, enum: BILLING_PRODUCTS, required: true },
          type: { type: String, enum: ['percent', 'amount'], required: true },
          value: { type: Number, required: true, min: 0 },
          effectiveFrom: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
          effectiveUntil: { type: String, match: /^\d{4}-\d{2}$/ },
          reason: { type: String, required: true, trim: true, maxlength: 500 },
          createdByEmail: { type: String, trim: true },
          createdAt: { type: Date, default: Date.now },
        }),
      ],
      default: [],
    },
    billingEmail: { type: String, trim: true, lowercase: true },
    paused: { type: Boolean, default: false },
  },
  { _id: false }
);

const profileSchema = new Schema<ITenantProfile>(
  {
    legalName: { type: String, trim: true, maxlength: 150 },
    rnc: {
      type: String,
      trim: true,
      validate: {
        validator: (v: string) => !v || /^\d{9}$|^\d{11}$/.test(v),
        message: 'RNC must be 9 or 11 digits',
      },
    },
    email:   { type: String, trim: true, lowercase: true, maxlength: 100 },
    phone:   { type: String, trim: true, maxlength: 30 },
    address: { type: String, trim: true, maxlength: 300 },
    city:    { type: String, trim: true, maxlength: 100 },
    state:   { type: String, trim: true, maxlength: 100 },
    country: { type: String, trim: true, uppercase: true, maxlength: 2 },
    zipCode: { type: String, trim: true, maxlength: 20 },
  },
  { _id: false }
);

const tenantSchema = new Schema<ITenant>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers and hyphens'],
      maxlength: 60,
    },
    plan: {
      type: String,
      enum: ['basic', 'pro', 'enterprise'],
      default: 'basic',
    },
    products: {
      type: [{ type: String, enum: APP_CODES }],
      default: ['pms'],
    },
    plans: {
      type: new Schema<ITenantPlans>(
        {
          accounting: { type: String, enum: ['starter', 'pro', 'plus'] },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    ownerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    settings: {
      language:     { type: String, trim: true },
      currency:     { type: String, trim: true },
      timezone:     { type: String, trim: true },
      logoUrl:      { type: String, trim: true },
      primaryColor: { type: String, trim: true },
    },
    profile: { type: profileSchema, default: () => ({}) },
    ecfConfig: { type: ecfConfigSchema },
    fiscal: { type: fiscalSchema },
    billing: { type: billingSchema },
  },
  { timestamps: true }
);

tenantSchema.index({ isActive: 1 });
tenantSchema.index({ ownerEmail: 1 });
// Webhook events carry the BillingSoft Organization id; a customer belongs to exactly one tenant.
tenantSchema.index({ 'fiscal.organizationId': 1 }, { unique: true, sparse: true });

export default mongoose.model<ITenant>('Tenant', tenantSchema);
