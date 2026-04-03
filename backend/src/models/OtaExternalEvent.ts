import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

/**
 * Stores a normalized representation of an iCal event we pulled from an OTA feed.
 * Deduplicated by (tenantId, mappingId, externalUid).
 * Linked to a local Reservation once imported successfully.
 */
export interface IOtaExternalEvent extends Document {
  tenantId: string;
  mappingId: mongoose.Types.ObjectId;   // Which OtaListingMapping this came from
  provider: string;

  // iCal event identity
  externalUid: string;                  // UID from the iCal VEVENT
  summary?: string;                     // SUMMARY (often "Airbnb (Confirmed)")
  guestName?: string;                   // Parsed from SUMMARY when available

  // Date range (stored as UTC midnight of the check-in/out date in property tz)
  checkIn: Date;
  checkOut: Date;

  // Raw iCal snapshot for auditability
  rawSnapshot?: string;

  // Status tracking
  status: 'active' | 'disappeared' | 'cancelled';
  firstSeenAt: Date;
  lastSeenAt: Date;

  // Linked local reservation (set when we create/find a match)
  reservationId?: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const otaExternalEventSchema = new Schema<IOtaExternalEvent>(
  {
    tenantId: { type: String, required: true },
    mappingId: { type: Schema.Types.ObjectId, ref: 'OtaListingMapping', required: true },
    provider: { type: String, required: true },
    externalUid: { type: String, required: true, maxlength: 500 },
    summary: { type: String, maxlength: 500 },
    guestName: { type: String, maxlength: 200 },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true },
    rawSnapshot: { type: String, maxlength: 4000 },
    status: {
      type: String,
      enum: ['active', 'disappeared', 'cancelled'],
      default: 'active',
    },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation' },
  },
  { timestamps: true }
);

otaExternalEventSchema.plugin(tenantPlugin);
// Deduplicate by OTA identity
otaExternalEventSchema.index({ tenantId: 1, mappingId: 1, externalUid: 1 }, { unique: true });
otaExternalEventSchema.index({ tenantId: 1, checkIn: 1 });

export default mongoose.model<IOtaExternalEvent>('OtaExternalEvent', otaExternalEventSchema);
