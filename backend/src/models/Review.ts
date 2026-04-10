import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IReview extends Document {
  guestName: string;
  rating: number;           // 1–5
  comment: string;
  source: string;           // e.g. 'Google', 'TripAdvisor', 'Booking.com', 'Direct'
  isActive: boolean;        // toggle visibility on booking engine
  displayOrder: number;     // manual ordering
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    guestName:    { type: String, required: true, maxlength: 120, trim: true },
    rating:       { type: Number, required: true, min: 1, max: 5 },
    comment:      { type: String, required: true, maxlength: 500, trim: true },
    source:       { type: String, default: 'Direct', maxlength: 60, trim: true },
    isActive:     { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

reviewSchema.plugin(tenantPlugin);
reviewSchema.index({ isActive: 1, displayOrder: 1 });

export default mongoose.model<IReview>('Review', reviewSchema);
