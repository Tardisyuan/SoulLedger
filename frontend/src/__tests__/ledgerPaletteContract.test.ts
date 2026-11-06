/**
 * @jest-environment node
 *
 * 色板 = SoulLedger 规范 v4(Claude Design 第七批 `V4Batch07.dc.html`,2026-11-06)。
 * v1「账簿 × 卷宗」、v2「朱印」、v3 冷中性灰三张表先后整张换掉,这份测试随之换成 v4 的表。
 *
 * The spec ships hex; globals.css stores OKLCH triples. This converts each token
 * back to sRGB and holds it to the spec's hex within one channel step, per theme,
 * so a hand edit to a triple that drifts from the design is red here.
 *
 * Also held, because the spec states them as the reason the palette is what it is:
 * - text tokens ≥ 4.5:1 on canvas, the block line and the focus ring ≥ 3:1;
 * - onMain ≥ 4.5:1 on every solid colour (v4 的 solid 就是给白字配的);
 * - each civilization's text colour (civT) ≥ 4.5:1 on canvas / surface-1 / surface-2, its metal
 *   mark ≥ 3:1 on canvas / surface-1;
 * - the five domain states are five DIFFERENT colours;
 * - civilization colour enters through `[data-civ]` only: each `[data-civ="x"]` block points the
 *   five generic names (`--color-main` / `-main-ink` / `-glow` / `-metal` / `-side`) at its own
 *   `--color-civ-x*` tokens and declares nothing else; no source file reads a civ token directly.
 *   (v3 的规则是「文明只进匾色,五处用」—— 用户 2026-11-06 决定撤销,照 v4 的范围。)
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

/** 规范 v4 的色表(Design 第七批定稿 `V4Batch07.dc.html` 的 `.th-dark` / `.th-light` 与四个
 * `[data-civ]`,2026-11-06)。v3 那张冷中性灰的表整张换掉,名字不动。
 *
 * v4 的 17 个主题角色对到这里的规则写在 globals.css 的色板抬头,摘要:
 *   main/card/card2 → canvas/surface-1/surface-2;ink → ink/block;sub → ink-muted 与 ink-subtle;
 *   faint → line-strong 与 disabled-ink;line(8%)压在 card 上合成 → line;pos/neg → success/danger。
 * 文明(用户 2026-11-06 决定照 v4 的范围):solid → `--color-civ-*`(=匾色 / 主按钮底),civT →
 * `-ink`,metal → `-metal`,side → `-side`,glow 两主题同值不在这张表(只有一个值,没有对错之分可量)。
 * 中性皮是第八批第 5 条给的值(与 App 一致);--color-warn / --color-faint-text 是第八批第 4、6 条新增的。v4 没定义的 danger-strong / tint / warning / 长明灯沿用 v3。 */
