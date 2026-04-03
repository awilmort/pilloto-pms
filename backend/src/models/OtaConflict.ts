import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export type OtaConflictStatus =
  | 'pending_review'
  | 'resolved_keep_pilloto'
  | 'resolved_accept_ota'
  | 'resolved_outside_system'
  | 'ignored_false_positive';

export type OtaConflictType = 'date_overlap' | 'double_booking';

export interface IOtaConflict extends Document {
  tenantId: string;
  mappingId: mongoose.Types.ObjectId;
  externalEventId: mongoose.Types.ObjectId;   // OtaExternalEvent
  overlappingReservationId: mongoose.Types.ObjectId; // local Reservation that owns the dates
  conflictType: OtaConflictType;
  status: OtaConflictStatus;
  resolvedBy?: mongoose.Types.ObjectId;  // User who resolved
  resolvedAt?: Date;
  notes?: string;
  // Snapshot at conflict creation time (for diff view)
  snapshot?: {
    externalCheckIn: Date;
    externalCheckOut: Date;
    externalGuestName?: string;
    localCheckIn: Date;
    localCheckOut: Date;
    localGuestName?: string;
    localStatus: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const snapshotSchema = new Schema(
  {
    externalCheckIn: Date,
    externalCheckOut: Date,
    externalGuestName: String,
    localCheckIn: Date,
    localCheckOut: Date,
    localGuestName: String,
    localStatus: String,
  },
  { _id: false }
);

const otaConflictSchema = new Schema<IOtaConflict>(
  {
    tenantId: { type: String, required: true },
    mappingId: { type: Schema.Types.ObjectId, ref: 'OtaListingMapping', required: true },
    externalEventId: { type: Schema.Types.ObjectId, ref: 'OtaExternalEvent', required: true },
    overlappingReservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
    conflictType: {
      type: String,
      enum: ['date_overlap', 'double_booking'],
      default: 'date_overlap',
    },
    status: {
      type: String,
      enum: [
        'pending_review',
        'resolved_keep_pilloto',
        'resolved_accept_ota',
        'resolved_outside_system',
        'ignored_false_positive',
      ],
      default: 'pending_review',
    },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    notes: { type: String, maxlength: 2000 },
    snapshot: { type: snapshotSchema },
  },
  { timestamps: true }
);

otaConflictSchema.plugin(tenantPlugin);
otaConflictSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
otaConflictSchema.index({ tenantId: 1, externalEventId: 1, overlappingReservationId: 1 }, { unique: true });

export default mongoose.model<IOtaConflict>('OtaConflict', otaConflictSchema);
