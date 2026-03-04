import mongoose, { Document, Schema } from 'mongoose';

export interface IAppSettings extends Document {
  key: string;        // singleton key, always 'global'
  services: {
    daypass: boolean;
    accommodation: boolean;
    pasatarde: boolean;
    event: boolean;
  };
  accommodationPricingModel: 'perGuest' | 'perRoom';
  sections: Record<string, boolean>;
  cashierShift: {
    openTime: string;
    closeTime: string;
  };
  updatedAt: Date;
}

const appSettingsSchema = new Schema<IAppSettings>(
  {
    key: { type: String, default: 'global', unique: true },
    services: {
      daypass:       { type: Boolean, default: true },
      accommodation: { type: Boolean, default: true },
      pasatarde:     { type: Boolean, default: true },
      event:         { type: Boolean, default: true },
    },
    accommodationPricingModel: {
      type: String,
      enum: ['perGuest', 'perRoom'],
      default: 'perGuest',
    },
    sections: {
      type: Schema.Types.Mixed,
      default: () => ({
        dashboard: true, revenue: true, commissions: true,
        schedule: true, accommodations: true, rooms: true,
        amenities: true, 'event-types': true, wristbands: true,
        pricing: true, reservations: true, users: true,
        roles: true, media: true, analytics: true,
        companies: true, guests: true, 'cashier-closures': true,
      }),
    },
    cashierShift: {
      openTime: { type: String, default: '08:00' },
      closeTime: { type: String, default: '17:00' },
    },
  },
  { timestamps: true }
);

export default mongoose.model<IAppSettings>('AppSettings', appSettingsSchema);
