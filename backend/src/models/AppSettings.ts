import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IEmailSettings {
  fromDisplayName?: string;
  replyTo?: string;
  footerHtml?: string;
  footerText?: string;
}

export interface IOtaSettings {
  enabled: boolean;
  /** Minimum minutes between automatic sync runs for this tenant (15 | 30 | 60 | 120 | 360) */
  syncIntervalMinutes: number;
  /** IANA timezone used to interpret OTA iCal dates (e.g. 'America/Santo_Domingo') */
  timezone: string;
  /** Whether to surface conflict alerts in the admin dashboard */
  conflictAlerts: boolean;
}

export interface IAppSettings extends Document {
  key: string;        // singleton key, always 'global'
  sections: Record<string, boolean>;
  nightAuditEnabled: boolean;       // master toggle for automated night audit
  nightAuditTime: string;           // cron expression for this tenant (overrides env default)
  checkoutTime: string;             // HH:MM — time guests must check out (default 11:00)
  emailSettings?: IEmailSettings;
  otaSettings?: IOtaSettings;
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
    checkoutTime:      { type: String, default: '11:00' }, // HH:MM
    emailSettings: {
      fromDisplayName: { type: String, default: '', maxlength: 100 },
      replyTo:         { type: String, default: '' },
      footerHtml:      { type: String, default: '' },
      footerText:      { type: String, default: '' },
    },
    otaSettings: {
      enabled:              { type: Boolean, default: false },
      syncIntervalMinutes:  { type: Number, default: 60 },
      timezone:             { type: String, default: 'UTC', maxlength: 80 },
      conflictAlerts:       { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
appSettingsSchema.plugin(tenantPlugin);
// Each tenant has exactly one settings document
appSettingsSchema.index({ tenantId: 1 }, { unique: true });

export default mongoose.model<IAppSettings>('AppSettings', appSettingsSchema);
