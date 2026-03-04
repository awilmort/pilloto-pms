import mongoose, { Document, Schema } from 'mongoose';

export type CreditScope = 'guest' | 'company';
export type CreditAccountStatus = 'active' | 'suspended';

export interface ICreditAccount extends Document {
  scope: CreditScope;
  referenceId: mongoose.Types.ObjectId;
  creditLimit: number;
  currentExposure: number;
  status: CreditAccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

const creditAccountSchema = new Schema<ICreditAccount>({
  scope: {
    type: String,
    enum: ['guest', 'company'],
    required: true,
    index: true,
  },
  referenceId: {
    type: Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  creditLimit: {
    type: Number,
    required: true,
    min: 0,
  },
  currentExposure: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    required: true,
    default: 'active',
    index: true,
  },
}, { timestamps: true });

creditAccountSchema.index({ scope: 1, referenceId: 1 }, { unique: true });

export default mongoose.model<ICreditAccount>('CreditAccount', creditAccountSchema);
