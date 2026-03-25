import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IRoom extends Document {
  name: string;
  description: string;
  amenities: string[];
  images: string[];
  status: 'active' | 'inactive';
  condition: 'pending_cleanup' | 'clean';
  comment?: string;
  features: {
    wifi: boolean;
    airConditioning: boolean;
    miniBar: boolean;
    balcony: boolean;
    oceanView: boolean;
    kitchenette: boolean;
    jacuzzi: boolean;
  };
  bedConfiguration: string;
  roomTypeId?: mongoose.Types.ObjectId; // Reference to the RoomType this room belongs to
  createdAt: Date;
  updatedAt: Date;
}

const roomSchema = new Schema<IRoom>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    maxlength: 1000
  },
  amenities: [{
    type: String,
    trim: true
  }],
  images: [{
    type: String,
    required: true
  }],
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  condition: {
    type: String,
    enum: ['pending_cleanup', 'clean'],
    default: 'clean'
  },
  comment: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  features: {
    wifi: { type: Boolean, default: true },
    airConditioning: { type: Boolean, default: true },
    miniBar: { type: Boolean, default: false },
    balcony: { type: Boolean, default: false },
    oceanView: { type: Boolean, default: false },
    kitchenette: { type: Boolean, default: false },
    jacuzzi: { type: Boolean, default: false }
  },
  bedConfiguration: {
    type: String,
    required: true,
    maxlength: 100
  },
  roomTypeId: {
    type: Schema.Types.ObjectId,
    ref: 'RoomType',
    default: null,
  },
}, {
  timestamps: true
});

// Index for searching
roomSchema.index({ status: 1 });
roomSchema.index({ condition: 1 });

// ── Multi-tenancy ────────────────────────────────────────────
roomSchema.plugin(tenantPlugin);

export default mongoose.model<IRoom>('Room', roomSchema);
