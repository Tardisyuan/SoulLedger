"use client";

import { useTheme } from "@/src/contexts/ThemeContext";
import { chartColors, type ChartColors } from "@/lib/chart-colors";

/**
 * The chart mirror for the theme currently on screen.
 *
 * Charts pass literals to Recharts props that cannot read CSS custom
 * properties, so they do not follow the `.light` cascade the rest of the app
 * follows. Everything else on a light-mode page repainted; the charts did not.
 *
 * The theme comes from the same place the `.light` class does — `ThemeContext`
 * owns both, toggling `document.documentElement.classList` from its own state —
 * so this hook and the stylesheet cannot disagree about which theme is active.
 * Reading the class back off the DOM here would be a second, laggier source of
 * truth for something one context already holds.
 *
 * `useTheme()` has a `dark` default in its `createContext` call, so a component
 * rendered outside `ThemeProvider` (several tests) gets the dark mirror rather
 * than throwing — the same behaviour those components already had.
 */
export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  return chartColors(theme);
}
