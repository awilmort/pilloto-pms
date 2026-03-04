import mongoose, { Document, Schema } from 'mongoose';

export interface IEventType extends Document {
  type: string; // identifier e.g., 'wedding'
  title: string; // display name
  description?: string;
  features: string[];
  priceFrom: number;
  maxGuests: number;
  maxChildren: number;
  maxAdults?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const eventTypeSchema = new Schema<IEventType>({
  type: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    maxlength: 50
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  features: {
    type: [String],
    default: []
  },
  priceFrom: {
    type: Number,
    required: true,
    min: 0
  },
  maxGuests: {
    type: Number,
    required: true,
    min: 1
  },
  maxChildren: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  maxAdults: {
    type: Number,
    required: false,
    min: 1
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

eventTypeSchema.index({ isActive: 1, priceFrom: 1 });

export default mongoose.model<IEventType>('EventType', eventTypeSchema);