const SPEC: Record<string, Record<ThemeName, string>> = {
  "--color-canvas": { light: "#f8f8f6", dark: "#111113" },
  "--color-surface-1": { light: "#ffffff", dark: "#1a1b1e" },
  "--color-surface-2": { light: "#f1f1ee", dark: "#222327" },
  "--color-line": { light: "#ebebeb", dark: "#2c2d30" },
  "--color-line-strong": { light: "#8a8d92", dark: "#7c7f85" },
  "--color-block": { light: "#16171a", dark: "#f3f3f1" },
  "--color-ink": { light: "#16171a", dark: "#f3f3f1" },
  "--color-ink-muted": { light: "#54575c", dark: "#b4b6ba" },
  "--color-ink-subtle": { light: "#54575c", dark: "#b4b6ba" },
  "--color-pillar": { light: "#f1f1ee", dark: "#0c0c0e" },
  "--color-on-main": { light: "#ffffff", dark: "#ffffff" },
  "--color-focus": { light: "#16171a", dark: "#f3f3f1" },
  "--color-success": { light: "#1f6b3f", dark: "#8ad3a1" },
  "--color-danger": { light: "#a81e3c", dark: "#f2849b" },
  "--color-danger-strong": { light: "#8f2430", dark: "#c84c5a" },
  "--color-danger-tint": { light: "#FFECEF", dark: "#33101A" },
  "--color-danger-on-tint": { light: "#8A0C33", dark: "#FFD3DC" },
  "--color-warning": { light: "#a65000", dark: "#e07a23" },
  "--color-success-tint": { light: "#E4FBE7", dark: "#102515" },
  "--color-warning-tint": { light: "#FFF1E2", dark: "#301904" },
  "--color-lamp": { light: "#6A3E00", dark: "#F2CC7A" },
  "--color-lamp-bg": { light: "#FBF1DC", dark: "#241B0C" },
  "--color-disabled-ink": { light: "#8a8d92", dark: "#7c7f85" },
  "--color-disabled-surface": { light: "#f1f1ee", dark: "#222327" },
  // 中性皮:Design 第八批第 5 条(2026-11-06)。glow 两主题同值,只有中性这一格放进表里 —— 它是第八批新给的值。
  "--color-civ-neutral": { light: "#5a606b", dark: "#55575e" },
  "--color-civ-neutral-ink": { light: "#54575c", dark: "#b4b6ba" },
  "--color-civ-neutral-glow": { light: "#8e939c", dark: "#8e939c" },
  "--color-civ-neutral-metal": { light: "#8a6a24", dark: "#ecaa3d" },
  "--color-civ-neutral-side": { light: "#f1f1ef", dark: "#0e0f11" },
  // 第八批新增:琥珀(连接状态的点与线,不当字)、比 sub 更淡的字。
  "--color-warn": { light: "#9a6400", dark: "#e8b45a" },
  "--color-faint-text": { light: "#686b70", dark: "#8e9197" },
  "--color-civ-cn": { light: "#a64a3b", dark: "#7e362b" },
  "--color-civ-cn-ink": { light: "#a04636", dark: "#d98a7a" },
  "--color-civ-cn-metal": { light: "#8a6a24", dark: "#c9a35e" },
  "--color-civ-cn-side": { light: "#fff0ec", dark: "#160806" },
  "--color-civ-eu": { light: "#7a4f85", dark: "#5a3a63" },
  "--color-civ-eu-ink": { light: "#885a94", dark: "#a883ae" },
  "--color-civ-eu-metal": { light: "#5c6878", dark: "#b9c2cf" },
  "--color-civ-eu-side": { light: "#f7edf6", dark: "#100718" },
  "--color-civ-eg": { light: "#3c69a2", dark: "#2b4e79" },
  "--color-civ-eg-ink": { light: "#174a88", dark: "#89bcf1" },
  "--color-civ-eg-metal": { light: "#86671e", dark: "#d6b25e" },
  "--color-civ-eg-side": { light: "#eaf2fb", dark: "#060c1c" },
  "--color-civ-gr": { light: "#37716a", dark: "#28544f" },
  "--color-civ-gr-ink": { light: "#31695e", dark: "#b5e3d8" },
  "--color-civ-gr-metal": { light: "#8f5b36", dark: "#c98b62" },
  "--color-civ-gr-side": { light: "#e8faf7", dark: "#03120f" },
};

const CIVS = ["neutral", "cn", "eu", "eg", "gr"] as const;

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
const rgbOf = (theme: ThemeName, name: string): Rgb => oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], name));
const CSS = readFileSync(path.join(FRONTEND_ROOT, "app", "globals.css"), "utf8");

