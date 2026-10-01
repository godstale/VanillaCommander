import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { AppSettings } from '@/lib/types/chat';
import type { ApprovalMode } from '@/lib/types/agent';
import {
  getSettings,
  updateSettings as persistSettings,
  DEFAULT_APP_SETTINGS,
} from '@/lib/db/repositories/settingsRepo';

export interface SettingsContextValue {
  settings: AppSettings;
  loading: boolean;
  updateSettings: (updates: Partial<Omit<AppSettings, 'id'>>) => Promise<void>;
  setDefaultApprovalMode: (mode: ApprovalMode) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getSettings()
      .then((loaded) => {
        if (!cancelled) {
          setSettings(loaded);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load settings from DB:', err);
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (updates: Partial<Omit<AppSettings, 'id'>>) => {
    try {
      const updated = await persistSettings(updates);
      setSettings(updated);
    } catch (err) {
      console.error('Failed to persist settings:', err);
      // Optimistically update local state even if DB write fails
      setSettings((prev) => ({ ...prev, ...updates }));
    }
  }, []);

  const setDefaultApprovalMode = useCallback(
    async (mode: ApprovalMode) => {
      await update({ defaultApprovalMode: mode });
    },
    [update],
  );

  return (
    <SettingsContext.Provider
      value={{
        settings,
        loading,
        updateSettings: update,
        setDefaultApprovalMode,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return ctx;
}
