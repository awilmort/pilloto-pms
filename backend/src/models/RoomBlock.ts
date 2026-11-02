/**
 * RoomBlock — a room taken out of service over a date range (CHANNEX_ARCHITECTURE.md §3, §10.1).
 *
 * Pilloto-native (no Channex dependency). Dates are calendar dates stored as noon UTC,
 * like reservations; `endDate` is exclusive, so a block 1 → 4 Nov covers the nights of
 * 1, 2 and 3 Nov. InventoryService subtracts blocked rooms from availability.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { changeCapturePlugin } from '../services/channex/changeCapture';

export const ROOM_BLOCK_REASONS = ['maintenance', 'out_of_order', 'owner_use', 'other'] as const;
export type RoomBlockReason = typeof ROOM_BLOCK_REASONS[number];

export interface IRoomBlock extends Document {
  tenantId: mongoose.Types.ObjectId;
  roomId: mongoose.Types.ObjectId;
  startDate: Date;
  /** Exclusive: the first night the room is back in service */
  endDate: Date;
  reason: RoomBlockReason;
  notes?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const roomBlockSchema = new Schema<IRoomBlock>(
  {
    roomId:    { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    startDate: { type: Date, required: true },
    endDate: {
      type: Date,
      required: true,
      validate: {
        validator: function (this: IRoomBlock, v: Date) { return !this.startDate || v > this.startDate; },
        message: 'The block must end after it starts',
      },
    },
    reason:    { type: String, enum: ROOM_BLOCK_REASONS, default: 'maintenance' },
    notes:     { type: String, trim: true, maxlength: 500, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

roomBlockSchema.plugin(tenantPlugin);
roomBlockSchema.plugin(changeCapturePlugin, { model: 'RoomBlock' });
roomBlockSchema.index({ tenantId: 1, roomId: 1, startDate: 1, endDate: 1 });

export default mongoose.model<IRoomBlock>('RoomBlock', roomBlockSchema);