describe("palette (规范 v4)", () => {
  const rows = THEMES.flatMap((theme) => Object.keys(SPEC).map((name) => [theme, name] as const));

  it("covers every spec token in both themes (a short list checks nothing)", () => {
    expect(rows).toHaveLength(2 * 47);
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
    "--color-faint-text",
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

  it.each(THEMES.flatMap((theme) => ["--color-surface-1", "--color-surface-2"].map((bg) => [theme, bg] as const)))(
    "%s --color-faint-text reads ≥ 4.5:1 on %s too (第八批:三种底上都达标)",
    (theme, bg) => {
      expect(contrastRatio(rgbOf(theme, "--color-faint-text"), rgbOf(theme, bg))).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(THEMES)("%s --color-warn (a dot and a 2px line, never text) is ≥ 3:1 on canvas", (theme) => {
    expect(contrastRatio(rgbOf(theme, "--color-warn"), rgbOf(theme, "--color-canvas"))).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)("%s: the five soul states are five different colours", (theme) => {
    const states = ["alive", "judging", "disposed", "reincarnating", "lost"].map((s) => rgbOf(theme, `--color-status-${s}`).join(","));
    expect(new Set(states).size).toBe(5);
  });
});

describe("the paired texts the spec measures", () => {
  /* v3 的深色埃及 / 希腊匾色托不住白字(3.99 / 4.16:1,v3 自己标「仅 ≥15px 粗体」),这里曾有一张
   * 大号文字例外表。v4 的 solid 是专门给白字配的深色(白字 5.62–9.46:1),例外表随之删掉 ——
   * 十格(含中性)一律按正文门槛。 */
  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("%s onMain on the %s solid ≥ 4.5:1", (theme, civ) => {
    expect(contrastRatio(rgbOf(theme, "--color-on-main"), rgbOf(theme, `--color-civ-${civ}`))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES.flatMap((theme) => CIVS.flatMap((civ) => ["--color-canvas", "--color-surface-1", "--color-surface-2"].map((bg) => [theme, civ, bg] as const))))(
    "%s %s text colour (civT) on %s ≥ 4.5:1",
    (theme, civ, bg) => {
      expect(contrastRatio(rgbOf(theme, `--color-civ-${civ}-ink`), rgbOf(theme, bg))).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(THEMES.flatMap((theme) => CIVS.flatMap((civ) => ["--color-canvas", "--color-surface-1"].map((bg) => [theme, civ, bg] as const))))(
    "%s %s metal mark on %s ≥ 3:1",
    (theme, civ, bg) => {
      expect(contrastRatio(rgbOf(theme, `--color-civ-${civ}-metal`), rgbOf(theme, bg))).toBeGreaterThanOrEqual(3);
    }
  );

  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("%s ink and ink-muted on the %s side ≥ 4.5:1", (theme, civ) => {
    for (const fg of ["--color-ink", "--color-ink-muted"]) {
      expect(contrastRatio(rgbOf(theme, fg), rgbOf(theme, `--color-civ-${civ}-side`))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("solid 托不住文明色的字、也托不住 3px 标:深色 solid 对 surface-1 不到 3:1 —— 字用 civT、标用 metal 是承重的", () => {
    for (const civ of ["cn", "eu", "eg", "gr"]) {
      expect(contrastRatio(rgbOf("dark", `--color-civ-${civ}`), rgbOf("dark", "--color-surface-1"))).toBeLessThan(3);
    }
  });

  it.each(THEMES)("%s neg.onBg on neg.bg ≥ 4.5:1, and white on neg.strong ≥ 4.5:1", (theme) => {
    expect(contrastRatio(rgbOf(theme, "--color-danger-on-tint"), rgbOf(theme, "--color-danger-tint"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio([255, 255, 255], rgbOf(theme, "--color-danger-strong"))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("%s input border (faint) on s1 ≥ 3:1 — the line token would not be", (theme) => {
    expect(contrastRatio(rgbOf(theme, "--color-line-strong"), rgbOf(theme, "--color-surface-1"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(rgbOf(theme, "--color-line"), rgbOf(theme, "--color-surface-1"))).toBeLessThan(3);
  });
});

/** 文明皮的五个通用名,`[data-civ="x"]` 把它们各自指到 `--color-civ-x` 加这个后缀。 */
const CIV_SLOTS: Record<string, string> = {
  "--color-main": "",
  "--color-main-ink": "-ink",
  "--color-glow": "-glow",
  "--color-metal": "-metal",
  "--color-side": "-side",
};

/** `[data-civ="x"] { … }` 的声明(注释已剥掉);`.seal[data-civ="eu"]` 这类形状规则不带自定义属性,不计。 */
function civBlocks(): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const b of CSS.matchAll(/(?<![\w.-])\[data-civ="(\w+)"\]\s*\{([^}]*)\}/g)) {
    const decls: Record<string, string> = { ...(out.get(b[1]) ?? {}) };
    for (const d of b[2].replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
    out.set(b[1], decls);
  }
  return out;
}

describe("civilization colour enters through [data-civ] only (规范 v4,用户 2026-11-06)", () => {
  it("no [data-civ] (before login) is the neutral skin, slot by slot", () => {
    for (const [slot, suffix] of Object.entries(CIV_SLOTS)) expect(ROOT_TOKENS[slot]).toBe(`var(--color-civ-neutral${suffix})`);
  });

  it("each [data-civ] block points the five slots at its own civilization and sets nothing else", () => {
    const blocks = civBlocks();
    expect([...blocks.keys()].sort()).toEqual(["cn", "eg", "eu", "gr"]);
    for (const [civ, decls] of blocks) {
      const want = Object.fromEntries(Object.entries(CIV_SLOTS).map(([slot, suffix]) => [slot, `var(--color-civ-${civ}${suffix})`]));
      expect({ civ, decls }).toEqual({ civ, decls: want });
    }
  });

  it("accent, accent-ink and focus follow the civilization's text colour, and only under [data-civ]", () => {
    // `[data-civ]` 单独成块的有两处:这一块,和 base 层 `:root, [data-civ]` 的 `--main-fill`。取声明了 accent 的那一块。
    const generic = [...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?<![\w.\]-])\[data-civ\]\s*\{([^}]*)\}/g)].filter((b) => /--color-accent\s*:/.test(b[1]));
    expect(generic).toHaveLength(1);
    const decls = Object.fromEntries([...generic[0][1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
    expect(decls).toEqual({
      "--color-accent": "var(--color-main-ink)",
      "--color-accent-ink": "var(--color-main-ink)",
      "--color-focus": "var(--color-main-ink)",
    });
  });

  it("no source file reads a civ token directly — they go through the five slots", () => {
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
