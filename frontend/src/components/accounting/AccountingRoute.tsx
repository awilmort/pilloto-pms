import React from 'react';
import { Navigate } from 'react-router-dom';
import { CircularProgress, Box } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { hasPermission } from '../../lib/permissions';

interface AccountingRouteProps {
  children: React.ReactNode;
  /** Specific accounting permission(s) required beyond plain app access. */
  requiredPermission?: string | string[];
}

/**
 * Route guard for `/accounting/*`, per PILLOTO_ACCOUNTING_IMPLEMENTATION_PLAN.md
 * Phase 2.1: a user with no `accounting` entry in `appRoles` (and not
 * `isSuperAdmin`) is redirected to `/admin` if they have pms access, or to
 * `/login` if they have neither — mirroring `ProtectedRoute`'s redirect
 * fallback pattern but scoped to the accounting app. Also gates on the
 * tenant actually holding the `accounting` product, checked first, same
 * ordering `useAccessibleApps` uses for the app switcher.
 */
const AccountingRoute: React.FC<AccountingRouteProps> = ({ children, requiredPermission }) => {
  const { user, isAuthenticated, loading, resolvedAppRoles } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();

  if (loading || tenantLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress size={60} />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const tenantHasAccounting = !!tenant?.products?.includes('accounting');
  const hasAccountingAccess = !!user?.isSuperAdmin || !!resolvedAppRoles?.accounting;

  if (!tenantHasAccounting || !hasAccountingAccess) {
    const hasPmsAccess = !!user?.isSuperAdmin || !!resolvedAppRoles?.pms;
    return <Navigate to={hasPmsAccess ? '/admin' : '/login'} replace />;
  }

  if (requiredPermission && !user?.isSuperAdmin) {
    const allowed = hasPermission(resolvedAppRoles, 'accounting', requiredPermission);
    if (!allowed) {
      return <Navigate to="/accounting" replace />;
    }
  }

  return <>{children}</>;
};

export default AccountingRoute;
