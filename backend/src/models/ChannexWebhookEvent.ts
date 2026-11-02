/**
 * ChannexWebhookEvent — raw Channex webhook deliveries, for debugging (CHANNEX_ARCHITECTURE.md §7.1, §9.2).
 *
 * This model does NOT use tenantPlugin: events arrive before the tenant is known (it is
 * resolved from `property_id` via ChannexProperty), and they must stay queryable from
 * any context. `tenantId` is set once resolved. Expires 14 days after receipt.
 */
import mongoose, { Document, Schema } from 'mongoose';

export const WEBHOOK_EVENT_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface IChannexWebhookEvent extends Document {
  event: string;
  channexPropertyId?: string;
  tenantId?: mongoose.Types.ObjectId;
  payload?: Record<string, unknown>;
  signatureKeyLabel?: string;
  receivedAt: Date;
  processedAt?: Date;
  error?: string;
}

const channexWebhookEventSchema = new Schema<IChannexWebhookEvent>(
  {
    event:             { type: String, required: true, maxlength: 80 },
    channexPropertyId: { type: String, maxlength: 64 },
    tenantId:          { type: Schema.Types.ObjectId, ref: 'Tenant' },
    payload:           { type: Schema.Types.Mixed },
    signatureKeyLabel: { type: String, maxlength: 80 },
    receivedAt:        { type: Date, default: () => new Date() },
    processedAt:       { type: Date },
    error:             { type: String, maxlength: 2000 },
  },
  { minimize: false }
);

channexWebhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: WEBHOOK_EVENT_TTL_SECONDS });
channexWebhookEventSchema.index({ channexPropertyId: 1, receivedAt: -1 });

export default mongoose.model<IChannexWebhookEvent>('ChannexWebhookEvent', channexWebhookEventSchema);
