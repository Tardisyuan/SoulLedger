/**
 * @jest-environment node
 *
 * 页头标题必须始终是 WCAG 意义上的「大号文字」,而页头上的字对比度按真实底色量。
 *
 * (文件名沿用身份带时代:v3 的身份带、v4 的标题行(`Plaque`,题字按实测宽度 28 → 20 → 20 两行降档)
 * 都在第三十批「卷宗」第 1 步撤掉了。现在只有一个页头 —— PageShell 的 `PageHead`:顶线 + 卷宗头,
 * 标题就是 `<h1>`,门页 `text-head` 24/32、卷宗页 `text-dossier` 32/40,不再降档、长的就换行。)
 *
 * 为什么这条规则存在。规范 v3 的四个文明色里,深色埃及与深色希腊上的白字达不到 4.5:1,v3 把这两格
 * 退到 WCAG 的大号文字门槛 3:1;那条放松的代价是「标题一旦掉到大号文字以下就成了真正的对比度不足」。
 * v4 起底是 canvas 上的一片文明光、字是 ink,十格都过 4.5;标题仍守大号文字,是因为页头标题本来就是大字,
 * 字阶一旦被调小,这里第一个红。
 *
 * 门槛用 WCAG 的定义:大号文字 = ≥18.66px(14pt)常规字重,**或** ≥14px 粗体(≥700)。
 *
 * 读的是 `PageShell.tsx` 里两个字面 `<h1>` 的类名与 `globals.css` 的字阶,不是抄来的数字。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  FRONTEND_ROOT,
  THEMES,
  TOKENS_BY_THEME,
  contrastRatio,
  oklchTripleToRgb,
  resolveTriple,
  type Rgb,
} from "./support/globalsCssTokens";

const CSS = readFileSync(path.join(FRONTEND_ROOT, "app", "globals.css"), "utf8");
const SHELL = readFileSync(path.join(FRONTEND_ROOT, "src", "components", "ui", "PageShell.tsx"), "utf8");

/** `--text-<name>: 20px;` → 20。找不到就抛,不要静默当成 0 放行。 */
function px(name: string): number {
  const m = new RegExp(`^\\s*--text-${name}:\\s*(\\d+(?:\\.\\d+)?)px;`, "m").exec(CSS);
  if (m === null) {
    throw new Error(`--text-${name} 不在 globals.css 里 —— 修这个读取器,不要删掉这条检查`);
  }
  return Number(m[1]);
}

/** 同名的 `--text-<name>--font-weight`,没声明就是继承来的常规字重。 */
function weight(name: string): number {
  const m = new RegExp(`^\\s*--text-${name}--font-weight:\\s*(\\d+);`, "m").exec(CSS);
  return m === null ? 400 : Number(m[1]);
}

