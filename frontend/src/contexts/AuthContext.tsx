import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { User, AuthContextType, RegisterData } from '../types';
import { rolesService } from '../services/api';
import { authService } from '../services/api';
import { toast } from 'react-toastify';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  permissions: string[];
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
        permissions: (action.payload.user as any).permissions || [],
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        loading: false,
        permissions: [],
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: action.payload,
        permissions: (action.payload as any).permissions || state.permissions,
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

  // Check if user is logged in on app start
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const response = await authService.getCurrentUser();
          if (response.data.success && response.data.user) {
            const user = response.data.user as any;
            // Attach permissions by looking up Role definition (case-insensitive)
            try {
              const rolesRes = await rolesService.getRoles();
              const roleDef = Array.isArray(rolesRes.data.data)
                ? rolesRes.data.data.find((r: any) => String(r.name).toLowerCase() === String(user.role).toLowerCase())
                : null;
              const legacyMap: Record<string, string> = {
                'schedule.view': 'admin.schedule',
                'accommodations.manage': 'admin.accommodations',
              };
              const rawPerms: string[] = roleDef?.permissions || [];
              user.permissions = rawPerms.map(p => legacyMap[p] || p);
            } catch (e) {
              user.permissions = [];
            }
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
      const response = await authService.getCurrentUser();
      if (response.data.success && response.data.user) {
        const user = response.data.user as any;
        try {
          const rolesRes = await rolesService.getRoles();
          const roleDef = Array.isArray(rolesRes.data.data)
            ? rolesRes.data.data.find((r: any) => String(r.name).toLowerCase() === String(user.role).toLowerCase())
            : null;
          const legacyMap: Record<string, string> = {
            'schedule.view': 'admin.schedule',
            'accommodations.manage': 'admin.accommodations',
          };
          const rawPerms: string[] = roleDef?.permissions || [];
          user.permissions = rawPerms.map(p => legacyMap[p] || p);
        } catch (e) {
          user.permissions = [];
        }
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
        const { user: rawUser, token } = response.data as any;
        const user = { ...rawUser } as any;
        // Attach permissions by looking up Role definition (case-insensitive)
        try {
          const rolesRes = await rolesService.getRoles();
          const roleDef = Array.isArray(rolesRes.data.data)
            ? rolesRes.data.data.find((r: any) => String(r.name).toLowerCase() === String(user.role).toLowerCase())
            : null;
          const legacyMap: Record<string, string> = {
            'schedule.view': 'admin.schedule',
            'accommodations.manage': 'admin.accommodations',
          };
          const rawPerms: string[] = roleDef?.permissions || [];
          user.permissions = rawPerms.map(p => legacyMap[p] || p);
        } catch (e) {
          user.permissions = [];
        }
        localStorage.setItem('token', token);
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
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
