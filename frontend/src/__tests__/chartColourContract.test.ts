/**
 * `app/globals.css` is the authority for colour; `lib/chart-colors.ts` mirrors
 * it as literals because Recharts cannot read custom properties. This holds the
 * mirror to the stylesheet in BOTH themes and in BOTH directions:
 *
 * - every entry equals the value of the token `CHART_TOKENS` names for it, per
 *   theme (a hand-typed near-miss is how the old tables drifted off the palette);
 * - STATE_COLORS covers exactly `Soul.current_state`, REALM_COLORS exactly
 *   `realms.types` — a state the API can send but no chart can colour is red,
 *   and so is an entry for a state that no longer exists.
 */
import { CHART_COLORS, CHART_TOKENS, KARMA_PATTERNS, REALM_PATTERNS, STATE_PATTERNS, type ChartColors } from "@/lib/chart-colors";

import {
  THEMES,
  TOKENS_BY_THEME,
  contrastRatio,
  literalOfIn,
  oklchTripleToRgb,
  readRealmTypes,
  readSoulStates,
  resolveTriple,
} from "./support/globalsCssTokens";

const TABLES = Object.keys(CHART_TOKENS) as (keyof ChartColors)[];

describe("chart colours mirror globals.css", () => {
  const rows = THEMES.flatMap((theme) =>
    TABLES.flatMap((table) => Object.keys(CHART_TOKENS[table]).map((key) => [theme, table, key] as const))
  );

  it("the pin list is not empty (a scanner that finds nothing passes everything)", () => {
    expect(rows.length).toBeGreaterThan(30);
  });

  it.each(rows)("%s %s.%s is its token's literal", (theme, table, key) => {
    const token = CHART_TOKENS[table][key];
    expect((CHART_COLORS[theme][table] as Record<string, string>)[key]).toBe(literalOfIn(theme, token));
  });

  it.each(THEMES)("%s: every table has exactly the keys CHART_TOKENS names", (theme) => {
    for (const table of TABLES) {
      expect(Object.keys(CHART_COLORS[theme][table]).sort()).toEqual(Object.keys(CHART_TOKENS[table]).sort());
    }
  });

  it("STATE_COLORS covers exactly the soul states the API can send", () => {
    expect(Object.keys(CHART_TOKENS.STATE_COLORS).sort()).toEqual([...readSoulStates()].sort());
  });

  it("REALM_COLORS covers exactly the realm types the UI renders", () => {
    expect(Object.keys(CHART_TOKENS.REALM_COLORS).sort()).toEqual([...readRealmTypes()].sort());
  });

  it("no series is bound to a civilization (规范 v1 §1.8)", () => {
    expect(TABLES).not.toContain("CIVILIZATION_COLORS");
  });
});

/**
 * 规范 v2 补足 A5:图表不用彩色分类。状态、去向、功过全在冷灰蓝梯度上,靠明度与图案分;
 * 匾色和状态色(反馈色)都不进图表。
 */
describe("charts are a gray-blue ramp plus patterns (规范 v2 A5)", () => {
  const DATA_TABLES = ["STATE_COLORS", "REALM_COLORS", "CHART_SERIES"] as const;

  it("every data colour is a ramp step — no status, plaque or accent colour", () => {
    for (const table of DATA_TABLES) {
      for (const token of Object.values(CHART_TOKENS[table])) expect(token).toMatch(/^--color-chart-[1-6]$/);
    }
  });

  it.each(THEMES)("%s: the five lifecycle states are ramp steps 1–5, in order; LOST is an outline of step 1 (Design D5)", (theme) => {
    const { LOST, ...lifecycle } = CHART_TOKENS.STATE_COLORS;
    expect(Object.keys(lifecycle)).toEqual(["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "SETTLED"]);
    const tokens = Object.values(lifecycle);
    expect(tokens).toEqual([1, 2, 3, 4, 5].map((n) => `--color-chart-${n}`));
    expect(LOST).toBe("--color-chart-1");
    expect(STATE_PATTERNS.LOST).toBe("outline");
    expect(Object.entries(STATE_PATTERNS).filter(([k]) => k !== "LOST").every(([, p]) => p === "solid")).toBe(true);
    expect(Object.keys(STATE_PATTERNS).sort()).toEqual(Object.keys(CHART_TOKENS.STATE_COLORS).sort());
    // Monotone lightness: dark → light in the light theme, light → dark in the dark theme.
    const L = tokens.map((t) => Number(literalOfIn(theme, t).slice(6).split(" ")[0]));
    const sorted = [...L].sort((a, b) => (theme === "light" ? a - b : b - a));
    expect(L).toEqual(sorted);
    expect(new Set(L).size).toBe(5);
  });

  it.each(THEMES)("%s: every ramp step is ≥ 3:1 against the page (A5「图形对 bg 至少 3:1」)", (theme) => {
    const bg = oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], "--color-canvas"));
    for (let n = 1; n <= 6; n++) {
      const step = oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], `--color-chart-${n}`));
      expect({ n, ok: contrastRatio(step, bg) >= 3 }).toEqual({ n, ok: true });
    }
  });

  it("the four realm types take the four patterns, one each", () => {
    expect(Object.keys(REALM_PATTERNS).sort()).toEqual([...readRealmTypes()].sort());
    expect(Object.values(REALM_PATTERNS).sort()).toEqual(["half", "hatch", "outline", "solid"]);
  });

  it("merit is solid and demerit is hatched — same colour, told apart by pattern", () => {
    expect(KARMA_PATTERNS).toEqual({ merit: "solid", demerit: "hatch" });
    expect(CHART_TOKENS.CHART_SERIES.merit).toBe(CHART_TOKENS.CHART_SERIES.demerit);
  });

  it("the tooltip is s1 with a 1px ink border (A5 · A2: overlays have no shadow, only the ink line)", () => {
    expect(CHART_TOKENS.CHART_CHROME.tooltipBg).toBe("--color-surface-1");
    expect(CHART_TOKENS.CHART_CHROME.tooltipBorder).toBe("--color-ink");
  });
});
