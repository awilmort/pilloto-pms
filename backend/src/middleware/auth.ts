import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '../utils/jwt';
import User from '../models/User';
import Role from '../models/Role';
import Tenant from '../models/Tenant';
import { AppCode } from '../constants/apps';
import { APP_ACCESS_PERMISSION } from '../constants/permissions';

export interface AuthRequest extends Request {
  user?: any;
  tenantId?: string;
  tenant?: any;
  isPlatformRequest?: boolean;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Check for token in cookies
    else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    // Verify token
    const decoded: JWTPayload = verifyToken(token);

    // ── Tenant validation ──────────────────────────────────────
    const reqTenantId = (req as any).tenantId as string | undefined;
    const isPlatform   = (req as any).isPlatformRequest as boolean | undefined;

    if (decoded.tenantId) {
      // Regular tenant user: JWT tenantId must match the resolved request tenantId
      if (!reqTenantId || decoded.tenantId !== reqTenantId) {
        return res.status(401).json({
          success: false,
          message: 'Token tenant mismatch.'
        });
      }
      // Verify the tenant is still active
      const tenant = await Tenant.findById(decoded.tenantId).select('isActive').lean();
      if (!tenant || !(tenant as any).isActive) {
        return res.status(401).json({
          success: false,
          message: 'Tenant is inactive or not found.'
        });
      }
    } else {
      // Superadmin user: must be a platform request
      if (!isPlatform) {
        return res.status(401).json({
          success: false,
          message: 'Superadmin token used outside the platform portal.'
        });
      }
    }

    // Get user from database
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated.'
      });
    }

    req.user = user;
    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.'
      });
    } else {
      console.error('Authentication error:', error);
      return res.status(500).json({
        success: false,
        message: 'Authentication failed.'
      });
    }
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Authentication required.'
      });
    }

    // Tenant-purchase gate: `authorize()` is only ever used to guard legacy `pms`
    // routes, so a tenant that never bought `pms` has no PMS surface here at all —
    // independent of the caller's own role/isSuperAdmin (Phase 10.1 permission-matrix
    // pass; mirrors the `accounting` tenant-product gate AccountingRoute already had
    // on the frontend, which had no backend-side equivalent for `pms`).
    const tenantProducts = (req.tenant as any)?.products as AppCode[] | undefined;
    if (tenantProducts && !tenantProducts.includes('pms')) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This tenant does not have the 'pms' product."
      });
    }

    const allowed = roles.map(r => String(r).toLowerCase());
    const userRole = String(req.user.role || '').toLowerCase();
    if (!allowed.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    next();
  };
};

// ── App-scoped permission resolution ──────────────────────────
// Resolution order: isSuperAdmin bypass → appRoles lookup for that app →
// master-permission (`<app>.access`) or specific-permission check → 403 otherwise.

/** Legacy full-admin bypass, scoped to `pms` — predates appRoles and is preserved for
 *  any user record that hasn't (yet) been migrated to carry a `pms` appRoles entry. */
function hasLegacyPmsAdminBypass(user: any): boolean {
  return user?.role === 'admin' || user?.role === 'superadmin';
}

async function getEffectiveAppPermissions(user: any, app: AppCode, tenantId?: string): Promise<string[]> {
  const appRoleEntry = (user?.appRoles || []).find((ar: any) => ar.app === app);
  if (appRoleEntry) {
    const role = await Role.findById(appRoleEntry.role).select('permissions').lean();
    return (role as any)?.permissions || [];
  }

  // Legacy fallback for users not yet carrying an appRoles entry for `pms`
  // (e.g. a straggler pre-migration record) — looks up by the flat role name.
  if (app === 'pms' && user?.role) {
    const tenantFilter = tenantId ? { tenantId } : {};
    const role = await Role.findOne({ name: String(user.role).toLowerCase(), app: 'pms', ...tenantFilter }).select('permissions').lean();
    return (role as any)?.permissions || [];
  }

  return [];
}

/** Whether `user` has any access at all to `app` (an appRoles entry, the tenant-owner
 *  bypass, or the legacy pms admin bypass) — used to scope visibility of app-scoped
 *  lists (roles, users, permission catalogs), independent of any specific permission.
 *  `tenantProducts`, when given, gates on the tenant actually having bought `app` —
 *  a purchase gate that even `isSuperAdmin`/the legacy bypass cannot cross: the tenant's
 *  product list gates the product itself, while a user's appRoles gate which users
 *  within it can use it. Omit it only for call sites with no tenant in scope. */
export function userHasAppAccess(user: any, app: AppCode, tenantProducts?: AppCode[]): boolean {
  if (!user) return false;
  if (tenantProducts && !tenantProducts.includes(app)) return false;
  if (user.isSuperAdmin) return true;
  if (app === 'pms' && hasLegacyPmsAdminBypass(user)) return true;
  return (user.appRoles || []).some((ar: any) => ar.app === app);
}

