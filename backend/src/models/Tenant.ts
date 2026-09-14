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

export type EcfAmbiente =
  | 'Simulacion'
  | 'Pruebas'
  | 'Certificacion'
  | 'Produccion';

export interface ITenantEcfConfig {
  /** AES-256-GCM encrypted Citrus API token — NEVER expose to frontend */
  citrusToken?: string;
  rnc: string;          // Dominican Tax ID: 9 or 11 digits
  razonSocial: string;  // Legal business name
  nombreComercial?: string;
  phone?: string;       // Business contact phone (shown on printed invoice)
  ambiente: EcfAmbiente;
  isActive: boolean;
  sucursal?: string;
  citrusBaseUrl: string;
  /** Default ITBIS rate (percent) for new Accounting-product invoice/quote/bill lines. Per §9.1. */
  defaultItbisRate: number;
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
  ecfConfig?: ITenantEcfConfig;
  createdAt: Date;
  updatedAt: Date;
}

const ecfConfigSchema = new Schema<ITenantEcfConfig>(
  {
    citrusToken: { type: String }, // stored encrypted; never expose raw value
    rnc: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v: string) => /^\d{9}$|^\d{11}$/.test(v),
        message: 'RNC must be 9 or 11 digits',
      },
    },
    razonSocial: { type: String, required: true, trim: true },
    nombreComercial: { type: String, trim: true },
    phone: { type: String, trim: true },
    ambiente: {
      type: String,
      enum: ['Simulacion', 'Pruebas', 'Certificacion', 'Produccion'],
      default: 'Simulacion',
    },
    isActive: { type: Boolean, default: false },
    sucursal: { type: String, trim: true },
    citrusBaseUrl: {
      type: String,
      required: true,
      trim: true,
      default: 'https://test.ecf.citrus.com.do',
    },
    defaultItbisRate: { type: Number, required: true, min: 0, max: 100, default: 18 },
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
    ecfConfig: { type: ecfConfigSchema },
  },
  { timestamps: true }
);

tenantSchema.index({ isActive: 1 });
tenantSchema.index({ ownerEmail: 1 });

export default mongoose.model<ITenant>('Tenant', tenantSchema);
