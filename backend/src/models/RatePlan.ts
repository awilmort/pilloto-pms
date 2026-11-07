import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { changeCapturePlugin } from '../services/channex/changeCapture';

export interface IOccupancyTier {
  guestType: 'adult' | 'child';
  guestNumber: number; // 1-based position (1st adult, 2nd adult, etc.)
  price: number;       // 0 means "included"
}

export type RatePlanVisibility = 'public' | 'private';

/** Promo codes are compared upper case, without surrounding spaces. */
export const ACCESS_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;
export const normalizeAccessCode = (code: unknown): string =>
  (typeof code === 'string' ? code.trim().toUpperCase() : '');

/** Distinct, valid, normalized codes (invalid entries are dropped). */
export function normalizeAccessCodes(codes: unknown): string[] {
  const list = Array.isArray(codes) ? codes : typeof codes === 'string' ? codes.split(/[\s,;]+/) : [];
  return [...new Set(list.map(normalizeAccessCode).filter((c) => ACCESS_CODE_RE.test(c)))];
}

export interface IRatePlan extends Document {
  name: string;             // e.g., "Standard Rate", "Non-refundable", "Corporate Rate"
  roomTypeId: mongoose.Types.ObjectId; // Reference to the RoomType this plan applies to
  basePrice: number;        // nightly / per-stay base price
  pricingMode: 'tiered';    // only supported mode
  occupancyTiers: IOccupancyTier[];
  isActive: boolean;
  /** Offered on OTAs through the channel manager (the booking engine is not affected) */
  sellOnChannels: boolean;
  /**
   * The room type's default plan: pre-selected for staff and the booking engine when no
   * contract or promo code applies (see services/ratePlanSelection.ts). At most one per room
   * type — the rate-plan routes clear the flag on the others.
   */
  isDefault: boolean;
  /**
   * 'public' = offered to every guest in the booking engine. 'private' = hidden there unless
   * the guest enters one of `accessCodes`; staff can always book it. OTAs are governed by
   * `sellOnChannels` only.
   */
  visibility: RatePlanVisibility;
  /** Promo codes (upper case) that unlock a private plan in the booking engine */
  accessCodes: string[];
  /** Guest-facing text: what is included and the conditions (shown in the booking engine) */
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const occupancyTierSchema = new Schema<IOccupancyTier>(
  {
    guestType: { type: String, enum: ['adult', 'child'], required: true },
    guestNumber: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const ratePlanSchema = new Schema<IRatePlan>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true },
    basePrice: { type: Number, required: true, min: 0, default: 0 },
    pricingMode: { type: String, enum: ['tiered'], default: 'tiered' },
    occupancyTiers: [occupancyTierSchema],
    isActive: { type: Boolean, default: true },
    sellOnChannels: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    accessCodes: { type: [String], default: [], set: normalizeAccessCodes },
    description: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true }
);

ratePlanSchema.index({ roomTypeId: 1, isActive: 1 });

ratePlanSchema.plugin(tenantPlugin);
ratePlanSchema.plugin(changeCapturePlugin, { model: 'RatePlan' });

export default mongoose.model<IRatePlan>('RatePlan', ratePlanSchema);
