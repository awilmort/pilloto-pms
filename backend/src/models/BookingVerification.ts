import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * Stores a 4-digit verification code sent to a guest's email
 * during the public booking flow. The code must be confirmed
 * before the reservation is finalized.
 */
export interface IBookingVerification extends Document {
  email: string;
  code: string;
  /** Number of failed attempts (lockout after 5) */
  attempts: number;
  verified: boolean;
  /** IP address that initiated the verification */
  ipAddress: string;
  /** Automatically expires after 15 minutes */
  expiresAt: Date;
  createdAt: Date;
}

const bookingVerificationSchema = new Schema<IBookingVerification>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    code: {
      type: String,
      required: true,
      minlength: 4,
      maxlength: 4,
    },
    attempts: {
      type: Number,
      default: 0,
      max: 5,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    ipAddress: {
      type: String,
      required: true,
      trim: true,
      maxlength: 45,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index — MongoDB auto-deletes expired documents
    },
  },
  { timestamps: true }
);

// Quick look-up by email + tenant
bookingVerificationSchema.index({ email: 1, verified: 1 });

// ── Multi-tenancy ────────────────────────────────────────────
bookingVerificationSchema.plugin(tenantPlugin);

export default mongoose.model<IBookingVerification>('BookingVerification', bookingVerificationSchema);
