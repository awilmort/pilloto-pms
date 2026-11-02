import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IEmailSettings {
  fromDisplayName?: string;
  replyTo?: string;
  footerHtml?: string;
  footerText?: string;
}

export interface IBookingSettings {
  /** Master toggle — must be true AND tenant plan must include bookingEngine */
  enabled: boolean;
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

export interface IChannelManagerSettings {
  /** Tenant switch — the plan must also include `channelManager` */
  enabled: boolean;
  /** Assign a free room of the booked type when an OTA booking arrives */
  autoAssignRooms: boolean;
  /** Send Pilloto's own confirmation email for OTA bookings (the OTA already emails the guest) */
  sendGuestConfirmationEmail: boolean;
  /** Push tax-inclusive nightly rates instead of pre-tax rates */
  ratesIncludeTaxes: boolean;
  /**
   * Who connects OTAs in the channel screen: the tenant, superadmins only ('platform_only'),
   * or the platform default (`PlatformSettings.channex.iframePlatformOnly`). Set from the
   * platform console only.
   */
  channelConnection: ChannelConnectionSetting;
}

export const CHANNEL_CONNECTION_SETTINGS = ['default', 'tenant', 'platform_only'] as const;
export type ChannelConnectionSetting = typeof CHANNEL_CONNECTION_SETTINGS[number];

export interface IAppSettings extends Document {
  key: string;        // singleton key, always 'global'
  sections: Record<string, boolean>;
  nightAuditEnabled: boolean;       // master toggle for automated night audit
  nightAuditTime: string;           // cron expression for this tenant (overrides env default)
  checkoutTime: string;             // HH:MM — time guests must check out (default 11:00)
  emailSettings?: IEmailSettings;
  bookingSettings?: IBookingSettings;
  channelManager?: IChannelManagerSettings;
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
    bookingSettings: {
      enabled:              { type: Boolean, default: false },
      widgetAllowedOrigins: [{ type: String, maxlength: 200 }],
      minAdvanceHours:      { type: Number, default: 24, min: 0 },
      maxAdvanceDays:       { type: Number, default: 365, min: 1 },
      termsVersion:         { type: String, default: '1.0', maxlength: 20 },
      privacyVersion:       { type: String, default: '1.0', maxlength: 20 },
    },
    channelManager: {
      enabled:                    { type: Boolean, default: false },
      autoAssignRooms:            { type: Boolean, default: true },
      sendGuestConfirmationEmail: { type: Boolean, default: false },
      ratesIncludeTaxes:          { type: Boolean, default: false },
      channelConnection:          { type: String, enum: CHANNEL_CONNECTION_SETTINGS, default: 'default' },
    },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
appSettingsSchema.plugin(tenantPlugin);
// Each tenant has exactly one settings document
appSettingsSchema.index({ tenantId: 1 }, { unique: true });

export default mongoose.model<IAppSettings>('AppSettings', appSettingsSchema);
