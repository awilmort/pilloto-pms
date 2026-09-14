import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CircularProgress, Box, Typography } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useTenant } from '../../contexts/TenantContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  requiredRole?: string | string[]; // supports 'admin', 'maintenance', 'staff', etc.
  requiredPermission?: string | string[]; // supports permission checks like 'admin.access'
  /** Section key from AppSettings.sections — redirects to /admin if section is disabled */
  requiredSection?: string;
  redirectTo?: string;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requireAuth = true,
  requiredRole,
  requiredPermission,
  requiredSection,
  redirectTo = '/login',
}) => {
  const { user, isAuthenticated, loading, permissions, resolvedAppRoles } = useAuth();
  const { activeSections, loading: sectionsLoading } = useSettings();
  const { tenant } = useTenant();
  const location = useLocation();

  // Show loading spinner while checking authentication or settings
  if (loading || (requiredSection && sectionsLoading)) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        minHeight="50vh"
        gap={2}
      >
        <CircularProgress size={60} />
        <Typography variant="h6" color="text.secondary">
          Loading...
        </Typography>
      </Box>
    );
  }

  // If authentication is required but user is not authenticated
  if (requireAuth && !isAuthenticated) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  // Tenant-purchase gate (Phase 10.1 finding): a tenant that never bought `pms` has no
  // PMS surface to show at all, regardless of the user's own role/isSuperAdmin — mirrors
  // AccountingRoute's `tenantHasAccounting` check (decision #2: Tenant.products gates the
  // product itself; User.appRoles gates which users within it). Only fires once the tenant
  // is actually resolved (not on `/login`'s `requireAuth={false}` toggle-redirect, and not
  // on the platform portal, where `tenant` is always null).
  if (requireAuth && user && tenant && !tenant.products?.includes('pms')) {
    const hasAccountingAccess = !!user.isSuperAdmin || !!resolvedAppRoles?.accounting;
    return <Navigate to={hasAccountingAccess ? '/accounting' : '/login'} replace />;
  }

  // If specific role is required but user doesn't have it
  if (requiredRole && user) {
    const allowed = Array.isArray(requiredRole)
      ? requiredRole.includes(user.role)
      : user.role === requiredRole;
    if (!allowed) {
    // Redirect admin to admin dashboard, others to login
    const redirect = user.role === 'admin' ? '/admin' : '/login';
    return <Navigate to={redirect} replace />;
    }
  }

  // Optional permission-based gate (pms-scoped `permissions` from AuthContext)
  if (requiredPermission && user) {
    const hasWildcard = permissions.includes('admin.access');
    const allowed = Array.isArray(requiredPermission)
      ? (requiredPermission.some(p => permissions.includes(p)) || hasWildcard)
      : (permissions.includes(requiredPermission) || hasWildcard);
    if (!allowed) {
      const redirect = user.role === 'admin' ? '/admin' : '/login';
      return <Navigate to={redirect} replace />;
    }
  }

  // Block access to disabled sections (admin decision overrides everything)
  if (requiredSection && activeSections[requiredSection] === false) {
    return <Navigate to="/admin" replace />;
  }

  // If user is authenticated but trying to access auth pages
  if (!requireAuth && isAuthenticated) {
    // Redirect based on user role
    const redirect = user?.role === 'admin' ? '/admin' : '/';
    return <Navigate to={redirect} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
