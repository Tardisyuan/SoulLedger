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
  /** No saved choice: the theme is the OS's and follows it (首次设置「跟随系统」). */
  followsSystem: boolean;
  /** Forget the saved choice and follow the OS again. */
  followSystem: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
  followsSystem: true,
  followSystem: () => {},
});

const STORAGE_KEY = "soulledger_theme";

/** 120ms of `--transition-duration-state` (规范 v2 fast) plus slack. */
const THEME_SWAP_MS = 200;

/** Asked as "light?" so that "no preference" lands on dark — the same question
 *  and the same fallback as THEME_BOOTSTRAP in app/layout.tsx. */
const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** 规范 v2:没选过就跟随系统。matchMedia 缺席(jsdom、极旧浏览器)时退回深色,
 *  与 v1 的默认一致。 */
function systemTheme(): Theme {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
    }
  } catch {
    // matchMedia 抛了:按没有它处理
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [followsSystem, setFollowsSystem] = useState(true);
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

  // Hydrate on mount. An explicit choice in localStorage wins; with none, the
  // theme follows the OS (规范 v2「跟随系统」) and keeps following it while the
  // page is open — a listener, because the OS flips at dusk without a reload.
  // The listener is attached only while nothing is saved: once the user picks,
  // `setTheme` stores it and the next change event finds a saved value and
  // leaves the choice alone.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable: behave as if nothing was chosen
    }
    if (saved === "light" || saved === "dark") {
      setThemeState(saved);
      setFollowsSystem(false);
    } else {
      setThemeState(systemTheme());
    }
    // Attached either way: `followSystem` can drop a saved choice later, and the
    // listener already ignores the OS while a choice is saved.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(LIGHT_QUERY);
    const follow = (e: MediaQueryListEvent) => {
      try {
        const now = localStorage.getItem(STORAGE_KEY);
        if (now === "light" || now === "dark") return;
      } catch {
        // unavailable: keep following
      }
      setThemeState(e.matches ? "light" : "dark");
    };
    mql.addEventListener?.("change", follow);
    return () => mql.removeEventListener?.("change", follow);
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
   * The timer matches `--transition-duration-state` (120ms) plus a frame of
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
    setFollowsSystem(false);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // unavailable: the choice lasts for this page only
    }
    root.classList.remove("dark", "light");
    root.classList.add(t);
  }, []);

  const toggleTheme = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  const followSystem = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // unavailable: nothing was saved there either
    }
    const t = systemTheme();
    setThemeState(t);
    setFollowsSystem(true);
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(t);
  }, []);

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme, followsSystem, followSystem }),
    [theme, toggleTheme, setTheme, followsSystem, followSystem]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
