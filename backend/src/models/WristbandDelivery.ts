import mongoose, { Document, Schema } from 'mongoose';

export interface IWristbandDelivery extends Document {
  date: Date;
  type: 'delivery' | 'collection';
  deliveredBy?: mongoose.Types.ObjectId;
  recipient?: string; // e.g., reception crew name or shift
  counts: {
    daypassAdults: number;
    daypassChildren: number;
    accommodations: number;
    pasatarde: number;
  };
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const wristbandDeliverySchema = new Schema<IWristbandDelivery>({
  date: { type: Date, required: true },
  type: { type: String, enum: ['delivery', 'collection'], default: 'delivery', required: true },
  deliveredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  recipient: { type: String, trim: true, maxlength: 100 },
  counts: {
    daypassAdults: { type: Number, required: true, min: 0 },
    daypassChildren: { type: Number, required: true, min: 0 },
    accommodations: { type: Number, required: true, min: 0 },
    pasatarde: { type: Number, required: true, min: 0 },
  },
  notes: { type: String, trim: true, maxlength: 500 },
}, { timestamps: true });

wristbandDeliverySchema.index({ date: 1 });

export default mongoose.model<IWristbandDelivery>('WristbandDelivery', wristbandDeliverySchema);
