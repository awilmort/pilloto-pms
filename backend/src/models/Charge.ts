import mongoose, { Document, Schema } from 'mongoose';

export interface ICharge extends Document {
  folioId: mongoose.Types.ObjectId;
  description: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
}

const chargeSchema = new Schema<ICharge>({
  folioId: {
    type: Schema.Types.ObjectId,
    ref: 'Folio',
    required: true,
    index: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
}, { timestamps: true });

export default mongoose.model<ICharge>('Charge', chargeSchema);
