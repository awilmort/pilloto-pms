import React, { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';
import { settingsService, AppSettings } from '../services/api';
import { useAuth } from './AuthContext';

interface SettingsContextValue {
  settings: AppSettings | null;
  activeSections: Record<string, boolean>;
  /** True while settings are being fetched for the first time after login */
  loading: boolean;
  refresh: () => void;
}

/** Stable empty map, so `activeSections` keeps its identity while settings are not loaded. */
const NO_SECTIONS: Record<string, boolean> = {};

const SettingsContext = createContext<SettingsContextValue>({
  settings: null,
  activeSections: {},
  loading: true,
  refresh: () => {},
});

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(() => {
    setLoading(true);
    settingsService.getSettings()
      .then(res => setSettings(res.data.data ?? null))
      .catch(() => setSettings(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Wait until auth state is resolved
    if (authLoading) return;
    if (!isAuthenticated) {
      setSettings(null);
      setLoading(false);
      return;
    }
    fetchSettings();
  }, [isAuthenticated, authLoading, fetchSettings]);

  const activeSections: Record<string, boolean> = settings?.sections ?? NO_SECTIONS;
  const value = useMemo(
    () => ({ settings, activeSections, loading, refresh: fetchSettings }),
    [settings, activeSections, loading, fetchSettings]
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
