/**
 * Plan definitions — source of truth for what features each plan includes.
 *
 * Plans are intentionally hardcoded here (not stored in the DB) because
 * plan structure is a business/development decision, not an admin-runtime one.
 * To change a plan, edit this file and redeploy — same workflow as updating
 * the pricing page on the marketing site.
 *
 * To assign a plan to a tenant, use the superadmin → Tenants page.
 */

export type PlanSlug = 'basic' | 'pro' | 'enterprise';

export interface PlanFeatures {
  /** Day-pass sales (venta de day passes) */
  daypass: boolean;
  /** Pasatarde / evening-pass sales */
  pasatarde: boolean;
  /** Events module */
  events: boolean;
  /** Wristband delivery tracking */
  wristbands: boolean;
  /** Charge rules (custom rules for folios / surcharges) */
  chargeRules: boolean;
  /** Agent / channel commissions */
  commissions: boolean;
  /** Corporate / credit accounts */
  corporateAccounts: boolean;
  /** Media library (room photo uploads) */
  media: boolean;
  /** Night audit module */
  nightAudit: boolean;
  /** Custom roles & permissions */
  customRoles: boolean;
  /** Public booking engine for direct guest reservations */
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

/** Returns the feature set for a given plan slug.
 *  Falls back to `basic` features if the slug is unknown. */
export function getPlanFeatures(slug: string): PlanFeatures {
  return PLANS[slug as PlanSlug]?.features ?? PLANS.basic.features;
}
