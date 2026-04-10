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
}

export interface PlanConfig {
  slug: PlanSlug;
  name: string;
  /** Monthly price in USD cents (e.g. 4900 = $49.00). Used for billing. */
  priceUsd: number;
  /** Human-readable price string for display purposes. */
  displayPrice: string;
  features: PlanFeatures;
}

export const PLANS: Record<PlanSlug, PlanConfig> = {
  basic: {
    slug: 'basic',
    name: 'Basic',
    priceUsd: 4900,
    displayPrice: '$49',
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
    },
  },

  pro: {
    slug: 'pro',
    name: 'Pro',
    priceUsd: 9900,
    displayPrice: '$99',
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
    },
  },

  enterprise: {
    slug: 'enterprise',
    name: 'Enterprise',
    priceUsd: 18900,
    displayPrice: '$189',
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
    },
  },
};

export function getPlanFeatures(slug: string): PlanFeatures {
  return PLANS[slug as PlanSlug]?.features ?? PLANS.basic.features;
}
