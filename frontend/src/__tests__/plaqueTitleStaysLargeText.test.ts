/**
 * @jest-environment node
 *
 * 身份带题字必须始终是 WCAG 意义上的「大号文字」,而它的白字对比度按真实底色量。
 *
 * 为什么这条规则存在。规范 v3 的四个文明色里,**深色埃及 #5f7fbe 与深色希腊
 * #5a8480 上的白字达不到 4.5:1** —— 实测 3.99:1 与 4.16:1,与 v3 自己令牌页上
 * 写的两个数逐位相同。v3 把这两格标成「仅 ≥15px 粗体」,也就是退到 WCAG 的大号
 * 文字门槛 3:1。`ledgerPaletteContract` 因此对这两格只断言 ≥3,并同时断言它确实 <4.5。
 * (v4,2026-11-06:文明的 solid 换成专给白字配的深色,十格白字都在 5.6:1 以上,那张例外表已删;
 * 题字仍守大号文字,是因为身份带题字的字阶本来就是大字,不再是为了借 3:1。)
 *
 * 那条放松是有代价的,而代价落在这里:**只要题字掉到大号文字以下,这两个文明的页头
 * 就成了真正的对比度不足**,而色板那份测试看不见字号,它只量颜色。
 *
 * v3 身份带(2026-10-01)的底色不是文明色本身,而是 `color-mix(in srgb, 文明色 90%, #111)`
 * —— 压暗 10%,白字对比度因此**变高**。下面第二组按 globals.css 里那一行真实的百分比与
 * 混入色重算四文明 × 两主题,并把结果钉住:每一格 ≥ 4.5 的就按正文门槛断言,不再借
 * 大号文字的 3:1。哪一天有人把混入比例调淡、或换了混入色,掉回 4.5 以下的那一格会红,
 * 红在「这格只剩大号文字可用」上,而不是静默。
 *
 * 门槛用 WCAG 的定义,不用 v3 那句「≥15px 粗体」:大号文字 = ≥18.66px(14pt)
 * 常规字重,**或** ≥14px 粗体(≥700)。
 *
 * 读的是 `Plaque.tsx` 的 TIER_CLASS 与 `globals.css` 的字阶,不是抄来的数字:
 * 新加一档、或把某一档的字号调小,这里都会红。
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
const PLAQUE = readFileSync(
  path.join(FRONTEND_ROOT, "src", "components", "plaque", "Plaque.tsx"),
  "utf8",
);

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

/** Plaque.tsx 的 TIER_CLASS,按档序:每档的 `text-*` 档名与整行类名。 */
function tiers(): { name: string; line: string }[] {
  const block = /const TIER_CLASS = \[([\s\S]*?)\] as const;/.exec(PLAQUE);
  if (block === null) {
    throw new Error("Plaque.tsx 里找不到 TIER_CLASS —— 身份带改了结构,跟着改这个读取器");
  }
  return block[1]
    .split("\n")
    .map((line) => ({ line, name: /\btext-([a-z0-9-]+)\b/.exec(line)?.[1] }))
    .filter((t): t is { name: string; line: string } => t.name !== undefined);
}

/** WCAG 2.2 §1.4.3 的大号文字:≥18.66px 常规,或 ≥14px 粗体。 */
const isLargeText = (size: number, w: number) => size >= 18.66 || (size >= 14 && w >= 700);

describe("身份带题字始终是大号文字,且是 Noto Serif SC 600", () => {
  const scales = tiers();

  it("读到了全部三档,而不是零档", () => {
    // 零档会让下面的 it.each 一条都不跑、整份测试照样绿 —— 正是这份测试要防的那种失效。
    expect(scales.map((t) => t.name)).toEqual(["display", "xl", "lg"]);
  });

  it.each(scales.map((t, tier) => [tier, t.name, t.line] as const))(
    "第 %s 档(text-%s)够大,字族是 font-title,字重 600",
    (_tier, name, line) => {
      const size = px(name);
      const w = /\bfont-semibold\b/.test(line) ? 600 : weight(name);
      expect({ name, size, weight: w, large: isLargeText(size, w), title: /\bfont-title\b/.test(line) }).toEqual({
        name,
        size,
        weight: 600,
        large: true,
        title: true,
      });
    },
  );

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

/** `.identity-band { … background: color-mix(in srgb, oklch(var(--color-main)) 90%, #111); }` → 0.9 与 [17,17,17]。 */
function bandMix(): { pct: number; shade: Rgb } {
  const rule = /\n {2}\.identity-band \{([^}]*)\}/.exec(CSS)?.[1];
  const m = rule && /background:\s*color-mix\(in srgb, oklch\(var\(--color-main\)\) (\d+)%, #([0-9a-f]{3})\);/.exec(rule);
  if (!m) throw new Error("globals.css 的 .identity-band 不是 color-mix(in srgb, main N%, #xxx) —— 跟着改这个读取器");
  const shade = [...m[2]].map((h) => parseInt(h + h, 16)) as unknown as Rgb;
  return { pct: Number(m[1]) / 100, shade };
}

/** `color-mix(in srgb, a p, b)`:在 gamma 编码的 sRGB 里线性插值(CSS Color 5)。 */
const mixSrgb = (a: Rgb, b: Rgb, p: number): Rgb =>
  a.map((v, i) => Math.round(v * p + b[i] * (1 - p))) as unknown as Rgb;

const CIVS = ["cn", "eu", "eg", "gr"] as const;
const rgb = (theme: (typeof THEMES)[number], name: string): Rgb =>
  oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], name));

