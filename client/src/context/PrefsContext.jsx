import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';

const DEFAULTS = { textScale: 1, contrast: 'normal', font: 'default', reduceMotion: false };
const KEY = 'barrierfix.display';
const PrefsContext = createContext(null);

function readLocal() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return DEFAULTS;
  }
}

// Display settings (text size, contrast, readable font, reduced motion). Saved to the
// account when signed in, and kept in this browser so the sign-in page uses them too.
export function PrefsProvider({ children }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(readLocal);

  useEffect(() => {
    if (user?.preferences) setPrefs((p) => ({ ...p, ...user.preferences }));
  }, [user?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${Math.round((prefs.textScale || 1) * 100)}%`;
    root.dataset.contrast = prefs.contrast;
    root.dataset.font = prefs.font;
    root.dataset.motion = prefs.reduceMotion ? 'reduce' : 'normal';
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* storage may be unavailable */
    }
  }, [prefs]);

  const update = useCallback(
    async (patch) => {
      const next = { ...prefs, ...patch };
      setPrefs(next);
      if (user) await api.patch('/api/users/me', { preferences: next }).catch(() => {});
    },
    [prefs, user],
  );

  return <PrefsContext.Provider value={{ prefs, update }}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);
