/**
 * ChannexBookingRevision — the booking revision inbox (CHANNEX_ARCHITECTURE.md §7.3, §10.1).
 *
 * Keyed by Channex revision id, so a revision delivered by both the webhook and the feed
 * poller is stored and applied once. `payload` is card-scrubbed (masked guarantee only)
 * and is Pilloto's durable copy — Channex deletes bookings 6 months after checkout.
 * Rows can exist before their tenant is known (unknown property → `failed`), so lookups
 * by revision id are made outside tenant context.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export const BOOKING_REVISION_STATUSES = ['new', 'modified', 'cancelled'] as const;
export type BookingRevisionStatus = typeof BOOKING_REVISION_STATUSES[number];
export const BOOKING_REVISION_SOURCES = ['webhook', 'feed'] as const;
export type BookingRevisionSource = typeof BOOKING_REVISION_SOURCES[number];
export const BOOKING_REVISION_PROCESSING = ['received', 'applied', 'skipped_stale', 'failed'] as const;
export type BookingRevisionProcessing = typeof BOOKING_REVISION_PROCESSING[number];

export interface IChannexBookingRevision extends Document {
  tenantId?: mongoose.Types.ObjectId;
  channexRevisionId: string;
  channexBookingId: string;
  channexPropertyId?: string;
  status?: BookingRevisionStatus;
  insertedAt?: Date;
  /** From the payload, for the inbox list: e.g. "BookingCom", and the OTA's own reservation code */
  otaName?: string;
  otaReservationCode?: string;
  payload?: Record<string, unknown>;
  source: BookingRevisionSource;
  processing: BookingRevisionProcessing;
  reservationId?: mongoose.Types.ObjectId;
  error?: string;
  attempts: number;
  ackedAt?: Date;
  /** Guest personal data removed from `payload` (privacy erasure) */
  erasedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const channexBookingRevisionSchema = new Schema<IChannexBookingRevision>(
  {
    channexRevisionId: { type: String, required: true, maxlength: 64 },
    channexBookingId:  { type: String, required: true, maxlength: 64 },
    channexPropertyId: { type: String, maxlength: 64 },
    status:            { type: String, enum: BOOKING_REVISION_STATUSES },
    insertedAt:        { type: Date },
    otaName:           { type: String, maxlength: 80 },
    otaReservationCode:{ type: String, maxlength: 120 },
    payload:           { type: Schema.Types.Mixed },
    source:            { type: String, enum: BOOKING_REVISION_SOURCES, required: true },
    processing:        { type: String, enum: BOOKING_REVISION_PROCESSING, default: 'received' },
    reservationId:     { type: Schema.Types.ObjectId, ref: 'Reservation' },
    error:             { type: String, maxlength: 2000 },
    attempts:          { type: Number, default: 0, min: 0 },
    ackedAt:           { type: Date },
    erasedAt:          { type: Date },
  },
  { timestamps: true, minimize: false }
);

channexBookingRevisionSchema.plugin(tenantPlugin);
channexBookingRevisionSchema.index({ channexRevisionId: 1 }, { unique: true });
channexBookingRevisionSchema.index({ channexBookingId: 1, insertedAt: 1 });
channexBookingRevisionSchema.index({ tenantId: 1, processing: 1 });
channexBookingRevisionSchema.index({ tenantId: 1, createdAt: -1 });

export default mongoose.model<IChannexBookingRevision>('ChannexBookingRevision', channexBookingRevisionSchema);
