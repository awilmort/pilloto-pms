import mongoose, { Document, Schema } from 'mongoose';

/**
 * A BillingSoft webhook event Pilloto has already handled. BillingSoft delivers at least once and
 * repeats the same event id on a retry, so the id is claimed (unique) before the event is acted on.
 * Not tenant-scoped: the webhook route runs outside any tenant context. Expires after 30 days.
 */
export interface IFiscalWebhookEvent extends Document {
  eventId: string;
  tenantId: mongoose.Types.ObjectId;
  type: string;
  receivedAt: Date;
}

const fiscalWebhookEventSchema = new Schema<IFiscalWebhookEvent>({
  eventId: { type: String, required: true, unique: true },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  type: { type: String, required: true },
  receivedAt: { type: Date, required: true, default: () => new Date(), expires: 30 * 24 * 60 * 60 },
});

export default mongoose.model<IFiscalWebhookEvent>('FiscalWebhookEvent', fiscalWebhookEventSchema);
