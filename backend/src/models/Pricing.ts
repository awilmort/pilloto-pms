import mongoose, { Document, Schema } from 'mongoose';

export type PricingService = 'daypass' | 'pasatarde' | 'hospedaje';
export type PricingCategory = 'standard' | 'special' | 'guest' | 'company';
export type PricingValidity = 'everyday' | 'weekdays' | 'weekend' | 'custom';

export interface IPricing extends Document {
  service: PricingService;
  category: PricingCategory;
  validity: PricingValidity;
  startDate?: Date; // required when validity = custom (and for special/guest)
  endDate?: Date;   // required when validity = custom (and for special/guest)
  guestEmail?: string; // required when category = 'guest'
  companyId?: mongoose.Types.ObjectId; // required when category = 'company', ref: 'Company'
  adultPrice: number;
  childrenPrice: number;
  roomPrice?: number; // Used when pricing model is perRoom for hospedaje
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const pricingSchema = new Schema<IPricing>({
  service: { type: String, enum: ['daypass', 'pasatarde', 'hospedaje'], required: true, index: true },
  category: { type: String, enum: ['standard', 'special', 'guest', 'company'], required: true, index: true },
  validity: { type: String, enum: ['everyday', 'weekdays', 'weekend', 'custom'], required: true },
  startDate: { type: Date },
  endDate: { type: Date },
  guestEmail: { type: String, index: true, sparse: true },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true, sparse: true },
  adultPrice: { type: Number, required: true, min: 0 },
  childrenPrice: { type: Number, required: true, min: 0 },
  roomPrice: { type: Number, min: 0 }, // Optional: flat per-room nightly rate for hospedaje perRoom model
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

pricingSchema.pre('save', function(next) {
  // If category is special, validity must be custom and dates provided
  if (this.category === 'special') {
    if (this.validity !== 'custom') {
      return next(new Error('Special category requires validity to be Custom'));
    }
    if (!this.startDate || !this.endDate) {
      return next(new Error('Special pricing requires startDate and endDate'));
    }
  }
  // If category is guest, require guestEmail + force custom validity + require dates
  if (this.category === 'guest') {
    if (!this.guestEmail || !this.guestEmail.trim()) {
      return next(new Error('Guest pricing requires a guest email'));
    }
    this.validity = 'custom';
    if (!this.startDate || !this.endDate) {
      return next(new Error('Guest pricing requires startDate and endDate'));
    }
  }
  // If category is company, require companyId + force custom validity + require dates
  if (this.category === 'company') {
    if (!this.companyId) {
      return next(new Error('Company pricing requires a company'));
    }
    this.validity = 'custom';
    if (!this.startDate || !this.endDate) {
      return next(new Error('Company pricing requires startDate and endDate'));
    }
  }
  // If validity is custom, ensure dates
  if (this.validity === 'custom') {
    if (!this.startDate || !this.endDate) {
      return next(new Error('Custom validity requires startDate and endDate'));
    }
  }

  // Normalize date range to day boundaries to guarantee inclusivity
  if (this.startDate) this.startDate = startOfDay(this.startDate);
  if (this.endDate) this.endDate = endOfDay(this.endDate);
  next();
});

// Ensure updates also normalize date boundaries
pricingSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate() as any;
  if (update) {
    if (update.startDate) {
      const s = new Date(update.startDate);
      update.startDate = startOfDay(s);
    }
    if (update.endDate) {
      const e = new Date(update.endDate);
      update.endDate = endOfDay(e);
    }
  }
  next();
});

pricingSchema.index({ service: 1, category: 1, validity: 1, startDate: 1, endDate: 1 });

export default mongoose.model<IPricing>('Pricing', pricingSchema);
