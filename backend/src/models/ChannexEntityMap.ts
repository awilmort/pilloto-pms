/**
 * ChannexEntityMap — Pilloto RoomType/RatePlan ↔ Channex room type/rate plan id
 * (CHANNEX_ARCHITECTURE.md §6.5, §10.1). Maintained by structural sync; the
 * `syncedSnapshot` is what was last sent, so changes (e.g. capacity) can be detected.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { ChannexEnvironment } from '../services/channex/config';
import { CHANNEX_ENVIRONMENTS } from './ChannexProperty';

export const CHANNEX_ENTITY_KINDS = ['room_type', 'rate_plan'] as const;
export type ChannexEntityKind = typeof CHANNEX_ENTITY_KINDS[number];
export const CHANNEX_ENTITY_MAP_STATUSES = ['active', 'orphaned', 'remap_required'] as const;
export type ChannexEntityMapStatus = typeof CHANNEX_ENTITY_MAP_STATUSES[number];

export interface IChannexEntityMap extends Document {
  tenantId: mongoose.Types.ObjectId;
  environment: ChannexEnvironment;
  kind: ChannexEntityKind;
  /** Pilloto RoomType or RatePlan _id */
  localId: mongoose.Types.ObjectId;
  channexId: string;
  channexPropertyId: string;
  syncedSnapshot?: {
    title?: string;
    occupancyOptions?: number[];
    countOfRooms?: number;
    childrenFee?: number;
  };
  status: ChannexEntityMapStatus;
  lastSyncedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const channexEntityMapSchema = new Schema<IChannexEntityMap>(
  {
    environment:       { type: String, enum: CHANNEX_ENVIRONMENTS, required: true },
    kind:              { type: String, enum: CHANNEX_ENTITY_KINDS, required: true },
    localId:           { type: Schema.Types.ObjectId, required: true },
    channexId:         { type: String, required: true, maxlength: 64 },
    channexPropertyId: { type: String, required: true, maxlength: 64 },
    syncedSnapshot: {
      title:            { type: String, maxlength: 255 },
      occupancyOptions: [{ type: Number, min: 1 }],
      countOfRooms:     { type: Number, min: 0 },
      childrenFee:      { type: Number, min: 0 },
    },
    status:            { type: String, enum: CHANNEX_ENTITY_MAP_STATUSES, default: 'active' },
    lastSyncedAt:      { type: Date },
    lastError:         { type: String, maxlength: 2000 },
  },
  { timestamps: true }
);

channexEntityMapSchema.plugin(tenantPlugin);
channexEntityMapSchema.index({ tenantId: 1, environment: 1, kind: 1, localId: 1 }, { unique: true });
channexEntityMapSchema.index({ environment: 1, channexId: 1 }, { unique: true });

export default mongoose.model<IChannexEntityMap>('ChannexEntityMap', channexEntityMapSchema);
