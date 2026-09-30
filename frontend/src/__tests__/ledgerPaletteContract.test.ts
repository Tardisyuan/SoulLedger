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

/** 规范 v3 的色表。v2「朱印」那张暖纸色的表整张换掉,来源是 Figma 项目
 * 「Modern SoulLedger Redesign」第七轮的「令牌」页与 `src/index.css`。
 *
 * v3 只定义 canvas / surface / ink / muted / line 五个中性角色与四个文明色,
 * 其余是本仓库多出来的档,按 globals.css 里写明的规则推导,**不是规范**:
 *   surface-2 / line-strong  保留 v2 的明度,色相彩度挪到 v3 的中性族
 *   surface-3 / rule / line  取 v3 的 line;block 取 v3 的 ink
 *   ink-muted / ink-subtle   都取 v3 的单一 muted
 * 状态色按用途对上 v3 的三档:danger ← v3 error、danger-strong ← v3 danger、
 * warning ← v3 warning;success 与长明灯 v3 没定义,连同各自 tint 原样保留。
 *
 * 两处有意偏离 v3,都为对比度(数字在 globals.css 的注释里):深色 danger-strong
 * 用 #c84c5a 而非 v3 的 #c94d5b(白字 4.47 → 4.53);浅色 warning 跟 v3 退回
 * #a65000(新底 #efefeb 上实测 4.83,v2 的羊皮纸底上曾是 4.40)。 */
const SPEC: Record<string, Record<ThemeName, string>> = {
  "--color-canvas": { light: "#efefeb", dark: "#10120f" },
  "--color-surface-1": { light: "#fbfbf8", dark: "#1a1d19" },
  "--color-surface-2": { light: "#e9eae5", dark: "#272a25" },
  "--color-line": { light: "#d1d3cd", dark: "#383c35" },
  "--color-line-strong": { light: "#5b5f59", dark: "#959a93" },
  "--color-block": { light: "#181a17", dark: "#f0f1ea" },
  "--color-ink": { light: "#181a17", dark: "#f0f1ea" },
  "--color-ink-muted": { light: "#646861", dark: "#a7aca4" },
  "--color-ink-subtle": { light: "#646861", dark: "#a7aca4" },
  "--color-pillar": { light: "#181a17", dark: "#070806" },
  "--color-on-main": { light: "#ffffff", dark: "#ffffff" },
  "--color-focus": { light: "#181a17", dark: "#f0f1ea" },
  "--color-success": { light: "#197037", dark: "#82CB92" },
  "--color-danger": { light: "#b42350", dark: "#ff7a9a" },
  "--color-danger-strong": { light: "#8f2430", dark: "#c84c5a" },
  "--color-danger-tint": { light: "#FFECEF", dark: "#33101A" },
  "--color-danger-on-tint": { light: "#8A0C33", dark: "#FFD3DC" },
  "--color-warning": { light: "#a65000", dark: "#e07a23" },
  "--color-success-tint": { light: "#E4FBE7", dark: "#102515" },
  "--color-warning-tint": { light: "#FFF1E2", dark: "#301904" },
  "--color-lamp": { light: "#6A3E00", dark: "#F2CC7A" },
  "--color-lamp-bg": { light: "#FBF1DC", dark: "#241B0C" },
  "--color-disabled-ink": { light: "#5b5f59", dark: "#959a93" },
  "--color-disabled-surface": { light: "#e9eae5", dark: "#272a25" },
  "--color-civ-neutral": { light: "#262925", dark: "#656962" },
  "--color-civ-cn": { light: "#8f3329", dark: "#ad4b40" },
  "--color-civ-eu": { light: "#583875", dark: "#80609a" },
  "--color-civ-eg": { light: "#294a8a", dark: "#5f7fbe" },
  "--color-civ-gr": { light: "#285051", dark: "#5a8480" },
};

const CIVS = ["neutral", "cn", "eu", "eg", "gr"] as const;

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
const rgbOf = (theme: ThemeName, name: string): Rgb => oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], name));
const CSS = readFileSync(path.join(FRONTEND_ROOT, "app", "globals.css"), "utf8");

describe("palette (规范 v3)", () => {
  const rows = THEMES.flatMap((theme) => Object.keys(SPEC).map((name) => [theme, name] as const));

  it("covers every spec token in both themes (a short list checks nothing)", () => {
    expect(rows).toHaveLength(2 * 29);
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
  /* v2 的匾色四个文明在两套主题下白字都过 4.5:1。**v3 不是** —— 它自己的令牌页
   * 就把深色埃及与深色希腊标成「仅 ≥15px 粗体」:
   *   --civil-egypt  白字 8.60:1 / 3.99:1(仅 ≥15px 粗体)
   *   --civil-greece 白字 8.91:1 / 4.16:1(仅 ≥15px 粗体)
   * 这里实测出来的正是 3.99 与 4.16,与 v3 写的逐位相同,所以不是色值抄错,
   * 是 v3 有意用了 WCAG 的大号文字门槛(≥18.66px 常规或 ≥14px 粗体,3:1)。
   *
   * 于是门槛按主题分开,而不是整体放松到 3:1 —— 放松到 3 会让另外六格也失去保护。
   * **代价是一条落到组件上的硬约束**:深色下埃及与希腊的匾题字不得小于 15px、
   * 不得低于粗体。那一条这份测试查不到(它只看色值),要在匾的组件里另立守卫;
   * 在那之前它只是一条写下来的约定,不是被执行的规则。 */
  const LARGE_TEXT_ONLY = new Set(["dark:eg", "dark:gr"]);

  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("%s onMain on the %s plaque", (theme, civ) => {
    const ratio = contrastRatio(rgbOf(theme, "--color-on-main"), rgbOf(theme, `--color-civ-${civ}`));
    if (LARGE_TEXT_ONLY.has(`${theme}:${civ}`)) {
      // 大号文字门槛,且要真的比 4.5 低 —— 否则这一格该回到上面那条,名单里不该有它。
      expect(ratio).toBeGreaterThanOrEqual(3);
      expect(ratio).toBeLessThan(4.5);
    } else {
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
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
  const SKIN_ASSETS = /^--(band|band-compact|band-tex|band-tex-w|seal-body|seal-ring|seal-line|seal-line-small|seal-scan|section|font-plaque|font-seal)$/;

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
