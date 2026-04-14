import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IGuest extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  notes?: string;
  companyId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const guestSchema = new Schema<IGuest>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    // Uniqueness enforced by compound index { email, tenantId } below
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    notes: { type: String, maxlength: 1000 },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: false },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
guestSchema.plugin(tenantPlugin);
guestSchema.index({ email: 1, tenantId: 1 }, { unique: true });
guestSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });

export default mongoose.model<IGuest>('Guest', guestSchema);
