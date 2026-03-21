import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke<AppSettings>("get_settings")
      .then(s => { setSettings(s); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      invoke("save_settings", { settings: next }).catch(() => {});
      return next;
    });
  }, []);

  return { settings, updateSettings, loaded };
}
