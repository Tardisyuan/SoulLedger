/**
 * Chart colours, in both themes — 规范 v2「朱印」补足 A5。
 *
 * 图表不用彩色分类:四种匾色和四种状态色已经把色相占满,再加分类色必然撞上其中一个。
 * 所以——
 * - 六种灵魂状态是**一条冷灰蓝(OKLCH 色相 250)的明度梯度**,按先后排:浅色从暗到亮、
 *   深色从亮到暗(`--color-chart-1…6`);
 * - 去向没有先后,用**四种图案**分:实底 / 半色(梯度第 4 档实底)/ 斜线 / 空框;
 * - 功过用**实底与空框斜线**分,不用状态色(反馈色不进领域枚举);
 * - 提示框 s1 底 + 1px ink 框;图形对 bg ≥ 3:1,数字直接标在图上,图例只作补充。
 *
 * Recharts props (`fill`, `stroke`, …) take concrete colours and cannot read CSS
 * custom properties, so the tokens in app/globals.css are mirrored here as
 * `oklch()` literals, one table per theme. `CHART_TOKENS` names the token each
 * entry mirrors; src/__tests__/chartColourContract.test.ts holds every literal
 * to that token's value in both themes, so this file cannot drift.
 * `src/hooks/useChartColors.ts` picks the table for the current theme.
 */

/** The two themes, spelled as `src/contexts/ThemeContext.tsx` spells them. */
export type ChartTheme = "dark" | "light";

export type ChartSeriesKey = "balance" | "realm" | "neutral" | "merit" | "demerit";
export type ChartChromeKey = "grid" | "axis" | "tick" | "tooltipBg" | "tooltipBorder";

/** A5 的四种图案。`half` 是梯度第 4 档的实底,另外三种都用第 1 档。 */
export type ChartPattern = "solid" | "half" | "hatch" | "outline";

export interface ChartColors {
  /** Soul lifecycle states (`Soul.current_state`) — the ordered gray-blue ramp. */
  STATE_COLORS: Record<string, string>;
  /** Realm types (`realms.types`) — colour of each realm's pattern (see REALM_PATTERNS). */
  REALM_COLORS: Record<string, string>;
  /** Series: all on the ramp; merit / demerit differ by pattern, not hue. */
  CHART_SERIES: Record<ChartSeriesKey, string>;
  /** Axis, grid, ticks, tooltip. */
  CHART_CHROME: Record<ChartChromeKey, string>;
}

/** Which token each entry mirrors. The contract test reads this; nothing renders it. */
export const CHART_TOKENS: { [K in keyof ChartColors]: Record<string, string> } = {
  STATE_COLORS: {
    ALIVE: "--color-chart-1",
    JUDGING: "--color-chart-2",
    DISPOSED: "--color-chart-3",
    REINCARNATING: "--color-chart-4",
    SETTLED: "--color-chart-5",
    LOST: "--color-chart-1",
  },
  REALM_COLORS: {
    PURGATORY: "--color-chart-1",
    BLISS: "--color-chart-4",
    HELL: "--color-chart-1",
    NEUTRAL: "--color-chart-1",
  },
  CHART_SERIES: {
    balance: "--color-chart-1",
    realm: "--color-chart-1",
    neutral: "--color-chart-4",
    merit: "--color-chart-1",
    demerit: "--color-chart-1",
  },
  CHART_CHROME: {
    grid: "--color-line",
    axis: "--color-block",
    tick: "--color-ink-subtle",
    tooltipBg: "--color-surface-1",
    tooltipBorder: "--color-ink",
  },
};

/**
 * 去向(realm type)→ 图案。A5 画的是「实底 / 半色 / 斜线 / 空框」四种,彼此没有先后,
 * 所以四个界各取一种、互不重复(contract test 钉住)。
 */
export const REALM_PATTERNS: Record<string, ChartPattern> = {
  PURGATORY: "solid",
  BLISS: "half",
  HELL: "hatch",
  NEUTRAL: "outline",
};

/**
 * 状态 → 图案(Design D5)。在世→审判中→已处置→轮回中→已终结占梯度第 1–5 档、实底;
 * 「迷失」不进梯度 —— 它是偏离流程的异常,放在梯度中间会被读成介于两个状态之间 ——
 * 用第 1 档色的空框,排在最后。
 */
