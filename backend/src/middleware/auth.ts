import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '../utils/jwt';
import User from '../models/User';
import Role from '../models/Role';
import Tenant from '../models/Tenant';

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

// Permission-based authorization using Role model
export const authorizePermission = (...permissions: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Access denied. Authentication required.' });
      }

      // Admin bypass: full access
      if (req.user.role === 'admin' || req.user.role === 'superadmin') {
        return next();
      }

      // Load role definition scoped to the current tenant and check permissions
      const tenantFilter = req.tenantId ? { tenantId: req.tenantId } : {};
      const role = await Role.findOne({ name: req.user.role.toLowerCase(), ...tenantFilter });
      const rolePerms = role?.permissions || [];
      const hasAny = permissions.length === 0 || permissions.some(p => rolePerms.includes(p));
      if (!hasAny) {
        return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
      }

      next();
    } catch (error) {
      console.error('Permission authorization error:', error);
      return res.status(500).json({ success: false, message: 'Authorization failure.' });
    }
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
