import mongoose, { Document, Schema } from 'mongoose';

export type SuppressionReason = 'hard_bounce' | 'soft_bounce' | 'complaint';

export interface IEmailSuppression extends Document {
  email: string;
  reason: SuppressionReason;
  suppressedAt: Date;
  // tenantId intentionally omitted: hard bounces and complaints apply globally.
  // An invalid/complaining address is invalid/complaining regardless of which
  // tenant sent to it, so a global suppression list is the correct model.
}

const emailSuppressionSchema = new Schema<IEmailSuppression>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
      unique: true,
    },
    reason: {
      type: String,
      enum: ['hard_bounce', 'soft_bounce', 'complaint'],
      required: true,
    },
    suppressedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

export default mongoose.model<IEmailSuppression>('EmailSuppression', emailSuppressionSchema);
