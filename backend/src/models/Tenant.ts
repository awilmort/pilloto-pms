import mongoose, { Document, Schema } from 'mongoose';

export type TenantPlan = 'basic' | 'pro' | 'enterprise';

export interface ITenantSettings {
  language?: string;   // e.g. 'es', 'en'
  currency?: string;   // e.g. 'DOP', 'USD'
  timezone?: string;   // e.g. 'America/Santo_Domingo'
  logoUrl?: string;
  primaryColor?: string;
}

export interface ITenant extends Document {
  name: string;
  slug: string;        // URL-safe unique identifier used for subdomain routing
  plan: TenantPlan;
  isActive: boolean;
  ownerEmail: string;  // Primary admin contact for this tenant
  settings: ITenantSettings;
  createdAt: Date;
  updatedAt: Date;
}

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
  },
  { timestamps: true }
);

tenantSchema.index({ slug: 1 }, { unique: true });
tenantSchema.index({ isActive: 1 });
tenantSchema.index({ ownerEmail: 1 });

export default mongoose.model<ITenant>('Tenant', tenantSchema);
