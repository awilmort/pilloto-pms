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

export interface IBookingSettings {
  /** Master toggle — must be true AND tenant plan must include bookingEngine */
  enabled: boolean;
  /** Contact phone shown to guests */
  contactPhone?: string;
  /** Contact email shown to guests */
  contactEmail?: string;
  /** Contact address shown to guests */
  contactAddress?: string;
  /** Whitelisted origins that may embed the booking widget via iframe/snippet */
  widgetAllowedOrigins: string[];
  /** Minimum hours in advance a booking can be made (default 24) */
  minAdvanceHours: number;
  /** Maximum days in advance a booking can be made (default 365) */
  maxAdvanceDays: number;
  /** Current version of the booking terms document */
  termsVersion: string;
  /** Current version of the booking privacy policy document */
  privacyVersion: string;
}

export interface IAppSettings extends Document {
  key: string;        // singleton key, always 'global'
  sections: Record<string, boolean>;
  nightAuditEnabled: boolean;       // master toggle for automated night audit
  nightAuditTime: string;           // cron expression for this tenant (overrides env default)
  checkoutTime: string;             // HH:MM — time guests must check out (default 11:00)
  emailSettings?: IEmailSettings;
  otaSettings?: IOtaSettings;
  bookingSettings?: IBookingSettings;
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
    bookingSettings: {
      enabled:              { type: Boolean, default: false },
      contactPhone:         { type: String, default: '', maxlength: 30 },
      contactEmail:         { type: String, default: '', maxlength: 100 },
      contactAddress:       { type: String, default: '', maxlength: 300 },
      widgetAllowedOrigins: [{ type: String, maxlength: 200 }],
      minAdvanceHours:      { type: Number, default: 24, min: 0 },
      maxAdvanceDays:       { type: Number, default: 365, min: 1 },
      termsVersion:         { type: String, default: '1.0', maxlength: 20 },
      privacyVersion:       { type: String, default: '1.0', maxlength: 20 },
    },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
appSettingsSchema.plugin(tenantPlugin);
// Each tenant has exactly one settings document
appSettingsSchema.index({ tenantId: 1 }, { unique: true });

export default mongoose.model<IAppSettings>('AppSettings', appSettingsSchema);
