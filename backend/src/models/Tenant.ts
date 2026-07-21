import mongoose, { Document, Schema } from 'mongoose';

export type TenantPlan = 'basic' | 'pro' | 'enterprise';

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
}

export interface ITenant extends Document {
  name: string;
  slug: string;        // URL-safe unique identifier used for subdomain routing
  plan: TenantPlan;
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
