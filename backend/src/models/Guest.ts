import mongoose, { Document, Schema } from 'mongoose';

export interface IGuest extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const guestSchema = new Schema<IGuest>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, trim: true },
    notes: { type: String, maxlength: 1000 },
  },
  { timestamps: true }
);

guestSchema.index({ email: 1 }, { unique: true });
guestSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });

export default mongoose.model<IGuest>('Guest', guestSchema);
