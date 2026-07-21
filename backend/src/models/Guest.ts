import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface IGuestCompanyLink {
  companyId: mongoose.Types.ObjectId;
  autoApproveCorporateRate: boolean;
}

export type GuestTipoId = 'RNC' | 'Cedula' | 'Pasaporte' | 'Otro';

export interface IGuestFiscalInfo {
  rnc?: string;
  cedula?: string;
  tipoId?: GuestTipoId;
  razonSocial?: string;
}

export interface IGuest extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  notes?: string;
  /** Multi-company links replacing the legacy single companyId */
  companyLinks: IGuestCompanyLink[];
  /** Fiscal identification for e-CF invoicing */
  fiscalInfo?: IGuestFiscalInfo;
  createdAt: Date;
  updatedAt: Date;
}

const guestCompanyLinkSchema = new Schema<IGuestCompanyLink>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    autoApproveCorporateRate: { type: Boolean, default: false },
  },
  { _id: false }
);

const guestSchema = new Schema<IGuest>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    // Uniqueness enforced by compound index { email, tenantId } below
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    notes: { type: String, maxlength: 1000 },
    companyLinks: { type: [guestCompanyLinkSchema], default: [] },
    fiscalInfo: {
      rnc: { type: String, trim: true },
      cedula: { type: String, trim: true },
      tipoId: { type: String, enum: ['RNC', 'Cedula', 'Pasaporte', 'Otro'], trim: true },
      razonSocial: { type: String, trim: true },
    },
  },
  { timestamps: true }
);

// ── Multi-tenancy ────────────────────────────────────────────
guestSchema.plugin(tenantPlugin);
guestSchema.index({ email: 1, tenantId: 1 }, { unique: true });
guestSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });

export default mongoose.model<IGuest>('Guest', guestSchema);