/** Whether `user` holds any of `permissions` (or the `<app>.access` master permission)
 *  within `app`. Empty `permissions` means "any access to the app is enough".
 *  `tenantProducts` is the same purchase gate `userHasAppAccess` documents above. */
export async function userHasPermission(user: any, app: AppCode, permissions: string[], tenantId?: string, tenantProducts?: AppCode[]): Promise<boolean> {
  if (!user) return false;
  if (tenantProducts && !tenantProducts.includes(app)) return false;
  if (user.isSuperAdmin) return true;
  if (app === 'pms' && hasLegacyPmsAdminBypass(user)) return true;

  const rolePerms = await getEffectiveAppPermissions(user, app, tenantId);
  const masterPermission = APP_ACCESS_PERMISSION[app];
  return (
    permissions.length === 0 ||
    rolePerms.includes(masterPermission) ||
    permissions.some(p => rolePerms.includes(p))
  );
}

// Permission-based authorization using Role model, scoped to a specific app.
export const authorizePermission = (app: AppCode, ...permissions: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Access denied. Authentication required.' });
      }

      const tenantProducts = (req.tenant as any)?.products as AppCode[] | undefined;
      const allowed = await userHasPermission(req.user, app, permissions, req.tenantId, tenantProducts);
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
      }

      next();
    } catch (error) {
      console.error('Permission authorization error:', error);
      return res.status(500).json({ success: false, message: 'Authorization failure.' });
    }
  };
};

/**
 * Middleware form of `userHasAppAccess` — requires the caller to hold *some* role
 * assignment in `app` (or the isSuperAdmin/legacy-pms-admin bypass), with no specific
 * permission string required. For the handful of legacy `pms` routes that only ever
 * called bare `authenticate` (`GET /api/reservations` and similar
 * read endpoints across `reservations.ts`/`companies.ts`/`pricing.ts`/etc.): in a
 * combined pms+accounting tenant, a user holding only an `accounting` appRoles entry
 * has no `pms` entry at all and must be rejected, even though the tenant itself has
 * `pms`. Deliberately NOT `authorizePermission(app)` with zero extra permission
 * strings — that function's "empty permissions means any access to the app is enough"
 * short-circuits to `true` before ever checking whether the caller has an appRoles
 * entry for `app` at all (see its own implementation), which would defeat the point
 * here. This preserves the exact loose-but-intentional pre-existing behavior of these
 * routes (any user holding a `pms` role — including the zero-permission `customer`
 * role — passes), just closes the cross-app hole.
 */
export const authorizeAppAccess = (app: AppCode) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Access denied. Authentication required.' });
    }
    const tenantProducts = (req.tenant as any)?.products as AppCode[] | undefined;
    if (!userHasAppAccess(req.user, app, tenantProducts)) {
      return res.status(403).json({ success: false, message: 'Access denied for this app.' });
    }
    next();
  };
};

/**
 * Tenant-purchase gate for entire route mounts that predate the multi-app permission
 * system: many legacy `pms` routers only ever call bare
 * `authenticate` — no `authorize()`/`authorizePermission()` at all — so `authorize()`'s
 * own product check (above) never runs for them, and an accounting-only tenant's user
 * could reach real PMS business data (e.g. `GET /api/reservations`) with nothing but a
 * valid JWT. Mount this ahead of an entire router (`app.use('/api/x', requireTenantProduct('pms'), xRoutes)`)
 * for any router that is unambiguously single-app — never for a router (`/api/roles`,
 * `/api/admin`) that serves both apps via its own per-request `?app=` resolution, since
 * those already gate correctly per-call via `userHasPermission`/`userHasAppAccess` above.
 * Unlike `authorize()`'s inline check, this doesn't require `req.user` — it runs (and can
 * reject) even ahead of public/customer-facing endpoints in the same router, which is the
 * intended behavior: a tenant that never bought `pms` has no PMS surface at all, public
 * booking pages included.
 */
export const requireTenantProduct = (app: AppCode) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const tenantProducts = (req.tenant as any)?.products as AppCode[] | undefined;
    if (tenantProducts && !tenantProducts.includes(app)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. This tenant does not have the '${app}' product.`
      });
    }
    next();
  };
};

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Check for token in cookies
    else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (token) {
      try {
        const decoded: JWTPayload = verifyToken(token);
        const user = await User.findById(decoded.userId).select('-password');
        if (user && user.isActive) {
          req.user = user;
        }
      } catch (error) {
        // Token is invalid, but we continue without authentication
        console.log('Optional auth failed:', error);
      }
    }

    next();
  } catch (error) {
    console.error('Optional authentication error:', error);
    next();
  }
};
