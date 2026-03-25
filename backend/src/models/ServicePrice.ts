import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type ServicePriceCategory = 'standard' | 'special' | 'guest' | 'company';
export type ServicePriceValidity = 'everyday' | 'weekdays' | 'weekend' | 'custom';

export interface IServicePrice extends Document {
  /** Reference to the Service this price applies to. */
  serviceId: mongoose.Types.ObjectId;
  category: ServicePriceCategory;
  validity: ServicePriceValidity;
  /** Required when validity = 'custom' or category ∈ { special, guest, company }. */
  startDate?: Date;
  endDate?: Date;
  /** Required when category = 'guest'. Used for per-guest price overrides. */
  guestEmail?: string;
  /** Required when category = 'company'. */
  companyId?: mongoose.Types.ObjectId;
  adultPrice: number;
  childrenPrice: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

const servicePriceSchema = new Schema<IServicePrice>(
  {
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['standard', 'special', 'guest', 'company'] as ServicePriceCategory[],
      required: true,
      index: true,
    },
    validity: {
      type: String,
      enum: ['everyday', 'weekdays', 'weekend', 'custom'] as ServicePriceValidity[],
      required: true,
    },
    startDate: { type: Date },
    endDate: { type: Date },
    guestEmail: { type: String, index: true, sparse: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true, sparse: true },
    adultPrice: { type: Number, required: true, min: 0 },
    childrenPrice: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ── Validation hooks (mirrors Pricing.ts logic) ──────────────
servicePriceSchema.pre('save', function (next) {
  if (this.category === 'special') {
    if (this.validity !== 'custom') {
      return next(new Error('Special category requires validity to be custom'));
    }
    if (!this.startDate || !this.endDate) {
      return next(new Error('Special pricing requires startDate and endDate'));
    }
  }

  if (this.category === 'guest') {
    if (!this.guestEmail?.trim()) {
      return next(new Error('Guest pricing requires a guest email'));
    }
    this.validity = 'custom';
    if (!this.startDate || !this.endDate) {
      return next(new Error('Guest pricing requires startDate and endDate'));
    }
  }

  if (this.category === 'company') {
    if (!this.companyId) {
      return next(new Error('Company pricing requires a company'));
    }
    this.validity = 'custom';
    if (!this.startDate || !this.endDate) {
      return next(new Error('Company pricing requires startDate and endDate'));
    }
  }

  if (this.validity === 'custom') {
    if (!this.startDate || !this.endDate) {
      return next(new Error('Custom validity requires startDate and endDate'));
    }
  }

  if (this.startDate) this.startDate = startOfDay(this.startDate);
  if (this.endDate) this.endDate = endOfDay(this.endDate);
  next();
});

servicePriceSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() as any;
  if (update) {
    if (update.startDate) update.startDate = startOfDay(new Date(update.startDate));
    if (update.endDate) update.endDate = endOfDay(new Date(update.endDate));
  }
  next();
});

servicePriceSchema.index({ serviceId: 1, category: 1, validity: 1, startDate: 1, endDate: 1 });

// ── Multi-tenancy ────────────────────────────────────────────
servicePriceSchema.plugin(tenantPlugin);

export default mongoose.model<IServicePrice>('ServicePrice', servicePriceSchema);
