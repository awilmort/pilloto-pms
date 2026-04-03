import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type OtaProvider = 'airbnb' | 'booking_com' | 'vrbo' | 'expedia' | 'other';

export interface IOtaListingMapping extends Document {
  tenantId: string;
  provider: OtaProvider;
  providerLabel?: string;      // Display name override (e.g., "Airbnb – Cabaña 1")
  externalListingId?: string;  // OTA's own listing/unit identifier
  inboundFeedUrl?: string;     // URL of OTA's iCal export feed (we pull from this)
  outboundToken: string;       // Opaque token for our iCal feed URL
  /** Local room (or accommodation unit) that this OTA listing maps to */
  roomId?: mongoose.Types.ObjectId;
  isActive: boolean;
  lastSyncedAt?: Date;
  lastSyncStatus?: 'ok' | 'error' | 'never';
  lastSyncError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const otaListingMappingSchema = new Schema<IOtaListingMapping>(
  {
    provider: {
      type: String,
      enum: ['airbnb', 'booking_com', 'vrbo', 'expedia', 'other'],
      required: true,
    },
    providerLabel: { type: String, trim: true, maxlength: 120 },
    externalListingId: { type: String, trim: true, maxlength: 200 },
    inboundFeedUrl: { type: String, trim: true, maxlength: 2000 },
    outboundToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
    isActive: { type: Boolean, default: true },
    lastSyncedAt: { type: Date },
    lastSyncStatus: { type: String, enum: ['ok', 'error', 'never'], default: 'never' },
    lastSyncError: { type: String, maxlength: 1000 },
  },
  { timestamps: true }
);

otaListingMappingSchema.plugin(tenantPlugin);
otaListingMappingSchema.index({ tenantId: 1, isActive: 1 });

export default mongoose.model<IOtaListingMapping>('OtaListingMapping', otaListingMappingSchema);
