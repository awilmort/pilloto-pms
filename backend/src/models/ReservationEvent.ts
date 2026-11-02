/**
 * ReservationEvent — one row per milestone in a reservation's history (who did what, when).
 *
 * Append-only and deliberately small: a semantic action, the actor, and only the tracked
 * fields that actually changed (services/reservationHistory.ts). Events whose facts are
 * already stored elsewhere are not written here but merged in when the history is read:
 * charges and payments (their own collections carry amount, time and `createdBy`) and,
 * for reservations created before history existed, the timestamps on the reservation.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export const RESERVATION_EVENT_ACTIONS = [
  'created',
  'updated',
  'status_changed',
  'cancelled',
  'rooms_changed',
  'moved',
  'checked_in',
  'checked_out',
  'charge_deleted',
  'payment_updated',
  'payment_deleted',
  'corporate_rate_approved',
  'corporate_rate_declined',
  'channel_modified',
  'email_sent',
  'deleted',
] as const;
export type ReservationEventAction = typeof RESERVATION_EVENT_ACTIONS[number];

export const ACTOR_KINDS = ['user', 'guest', 'channel', 'system'] as const;
export type ActorKind = typeof ACTOR_KINDS[number];

export interface IEventActor {
  kind: ActorKind;
  userId?: mongoose.Types.ObjectId;
  /** Snapshot at write time, so the row stays readable if the user is renamed or removed */
  name?: string;
}

export interface IFieldChange {
  field: string;
  from?: unknown;
  to?: unknown;
}

export interface IReservationEvent extends Document {
  tenantId?: mongoose.Types.ObjectId;
  reservationId: mongoose.Types.ObjectId;
  action: ReservationEventAction;
  actor: IEventActor;
  changes?: IFieldChange[];
  /** The charge or payment the event is about */
  ref?: { kind: 'charge' | 'payment'; id: mongoose.Types.ObjectId };
  /** Amount of a deleted charge or payment (its own row is gone) */
  amount?: number;
  note?: string;
  createdAt: Date;
}

const reservationEventSchema = new Schema<IReservationEvent>(
  {
    reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
    action:        { type: String, enum: RESERVATION_EVENT_ACTIONS, required: true },
    actor: {
      type: new Schema<IEventActor>({
        kind:   { type: String, enum: ACTOR_KINDS, required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        name:   { type: String, maxlength: 120 },
      }, { _id: false }),
      required: true,
    },
    changes: {
      type: [new Schema<IFieldChange>({
        field: { type: String, required: true, maxlength: 40 },
        from:  { type: Schema.Types.Mixed },
        to:    { type: Schema.Types.Mixed },
      }, { _id: false })],
      default: undefined,
    },
    ref: {
      type: new Schema({
        kind: { type: String, enum: ['charge', 'payment'], required: true },
        id:   { type: Schema.Types.ObjectId, required: true },
      }, { _id: false }),
      required: false,
    },
    amount: { type: Number },
    note: { type: String, maxlength: 300 },
  },
  // Immutable rows: no updatedAt, no version key
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

reservationEventSchema.plugin(tenantPlugin);
// The one read path: a reservation's history, newest first
reservationEventSchema.index({ tenantId: 1, reservationId: 1, createdAt: -1 });

export default mongoose.model<IReservationEvent>('ReservationEvent', reservationEventSchema);
