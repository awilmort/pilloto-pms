import mongoose, { Document, Schema } from 'mongoose';

export interface IAmenity extends Document {
  name: string;
  description: string;
  image: string;
  isActive: boolean;
  category: 'accommodation' | 'dining' | 'recreation' | 'wellness' | 'business' | 'general';
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const amenitySchema = new Schema<IAmenity>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  image: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  category: {
    type: String,
    enum: ['accommodation', 'dining', 'recreation', 'wellness', 'business', 'general'],
    default: 'general'
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for efficient queries
amenitySchema.index({ isActive: 1, order: 1 });
amenitySchema.index({ category: 1, isActive: 1 });

export default mongoose.model<IAmenity>('Amenity', amenitySchema);
