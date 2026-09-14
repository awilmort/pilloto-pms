import { useLocation } from 'react-router-dom';
import { AppCode, ResolvedAppRole } from '../types';
import { useAuth } from '../contexts/AuthContext';

/**
 * Per-app "master access" permission — grants everything within that app.
 * Mirrors backend/src/constants/permissions.ts APP_ACCESS_PERMISSION. pms
 * keeps its legacy `admin.*` naming (predates the app concept); accounting
 * follows the `<app>.*` convention. Never template-string `${app}.access`.
 */
export const APP_ACCESS_PERMISSION: Record<AppCode, string> = {
  pms: 'admin.access',
  accounting: 'accounting.access',
};

/** Route-path prefixes that identify which app the current screen belongs to. */
const APP_PATH_PREFIXES: Record<AppCode, string> = {
  accounting: '/accounting',
  pms: '/admin',
};

/**
 * Derives the current app from the route path (never the hostname — both
 * apps live under the same subdomain). Defaults to `pms` for any path
 * outside `/accounting`, matching today's admin-is-the-default behavior.
 */
export function getAppFromPath(pathname: string): AppCode {
  return pathname.startsWith(APP_PATH_PREFIXES.accounting) ? 'accounting' : 'pms';
}

/**
 * Checks whether the given resolved appRoles grant `permission` in `app` —
 * either directly, or via that app's master access permission.
 */
export function hasPermission(
  appRoles: Partial<Record<AppCode, ResolvedAppRole>> | undefined | null,
  app: AppCode,
  permission: string | string[]
): boolean {
  const entry = appRoles?.[app];
  if (!entry) return false;
  const granted = entry.permissions || [];
  if (granted.includes(APP_ACCESS_PERMISSION[app])) return true;
  const required = Array.isArray(permission) ? permission : [permission];
  return required.some((p) => granted.includes(p));
}

/**
 * Hook form of `hasPermission`, bound to whichever app the current route
 * tree is under and short-circuited by the tenant-level `isSuperAdmin`
 * bypass.
 */
export function usePermission(permission: string | string[]): boolean {
  const { user, resolvedAppRoles } = useAuth();
  const location = useLocation();
  if (user?.isSuperAdmin) return true;
  const app = getAppFromPath(location.pathname);
  return hasPermission(resolvedAppRoles, app, permission);
}
