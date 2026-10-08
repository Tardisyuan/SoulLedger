/** The theme choice (follow the system / light / dark), kept on this device. */
import { platform } from "@soulledger/core/platform";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "officer_theme";

export function readThemeChoice(): ThemeChoice {
  const stored = platform().persistent.get(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

interface Prefs {
  themeChoice: ThemeChoice;
  setThemeChoice: (next: ThemeChoice) => void;
}

const PrefsContext = createContext<Prefs>({ themeChoice: "system", setThemeChoice: () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [themeChoice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  const setThemeChoice = useCallback((next: ThemeChoice) => {
    if (next === "system") platform().persistent.remove(THEME_KEY);
    else platform().persistent.set(THEME_KEY, next);
    setChoice(next);
  }, []);
  const value = useMemo(() => ({ themeChoice, setThemeChoice }), [themeChoice, setThemeChoice]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);
