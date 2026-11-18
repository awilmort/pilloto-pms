/**
 * Plan definitions — frontend mirror of backend/src/config/plans.ts
 *
 * Keep these two files in sync whenever you add/remove features or tiers.
 */

export type PlanSlug = 'basic' | 'pro' | 'enterprise';

export interface PlanFeatures {
  daypass: boolean;
  pasatarde: boolean;
  events: boolean;
  wristbands: boolean;
  chargeRules: boolean;
  commissions: boolean;
  corporateAccounts: boolean;
  media: boolean;
  nightAudit: boolean;
  customRoles: boolean;
  bookingEngine: boolean;
  channelManager: boolean;
}

export interface PlanLimits {
  maxRooms: number | null;
  maxUsers: number | null;
}

export interface PlanConfig {
  slug: PlanSlug;
  name: string;
  /** Starting monthly list price, DOP before ITBIS (the live price comes from GET /api/public/plans). */
  listPriceDop: number;
  features: PlanFeatures;
  limits: PlanLimits;
}

export const PLANS: Record<PlanSlug, PlanConfig> = {
  basic: {
    slug: 'basic',
    name: 'Basic',
    listPriceDop: 2450,
    limits: { maxRooms: 15, maxUsers: 2 },
    features: {
      media: true,
      daypass: false,
      pasatarde: false,
      events: false,
      wristbands: false,
      chargeRules: false,
      commissions: false,
      corporateAccounts: false,
      nightAudit: false,
      customRoles: false,
      bookingEngine: false,
      channelManager: false,
    },
  },

  pro: {
    slug: 'pro',
    name: 'Pro',
    listPriceDop: 5540,
    limits: { maxRooms: 50, maxUsers: null },
    features: {
      media: true,
      daypass: true,
      pasatarde: true,
      events: true,
      wristbands: true,
      chargeRules: true,
      commissions: false,
      corporateAccounts: false,
      nightAudit: false,
      customRoles: false,
      bookingEngine: true,
      channelManager: true,
    },
  },

  enterprise: {
    slug: 'enterprise',
    name: 'Enterprise',
    listPriceDop: 9370,
    limits: { maxRooms: 100, maxUsers: null },
    features: {
      media: true,
      daypass: true,
      pasatarde: true,
      events: true,
      wristbands: true,
      chargeRules: true,
      commissions: true,
      corporateAccounts: true,
      nightAudit: true,
      customRoles: true,
      bookingEngine: true,
      channelManager: true,
    },
  },
};

export const PLAN_SLUGS: PlanSlug[] = ['basic', 'pro', 'enterprise'];

export function getPlanFeatures(slug: string): PlanFeatures {
  return PLANS[slug as PlanSlug]?.features ?? PLANS.basic.features;
}
