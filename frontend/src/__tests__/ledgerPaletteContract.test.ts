/**
 * 色板 = SoulLedger 规范 v1「账簿 × 卷宗」§1.1(Claude Design,2026-09-24)。
 *
 * The spec ships hex; globals.css stores OKLCH triples. This converts each token
 * back to sRGB and holds it to the spec's hex within one channel step, per theme,
 * so a hand edit to a triple that drifts from the design is red here.
 *
 * Also held, because the spec states them as the reason the palette is what it is:
 * - text tokens ≥ 4.5:1 on canvas, the block line and the focus ring ≥ 3:1;
 * - the five domain states are five DIFFERENT colours (the old palette had
 *   已处置 and 轮回中 3° apart);
 * - civilization is not in the colour layer: no `--color-civ-*` / `--civ-*`
 *   is declared or read anywhere (规范 v1 §1.8, rule 06).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  FRONTEND_ROOT,
  ROOT_TOKENS,
  THEMES,
  TOKENS_BY_THEME,
  contrastRatio,
  oklchTripleToRgb,
  resolveTriple,
  type Rgb,
  type ThemeName,
} from "./support/globalsCssTokens";

/** Spec §1.1, transcribed from the design's L / D tables. */
const SPEC: Record<string, Record<ThemeName, string>> = {
  "--color-canvas": { light: "#f8f5ec", dark: "#0c0d10" },
  "--color-surface-1": { light: "#fdfbf6", dark: "#121419" },
  "--color-surface-2": { light: "#efe9da", dark: "#1a1d24" },
  "--color-surface-3": { light: "#e3dcc8", dark: "#252932" },
  "--color-rule": { light: "#e2c4bc", dark: "#342a2c" },
  "--color-line": { light: "#d3ccb9", dark: "#2a2e37" },
  "--color-block": { light: "#17181a", dark: "#c9ccd3" },
  "--color-ink": { light: "#17181a", dark: "#e8e9ec" },
  "--color-ink-muted": { light: "#45474c", dark: "#b3b7bf" },
  "--color-ink-subtle": { light: "#65686e", dark: "#8a8f99" },
  "--color-accent": { light: "#1d4e9e", dark: "#8db2ff" },
  "--color-danger": { light: "#b3261e", dark: "#f28273" },
  "--color-danger-tint": { light: "#f6e1da", dark: "#2b1715" },
  "--color-success": { light: "#23663a", dark: "#6acb8a" },
  "--color-success-tint": { light: "#e1ebdb", dark: "#13231a" },
  "--color-warning": { light: "#7a5000", dark: "#f0b44a" },
  "--color-warning-tint": { light: "#f2e4c4", dark: "#2a2011" },
  "--color-disabled-ink": { light: "#a6a294", dark: "#4f535c" },
  "--color-disabled-surface": { light: "#eeeadf", dark: "#16181d" },
};

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
const rgbOf = (theme: ThemeName, name: string): Rgb => oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], name));

describe("ledger palette (规范 v1 §1.1)", () => {
  const rows = THEMES.flatMap((theme) => Object.keys(SPEC).map((name) => [theme, name] as const));

  it("covers every spec token in both themes (a short list checks nothing)", () => {
    expect(rows).toHaveLength(2 * 19);
  });

  it.each(rows)("%s %s is the spec's colour", (theme, name) => {
    const got = rgbOf(theme, name);
    const want = hexRgb(SPEC[name][theme]);
    got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(1));
  });

  const TEXT = ["--color-ink", "--color-ink-muted", "--color-ink-subtle", "--color-accent", "--color-danger", "--color-success", "--color-warning"];
  it.each(THEMES.flatMap((theme) => TEXT.map((name) => [theme, name] as const)))("%s %s reads ≥ 4.5:1 on canvas", (theme, name) => {
    expect(contrastRatio(rgbOf(theme, name), rgbOf(theme, "--color-canvas"))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES.flatMap((theme) => ["--color-block", "--color-focus"].map((name) => [theme, name] as const)))(
    "%s %s reads ≥ 3:1 on canvas",
    (theme, name) => {
      expect(contrastRatio(rgbOf(theme, name), rgbOf(theme, "--color-canvas"))).toBeGreaterThanOrEqual(3);
    }
  );

  it.each(THEMES)("%s: the five soul states are five different colours", (theme) => {
    const states = ["alive", "judging", "disposed", "reincarnating", "lost"].map((s) => rgbOf(theme, `--color-status-${s}`).join(","));
    expect(new Set(states).size).toBe(5);
  });
});

describe("civilization is not a colour (规范 v1 §1.8)", () => {
  it("globals.css declares no civ token", () => {
    expect(Object.keys(ROOT_TOKENS).filter((name) => /^--(color-)?civ-/.test(name))).toEqual([]);
    const css = readFileSync(path.join(FRONTEND_ROOT, "app", "globals.css"), "utf8");
    expect(css).not.toMatch(/\[data-civ/);
  });

  it("no source file reads one", () => {
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "--untracked", "-lE", String.raw`var\(--(color-)?civ-`, "--", "app", "src", "components", "lib", ":!src/__tests__"], {
        cwd: FRONTEND_ROOT,
        encoding: "utf8",
      });
    } catch (e) {
      // git grep exits 1 when nothing matches — that is the pass; anything else is a real failure.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    expect(hits).toBe("");
  });
});
