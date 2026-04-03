/**
 * PlatformSettings — global, platform-scoped configuration singleton.
 *
 * This model does NOT use tenantPlugin. It stores a single document
 * with key='global' that applies to the entire platform (all tenants).
 */
import mongoose, { Document, Schema } from 'mongoose';

export interface IPlatformOtaSync {
  globalEnabled: boolean;
  /** Cron tick interval in minutes — values: 5 | 10 | 15 | 20 | 30 | 60 */
  cronIntervalMinutes: number;
}

export interface IPlatformSettings extends Document {
  key: string;
  otaSync: IPlatformOtaSync;
}

const platformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, default: 'global' },
    otaSync: {
      globalEnabled:       { type: Boolean, default: true },
      cronIntervalMinutes: { type: Number, default: 5 },
    },
  },
  { timestamps: true }
);

platformSettingsSchema.index({ key: 1 }, { unique: true });

export default mongoose.model<IPlatformSettings>('PlatformSettings', platformSettingsSchema);