export const STATE_PATTERNS: Record<string, ChartPattern> = {
  ALIVE: "solid",
  JUDGING: "solid",
  DISPOSED: "solid",
  REINCARNATING: "solid",
  SETTLED: "solid",
  LOST: "outline",
};

/** 功 = 实底,过 = 空框斜线(A5「功 / 过 · 实底与空框斜线 · 零线 2px ink」)。 */
export const KARMA_PATTERNS: Record<"merit" | "demerit", ChartPattern> = {
  merit: "solid",
  demerit: "hatch",
};

/** 斜线图案的几何:45°,线宽 1.5,间距 5(A5 的 `repeating-linear-gradient(45deg, c 0 1.5px, transparent 1.5px 5px)`)。 */
export const HATCH = { angle: 45, stroke: 1.5, gap: 5 } as const;

const DARK: ChartColors = {
  STATE_COLORS: {
    ALIVE: "oklch(0.946168 0.032488 229.2456)",
    JUDGING: "oklch(0.869674 0.044412 250.4438)",
    DISPOSED: "oklch(0.800399 0.044801 248.3861)",
    REINCARNATING: "oklch(0.740999 0.045000 249.5047)",
    SETTLED: "oklch(0.690172 0.045147 250.6443)",
    LOST: "oklch(0.946168 0.032488 229.2456)",
  },
  REALM_COLORS: {
    PURGATORY: "oklch(0.946168 0.032488 229.2456)",
    BLISS: "oklch(0.740999 0.045000 249.5047)",
    HELL: "oklch(0.946168 0.032488 229.2456)",
    NEUTRAL: "oklch(0.946168 0.032488 229.2456)",
  },
  CHART_SERIES: {
    balance: "oklch(0.946168 0.032488 229.2456)",
    realm: "oklch(0.946168 0.032488 229.2456)",
    neutral: "oklch(0.740999 0.045000 249.5047)",
    merit: "oklch(0.946168 0.032488 229.2456)",
    demerit: "oklch(0.946168 0.032488 229.2456)",
  },
  CHART_CHROME: {
    grid: "oklch(0.349944 0.013063 131.5941)",
    axis: "oklch(0.955447 0.009333 113.1622)",
    tick: "oklch(0.738053 0.012625 133.4092)",
    tooltipBg: "oklch(0.226034 0.008836 137.8312)",
    tooltipBorder: "oklch(0.955447 0.009333 113.1622)",
  },
};

const LIGHT: ChartColors = {
  STATE_COLORS: {
    ALIVE: "oklch(0.259075 0.045425 251.0858)",
    JUDGING: "oklch(0.360350 0.044648 250.3338)",
    DISPOSED: "oklch(0.440635 0.045391 248.8937)",
    REINCARNATING: "oklch(0.509215 0.044595 251.0144)",
    SETTLED: "oklch(0.570530 0.044052 249.7496)",
    LOST: "oklch(0.259075 0.045425 251.0858)",
  },
  REALM_COLORS: {
    PURGATORY: "oklch(0.259075 0.045425 251.0858)",
    BLISS: "oklch(0.509215 0.044595 251.0144)",
    HELL: "oklch(0.259075 0.045425 251.0858)",
    NEUTRAL: "oklch(0.259075 0.045425 251.0858)",
  },
  CHART_SERIES: {
    balance: "oklch(0.259075 0.045425 251.0858)",
    realm: "oklch(0.259075 0.045425 251.0858)",
    neutral: "oklch(0.509215 0.044595 251.0144)",
    merit: "oklch(0.259075 0.045425 251.0858)",
    demerit: "oklch(0.259075 0.045425 251.0858)",
  },
  CHART_CHROME: {
    grid: "oklch(0.863595 0.008432 121.6501)",
    axis: "oklch(0.214438 0.006530 134.9799)",
    tick: "oklch(0.511553 0.011899 131.4694)",
    tooltipBg: "oklch(0.987257 0.003952 106.4716)",
    tooltipBorder: "oklch(0.214438 0.006530 134.9799)",
  },
};

export const CHART_COLORS: Record<ChartTheme, ChartColors> = { dark: DARK, light: LIGHT };

/** The mirror for one theme. No bare table export: that invites the dark one onto a light page. */
export function chartColors(theme: ChartTheme): ChartColors {
  return CHART_COLORS[theme];
}
