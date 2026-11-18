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
  /** Channex channel manager (OTA distribution: Booking.com, Expedia, Airbnb, …) */
  channelManager: boolean;
}

export interface PlanLimits {
  /** Max active rooms. `null` = unlimited. */
  maxRooms: number | null;
  /** Max distinct users holding a `pms` appRoles entry. `null` = unlimited. */
  maxUsers: number | null;
}

export interface PlanConfig {
  slug: PlanSlug;
  name: string;
  /** Starting monthly list price, DOP before ITBIS. The console price list (`PlanPrice`) is authoritative. */
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

export const isPmsPlan = (value: unknown): value is PlanSlug =>
  typeof value === 'string' && (PLAN_SLUGS as string[]).includes(value);

/** Plans from smallest to largest. */
export const pmsPlanRank = (slug: PlanSlug): number => PLAN_SLUGS.indexOf(slug);

/** Returns the limits for a given plan slug (falls back to `basic`). */
export function getPlanLimits(slug: string): PlanLimits {
  return PLANS[slug as PlanSlug]?.limits ?? PLANS.basic.limits;
}

/** The smallest PMS plan that includes `feature` (what an upgrade prompt offers). */
export function smallestPlanWith(feature: keyof PlanFeatures): PlanSlug {
  return PLAN_SLUGS.find((s) => PLANS[s].features[feature]) ?? 'enterprise';
}

/** Returns the feature set for a given plan slug.
 *  Falls back to `basic` features if the slug is unknown. */
export function getPlanFeatures(slug: string): PlanFeatures {
  return PLANS[slug as PlanSlug]?.features ?? PLANS.basic.features;
}
