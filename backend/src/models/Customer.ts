import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * AR customer for the standalone Accounting product. Same field shape as
 * `Company.ts` on purpose (both are "who do we bill / report AR against"),
 * but a distinct collection: a PMS `Company` is a reservation-side entity
 * (group/corporate rates) and should never leak into the Accounting product's
 * customer picker, or vice versa.
 *
 * `linkedCompanyId` is the bridge for the one case where the two genuinely are the same
 * real-world entity — a pre-approved direct-bill account (hotel corporate account / travel
 * agency) that is also billed as an Accounting customer. It's informational only: `Customer`
 * keeps its own denormalized fields rather than a live join, so reports never need a second
 * lookup.
 *
 * `linkedGuestId` is the same bridge for the other real AR case: a departed guest whose
 * unpaid folio balance was transferred to City Ledger. Find-or-create on this field so
 * a repeat guest who runs a balance twice gets one `Customer`, not two.
 */
export interface ICustomer extends Document {
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
  /** Optional bridge to a PMS `Company` — set when this Customer is also a hotel direct-bill account. */
  linkedCompanyId?: mongoose.Types.ObjectId;
  /** Optional bridge to a PMS `Guest` — set when this Customer originated from a City Ledger transfer. */
  linkedGuestId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
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
    linkedCompanyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    linkedGuestId: { type: Schema.Types.ObjectId, ref: 'Guest' },
  },
  { timestamps: true }
);

customerSchema.index({ name: 'text', email: 'text', contactName: 'text' });

// ── Multi-tenancy ────────────────────────────────────────────
customerSchema.plugin(tenantPlugin);

export default mongoose.model<ICustomer>('Customer', customerSchema);
