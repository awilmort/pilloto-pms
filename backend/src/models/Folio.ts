import mongoose, { Document, Schema } from 'mongoose';

export type FolioStatus = 'open' | 'in_ar' | 'closed';

export interface IFolio extends Document {
  reservationId: mongoose.Types.ObjectId;
  status: FolioStatus;
  createdAt: Date;
  updatedAt: Date;
}

const folioSchema = new Schema<IFolio>({
  reservationId: {
    type: Schema.Types.ObjectId,
    ref: 'Reservation',
    required: true,
    unique: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['open', 'in_ar', 'closed'],
    default: 'open',
    index: true,
  },
}, { timestamps: true });

export default mongoose.model<IFolio>('Folio', folioSchema);
