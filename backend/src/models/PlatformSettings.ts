/**
 * PlatformSettings — global, platform-scoped configuration singleton.
 *
 * This model does NOT use tenantPlugin. It stores a single document
 * with key='global' that applies to the entire platform (all tenants).
 */
import mongoose, { Document, Schema } from 'mongoose';

export interface IPlatformChannexSettings {
  /** Platform kill switch for every Channex worker and push */
  globalEnabled: boolean;
  /** Channex global webhook id (the signing secret itself lives only in CHANNEX_WEBHOOK_SECRET) */
  webhookId?: string;
  signingKeyId?: string;
  lastWebhookAt?: Date;
  /** Booking inbox: one instance processes revisions at a time (keeps per-booking order) */
  inboxLeaseUntil?: Date;
  lastFeedPollAt?: Date;
  /**
   * Default for tenants without their own choice: only superadmins open the channel
   * connection screen (used if the iframe isolation check fails, plan 9.5).
   */
  iframePlatformOnly: boolean;
  /**
   * OTA codes offered to tenants in "Conectar un canal" (e.g. ['BDC', 'EXP']), in card order.
   * Unset = the OTAs that have a guide (services/channex/channels.ts DEFAULT_OFFERED_CHANNELS).
   */
  offeredChannels?: string[];
}

export interface IPlatformSettings extends Document {
  key: string;
  channex: IPlatformChannexSettings;
}

const platformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, default: 'global' },
    channex: {
      globalEnabled: { type: Boolean, default: true },
      webhookId:     { type: String, maxlength: 64 },
      signingKeyId:  { type: String, maxlength: 64 },
      lastWebhookAt: { type: Date },
      inboxLeaseUntil: { type: Date },
      lastFeedPollAt: { type: Date },
      iframePlatformOnly: { type: Boolean, default: false },
      // No default: unset (never chosen) is told apart from an empty choice
      offeredChannels: { type: [String], default: undefined },
    },
  },
  { timestamps: true }
);

platformSettingsSchema.index({ key: 1 }, { unique: true });

export default mongoose.model<IPlatformSettings>('PlatformSettings', platformSettingsSchema);
