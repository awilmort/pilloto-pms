import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IAppSettings extends Document {
  key: string;        // singleton key, always 'global'
  sections: Record<string, boolean>;
  nightAuditEnabled: boolean;       // master toggle for automated night audit
  nightAuditTime: string;           // cron expression for this tenant (overrides env default)
  updatedAt: Date;
}

const appSettingsSchema = new Schema<IAppSettings>(
  {
    key: { type: String, default: 'global' },  // kept for backward compat; uniqueness is per-tenant
    sections: {
      type: Schema.Types.Mixed,
      default: () => ({
        dashboard: true, revenue: true, commissions: true,
        schedule: true, accommodations: true, rooms: true,
        amenities: true, 'event-types': true, wristbands: true,
        pricing: true, reservations: true, users: true,
        roles: true, media: true, analytics: true,
        companies: true, guests: true, 'cashier-closures': true,
      }),
    },
    nightAuditEnabled: { type: Boolean, default: true },
    nightAuditTime:    { type: String, default: '' },  // empty = use server default from env
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
appSettingsSchema.plugin(tenantPlugin);
// Each tenant has exactly one settings document
appSettingsSchema.index({ tenantId: 1 }, { unique: true });

export default mongoose.model<IAppSettings>('AppSettings', appSettingsSchema);
