import React, { createContext, useContext, useState, useEffect } from 'react';
import { settingsService, AppSettings } from '../services/api';
import { useAuth } from './AuthContext';

interface SettingsContextValue {
  settings: AppSettings | null;
  activeSections: Record<string, boolean>;
  /** True while settings are being fetched for the first time after login */
  loading: boolean;
  refresh: () => void;
}

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

  const fetchSettings = () => {
    setLoading(true);
    settingsService.getSettings()
      .then(res => setSettings(res.data.data ?? null))
      .catch(() => setSettings(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Wait until auth state is resolved
    if (authLoading) return;
    if (!isAuthenticated) {
      setSettings(null);
      setLoading(false);
      return;
    }
    fetchSettings();
  }, [isAuthenticated, authLoading]);

  const activeSections: Record<string, boolean> = settings?.sections ?? {};

  return (
    <SettingsContext.Provider value={{ settings, activeSections, loading, refresh: fetchSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
