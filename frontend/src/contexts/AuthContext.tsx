import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { AppCode, AuthContextType, RegisterData, ResolvedAppRole, User } from '../types';
import { authService } from '../services/api';
import { toast } from 'react-toastify';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  permissions: string[];
  discountLimit: number;
  resolvedAppRoles: Partial<Record<AppCode, ResolvedAppRole>>;
}

type AuthAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'LOGIN_SUCCESS'; payload: { user: User; token: string } }
  | { type: 'LOGOUT' }
  | { type: 'UPDATE_USER'; payload: User };

const initialState: AuthState = {
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  loading: true,
  permissions: [],
  discountLimit: 0,
  resolvedAppRoles: {},
};

/**
 * `schedule.view` and `accommodations.manage` are legacy pms permission
 * names still stored verbatim on Role documents (see
 * backend/src/constants/permissions.ts) — they aren't backend-enforced but
 * do gate frontend nav/route visibility under their `admin.*` names. Kept
 * here rather than in the backend response since it's frontend-only routing
 * behavior, not an access-control decision.
 */
const LEGACY_PMS_PERMISSION_MAP: Record<string, string> = {
  'schedule.view': 'admin.schedule',
  'accommodations.manage': 'admin.accommodations',
};

/** Derives the legacy flat `permissions`/`discountLimit` fields (pms-scoped) from the resolved appRoles. */
const derivePmsFields = (user: User): Pick<AuthState, 'permissions' | 'discountLimit' | 'resolvedAppRoles'> => {
  const resolvedAppRoles = user.resolvedAppRoles || {};
  const pms = resolvedAppRoles.pms;
  const rawPermissions = pms?.permissions || [];
  return {
    permissions: rawPermissions.map((p) => LEGACY_PMS_PERMISSION_MAP[p] || p),
    discountLimit: pms?.discountLimit ?? 0,
    resolvedAppRoles,
  };
};

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        loading: false,
        ...derivePmsFields(action.payload.user),
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        loading: false,
        permissions: [],
        discountLimit: 0,
        resolvedAppRoles: {},
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: action.payload,
        ...derivePmsFields(action.payload),
      };
    default:
      return state;
  }
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Fetches the current user with resolved per-app roles/permissions already joined server-side.
  const fetchResolvedUser = async (): Promise<User | null> => {
    const response = await authService.getCurrentUser();
    if (response.data.success && response.data.user) {
      return response.data.user;
    }
    return null;
  };

  // Check if user is logged in on app start
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const user = await fetchResolvedUser();
          if (user) {
            dispatch({ type: 'LOGIN_SUCCESS', payload: { user, token } });
          } else {
            localStorage.removeItem('token');
            dispatch({ type: 'LOGOUT' });
          }
        } catch (error) {
          localStorage.removeItem('token');
          dispatch({ type: 'LOGOUT' });
        }
      } else {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    checkAuth();
  }, []);

  const refreshUser = async (): Promise<void> => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const user = await fetchResolvedUser();
      if (user) {
        dispatch({ type: 'UPDATE_USER', payload: user });
      }
    } catch (e) {
      // ignore errors; leave current state
    }
  };

  const login = async (email: string, password: string): Promise<void> => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const response = await authService.login({ email, password });

      if (response.data.success && response.data.user && response.data.token) {
        const { token } = response.data;
        // Store token BEFORE any authenticated calls so the request interceptor can use it
        localStorage.setItem('token', token);
        // Re-fetch through /auth/me for the resolved appRoles the login response doesn't include
        const user = (await fetchResolvedUser()) || response.data.user;
        dispatch({ type: 'LOGIN_SUCCESS', payload: { user, token } });
        toast.success('Login successful!');
      } else {
        throw new Error(response.data.message || 'Login failed');
      }
    } catch (error: any) {
      dispatch({ type: 'SET_LOADING', payload: false });
      const message = error.response?.data?.message || error.message || 'Login failed';
      toast.error(message);
      throw error;
    }
  };

  const register = async (userData: RegisterData): Promise<void> => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const response = await authService.register(userData);

      if (response.data.success && response.data.user && response.data.token) {
        const { user, token } = response.data;
        localStorage.setItem('token', token);
        dispatch({ type: 'LOGIN_SUCCESS', payload: { user, token } });
        toast.success('Registration successful!');
      } else {
        throw new Error(response.data.message || 'Registration failed');
      }
    } catch (error: any) {
      dispatch({ type: 'SET_LOADING', payload: false });
      const message = error.response?.data?.message || error.message || 'Registration failed';
      toast.error(message);
      throw error;
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await authService.logout();
    } catch (error) {
      // Continue with logout even if API call fails
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('token');
      dispatch({ type: 'LOGOUT' });
      toast.success('Logged out successfully');
    }
  };

  const value: AuthContextType = {
    user: state.user,
    token: state.token,
    isAuthenticated: state.isAuthenticated,
    loading: state.loading,
    login,
    register,
    logout,
    permissions: state.permissions,
    discountLimit: state.discountLimit,
    resolvedAppRoles: state.resolvedAppRoles,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
