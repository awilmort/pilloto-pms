/**
 * ChannexProperty — the tenant's Channex group + property (CHANNEX_ARCHITECTURE.md §4.1, §10.1).
 *
 * One per tenant per Channex environment, created when the tenant enables the channel
 * manager (never at tenant creation). Also carries the ARI worker's per-property lease and
 * pause state, so several backend instances agree on who pushes and when.
 *
 * The webhook handler resolves the tenant from a Channex `property_id` with a query made
 * outside any tenant context (the tenant plugin does not scope it).
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { ChannexEnvironment } from '../services/channex/config';

export const CHANNEX_ENVIRONMENTS: ChannexEnvironment[] = ['staging', 'production'];
export const CHANNEX_PROPERTY_STATUSES = ['provisioning', 'active', 'disabled', 'error'] as const;
export type ChannexPropertyStatus = typeof CHANNEX_PROPERTY_STATUSES[number];

export interface IChannexProperty extends Document {
  tenantId: mongoose.Types.ObjectId;
  environment: ChannexEnvironment;
  channexPropertyId?: string;
  channexGroupId?: string;
  status: ChannexPropertyStatus;
  propertyType?: string;
  currency?: string;
  timezone?: string;
  lastFullSyncAt?: Date;
  /** ARI pushes are skipped until this time (429/5xx/auth backoff). */
  pausedUntil: Date;
  /** Worker lease: the instance holding it pushes for this property until it expires. */
  ariLeaseUntil: Date;
  consecutiveFailures: number;
  /** First failed push of the current failure streak (cleared by a successful push) */
  failingSince?: Date;
  /** Pushes stopped by a superadmin (platform console); the outbox keeps collecting changes */
  pushesPaused: boolean;
  pushesPausedAt?: Date;
  lastPushAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const channexPropertySchema = new Schema<IChannexProperty>(
  {
    environment:         { type: String, enum: CHANNEX_ENVIRONMENTS, required: true },
    channexPropertyId:   { type: String, maxlength: 64 },
    channexGroupId:      { type: String, maxlength: 64 },
    status:              { type: String, enum: CHANNEX_PROPERTY_STATUSES, default: 'provisioning' },
    propertyType:        { type: String, maxlength: 40 },
    currency:            { type: String, maxlength: 3 },
    timezone:            { type: String, maxlength: 80 },
    lastFullSyncAt:      { type: Date },
    pausedUntil:         { type: Date, default: () => new Date(0) },
    ariLeaseUntil:       { type: Date, default: () => new Date(0) },
    consecutiveFailures: { type: Number, default: 0, min: 0 },
    failingSince:        { type: Date },
    pushesPaused:        { type: Boolean, default: false },
    pushesPausedAt:      { type: Date },
    lastPushAt:          { type: Date },
    lastError:           { type: String, maxlength: 2000 },
  },
  { timestamps: true }
);

channexPropertySchema.plugin(tenantPlugin);
channexPropertySchema.index({ tenantId: 1, environment: 1 }, { unique: true });
// Ids exist only once Channex has created the property
channexPropertySchema.index(
  { channexPropertyId: 1 },
  { unique: true, partialFilterExpression: { channexPropertyId: { $type: 'string' } } }
);

export default mongoose.model<IChannexProperty>('ChannexProperty', channexPropertySchema);
