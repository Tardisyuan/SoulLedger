"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

const STORAGE_KEY = "soulledger_theme";

/** 160ms of `--transition-duration-state` plus one frame of slack. */
const THEME_SWAP_MS = 200;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const themeSwapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A switch immediately followed by a navigation would otherwise leave the
  // class on `<html>` — which outlives this provider, since it is not React's
  // to clean up — and every colour change on the next page would inherit a
  // 160ms tween it never asked for.
  useEffect(() => {
    return () => {
      if (themeSwapTimer.current) clearTimeout(themeSwapTimer.current);
      document.documentElement.classList.remove("theme-switching");
    };
  }, []);

  // Hydrate from localStorage on mount, and keep DOM in sync with state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (saved === "light" || saved === "dark") {
        setThemeState(saved);
      } else {
        // Default: dark, ensure DOM matches
        document.documentElement.classList.add("dark");
        document.documentElement.classList.remove("light");
      }
    } catch {
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Sync DOM classes whenever theme changes
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  /**
   * The swap is a whole-screen colour inversion; `theme-switching` is what
   * makes it a change rather than a cut. See the rule in `app/globals.css`.
   *
   * The class and the colour change land in the same style recalculation, which
   * is what the CSS Transitions spec wants: a transition starts when a property
   * changes AND the *after-change* style declares a transition for it. So the
   * ordering of these two `classList` calls does not matter — but they must not
   * be split across frames, or the first frame would repaint in the new colours
   * with nothing to tween.
   *
   * It comes off on a timer rather than on `transitionend`: that event fires
   * once per property per element, which on a full page is thousands of
   * events for one interaction, and it does not fire at all for elements whose
   * colours happen not to differ between the two themes.
   *
   * The timer matches `--transition-duration-state` (160ms) plus a frame of
   * slack. If the two ever disagree, the visible symptom is a swap that stops
   * halfway and jumps — so the number is written next to its reason rather
   * than left as a bare 200.
   */
  const setTheme = useCallback((t: Theme) => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    if (themeSwapTimer.current) clearTimeout(themeSwapTimer.current);
    themeSwapTimer.current = setTimeout(() => {
      root.classList.remove("theme-switching");
      themeSwapTimer.current = null;
    }, THEME_SWAP_MS);

    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    root.classList.remove("dark", "light");
    root.classList.add(t);
  }, []);

  const toggleTheme = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
