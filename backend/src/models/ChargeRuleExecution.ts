import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type ExecutionStatus = 'success' | 'skipped' | 'error';

export interface IChargeRuleExecution extends Document {
  chargeRuleId: mongoose.Types.ObjectId;
  reservationId: mongoose.Types.ObjectId;
  /** ISO date string (YYYY-MM-DD) representing the business date of the audit run.
   *  Combined with chargeRuleId + reservationId forms the idempotency key. */
  businessDate: string;
  status: ExecutionStatus;
  chargeId?: mongoose.Types.ObjectId;
  errorMessage?: string;
  executedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const chargeRuleExecutionSchema = new Schema<IChargeRuleExecution>({
  chargeRuleId: {
    type: Schema.Types.ObjectId,
    ref: 'ChargeRule',
    required: true,
    index: true,
  },
  reservationId: {
    type: Schema.Types.ObjectId,
    ref: 'Reservation',
    required: true,
    index: true,
  },
  /** YYYY-MM-DD – prevents double-posting on the same business day */
  businessDate: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['success', 'skipped', 'error'],
    required: true,
  },
  chargeId: {
    type: Schema.Types.ObjectId,
    ref: 'Charge',
  },
  errorMessage: {
    type: String,
  },
  executedAt: {
    type: Date,
    default: () => new Date(),
  },
}, { timestamps: true });

// Compound unique index ensures one execution per rule+reservation+day
chargeRuleExecutionSchema.index(
  { chargeRuleId: 1, reservationId: 1, businessDate: 1 },
  { unique: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
chargeRuleExecutionSchema.plugin(tenantPlugin);

export default mongoose.model<IChargeRuleExecution>('ChargeRuleExecution', chargeRuleExecutionSchema);
