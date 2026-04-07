import mongoose, { Document, Schema } from 'mongoose';

export type PrivacyRequestType = 'access' | 'deletion' | 'rectification' | 'portability' | 'objection';
export type PrivacyRequestStatus = 'pending' | 'in_progress' | 'completed' | 'denied';

export interface IPrivacyRequest extends Document {
  email: string;
  name: string;
  requestType: PrivacyRequestType;
  status: PrivacyRequestStatus;
  description: string;
  tenantId?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  resolvedBy?: mongoose.Types.ObjectId;
  resolutionNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const privacyRequestSchema = new Schema<IPrivacyRequest>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    requestType: {
      type: String,
      enum: ['access', 'deletion', 'rectification', 'portability', 'objection'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'denied'],
      default: 'pending',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
    },
    resolvedAt: Date,
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    resolutionNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

privacyRequestSchema.index({ email: 1, status: 1 });
privacyRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IPrivacyRequest>('PrivacyRequest', privacyRequestSchema);
