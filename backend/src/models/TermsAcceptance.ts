import mongoose, { Document, Schema } from 'mongoose';

export interface ITermsAcceptance extends Document {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  documentType: 'terms' | 'privacy' | 'aup';
  documentVersion: string;
  acceptedAt: Date;
  ipAddress: string;
  userAgent: string;
}

const termsAcceptanceSchema = new Schema<ITermsAcceptance>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: ['terms', 'privacy', 'aup'],
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
  },
  { timestamps: true }
);

termsAcceptanceSchema.index({ tenantId: 1, userId: 1, documentType: 1 });
termsAcceptanceSchema.index({ documentType: 1, documentVersion: 1 });

export default mongoose.model<ITermsAcceptance>('TermsAcceptance', termsAcceptanceSchema);
