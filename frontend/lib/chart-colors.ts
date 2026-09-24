/**
 * Chart colours, in both themes — 规范 v1 §1.3.
 *
 * Recharts props (`fill`, `stroke`, `tick.fill`, …) take concrete colours and
 * cannot read CSS custom properties, so the tokens in app/globals.css are
 * mirrored here as `oklch()` literals, one table per theme. `CHART_TOKENS` names
 * the token each entry mirrors; src/__tests__/chartColourContract.test.ts holds
 * every literal to that token's value in both themes, so this file cannot drift.
 *
 * Series are not bound to civilizations (§1.8): a chart that separates
 * civilizations does it with shape marks and direct labels, all in ink.
 * `src/hooks/useChartColors.ts` picks the table for the current theme.
 */

/** The two themes, spelled as `src/contexts/ThemeContext.tsx` spells them. */
export type ChartTheme = "dark" | "light";

export type ChartSeriesKey = "balance" | "realm" | "neutral" | "merit" | "demerit";
export type ChartChromeKey = "accent" | "grid" | "axis" | "tick" | "tooltipBg" | "tooltipBorder";

export interface ChartColors {
  /** Soul lifecycle states (`Soul.current_state`) — the domain state colours. */
  STATE_COLORS: Record<string, string>;
  /** Realm types (`realms.types`). */
  REALM_COLORS: Record<string, string>;
  /** Series: series-1 ink, series-2 accent, series-4 ink-subtle; merit / demerit. */
  CHART_SERIES: Record<ChartSeriesKey, string>;
  /** Axis, grid (the ledger's rule), ticks, tooltip. */
  CHART_CHROME: Record<ChartChromeKey, string>;
}

/** Which token each entry mirrors. The contract test reads this; nothing renders it. */
export const CHART_TOKENS: { [K in keyof ChartColors]: Record<string, string> } = {
  STATE_COLORS: {
    ALIVE: "--color-success",
    JUDGING: "--color-warning",
    DISPOSED: "--color-ink",
    REINCARNATING: "--color-accent",
    LOST: "--color-ink-subtle",
    SETTLED: "--color-ink-muted",
  },
  REALM_COLORS: {
    HELL: "--color-danger",
    PURGATORY: "--color-warning",
    BLISS: "--color-success",
    NEUTRAL: "--color-ink-subtle",
  },
  CHART_SERIES: {
    balance: "--color-ink",
    realm: "--color-accent",
    neutral: "--color-ink-subtle",
    merit: "--color-success",
    demerit: "--color-danger",
  },
  CHART_CHROME: {
    accent: "--color-accent",
    grid: "--color-rule",
    axis: "--color-block",
    tick: "--color-ink-subtle",
    tooltipBg: "--color-surface-1",
    tooltipBorder: "--color-line",
  },
};

const DARK: ChartColors = {
  STATE_COLORS: {
    ALIVE: "oklch(0.765836 0.131731 152.8502)",
    JUDGING: "oklch(0.806698 0.138580 78.5222)",
    DISPOSED: "oklch(0.934113 0.004173 271.3676)",
    REINCARNATING: "oklch(0.766991 0.118326 264.1625)",
    LOST: "oklch(0.649150 0.015962 264.4570)",
    SETTLED: "oklch(0.778696 0.012177 264.4963)",
  },
  REALM_COLORS: {
    HELL: "oklch(0.727654 0.139960 28.8863)",
    PURGATORY: "oklch(0.806698 0.138580 78.5222)",
    BLISS: "oklch(0.765836 0.131731 152.8502)",
    NEUTRAL: "oklch(0.649150 0.015962 264.4570)",
  },
  CHART_SERIES: {
    balance: "oklch(0.934113 0.004173 271.3676)",
    realm: "oklch(0.766991 0.118326 264.1625)",
    neutral: "oklch(0.649150 0.015962 264.4570)",
    merit: "oklch(0.765836 0.131731 152.8502)",
    demerit: "oklch(0.727654 0.139960 28.8863)",
  },
  CHART_CHROME: {
    accent: "oklch(0.766991 0.118326 264.1625)",
    grid: "oklch(0.296939 0.015156 4.5359)",
    axis: "oklch(0.844951 0.010232 267.3470)",
    tick: "oklch(0.649150 0.015962 264.4570)",
    tooltipBg: "oklch(0.191373 0.010618 268.1287)",
    tooltipBorder: "oklch(0.301015 0.017256 266.3777)",
  },
};

const LIGHT: ChartColors = {
  STATE_COLORS: {
    ALIVE: "oklch(0.455753 0.098259 151.6573)",
    JUDGING: "oklch(0.466535 0.098749 74.2741)",
    DISPOSED: "oklch(0.208789 0.004235 264.4766)",
    REINCARNATING: "oklch(0.438650 0.140636 259.8917)",
    LOST: "oklch(0.516707 0.010128 264.4796)",
    SETTLED: "oklch(0.397873 0.008784 268.4341)",
  },
  REALM_COLORS: {
    HELL: "oklch(0.501282 0.178318 28.7047)",
    PURGATORY: "oklch(0.466535 0.098749 74.2741)",
    BLISS: "oklch(0.455753 0.098259 151.6573)",
    NEUTRAL: "oklch(0.516707 0.010128 264.4796)",
  },
  CHART_SERIES: {
    balance: "oklch(0.208789 0.004235 264.4766)",
    realm: "oklch(0.438650 0.140636 259.8917)",
    neutral: "oklch(0.516707 0.010128 264.4796)",
    merit: "oklch(0.455753 0.098259 151.6573)",
    demerit: "oklch(0.501282 0.178318 28.7047)",
  },
  CHART_CHROME: {
    accent: "oklch(0.438650 0.140636 259.8917)",
    grid: "oklch(0.843587 0.036004 35.3407)",
    axis: "oklch(0.208789 0.004235 264.4766)",
    tick: "oklch(0.516707 0.010128 264.4796)",
    tooltipBg: "oklch(0.988238 0.006936 88.6415)",
    tooltipBorder: "oklch(0.845691 0.026923 90.1212)",
  },
};

export const CHART_COLORS: Record<ChartTheme, ChartColors> = { dark: DARK, light: LIGHT };

/** The mirror for one theme. No bare table export: that invites the dark one onto a light page. */
export function chartColors(theme: ChartTheme): ChartColors {
  return CHART_COLORS[theme];
}
