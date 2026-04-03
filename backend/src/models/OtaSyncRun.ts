import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type OtaSyncRunStatus = 'running' | 'completed' | 'failed' | 'partial';
export type OtaSyncRunTrigger = 'cron' | 'manual';

export interface IOtaSyncRun extends Document {
  tenantId: string;
  mappingId?: mongoose.Types.ObjectId; // null = full-tenant run
  provider?: string;
  triggeredBy: OtaSyncRunTrigger;
  status: OtaSyncRunStatus;
  startedAt: Date;
  completedAt?: Date;
  imported: number;
  updated: number;
  conflicts: number;
  errorCount: number;
  error?: string;
}

const otaSyncRunSchema = new Schema<IOtaSyncRun>(
  {
    tenantId: { type: String, required: true },
    mappingId: { type: Schema.Types.ObjectId, ref: 'OtaListingMapping' },
    provider: { type: String },
    triggeredBy: { type: String, enum: ['cron', 'manual'], required: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed', 'partial'],
      default: 'running',
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    imported: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    conflicts: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    error: { type: String, maxlength: 2000 },
  },
  { timestamps: false }
);

otaSyncRunSchema.plugin(tenantPlugin);
otaSyncRunSchema.index({ tenantId: 1, startedAt: -1 });
otaSyncRunSchema.index({ tenantId: 1, mappingId: 1, startedAt: -1 });
// Stale lock detection
otaSyncRunSchema.index({ tenantId: 1, status: 1, startedAt: 1 });

export default mongoose.model<IOtaSyncRun>('OtaSyncRun', otaSyncRunSchema);
