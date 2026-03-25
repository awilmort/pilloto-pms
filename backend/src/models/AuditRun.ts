import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type AuditRunStatus = 'running' | 'completed' | 'failed' | 'skipped';
export type AuditRunTrigger = 'cron' | 'manual';

export interface IAuditRunSummary {
  rulesEvaluated: number;
  reservationsScanned: number;
  chargesPosted: number;
  skipped: number;
  errors: number;
}

export interface IAuditRun extends Document {
  tenantId: string;
  businessDate: string;          // YYYY-MM-DD — the audit date this run covers
  status: AuditRunStatus;
  triggeredBy: AuditRunTrigger;
  dryRun: boolean;
  startedAt: Date;
  completedAt?: Date;
  summary?: IAuditRunSummary;
  error?: string;
}

const auditRunSummarySchema = new Schema<IAuditRunSummary>(
  {
    rulesEvaluated:     { type: Number, default: 0 },
    reservationsScanned:{ type: Number, default: 0 },
    chargesPosted:      { type: Number, default: 0 },
    skipped:            { type: Number, default: 0 },
    errors:             { type: Number, default: 0 },
  },
  { _id: false }
);

const auditRunSchema = new Schema<IAuditRun>(
  {
    tenantId:     { type: String, required: true },
    businessDate: { type: String, required: true },   // YYYY-MM-DD
    status:       { type: String, enum: ['running', 'completed', 'failed', 'skipped'], default: 'running' },
    triggeredBy:  { type: String, enum: ['cron', 'manual'], required: true },
    dryRun:       { type: Boolean, default: false },
    startedAt:    { type: Date, default: Date.now },
    completedAt:  { type: Date },
    summary:      { type: auditRunSummarySchema },
    error:        { type: String },
  },
  { timestamps: false }
);

// One real run (non-dry) per tenant per day. Dry-run calls can repeat freely.
auditRunSchema.index({ tenantId: 1, businessDate: 1, dryRun: 1 });

// Stale-lock detection: index on status + startedAt so expired 'running' locks are cheap to query
auditRunSchema.index({ tenantId: 1, status: 1, startedAt: 1 });

auditRunSchema.plugin(tenantPlugin);

export default mongoose.model<IAuditRun>('AuditRun', auditRunSchema);
