import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IRoomType extends Document {
  name: string;
  capacity: number; // max total guests (adults + children)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roomTypeSchema = new Schema<IRoomType>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    capacity: { type: Number, required: true, min: 1, default: 2 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

roomTypeSchema.index({ name: 1 });

roomTypeSchema.plugin(tenantPlugin);

export default mongoose.model<IRoomType>('RoomType', roomTypeSchema);
