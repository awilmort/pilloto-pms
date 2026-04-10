import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * Records guest acceptance of booking-specific terms and privacy policy
 * from the public booking flow (unauthenticated).
 *
 * Separate from TermsAcceptance which requires a userId (staff/admin flow).
 */
export interface IGuestTermsAcceptance extends Document {
  email: string;
  guestName: string;
  documentType: 'booking-terms' | 'booking-privacy';
  documentVersion: string;
  acceptedAt: Date;
  ipAddress: string;
  userAgent: string;
  /** The BookingVerification._id that proved email ownership */
  verificationId?: mongoose.Types.ObjectId;
}

const guestTermsAcceptanceSchema = new Schema<IGuestTermsAcceptance>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      index: true,
    },
    guestName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    documentType: {
      type: String,
      enum: ['booking-terms', 'booking-privacy'],
      required: true,
    },
    documentVersion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },
    acceptedAt: {
      type: Date,
      default: Date.now,
    },
    ipAddress: {
      type: String,
      required: true,
      trim: true,
      maxlength: 45,
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    verificationId: {
      type: Schema.Types.ObjectId,
      ref: 'BookingVerification',
    },
  },
  { timestamps: true }
);

guestTermsAcceptanceSchema.index({ email: 1, documentType: 1, documentVersion: 1 });

// ── Multi-tenancy ────────────────────────────────────────────
guestTermsAcceptanceSchema.plugin(tenantPlugin);

export default mongoose.model<IGuestTermsAcceptance>('GuestTermsAcceptance', guestTermsAcceptanceSchema);