/** PageShell.tsx 里每个字面 `<h1 className="…">`:它的 `text-*` 档名与整串类名。 */
function titles(): { name: string; line: string }[] {
  return [...SHELL.matchAll(/<h1 className="([^"]*)"/g)]
    .map((m) => ({ line: m[1], name: /(?<![\w-])text-(?!\[)([a-z0-9-]+)\b/.exec(m[1])?.[1] }))
    .filter((t): t is { name: string; line: string } => t.name !== undefined);
}

/** WCAG 2.2 §1.4.3 的大号文字:≥18.66px 常规,或 ≥14px 粗体。 */
const isLargeText = (size: number, w: number) => size >= 18.66 || (size >= 14 && w >= 700);

describe("页头标题始终是大号文字,且是 Noto Serif SC 600", () => {
  const scales = titles();

  it("读到了两种页头(门页、卷宗页),而不是零种", () => {
    // 零种会让下面的 it.each 一条都不跑、整份测试照样绿 —— 正是这份测试要防的那种失效。
    expect(scales.map((t) => t.name)).toEqual(["dossier", "head"]);
    expect([px("head"), px("dossier")]).toEqual([24, 32]);
  });

  it.each(scales.map((t) => [t.name, t.line] as const))("text-%s 够大,字族是 font-title,字重 600", (name, line) => {
    const size = px(name);
    const w = /\bfont-semibold\b/.test(line) ? 600 : weight(name);
    expect({ name, size, weight: w, large: isLargeText(size, w), title: /\bfont-title\b/.test(line) }).toEqual({
      name,
      size,
      weight: 600,
      large: true,
      title: true,
    });
  });

  it("判据本身是活的:18px 常规不算大号,14px 粗体算", () => {
    // 没有这一条,把 isLargeText 写成 `() => true` 上面全部照样绿。
    expect(isLargeText(18, 400)).toBe(false);
    expect(isLargeText(14, 700)).toBe(true);
    expect(isLargeText(13.9, 700)).toBe(false);
  });

  it("font-title 是 Noto Serif SC,且只有它这一支(中西文都由它出)", () => {
    const decl = /--font-title:\s*([^;]+);/.exec(CSS)?.[1].replace(/\s+/g, " ");
    expect(decl).toBe("'SoulLedger Glyphs', 'Noto Serif SC Variable', ui-serif, Georgia, serif");
  });
});

/** `color-mix(in srgb, fg p, transparent)` 叠在不透明的 bg 上:在 gamma 编码的 sRGB 里逐通道 fg·p + bg·(1−p)。 */
const over = (fg: Rgb, bg: Rgb, p: number): Rgb =>
  fg.map((v, i) => Math.round(v * p + bg[i] * (1 - p))) as unknown as Rgb;

const CIVS = ["cn", "eu", "eg", "gr"] as const;
const rgb = (theme: (typeof THEMES)[number], name: string): Rgb =>
  oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], name));

/** 第三十批 `--glowA`(深 .30 / 浅 .22)。读不到就抛:当成 0 = 没有光,对比度只会更好看,检查就失效了。 */
function glowAlpha(theme: (typeof THEMES)[number]): number {
  const raw = Number(TOKENS_BY_THEME[theme]["--glowA"]);
  if (!(raw > 0 && raw < 1)) throw new Error(`--glowA 在 ${theme} 读不到 —— 跟着改这个读取器`);
  return raw;
}

/**
 * 页头的光(`.page-head-glow`,v4 `.glowtop`):canvas 上的一片径向渐变,最亮处(圆心)= glow 按 --glowA 混进
 * canvas;字与印按这一处量 —— 别处的底更接近 canvas,只会更清楚。
 */
const bandBrightest = (theme: (typeof THEMES)[number], civ: (typeof CIVS)[number]): Rgb =>
  over(rgb(theme, `--color-civ-${civ}-glow`), rgb(theme, "--color-canvas"), glowAlpha(theme));

