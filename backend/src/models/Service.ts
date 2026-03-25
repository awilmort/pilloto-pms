import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type ServiceKind = 'daypass' | 'pasatarde' | 'event' | 'roomAddon' | 'generic';
export type ChargeBasis = 'perPerson' | 'perRoom' | 'perStay' | 'perEvent';

export interface IService extends Document {
  /** Unique short code per tenant (e.g. "DAYPASS", "PASATARDE"). Used for look-up. */
  code: string;
  name: string;
  /** Drives behavior: pricing look-up, reservation type matching, UI display. */
  kind: ServiceKind;
  /** How the unit price is multiplied to get the subtotal. */
  chargeBasis: ChargeBasis;
  isActive: boolean;
  /** Whether the service can appear in the guest-facing online booking flow. */
  isOnlineBookable: boolean;
  /** Whether the service appears as a quick-add in the POS / front-desk interface. */
  isVisibleInPOS: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const serviceSchema = new Schema<IService>(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    kind: {
      type: String,
      enum: ['daypass', 'pasatarde', 'event', 'roomAddon', 'generic'] as ServiceKind[],
      required: true,
      index: true,
    },
    chargeBasis: {
      type: String,
      enum: ['perPerson', 'perRoom', 'perStay', 'perEvent'] as ChargeBasis[],
      required: true,
    },
    isActive: { type: Boolean, default: true },
    isOnlineBookable: { type: Boolean, default: false },
    isVisibleInPOS: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Unique code per tenant (enforced by tenantPlugin scoping the index)
serviceSchema.index({ code: 1 }, { unique: true, sparse: false });

// ── Multi-tenancy ────────────────────────────────────────────
serviceSchema.plugin(tenantPlugin);

export default mongoose.model<IService>('Service', serviceSchema);
