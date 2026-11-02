/**
 * ChannexChannel — the tenant's OTA connections as last read from Channex
 * (CHANNEX_ARCHITECTURE.md §8.4; plan Phase 8.1).
 *
 * Channels are created and mapped by the tenant inside the Channex iframe, so Channex is
 * their source of truth; this is a cache refreshed whenever the channel list is read, plus
 * the health Pilloto learns from channel webhooks. Its `_id` is the channel id the tenant
 * API uses: the Channex channel id never leaves the platform console (§18 white-label).
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { ChannexEnvironment } from '../services/channex/config';
import { CHANNEX_ENVIRONMENTS } from './ChannexProperty';

export interface IChannexChannel extends Document {
  tenantId: mongoose.Types.ObjectId;
  environment: ChannexEnvironment;
  channexChannelId: string;
  channexPropertyId: string;
  /** Name the tenant gave the connection inside the iframe */
  title?: string;
  /** Channex adapter name as sent (`channel` attribute, e.g. "BookingCom") */
  adapter?: string;
  /** Channex short code (e.g. 'BDC'), derived from the adapter */
  otaCode?: string;
  isActive: boolean;
  /** Channex `status` (only some adapters, e.g. Google: active/pending/temporal_error/permanent_error) */
  channexStatus?: string;
  expectedRemovalDate?: string;
  channexInsertedAt?: Date;
  /** Latest time Pilloto saw the channel turn active (webhook `activate_channel` or a read) */
  activatedAt?: Date;
  lastEvent?: string;
  lastEventAt?: Date;
  lastSeenAt: Date;
  /** No longer returned by Channex */
  removedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const channexChannelSchema = new Schema<IChannexChannel>(
  {
    environment:         { type: String, enum: CHANNEX_ENVIRONMENTS, required: true },
    channexChannelId:    { type: String, required: true, maxlength: 64 },
    channexPropertyId:   { type: String, required: true, maxlength: 64 },
    title:               { type: String, maxlength: 200 },
    adapter:             { type: String, maxlength: 80 },
    otaCode:             { type: String, maxlength: 10 },
    isActive:            { type: Boolean, default: false },
    channexStatus:       { type: String, maxlength: 40 },
    expectedRemovalDate: { type: String, maxlength: 40 },
    channexInsertedAt:   { type: Date },
    activatedAt:         { type: Date },
    lastEvent:           { type: String, maxlength: 80 },
    lastEventAt:         { type: Date },
    lastSeenAt:          { type: Date, default: () => new Date() },
    removedAt:           { type: Date },
  },
  { timestamps: true }
);

channexChannelSchema.plugin(tenantPlugin);
channexChannelSchema.index({ tenantId: 1, environment: 1, channexChannelId: 1 }, { unique: true });
// Webhooks find the channel by its Channex id before the tenant is known
channexChannelSchema.index({ environment: 1, channexChannelId: 1 }, { unique: true });

export default mongoose.model<IChannexChannel>('ChannexChannel', channexChannelSchema);
