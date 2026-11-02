/**
 * ChannexSyncLog — one row per Channex ARI/structure call (CHANNEX_ARCHITECTURE.md §9.2).
 * Shown as "Sync activity" on the Channel Manager home; certification task ids are
 * copied from here. Expires after 90 days.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export const CHANNEX_SYNC_TRIGGERS = ['delta', 'full_sync', 'manual'] as const;
export type ChannexSyncTrigger = typeof CHANNEX_SYNC_TRIGGERS[number];
export const CHANNEX_SYNC_KINDS = ['availability', 'restrictions', 'structure'] as const;
export type ChannexSyncKind = typeof CHANNEX_SYNC_KINDS[number];

export const SYNC_LOG_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface IChannexSyncLog extends Document {
  tenantId: mongoose.Types.ObjectId;
  trigger: ChannexSyncTrigger;
  kind: ChannexSyncKind;
  valuesCount: number;
  dateFrom?: string;
  dateTo?: string;
  taskIds: string[];
  warnings: unknown[];
  httpStatus?: number;
  durationMs?: number;
  error?: string;
  batchId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const channexSyncLogSchema = new Schema<IChannexSyncLog>(
  {
    trigger:     { type: String, enum: CHANNEX_SYNC_TRIGGERS, required: true },
    kind:        { type: String, enum: CHANNEX_SYNC_KINDS, required: true },
    valuesCount: { type: Number, default: 0, min: 0 },
    dateFrom:    { type: String, maxlength: 10 },
    dateTo:      { type: String, maxlength: 10 },
    taskIds:     { type: [String], default: () => [] },
    warnings:    { type: [Schema.Types.Mixed], default: () => [] },
    httpStatus:  { type: Number },
    durationMs:  { type: Number, min: 0 },
    error:       { type: String, maxlength: 2000 },
    batchId:     { type: String, maxlength: 64 },
  },
  { timestamps: true }
);

channexSyncLogSchema.plugin(tenantPlugin);
channexSyncLogSchema.index({ tenantId: 1, createdAt: -1 });
channexSyncLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: SYNC_LOG_TTL_SECONDS });

export default mongoose.model<IChannexSyncLog>('ChannexSyncLog', channexSyncLogSchema);
