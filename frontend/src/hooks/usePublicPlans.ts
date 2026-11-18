import { useEffect, useState } from 'react';
import axios from 'axios';
import { PLANS, PLAN_SLUGS } from '../config/plans';
import { ACCOUNTING_PLANS, ACCOUNTING_PLAN_SLUGS } from '../config/accountingPlans';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

export interface PublicPlan {
  slug: string;
  name: string;
  monthlyPrice: number;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  includedEcf: { plan: string; transactions: number | null };
}

export interface PublicPlans {
  currency: 'DOP';
  taxPercent: number;
  suiteDiscountPercent: number;
  pms: PublicPlan[];
  accounting: PublicPlan[];
}

const PMS_ECF: Record<string, string> = { basic: 'essential', pro: 'essential', enterprise: 'pro' };
const ACC_ECF: Record<string, string> = { invoicing: 'essential', essentials: 'essential', pro: 'pro', plus: 'max' };

/** The configured starting prices, shown until (or if) the live price list cannot be read. */
const FALLBACK: PublicPlans = {
  currency: 'DOP',
  taxPercent: 18,
  suiteDiscountPercent: 20,
  pms: PLAN_SLUGS.map((s) => ({
    slug: s, name: PLANS[s].name, monthlyPrice: PLANS[s].listPriceDop,
    features: { ...PLANS[s].features }, limits: { ...PLANS[s].limits }, includedEcf: { plan: PMS_ECF[s], transactions: null },
  })),
  accounting: ACCOUNTING_PLAN_SLUGS.map((s) => ({
    slug: s, name: ACCOUNTING_PLANS[s].name, monthlyPrice: ACCOUNTING_PLANS[s].listPriceDop,
    features: { ...ACCOUNTING_PLANS[s].features }, limits: { ...ACCOUNTING_PLANS[s].limits }, includedEcf: { plan: ACC_ECF[s], transactions: null },
  })),
};

let cache: PublicPlans | null = null;

/** The plans and prices Pilloto sells (GET /api/public/plans), for the marketing pricing tables. */
export function usePublicPlans(): PublicPlans {
  const [plans, setPlans] = useState<PublicPlans>(cache ?? FALLBACK);
  useEffect(() => {
    if (cache) return;
    axios.get(API_BASE_URL + '/public/plans').then((r) => {
      if (r.data?.data) {
        cache = r.data.data;
        setPlans(r.data.data);
      }
    }).catch(() => undefined);
  }, []);
  return plans;
}

/** RD$1,590 — whole pesos, the way prices are listed. */
export const formatListPrice = (n: number): string => 'RD$' + Math.round(n).toLocaleString('en-US');

/** A rough US-dollar reference (at RD$63 per dollar). */
export const approxUsd = (n: number): string => '≈ US$' + Math.round(n / 63);
