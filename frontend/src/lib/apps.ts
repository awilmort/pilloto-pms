import { useMemo } from 'react';
import { AppCode } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';

/**
 * Mirrors backend/src/constants/apps.ts APP_CODES/APP_METADATA — must be
 * kept in sync if either changes. Duplicated here since frontend has no
 * shared package with backend (same reasoning as permissions.ts's
 * APP_ACCESS_PERMISSION duplication).
 */
export const APP_CODES: AppCode[] = ['pms', 'accounting'];

export const APP_METADATA: Record<AppCode, { name: string; path: string }> = {
  pms: { name: 'Pilloto PMS', path: '/admin' },
  accounting: { name: 'Pilloto Accounting', path: '/accounting' },
};

/**
 * Apps both the tenant's `products` and the current user's `appRoles` allow
 * access to — the tenant-product gate is checked first, unconditionally,
 * even for `isSuperAdmin` (a superadmin should never see an app the tenant
 * hasn't bought). Shared by the AppShell switcher and any shared screen
 * (Roles/Users management) that needs to scope itself to grantable apps.
 */
export function useAccessibleApps(): AppCode[] {
  const { user, resolvedAppRoles } = useAuth();
  const { tenant } = useTenant();
  return useMemo(
    () =>
      APP_CODES.filter((code) => {
        if (!tenant?.products?.includes(code)) return false;
        if (user?.isSuperAdmin) return true;
        return !!resolvedAppRoles?.[code];
      }),
    [tenant, user, resolvedAppRoles]
  );
}
