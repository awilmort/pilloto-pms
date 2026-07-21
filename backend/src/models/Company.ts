import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export interface ICompany extends Document {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  /** RNC for B2B e-CF (Factura de Crédito Fiscal E31) */
  rnc?: string;
  razonSocial?: string;
  createdAt: Date;
  updatedAt: Date;
}

const companySchema = new Schema<ICompany>(
  {
    name: { type: String, required: true, trim: true, index: true },
    contactName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    notes: { type: String, maxlength: 1000 },
    isActive: { type: Boolean, default: true },
    rnc: { type: String, trim: true },
    razonSocial: { type: String, trim: true },
  },
  { timestamps: true }
);

companySchema.index({ name: 'text', email: 'text', contactName: 'text' });

// ── Multi-tenancy ────────────────────────────────────────────
companySchema.plugin(tenantPlugin);

export default mongoose.model<ICompany>('Company', companySchema);
