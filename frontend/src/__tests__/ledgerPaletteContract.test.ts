/**
 * 色板 = SoulLedger 规范 v2「朱印」(Claude Design,2026-09-29 定稿;design-cache/v2/
 * spec-final.dc.html §一「Web · 四文明共用」、§二 状态色、§三 文明皮)。
 * v1「账簿 × 卷宗」那张表在这次改版里整张换掉,这份测试随之换成 v2 的表。
 *
 * The spec ships hex; globals.css stores OKLCH triples. This converts each token
 * back to sRGB and holds it to the spec's hex within one channel step, per theme,
 * so a hand edit to a triple that drifts from the design is red here.
 *
 * Also held, because the spec states them as the reason the palette is what it is:
 * - text tokens ≥ 4.5:1 on canvas, the block line and the focus ring ≥ 3:1;
 * - onMain ≥ 4.5:1 on every plaque colour (§三 算的就是这一条);
 * - the five domain states are five DIFFERENT colours;
 * - civilization enters ONLY the plaque colour (§1.8 收窄): `--color-civ-*` is read
 *   by exactly one declaration, `--color-main`, per `[data-civ]`; no source file
 *   reads a civ token directly.
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

/** Spec v2 §一 / §二 / §三, transcribed from the design's L / D tables. */
const SPEC: Record<string, Record<ThemeName, string>> = {
  "--color-canvas": { light: "#f4ede0", dark: "#100e0d" },
  "--color-surface-1": { light: "#fffaf1", dark: "#1a1715" },
  "--color-surface-2": { light: "#ebe1cd", dark: "#26221e" },
  "--color-line": { light: "#dcd1bd", dark: "#332d28" },
  "--color-line-strong": { light: "#655c53", dark: "#a3968a" },
  "--color-block": { light: "#151312", dark: "#f2e9dc" },
  "--color-ink": { light: "#151312", dark: "#f2e9dc" },
  "--color-ink-muted": { light: "#4a4441", dark: "#c6b9a8" },
  "--color-ink-subtle": { light: "#655c53", dark: "#a3968a" },
  "--color-pillar": { light: "#151312", dark: "#050404" },
  "--color-on-main": { light: "#fff4e8", dark: "#fff4e8" },
  "--color-focus": { light: "#151312", dark: "#f2e9dc" },
  "--color-success": { light: "#197037", dark: "#82CB92" },
  "--color-danger": { light: "#A8103E", dark: "#FF7A93" },
  "--color-danger-strong": { light: "#A8103E", dark: "#C21D4D" },
  "--color-danger-tint": { light: "#FFECEF", dark: "#33101A" },
  "--color-danger-on-tint": { light: "#8A0C33", dark: "#FFD3DC" },
  "--color-warning": { light: "#A65000", dark: "#FF9A3C" },
  "--color-lamp": { light: "#6A3E00", dark: "#F2CC7A" },
  "--color-lamp-bg": { light: "#FBF1DC", dark: "#241B0C" },
  "--color-disabled-ink": { light: "#655c53", dark: "#a3968a" },
  "--color-disabled-surface": { light: "#ebe1cd", dark: "#26221e" },
  "--color-civ-neutral": { light: "#2b2724", dark: "#6e665e" },
  "--color-civ-cn": { light: "#9a2f1f", dark: "#b3402c" },
  "--color-civ-eu": { light: "#4a2a6a", dark: "#7a52a6" },
  "--color-civ-eg": { light: "#1f3f8a", dark: "#3e62b8" },
  "--color-civ-gr": { light: "#1f3b3e", dark: "#3f7076" },
};

const CIVS = ["neutral", "cn", "eu", "eg", "gr"] as const;

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
const rgbOf = (theme: ThemeName, name: string): Rgb => oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], name));
const CSS = readFileSync(path.join(FRONTEND_ROOT, "app", "globals.css"), "utf8");

