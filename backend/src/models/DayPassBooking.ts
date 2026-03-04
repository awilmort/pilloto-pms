import mongoose, { Schema, Document } from 'mongoose';

export interface IDayPassBooking extends Document {
  user: mongoose.Types.ObjectId;
  date: Date;
  adults: number;
  children: number;
  infants: number;
  totalGuests: number;
  totalPrice: number;
  contactInfo: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    country?: string;
  };
  specialRequests?: string;
  status: 'confirmed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

const DayPassBookingSchema: Schema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  date: {
    type: Date,
    required: true
  },
  adults: {
    type: Number,
    required: true,
    min: 1
  },
  children: {
    type: Number,
    default: 0,
    min: 0
  },
  infants: {
    type: Number,
    default: 0,
    min: 0
  },
  totalGuests: {
    type: Number,
    required: true
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  contactInfo: {
    firstName: {
      type: String,
      required: true,
      trim: true
    },
    lastName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    country: {
      type: String,
      trim: true
    }
  },
  specialRequests: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['confirmed', 'cancelled'],
    default: 'confirmed'
  }
}, {
  timestamps: true
});

// Indexes for better query performance
DayPassBookingSchema.index({ user: 1, date: 1 });
DayPassBookingSchema.index({ date: 1 });
DayPassBookingSchema.index({ status: 1 });

export default mongoose.model<IDayPassBooking>('DayPassBooking', DayPassBookingSchema);
