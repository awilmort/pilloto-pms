/**
 * TenantContext
 *
 * Detects the current tenant from the browser's subdomain and fetches
 * public tenant info from /api/tenant/info.
 *
 * Subdomain rules:
 *   - admin.pilloto.com  → isPlatform = true, tenant = null
 *   - {slug}.pilloto.com → regular tenant app
 *   - localhost / custom dev host → reads REACT_APP_TENANT_SLUG env var
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { getPlanFeatures, PlanFeatures } from '../config/plans';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

export interface TenantInfo {
  _id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  settings: {
    language?: string;
    currency?: string;
    timezone?: string;
    logoUrl?: string;
    primaryColor?: string;
  };
}

interface TenantContextValue {
  tenant: TenantInfo | null;
  isPlatform: boolean;
  /** true while the initial fetch is in progress */
  loading: boolean;
  tenantSlug: string | undefined;
  /** true when a subdomain was detected but the backend returned 404 */
  tenantNotFound: boolean;
  /** Resolved feature flags for the tenant's current plan. null on platform / no tenant. */
  planFeatures: PlanFeatures | null;
  /** true when on the login.pilloto.com portal (cross-tenant email lookup) */
  isLoginPortal: boolean;
}

const TenantContext = createContext<TenantContextValue>({
  tenant: null,
  isPlatform: false,
  loading: true,
  tenantSlug: undefined,
  tenantNotFound: false,
  planFeatures: null,
  isLoginPortal: false,
});

export const useTenant = () => useContext(TenantContext);

/** Returns true if the tenant's plan includes the given feature. Always false on platform. */
export function usePlanFeature(feature: keyof PlanFeatures): boolean {
  const { planFeatures } = useContext(TenantContext);
  return planFeatures?.[feature] ?? false;
}

/** Extract subdomain from window.location.hostname.
 *  Works for both production (slug.pilloto.com → 3 parts)
 *  and local development (slug.localhost → 2 parts).
 */
function getSubdomain(): string | undefined {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  // production: slug.pilloto.com  (3+ parts)
  if (parts.length >= 3) return parts[0].toLowerCase();
  // local: slug.localhost  (2 parts, second part is 'localhost')
  if (parts.length === 2 && parts[1] === 'localhost') return parts[0].toLowerCase();
  return undefined;
}

/** Determine slug and platform flag from current origin */
function resolveSlugInfo(): { slug: string | undefined; isPlatform: boolean; isLoginPortal: boolean } {
  const subdomain = getSubdomain();

  if (subdomain === 'admin') {
    return { slug: undefined, isPlatform: true, isLoginPortal: false };
  }

  const envSlug = process.env.REACT_APP_TENANT_SLUG || undefined;

  // login subdomain or explicit env override
  if (subdomain === 'login' || envSlug === '__login_portal__') {
    return { slug: undefined, isPlatform: false, isLoginPortal: true };
  }

  const slug = subdomain || envSlug || undefined;

  return { slug, isPlatform: false, isLoginPortal: false };
}

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenant]         = useState<TenantInfo | null>(null);
  const [isPlatform, setIsPlatform] = useState(false);
  const [tenantSlug, setTenantSlug] = useState<string | undefined>(undefined);
  const [tenantNotFound, setTenantNotFound] = useState(false);
  const [isLoginPortal, setIsLoginPortal] = useState(false);

  // loading is only true while we're waiting for a tenant API call.
  // When there's no slug (marketing site or login portal) we never load at all.
  const [loading, setLoading] = useState(() => {
    const { slug, isPlatform: platform } = resolveSlugInfo();
    return !!(slug || platform); // false immediately for marketing + login portal
  });

  useEffect(() => {
    const { slug, isPlatform: platform, isLoginPortal: portal } = resolveSlugInfo();

    setIsPlatform(platform);
    setTenantSlug(slug);
    setIsLoginPortal(portal);

    // No subdomain, not platform, not login portal → marketing site. Skip API entirely.
    if (!slug && !platform && !portal) {
      return;
    }

    // Login portal → also skip the tenant info call; uses its own lookup endpoint.
    if (portal) {
      return;
    }

    const headers: Record<string, string> = {};
    if (slug)    headers['X-Tenant-Slug'] = slug;
    if (platform) headers['X-Tenant-Slug'] = '__superadmin__';

    const origin = (() => {
      try { return new URL(API_BASE_URL).origin; } catch { return ''; }
    })();

    axios
      .get(`${origin}/api/tenant/info`, { headers })
      .then((res) => {
        if (res.data?.data) {
          setTenant(res.data.data as TenantInfo);
        }
      })
      .catch((err) => {
        if (slug && !platform) {
          const status = err?.response?.status;
          if (status === 404 || status === undefined) {
            setTenantNotFound(true);
          }
        }
        // Platform requests: silently fail — superadmin login still works
      })
      .finally(() => setLoading(false));
  }, []);

  const planFeatures = tenant ? getPlanFeatures(tenant.plan) : null;

  return (
    <TenantContext.Provider value={{ tenant, isPlatform, loading, tenantSlug, tenantNotFound, planFeatures, isLoginPortal }}>
      {children}
    </TenantContext.Provider>
  );
};
