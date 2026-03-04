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
}

const TenantContext = createContext<TenantContextValue>({
  tenant: null,
  isPlatform: false,
  loading: true,
  tenantSlug: undefined,
  tenantNotFound: false,
});

export const useTenant = () => useContext(TenantContext);

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
function resolveSlugInfo(): { slug: string | undefined; isPlatform: boolean } {
  const subdomain = getSubdomain();

  if (subdomain === 'admin') {
    return { slug: undefined, isPlatform: true };
  }

  const slug =
    subdomain ||
    process.env.REACT_APP_TENANT_SLUG ||
    undefined;

  return { slug, isPlatform: false };
}

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenant]         = useState<TenantInfo | null>(null);
  const [isPlatform, setIsPlatform] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [tenantSlug, setTenantSlug] = useState<string | undefined>(undefined);
  const [tenantNotFound, setTenantNotFound] = useState(false);

  useEffect(() => {
    const { slug, isPlatform: platform } = resolveSlugInfo();

    setIsPlatform(platform);
    setTenantSlug(slug);

    const headers: Record<string, string> = {};
    if (slug) headers['X-Tenant-Slug'] = slug;
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
        if (res.data?.isPlatform) {
          setIsPlatform(true);
        }
      })
      .catch((err) => {
        if (slug && !platform) {
          // 404 = tenant doesn't exist; network error (CORS/offline) = also treat as not found
          // so the user never sees the app in a broken state
          const status = err?.response?.status;
          if (status === 404 || status === undefined) {
            setTenantNotFound(true);
          }
        }
        // Platform requests: silently fail — superadmin login still works
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, isPlatform, loading, tenantSlug, tenantNotFound }}>
      {children}
    </TenantContext.Provider>
  );
};
