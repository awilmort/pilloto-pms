/**
 * PlatformSettings — global, platform-scoped configuration singleton.
 *
 * This model does NOT use tenantPlugin. It stores a single document
 * with key='global' that applies to the entire platform (all tenants).
 */
import mongoose, { Document, Schema } from 'mongoose';
import { fiscalSchema, ITenantFiscal } from './Tenant';

/** The settings document's key: there is exactly one. */
export const PLATFORM_KEY = 'global';

/** BillingSoft line taxes that Pilloto's own charges can carry. */
export const BILLING_TAXES = ['itbis18', 'itbis16', 'itbis0', 'exempt'] as const;
export type BillingTax = (typeof BILLING_TAXES)[number];

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

/**
 * How Pilloto charges its tenants, and its own link to BillingSoft for the e-CF it issues for what
 * it collects.
 */
export interface IPlatformBillingSettings {
  /**
   * How ITBIS applies to Pilloto's subscription charges. 18% by default; an operator changes it
   * here if the DGII's treatment of the service says otherwise. Listed prices are before this tax.
   */
  tax: BillingTax;
  /** Days after a charge is created that it is due. */
  dueDays: number;
  /** Where Pilloto's own e-CF notices (a DGII rejection, a low range) go. */
  notifyEmail?: string;
  /** How tenants pay today (bank account, reference to quote). Included in the charge email. */
  paymentInstructions?: string;
  /**
   * Pilloto's own BillingSoft Organization. Its `organizationId` is `self`: the partner key acts
   * for Pilloto when no customer header is sent.
   */
  fiscal?: ITenantFiscal;
}

export interface IPlatformSettings extends Document {
  key: string;
  channex: IPlatformChannexSettings;
  billing: IPlatformBillingSettings;
}

const platformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, default: PLATFORM_KEY },
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
    billing: {
      tax: { type: String, enum: BILLING_TAXES, default: 'itbis18' },
      dueDays: { type: Number, default: 10, min: 0, max: 90 },
      notifyEmail: { type: String, trim: true, lowercase: true },
      paymentInstructions: { type: String, trim: true, maxlength: 2000 },
      fiscal: { type: fiscalSchema },
    },
  },
  { timestamps: true }
);

platformSettingsSchema.index({ key: 1 }, { unique: true });

export default mongoose.model<IPlatformSettings>('PlatformSettings', platformSettingsSchema);
