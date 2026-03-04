import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

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
  },
  status: {
    type: String,
    enum: ['open', 'in_ar', 'closed'],
    default: 'open',
    index: true,
  },
}, { timestamps: true });

// ── Multi-tenancy ────────────────────────────────────────────
folioSchema.plugin(tenantPlugin);

export default mongoose.model<IFolio>('Folio', folioSchema);
