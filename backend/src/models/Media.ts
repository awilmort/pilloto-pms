import mongoose, { Document, Schema } from 'mongoose';

export interface IMedia extends Document {
  filename: string; // stored filename with extension, unique
  title: string;
  description?: string;
  url: string;
  type: 'image' | 'video';
  category: 'rooms' | 'aquapark' | 'facilities' | 'dining' | 'activities' | 'general';
  isPublic: boolean;
  isFeatured: boolean;
  tags: string[];
  uploadedBy: mongoose.Types.ObjectId;
  fileSize: number;
  dimensions?: {
    width: number;
    height: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const mediaSchema = new Schema<IMedia>({
  filename: {
    type: String,
    required: true,
    trim: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500,
    trim: true
  },
  url: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['image', 'video'],
    required: true
  },
  category: {
    type: String,
    enum: ['rooms', 'aquapark', 'facilities', 'dining', 'activities', 'general'],
    required: true
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  uploadedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  fileSize: {
    type: Number,
    required: true
  },
  dimensions: {
    width: { type: Number },
    height: { type: Number }
  }
}, {
  timestamps: true
});

// Index for efficient queries
mediaSchema.index({ filename: 1 }, { unique: true });
mediaSchema.index({ url: 1 }, { unique: true });
mediaSchema.index({ category: 1, isPublic: 1 });
mediaSchema.index({ isFeatured: 1, isPublic: 1 });
mediaSchema.index({ tags: 1 });
mediaSchema.index({ uploadedBy: 1 });

export default mongoose.model<IMedia>('Media', mediaSchema);
