/** The theme choice (follow the system / light / dark), and 「落印前先确认」, kept on this device. */
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

/**
 * 「落印前先确认」(2026-11-14 用户决定,与网页同名的开关,WCAG 2.2.1 的「可关」):默认关。打开后滑卡审判的「通过」
 * 不再走 3 秒撤回窗口,先弹回读底页(人名 · 案号 · 判决),按「落印」才发,没有计时。存在设备的 persistent 里,
 * 在按下的那一刻读(`sealReadbackWished()`),不经 context —— 改它的是「我的」页,滑卡页那时不在屏上。
 */
export const SEAL_READBACK_KEY = "officer_seal_readback";
export const sealReadbackWished = () => platform().persistent.get(SEAL_READBACK_KEY) === "1";
export const setSealReadbackWished = (on: boolean) => (on ? platform().persistent.set(SEAL_READBACK_KEY, "1") : platform().persistent.remove(SEAL_READBACK_KEY));
