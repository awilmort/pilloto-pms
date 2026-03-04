/**
 * Tenant Context Middleware
 *
 * Responsibilities:
 *  1. Resolve the current tenant from the Host header or the X-Tenant-Slug header.
 *  2. Store the resolved tenantId in an AsyncLocalStorage so the Mongoose
 *     query-scoping plugin can access it without being passed explicitly.
 *  3. Mark requests coming from admin.pilloto.com as platform (superadmin) requests.
 *
 * Tenant resolution priority:
 *  a) X-Tenant-Slug request header  (local dev / API clients)
 *  b) Subdomain extracted from Host header  (production)
 *  c) TENANT_SLUG environment variable      (local dev fallback)
 */

import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import Tenant from '../models/Tenant';

// ────────────────────────────────────────────────────────────
// AsyncLocalStorage — shared singleton used by the Mongoose plugin
// ────────────────────────────────────────────────────────────
export interface TenantStore {
  tenantId: string;
}

export const tenantLocalStorage = new AsyncLocalStorage<TenantStore | null>();

/** Returns the tenantId for the currently executing async context, or undefined. */
export const getTenantId = (): string | undefined =>
  tenantLocalStorage.getStore()?.tenantId;

// ────────────────────────────────────────────────────────────
// Extend Express Request
// ────────────────────────────────────────────────────────────
export interface TenantRequest extends Request {
  tenantId?: string;
  tenant?: InstanceType<typeof Tenant>;
  isPlatformRequest?: boolean;
}

// ────────────────────────────────────────────────────────────
// Helper: extract subdomain slug from Host header
// e.g. "banana-ranch.pilloto.com" → "banana-ranch"
//      "admin.pilloto.com"        → "admin"
//      "localhost:3000"           → undefined
// ────────────────────────────────────────────────────────────
function extractSubdomain(host: string): string | undefined {
  // Strip port
  const hostname = host.split(':')[0];
  const parts = hostname.split('.');
  // production: sub.domain.tld (3+ parts)
  if (parts.length >= 3) return parts[0].toLowerCase();
  // local development: slug.localhost (2 parts)
  if (parts.length === 2 && parts[1] === 'localhost') return parts[0].toLowerCase();
  return undefined;
}

// ────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────
export const resolveTenant = async (
  req: TenantRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const host = req.headers.host || '';
  const xSlug = (req.headers['x-tenant-slug'] as string | undefined)?.trim().toLowerCase();

  // ── 1. Detect platform (superadmin) requests ──────────────
  const subdomain = extractSubdomain(host);
  const isPlatform =
    subdomain === 'admin' ||
    xSlug === '__superadmin__' ||
    process.env.IS_PLATFORM_SERVER === 'true';

  if (isPlatform) {
    req.isPlatformRequest = true;
    // Platform requests run without any tenant scope
    tenantLocalStorage.run(null, () => next());
    return;
  }

  // ── 2. Determine the slug to look up ─────────────────────
  const slug = xSlug || subdomain || process.env.TENANT_SLUG;

  if (!slug) {
    // No tenant context could be determined — pass through.
    // Route handlers that require a tenant will reject the request.
    tenantLocalStorage.run(null, () => next());
    return;
  }

  // ── 3. Look up the tenant ─────────────────────────────────
  try {
    const tenant = await Tenant.findOne({ slug, isActive: true }).lean();
    if (!tenant) {
      res.status(404).json({ success: false, message: `Tenant '${slug}' not found or inactive.` });
      return;
    }

    const tenantId = (tenant._id as any).toString() as string;
    req.tenantId = tenantId;
    req.tenant = tenant as any;

    // Run the rest of the request inside the tenant's async store
    tenantLocalStorage.run({ tenantId }, () => next());
  } catch (err) {
    console.error('Tenant resolution error:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve tenant.' });
  }
};
