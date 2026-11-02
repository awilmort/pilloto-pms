/**
 * ChannelOnboarding — resumable wizard progress (CHANNEX_ARCHITECTURE.md §8.3–8.4, §10.1).
 * One `setup` row per tenant, and one `channel` row per OTA (`otaCode`, e.g. 'BDC').
 */
import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';

export const CHANNEL_ONBOARDING_KINDS = ['setup', 'channel'] as const;
export type ChannelOnboardingKind = typeof CHANNEL_ONBOARDING_KINDS[number];
export const CHANNEL_ONBOARDING_STATUSES = ['in_progress', 'waiting_ota', 'completed', 'abandoned'] as const;
export type ChannelOnboardingStatus = typeof CHANNEL_ONBOARDING_STATUSES[number];

export interface IChannelOnboarding extends Document {
  tenantId: mongoose.Types.ObjectId;
  kind: ChannelOnboardingKind;
  otaCode?: string;
  step: number;
  /** Checklist ticks and wizard choices, keyed by step */
  answers: Record<string, unknown>;
  channexChannelId?: string;
  status: ChannelOnboardingStatus;
  startedBy?: mongoose.Types.ObjectId;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const channelOnboardingSchema = new Schema<IChannelOnboarding>(
  {
    kind:             { type: String, enum: CHANNEL_ONBOARDING_KINDS, required: true },
    otaCode: {
      type: String, maxlength: 10, uppercase: true, trim: true,
      required: [function (this: IChannelOnboarding) { return this.kind === 'channel'; }, 'otaCode is required for a channel onboarding'],
      validate: {
        validator: function (this: IChannelOnboarding, v?: string) { return this.kind !== 'setup' || !v; },
        message: 'A setup onboarding has no otaCode',
      },
    },
    step:             { type: Number, default: 1, min: 1 },
    answers:          { type: Schema.Types.Mixed, default: () => ({}) },
    channexChannelId: { type: String, maxlength: 64 },
    status:           { type: String, enum: CHANNEL_ONBOARDING_STATUSES, default: 'in_progress' },
    startedBy:        { type: Schema.Types.ObjectId, ref: 'User' },
    startedAt:        { type: Date, default: () => new Date() },
    completedAt:      { type: Date },
  },
  { timestamps: true, minimize: false }
);

channelOnboardingSchema.plugin(tenantPlugin);
channelOnboardingSchema.index({ tenantId: 1, kind: 1, otaCode: 1 }, { unique: true });

export default mongoose.model<IChannelOnboarding>('ChannelOnboarding', channelOnboardingSchema);