/**
 * 实测值(2026-11-06,规范 v4 的 solid,`color-mix(main 90%, #111)`),两位小数,
 * 用与本测试同一套换算(globalsCssTokens)离线算出,未在 jest 里跑过:
 *
 *            地府   欧洲   埃及   希腊
 *   深色     9.48  10.26   9.35   9.37
 *   浅色     6.57   7.20   6.42   6.45
 *
 * v3 时是 深 6.27 / 5.95 / 4.66 / 4.82、浅 8.75 / 10.23 / 9.48 / 9.71:v4 的深色 solid 更暗,
 * 浅色 solid 更亮(浅色 solid 本身就是主按钮底,白字 5.62–6.39)。
 */
const MEASURED: Record<string, number> = {
  "dark:cn": 9.48, "dark:eu": 10.26, "dark:eg": 9.35, "dark:gr": 9.37,
  "light:cn": 6.57, "light:eu": 7.2, "light:eg": 6.42, "light:gr": 6.45,
};

describe("身份带底色(文明色压暗 10%)上的白字", () => {
  const { pct, shade } = bandMix();

  it("读到的混入就是 v3 的 90% / #111", () => {
    expect({ pct, shade }).toEqual({ pct: 0.9, shade: [17, 17, 17] });
  });

  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("%s · %s ≥ 4.5:1,且等于实测表", (theme, civ) => {
    const band = mixSrgb(rgb(theme, `--color-civ-${civ}`), shade, pct);
    const ratio = contrastRatio(rgb(theme, "--color-on-main"), band);
    expect(Number(ratio.toFixed(2))).toBe(MEASURED[`${theme}:${civ}`]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("混入确实让白字更清楚:每一格都比未混入的文明色高", () => {
    for (const theme of THEMES) {
      for (const civ of CIVS) {
        const raw = contrastRatio(rgb(theme, "--color-on-main"), rgb(theme, `--color-civ-${civ}`));
        const band = contrastRatio(rgb(theme, "--color-on-main"), mixSrgb(rgb(theme, `--color-civ-${civ}`), shade, pct));
        expect(band).toBeGreaterThan(raw);
      }
    }
  });
});

/**
 * 灵魂详情身份带上的案号与「全部 N 场」是 `<a>`,不是 `<button>`:按钮继承带上的白字,而 base 层的
 * `a` 规则把链接染成 ink-muted(悬停 accent-ink)。上面那组只量白字,看不见这件事 —— 所以这里按
 * globals.css 决定链接**实际**是什么颜色,再量。`.identity-band` 在 utilities 层,压得过 base 层
 * 的 `a` 和它的 :hover,所以有这条 `color: inherit` 就是白字,没有就落回 base 的颜色。
 */
function bandLinkToken(): string {
  if (/color:\s*inherit;/.test(ruleBody(".identity-band a"))) return "--color-on-main";
  const base = /\n {2}a \{\s*@apply text-\[oklch\(var\((--color-[a-z-]+)\)\)\]/.exec(CSS)?.[1];
  if (!base) throw new Error("globals.css 的 base `a` 规则改了形状 —— 跟着改这个读取器");
  return base;
}

describe("身份带上的链接(案号)", () => {
  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("%s · %s ≥ 4.5:1", (theme, civ) => {
    const { pct, shade } = bandMix();
    const band = mixSrgb(rgb(theme, `--color-civ-${civ}`), shade, pct);
    expect({ token: bandLinkToken(), ok: contrastRatio(rgb(theme, bandLinkToken()), band) >= 4.5 }).toEqual({
      token: "--color-on-main",
      ok: true,
    });
  });

  // v4(2026-11-06):深色带更暗,base 的 ink-muted 压在上面是 4.60–5.05,四格碰巧过了;浅色四格是 1.0–1.1。
  // 所以这条现在只断言浅色那四格 —— 浅色仍让 `color: inherit` 承重。
  it("base 的 `a` 颜色确实托不住(浅色):这条规则是承重的,不是多余的", () => {
    const base = /\n {2}a \{\s*@apply text-\[oklch\(var\((--color-[a-z-]+)\)\)\]/.exec(CSS)?.[1] as string;
    const { pct, shade } = bandMix();
    const under = CIVS.filter((civ) => contrastRatio(rgb("light", base), mixSrgb(rgb("light", `--color-civ-${civ}`), shade, pct)) < 4.5);
    expect(under).toHaveLength(CIVS.length);
  });
});

/**
 * 印(规范 v3 描边印)是图形,门槛是 WCAG 1.4.11 的 3:1。它是 currentColor:身份带上随带上的
 * 白字(`.identity-band .seal { color: inherit }`),别处是文明的字色 civT(`--color-main-ink`,v4 起;
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

/** globals.css 里某条两格缩进的规则体(`\n  .seal {` …)。 */
const ruleBody = (sel: string) => new RegExp(`\\n {2}${sel.replace(/[.]/g, "\\$&")} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? "";

describe("印的描边与印文 ≥ 3:1(图形)", () => {
  it("印是 currentColor 的文明字色,身份带上改随白字 —— 下面两组量的就是这两种颜色", () => {
    expect(ruleBody(".seal")).toMatch(/color: oklch\(var\(--color-main-ink\)\);[\s\S]*border: 2px solid currentColor;/);
    expect(ruleBody(".identity-band .seal")).toMatch(/color: inherit;/);
    expect(ruleBody(".identity-band")).toMatch(/color: oklch\(var\(--color-on-main\)\);/);
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

  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("身份带上 %s · %s 的白印 ≥ 3:1", (theme, civ) => {
    const { pct, shade } = bandMix();
    const ratio = contrastRatio(rgb(theme, "--color-on-main"), mixSrgb(rgb(theme, `--color-civ-${civ}`), shade, pct));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