describe("palette (规范 v2 §一–§三)", () => {
  const rows = THEMES.flatMap((theme) => Object.keys(SPEC).map((name) => [theme, name] as const));

  it("covers every spec token in both themes (a short list checks nothing)", () => {
    expect(rows).toHaveLength(2 * 27);
  });

  it.each(rows)("%s %s is the spec's colour", (theme, name) => {
    const got = rgbOf(theme, name);
    const want = hexRgb(SPEC[name][theme]);
    got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(1));
  });

  const TEXT = [
    "--color-ink",
    "--color-ink-muted",
    "--color-ink-subtle",
    "--color-accent",
    "--color-danger",
    "--color-success",
    "--color-warning",
    "--color-lamp",
  ];
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

describe("the paired texts the spec measures", () => {
  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("%s onMain on the %s plaque ≥ 4.5:1", (theme, civ) => {
    expect(contrastRatio(rgbOf(theme, "--color-on-main"), rgbOf(theme, `--color-civ-${civ}`))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("%s neg.onBg on neg.bg ≥ 4.5:1, and white on neg.strong ≥ 4.5:1", (theme) => {
    expect(contrastRatio(rgbOf(theme, "--color-danger-on-tint"), rgbOf(theme, "--color-danger-tint"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio([255, 255, 255], rgbOf(theme, "--color-danger-strong"))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("%s input border (ink3) on s1 ≥ 3:1 — the line token would not be", (theme) => {
    expect(contrastRatio(rgbOf(theme, "--color-line-strong"), rgbOf(theme, "--color-surface-1"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(rgbOf(theme, "--color-line"), rgbOf(theme, "--color-surface-1"))).toBeLessThan(3);
  });
});

/** `--color-main` as the stylesheet resolves it under `<html data-civ="…">`. */
function mainUnder(civ: string): string | undefined {
  if (civ === "neutral") return ROOT_TOKENS["--color-main"];
  const block = new RegExp(String.raw`\[data-civ="${civ}"\]\s*\{([^}]*)\}`).exec(CSS);
  return block ? /--color-main:\s*([^;]+);/.exec(block[1])?.[1].trim() : undefined;
}

describe("civilization enters only the plaque colour (规范 v2 §1.8 收窄)", () => {
  it("no [data-civ] (before login) is the neutral skin", () => {
    expect(ROOT_TOKENS["--color-main"]).toBe("var(--color-civ-neutral)");
  });

  it.each(CIVS.filter((c) => c !== "neutral"))("[data-civ=%s] points --color-main at its own plaque colour", (civ) => {
    expect(mainUnder(civ)).toBe(`var(--color-civ-${civ})`);
  });

  // 文明皮是「匾色 + 匾纹 + 印形 + 题字 / 印文字体」(§三),所以 [data-civ] 块里除了匾色还有
  // 素材与字体的变量(第二阶段,见 zhuyinShell.test)。这条守的仍是 §1.8 收窄那句话:**颜色**
  // 里只有 --color-main 随文明变;非颜色的声明只能是那几类皮肤素材,别的一概不许。
  const SKIN_ASSETS = /^--(band|band-compact|seal-body|seal-ring|seal-line|seal-line-small|seal-scan|section|font-plaque|font-seal)$/;

  it("a [data-civ] block sets no colour but --color-main, and nothing but skin assets besides", () => {
    const blocks = [...CSS.matchAll(/\[data-civ="(\w+)"\]\s*\{([^}]*)\}/g)];
    expect([...new Set(blocks.map((b) => b[1]))].sort()).toEqual(["cn", "eg", "eu", "gr", "neutral"]);
    const mainSetBy: string[] = [];
    for (const b of blocks) {
      const decls = [...b[2].matchAll(/(--[\w-]+)\s*:/g)].map((d) => d[1]);
      const colours = decls.filter((d) => d.startsWith("--color-"));
      expect(colours.filter((d) => d !== "--color-main")).toEqual([]);
      if (colours.includes("--color-main")) mainSetBy.push(b[1]);
      expect(decls.filter((d) => !d.startsWith("--color-") && !SKIN_ASSETS.test(d))).toEqual([]);
    }
    expect(mainSetBy.sort()).toEqual(["cn", "eg", "eu", "gr"]);
  });

  it("no source file reads a civ token directly — they go through --color-main", () => {
    let hits = "";
    try {
      hits = execFileSync(
        "git",
        ["grep", "--untracked", "-lE", String.raw`var\(--(color-)?civ-`, "--", "app", "src", "components", "lib", ":!src/__tests__", ":!app/globals.css"],
        { cwd: FRONTEND_ROOT, encoding: "utf8" }
      );
    } catch (e) {
      // git grep exits 1 when nothing matches — that is the pass; anything else is a real failure.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    expect(hits).toBe("");
  });
});