/** globals.css 里某条两格缩进的规则体(`\n  .seal {` …)。 */
const ruleBody = (sel: string) => new RegExp(`\\n {2}${sel.replace(/[.]/g, "\\$&")} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? "";

describe("页头(canvas 上的文明光)上的字", () => {
  it("读到的就是第三十批的光:glow × --glowA 的径向渐变,字是 ink,小字行是 ink-muted", () => {
    expect(ruleBody(".page-head")).toMatch(/color: oklch\(var\(--color-ink\)\);/);
    expect(ruleBody(".page-head-glow")).toMatch(
      /radial-gradient\(60% 100% at 24% 0%, color-mix\(in srgb, oklch\(var\(--color-glow\)\) calc\(var\(--glowA\) \* 100%\), transparent\), transparent 72%\);/,
    );
    expect(ruleBody(".page-head-meta")).toMatch(/color: oklch\(var\(--color-ink-muted\)\);/);
    expect(ruleBody(".page-head-glow")).not.toMatch(/--color-main/);
  });

  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))(
    "%s · %s:ink 与 ink-muted 在光最亮处都 ≥ 4.5:1",
    (theme, civ) => {
      expect(contrastRatio(rgb(theme, "--color-ink"), bandBrightest(theme, civ))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(rgb(theme, "--color-ink-muted"), bandBrightest(theme, civ))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("光确实压低了对比度(量的是有光的那一处,不是 canvas 本身)", () => {
    for (const theme of THEMES) {
      for (const civ of CIVS) {
        const plain = contrastRatio(rgb(theme, "--color-ink"), rgb(theme, "--color-canvas"));
        expect(contrastRatio(rgb(theme, "--color-ink"), bandBrightest(theme, civ))).toBeLessThan(plain);
      }
    }
  });

  it("小字行里的链接(灵魂详情的案号、「全部 N 场」)随小字的颜色,量的就是上面那一种", () => {
    expect(ruleBody(".page-head-meta a")).toMatch(/color:\s*inherit;/);
  });
});

/**
 * 印(规范 v3 描边印)是图形,门槛是 WCAG 1.4.11 的 3:1。它是 currentColor:v3 时身份带上随带上的
 * 白字,v4 起一律是文明的字色 civT(`--color-main-ink`,v4 起;
 * v3 时是匾色本身)—— 落在 canvas(审判队列的裁决条、判决页)或 surface-1(导航、确认层、印字弹窗)上。
 * 为什么不再是匾色:v4 的深色 solid 对 surface-1 只有约 2:1(ledgerPaletteContract 钉着),印会看不见。
 *
 * 实测(2026-11-06,civT;离线按同一套换算算出,未在 jest 里跑过),两位小数:
 *
 *                    地府   欧洲   埃及   希腊
 *   深色 canvas      7.07   5.86   9.45  13.42
 *   深色 surface-1   6.45   5.35   8.63  12.25
 *   浅色 canvas      5.77   5.02   8.33   5.96
 *   浅色 surface-1   6.13   5.33   8.86   6.34
 *
 * 最紧的一格是浅色欧洲在 canvas 上的 5.02。
 */
const SEAL_MEASURED: Record<string, number> = {
  "dark:--color-canvas:cn": 7.07, "dark:--color-canvas:eu": 5.86, "dark:--color-canvas:eg": 9.45, "dark:--color-canvas:gr": 13.42,
  "dark:--color-surface-1:cn": 6.45, "dark:--color-surface-1:eu": 5.35, "dark:--color-surface-1:eg": 8.63, "dark:--color-surface-1:gr": 12.25,
  "light:--color-canvas:cn": 5.77, "light:--color-canvas:eu": 5.02, "light:--color-canvas:eg": 8.33, "light:--color-canvas:gr": 5.96,
  "light:--color-surface-1:cn": 6.13, "light:--color-surface-1:eu": 5.33, "light:--color-surface-1:eg": 8.86, "light:--color-surface-1:gr": 6.34,
};

describe("印的描边与印文 ≥ 3:1(图形)", () => {
  it("印是 currentColor 的文明字色(v4 删了随白字的那条)—— 下面两组量的就是这一种颜色", () => {
    expect(ruleBody(".seal")).toMatch(/color: oklch\(var\(--color-main-ink\)\);[\s\S]*border: 2px solid currentColor;/);
    expect(CSS).not.toMatch(/\.identity-band \.seal\s*\{/);
  });

  it.each(
    THEMES.flatMap((theme) =>
      ["--color-canvas", "--color-surface-1"].flatMap((surface) => CIVS.map((civ) => [theme, surface, civ] as const)),
    ),
  )("%s · %s 上的 %s 印 ≥ 3:1,且等于实测表", (theme, surface, civ) => {
    const ratio = contrastRatio(rgb(theme, `--color-civ-${civ}-ink`), rgb(theme, surface));
    expect(Number(ratio.toFixed(2))).toBe(SEAL_MEASURED[`${theme}:${surface}:${civ}`]);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  // 顶线、纹样、水印与印同是 civT 画在这片光上(第三十批起页头不再放印,顶线与水印是同一种颜色)。
  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("页头光最亮处 %s · %s 的 civT ≥ 3:1", (theme, civ) => {
    expect(contrastRatio(rgb(theme, `--color-civ-${civ}-ink`), bandBrightest(theme, civ))).toBeGreaterThanOrEqual(3);
  });
});
