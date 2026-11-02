/**
 * ChannelAriChange — the ARI outbox (CHANNEX_ARCHITECTURE.md §6.2–6.3, §10.1).
 *
 * Written by the change-capture plugin in the same request that changed the data;
 * consumed by the ARI worker (pending → in_flight → done | failed). Ranges are
 * superset ranges of `YYYY-MM-DD` dates (inclusive); `fields: ['*']` means "everything".
 * Done rows expire 14 days after `completedAt`.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { isChannexDate } from '../services/channex/dates';

export const CHANNEL_ARI_CHANGE_KINDS = ['availability', 'rates', 'structure'] as const;
export type ChannelAriChangeKind = typeof CHANNEL_ARI_CHANGE_KINDS[number];
export const CHANNEL_ARI_CHANGE_STATUSES = ['pending', 'in_flight', 'done', 'failed'] as const;
export type ChannelAriChangeStatus = typeof CHANNEL_ARI_CHANGE_STATUSES[number];

export const ARI_CHANGE_DONE_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface IChannelAriChange extends Document {
  tenantId: mongoose.Types.ObjectId;
  kind: ChannelAriChangeKind;
  roomTypeId?: mongoose.Types.ObjectId;
  ratePlanId?: mongoose.Types.ObjectId;
  /** Inclusive `YYYY-MM-DD` range; absent for structure rows that are not date-bound */
  dateFrom?: string;
  dateTo?: string;
  fields: string[];
  reason?: string;
  sourceModel?: string;
  sourceId?: mongoose.Types.ObjectId;
  status: ChannelAriChangeStatus;
  attempts: number;
  batchId?: string;
  error?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const channexDate = {
  type: String,
  validate: { validator: (v?: string) => v === undefined || v === null || isChannexDate(v), message: 'Invalid YYYY-MM-DD date' },
};

const channelAriChangeSchema = new Schema<IChannelAriChange>(
  {
    kind:        { type: String, enum: CHANNEL_ARI_CHANGE_KINDS, required: true },
    roomTypeId:  { type: Schema.Types.ObjectId, ref: 'RoomType' },
    ratePlanId:  { type: Schema.Types.ObjectId, ref: 'RatePlan' },
    dateFrom:    channexDate,
    dateTo: {
      type: String,
      validate: [
        channexDate.validate,
        {
          validator: function (this: IChannelAriChange, v?: string) { return !v || !this.dateFrom || this.dateFrom <= v; },
          message: 'dateTo must not be before dateFrom',
        },
      ],
    },
    fields:      { type: [String], default: () => ['*'] },
    reason:      { type: String, maxlength: 200 },
    sourceModel: { type: String, maxlength: 60 },
    sourceId:    { type: Schema.Types.ObjectId },
    status:      { type: String, enum: CHANNEL_ARI_CHANGE_STATUSES, default: 'pending' },
    attempts:    { type: Number, default: 0, min: 0 },
    batchId:     { type: String, maxlength: 64 },
    error:       { type: String, maxlength: 2000 },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

channelAriChangeSchema.plugin(tenantPlugin);
channelAriChangeSchema.index({ tenantId: 1, status: 1, createdAt: 1 });
channelAriChangeSchema.index(
  { completedAt: 1 },
  { expireAfterSeconds: ARI_CHANGE_DONE_TTL_SECONDS, partialFilterExpression: { status: 'done' } }
);

export default mongoose.model<IChannelAriChange>('ChannelAriChange', channelAriChangeSchema);
