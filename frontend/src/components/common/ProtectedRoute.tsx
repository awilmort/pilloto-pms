import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CircularProgress, Box, Typography } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';

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
  const { user, isAuthenticated, loading, permissions } = useAuth();
  const { activeSections, loading: sectionsLoading } = useSettings();
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

  // Optional permission-based gate (uses user.permissions if present on the user object via AuthContext augmentation)
  if (requiredPermission && user) {
    const perms = permissions as string[] | undefined;
    const hasWildcard = !!perms && perms.includes('admin.access');
    const allowed = Array.isArray(requiredPermission)
      ? (!!perms && (requiredPermission.some(p => perms.includes(p)) || hasWildcard))
      : (!!perms && (perms.includes(requiredPermission) || hasWildcard));
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
