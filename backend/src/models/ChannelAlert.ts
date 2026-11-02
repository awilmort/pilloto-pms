/**
 * ChannelAlert — channel-manager problems needing attention (CHANNEX_ARCHITECTURE.md §9.1).
 *
 * Dedupes on (tenantId, type, dedupeKey). Platform-level alerts (`api_auth_failed`,
 * `unknown_property`) have no tenantId.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export const CHANNEL_ALERT_TYPES = [
  'overbooking',
  'unmapped_booking',
  'non_acked_booking',
  'modification_needs_review',
  'currency_mismatch',
  'sync_error',
  'sync_warning',
  'rate_error',
  'ari_warning',
  'push_failing',
  'channel_disconnected',
  'listing_disconnected',
  'channel_removal_warning',
  'property_removal_warning',
  'remap_required',
  'unmap_before_delete',
  'airbnb_reservation_request',
  'airbnb_alteration_request',
  'airbnb_inquiry',
  // Platform-level (no tenant): bad API key / IP allowlist, booking for an unknown property
  'api_auth_failed',
  'unknown_property',
] as const;
export type ChannelAlertType = typeof CHANNEL_ALERT_TYPES[number];

export const CHANNEL_ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type ChannelAlertSeverity = typeof CHANNEL_ALERT_SEVERITIES[number];
export const CHANNEL_ALERT_STATUSES = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;
export type ChannelAlertStatus = typeof CHANNEL_ALERT_STATUSES[number];

export interface IChannelAlert extends Document {
  tenantId?: mongoose.Types.ObjectId;
  type: ChannelAlertType;
  severity: ChannelAlertSeverity;
  status: ChannelAlertStatus;
  dedupeKey: string;
  title: string;
  details?: Record<string, unknown>;
  reservationId?: mongoose.Types.ObjectId;
  channexBookingId?: string;
  channelId?: string;
  liveFeedEventId?: string;
  /** Deadline (e.g. Airbnb request: 24 h to answer) */
  dueAt?: Date;
  /** How many times the problem was reported (duplicates bump it instead of adding alerts) */
  occurrences: number;
  lastSeenAt?: Date;
  acknowledgedBy?: mongoose.Types.ObjectId;
  acknowledgedAt?: Date;
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  /** Resolved by Pilloto itself (e.g. a successful push after `push_failing`) */
  autoResolved?: boolean;
  notes?: string;
  /** New or reopened critical alert not yet included in an email digest */
  emailPending?: boolean;
  emailedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const channelAlertSchema = new Schema<IChannelAlert>(
  {
    type:             { type: String, enum: CHANNEL_ALERT_TYPES, required: true },
    severity:         { type: String, enum: CHANNEL_ALERT_SEVERITIES, required: true },
    status:           { type: String, enum: CHANNEL_ALERT_STATUSES, default: 'open' },
    dedupeKey:        { type: String, required: true, maxlength: 200 },
    title:            { type: String, required: true, maxlength: 300 },
    details:          { type: Schema.Types.Mixed },
    reservationId:    { type: Schema.Types.ObjectId, ref: 'Reservation' },
    channexBookingId: { type: String, maxlength: 64 },
    channelId:        { type: String, maxlength: 64 },
    liveFeedEventId:  { type: String, maxlength: 64 },
    dueAt:            { type: Date },
    occurrences:      { type: Number, default: 1, min: 1 },
    lastSeenAt:       { type: Date },
    acknowledgedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt:   { type: Date },
    resolvedBy:       { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt:       { type: Date },
    autoResolved:     { type: Boolean },
    notes:            { type: String, maxlength: 2000 },
    emailPending:     { type: Boolean },
    emailedAt:        { type: Date },
  },
  { timestamps: true }
);

channelAlertSchema.plugin(tenantPlugin);
channelAlertSchema.index({ tenantId: 1, type: 1, dedupeKey: 1 }, { unique: true });
channelAlertSchema.index({ tenantId: 1, status: 1, severity: 1, createdAt: -1 });
channelAlertSchema.index({ emailPending: 1, tenantId: 1 }, { partialFilterExpression: { emailPending: true } });

export default mongoose.model<IChannelAlert>('ChannelAlert', channelAlertSchema);
