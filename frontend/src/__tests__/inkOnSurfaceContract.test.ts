/**
 * @jest-environment node
 *
 * Every text colour on every ground text can sit on, in both themes, ≥ 4.5:1
 * (WCAG 2.x AA, normal text) — measured from globals.css, not assumed.
 *
 * The grounds follow 规范 v1 §1.1's roles:
 * - canvas, surface-1, surface-2 carry text (page, inputs / insets, hovered and
 *   selected rows, the current nav item, the batch bar) → the whole ink family
 *   and every semantic text colour;
 * - the three tints carry a message in their own colour (error bar = danger on
 *   danger-tint, …) plus ink / ink-muted;
 * - surface-3 is the pressed state and the skeleton block: NO text. ink-subtle
 *   measures 4.08:1 on it in light — putting a label there is a real defect,
 *   and `SURFACE_3_HAS_NO_TEXT` below keeps that fact next to the matrix.
 *
 * The ink family is derived from the stylesheet (`--color-ink` + every
 * `--color-ink-*`), so a dimmer ink added tomorrow joins the matrix unasked.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  FRONTEND_ROOT,
  GLOBALS_CSS,
  ROOT_TOKENS,
  THEMES,
  TOKENS_BY_THEME,
  contrastRatio,
  oklchTripleToRgb,
  resolveTriple,
  suffixesOf,
  type Rgb,
  type ThemeName,
} from "./support/globalsCssTokens";

const AA_NORMAL_TEXT = 4.5;

const INK_TOKENS: string[] = ["--color-ink", ...suffixesOf(ROOT_TOKENS, "--color-ink").map((s) => `--color-ink-${s}`)];
const SEMANTIC_TEXT = ["--color-accent", "--color-danger", "--color-success", "--color-warning"];
const TEXT_GROUNDS = ["--color-canvas", "--color-surface-1", "--color-surface-2"];
const TINTS: [string, string][] = [
  ["--color-danger-tint", "--color-danger"],
  ["--color-success-tint", "--color-success"],
  ["--color-warning-tint", "--color-warning"],
];

const ratio = (theme: ThemeName, fg: string, bg: string) =>
  contrastRatio(
    oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], fg)),
    oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], bg))
  );

/**
 * 已知不过 AA 的格子。曾有一格:浅色警示 #A65000 在 s2 上 4.29:1;Design D3 把浅色警示改成
 * #9F4A00(s2 上 4.69),例外随之删除。下面那条「例外仍低于 AA」的测试保证例外不会在色值
 * 修好后还留着。
 */
const KNOWN_BELOW_AA: ReadonlyArray<readonly [ThemeName, string, string]> = [];
const isKnown = (theme: ThemeName, fg: string, bg: string) =>
  KNOWN_BELOW_AA.some(([t, f, b]) => t === theme && f === fg && b === bg);

const FULL_MATRIX = THEMES.flatMap((theme) => [
  ...TEXT_GROUNDS.flatMap((bg) => [...INK_TOKENS, ...SEMANTIC_TEXT].map((fg) => [theme, fg, bg] as const)),
  ...TINTS.flatMap(([bg, own]) => ["--color-ink", "--color-ink-muted", own].map((fg) => [theme, fg, bg] as const)),
]);
const MATRIX = FULL_MATRIX.filter(([theme, fg, bg]) => !isKnown(theme, fg, bg));

describe("ink on surface", () => {
  it("the matrix is the size it should be (derived lists that go empty pass everything)", () => {
    expect(INK_TOKENS).toEqual(expect.arrayContaining(["--color-ink", "--color-ink-muted", "--color-ink-subtle"]));
    expect(FULL_MATRIX).toHaveLength(THEMES.length * (TEXT_GROUNDS.length * (INK_TOKENS.length + SEMANTIC_TEXT.length) + TINTS.length * 3));
    expect(MATRIX).toHaveLength(FULL_MATRIX.length - KNOWN_BELOW_AA.length);
  });

  it("every known exception is still below AA (else delete it)", () => {
    for (const [theme, fg, bg] of KNOWN_BELOW_AA) expect({ theme, fg, bg, below: ratio(theme, fg, bg) < AA_NORMAL_TEXT }).toEqual({ theme, fg, bg, below: true });
  });

  it.each(MATRIX)("%s: %s on %s ≥ 4.5:1", (theme, fg, bg) => {
    expect(ratio(theme, fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("SURFACE_3_HAS_NO_TEXT: the subtle ink really does fail there, so the rule is load-bearing", () => {
    expect(ratio("light", "--color-ink-subtle", "--color-surface-3")).toBeLessThan(AA_NORMAL_TEXT);
  });
});


/* ──────────────────────────────────────────────────────────────────────────
 * 渲染后的对比度与 main 的用法(Design 第六十三批「对比度守卫的规定」,2026-10-29)。
 * 上面的矩阵只量「token 对 token」;这里补它看不见的那一类,规定有四条:
 *   1. main 只做底色、指示条、描边和印章,不做文字色(两主题,字号不限)。
 *   2. 深色里 main 作底、上面有字,一律用加深那一档(`color-mix(in srgb, main 90%, #111)`,
 *      身份带与主按钮同一个颜色),上面的字只用 on-main。
 *   3. 文字不用 opacity 降级 —— 要次要就换 ink-muted。
 *   4. 文字 ≥ 4.5:1;指示条、描边这类非文字元素对相邻底色 ≥ 3:1。四文明 × 两主题。
 * 数值格在下面的 RENDERED;1–3 是源码扫描,在再下面一组。这里没有白名单:第六十三批的五处
 * (底栏当前项、身份带小字、键帽、主按钮、「禁授」)都已按回复改掉,不达标的格子就红。
 * ────────────────────────────────────────────────────────────────────────── */
const AA_NON_TEXT = 3;
const CIVS = ["cn", "eu", "eg", "gr"] as const;
const CSS = readFileSync(GLOBALS_CSS, "utf8");
const stripCode = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rgbOf = (theme: ThemeName, name: string): Rgb => oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], name));
/** `color-mix(in srgb, main p, #111)`,与浏览器一样在 gamma sRGB 上逐通道混。 */
const mixWith111 = (rgb: Rgb, p: number): Rgb => rgb.map((v) => Math.round(v * p + 17 * (1 - p))) as unknown as Rgb;
const pct = (raw: string | undefined, what: string): number => {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(raw ?? "");
  if (m === null) throw new Error(`${what} 不是百分比:${raw} —— 修读取器,别删这条检查`);
  return Number(m[1]) / 100;
};
/** 身份带底的比例,读 globals.css 那一行(plaqueTitleStaysLargeText 读的也是它)。 */
const BAND_PCT = pct(/\.identity-band\s*\{[^}]*background:\s*color-mix\(in srgb, oklch\(var\(--color-main\)\) ([\d.]+%), #111\)/.exec(CSS)?.[1], ".identity-band 的 background");
/** 主按钮底 `--main-fill`(Button.tsx primary 读它):深色那一块必须与身份带底逐字相同,浅色就是 main。 */
const mainFillIn = (selector: string): string | undefined =>
  new RegExp(`${selector}\\s*\\{[^}]*--main-fill:\\s*([^;]+);`).exec(stripCode(CSS))?.[1].trim();
const MAIN_FILL = {
  dark: mainFillIn(":root,\\s*\\[data-civ\\]"),
  light: mainFillIn(":root\\.light,\\s*\\.light \\[data-civ\\]"),
};
const BAND_BG = /\.identity-band\s*\{[^}]*background:\s*([^;]+);/.exec(CSS)?.[1].trim();
const fillOf = (theme: ThemeName, main: Rgb): Rgb => (theme === "dark" ? mixWith111(main, BAND_PCT) : main);

type Cell = { key: string; ratio: number; min: number };
const cellOf = (key: string, fg: Rgb, bg: Rgb, min = AA_NORMAL_TEXT): Cell => ({ key, ratio: contrastRatio(fg, bg), min });

const RENDERED: Cell[] = THEMES.flatMap((theme) => {
  const onMain = rgbOf(theme, "--color-on-main");
  const surface1 = rgbOf(theme, "--color-surface-1");
  return CIVS.flatMap((civ) => {
    const main = rgbOf(theme, `--color-civ-${civ}`);
    return [
      // 3px 指示条(侧栏左标、底栏顶标、行首色标)对 surface-1:非文字,3:1。
      cellOf(`${theme}:main-${civ} mark on surface-1`, main, surface1, AA_NON_TEXT),
      // 身份带上的字(题字之外:品牌、殿名、「案号」11 / 12px),纯白不透明。
      cellOf(`${theme}:on-main on band-${civ}`, onMain, mixWith111(main, BAND_PCT)),
      // 主按钮上的字与按钮里的键帽 ⌘⏎ / ⌘S,纯白不透明;13–15px 不是大字。
      cellOf(`${theme}:on-main on primary-${civ}`, onMain, fillOf(theme, main)),
    ];
  });
});

describe("渲染后的对比度(指示条 / 身份带 / 主按钮,四文明 × 两主题)", () => {
  it("矩阵的大小对,键不重复(派生列表变空会让一切放行)", () => {
    expect(RENDERED).toHaveLength(THEMES.length * CIVS.length * 3);
    expect(new Set(RENDERED.map((c) => c.key)).size).toBe(RENDERED.length);
  });

  it.each(RENDERED.map((c) => [c.key, c] as const))("%s 达标", (_key, c) => {
    expect(c.ratio).toBeGreaterThanOrEqual(c.min);
  });

  it("深色主按钮与身份带是同一档加深色,浅色主按钮就是 main", () => {
    expect(BAND_PCT).toBe(0.9);
    expect(MAIN_FILL).toEqual({ dark: BAND_BG, light: "oklch(var(--color-main))" });
    expect(BAND_BG).toBe("color-mix(in srgb, oklch(var(--color-main)) 90%, #111)");
  });

  it("加深那一档是必需的:深色埃及 / 希腊的 main 本身托不住白字(规定 2 是承重的)", () => {
    for (const civ of ["eg", "gr"]) expect(contrastRatio(rgbOf("dark", "--color-on-main"), rgbOf("dark", `--color-civ-${civ}`))).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("main 作字色在深色 cn / eu 的 surface-1 上不到 4.5(规定 1 是承重的)", () => {
    for (const civ of ["cn", "eu"]) expect(contrastRatio(rgbOf("dark", `--color-civ-${civ}`), rgbOf("dark", "--color-surface-1"))).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("「禁授」垫的 canvas 实底上 ink-muted 达标,而直接压斜纹线(line)不达标 —— 字必须垫底", () => {
    for (const theme of THEMES) expect(ratio(theme, "--color-ink-muted", "--color-canvas")).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(ratio("light", "--color-ink-subtle", "--color-line")).toBeLessThan(AA_NORMAL_TEXT);
  });
});

/* ── 源码扫描:规定 1–3 ─────────────────────────────────────────────────── */
const SOURCE_DIRS = ["app", "src", "lib"].map((d) => path.join(FRONTEND_ROOT, d));
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(tsx?|css)$/.test(e.name) ? [full] : [];
  });
const SOURCES = SOURCE_DIRS.flatMap(sourceFiles).map((file) => ({
  rel: path.relative(FRONTEND_ROOT, file).split(path.sep).join("/"),
  code: stripCode(readFileSync(file, "utf8")),
}));
const filesMatching = (re: RegExp) => SOURCES.filter((s) => re.test(s.code)).map((s) => s.rel).sort();

/** main 作字色:Tailwind 的 `text-[oklch(var(--color-main)…)]` / `text-[color:…]`,CSS 的 `color: …--color-main`。 */
const MAIN_AS_TEXT = /\btext-\[(?:color:)?oklch\(var\(--color-main\)|(?<![-\w])color:\s*(?:oklch\()?var\(--color-main\)/;
/** 允许的:印(`.seal`,规定 1 里的「印章」:描边印,印文随边框同色)。 */
const MAIN_AS_TEXT_ALLOWED = ["app/globals.css"];
/** main 的原色作底:只给不带字的标记(3px 指示条、拓扑图上的点);带字的底用 Button 的加深档。 */
const MAIN_RAW_FILL = /\bbg-\[oklch\(var\(--color-main\)\)|(?<![-\w])background(?:-color)?:\s*oklch\(var\(--color-main\)\)/;
const MAIN_RAW_FILL_ALLOWED: Record<string, string> = {
  "app/workflow/[id]/page.tsx": "当前节点的 3px 左标",
  "src/components/judgment/RowMark.tsx": "行首 3px 色标",
  "src/components/layout/GlobalNav.tsx": "侧栏左标 / 底栏顶标,3px",
  "src/components/realms/RouteTopology.tsx": "路线拓扑上当前站的点(10 / 12px 方块,无字)",
};

describe("main 的用法与文字透明度(源码扫描)", () => {
  it("扫到了源码(空扫描会让一切放行)", () => {
    expect(SOURCES.length).toBeGreaterThan(300);
    expect(SOURCES.map((s) => s.rel)).toEqual(expect.arrayContaining(["app/globals.css", "src/components/ui/Button.tsx"]));
  });

  it("规定 1:main 不作文字色 —— 只有印(globals.css `.seal`)", () => {
    expect(filesMatching(MAIN_AS_TEXT)).toEqual(MAIN_AS_TEXT_ALLOWED);
    expect(/\.seal\s*\{[^}]*color:\s*oklch\(var\(--color-main\)\)/.test(CSS)).toBe(true);
    const outsideSeal = CSS.replace(/\.seal\s*\{[^}]*\}/g, "");
    expect(MAIN_AS_TEXT.test(stripCode(outsideSeal))).toBe(false);
  });

  it("规定 1 的扫描抓得到它要抓的写法", () => {
    for (const bad of ['className="text-[oklch(var(--color-main))]"', "className=\"text-[oklch(var(--color-main)/0.8)]\"", ".x { color: oklch(var(--color-main)); }", ".x { color: var(--color-main); }"])
      expect(MAIN_AS_TEXT.test(bad)).toBe(true);
    for (const ok of ['className="bg-[oklch(var(--color-main))]"', ".x { --slip-ink: oklch(var(--color-main)); border-color: oklch(var(--color-main)); }"])
      expect(MAIN_AS_TEXT.test(ok)).toBe(false);
  });

  it("规定 2:main 原色作底只给不带字的标记;主按钮走 `--main-fill`", () => {
    expect(filesMatching(MAIN_RAW_FILL)).toEqual(Object.keys(MAIN_RAW_FILL_ALLOWED).sort());
    const button = SOURCES.find((s) => s.rel === "src/components/ui/Button.tsx")!.code;
    expect(button).toContain("bg-(--main-fill)");
    expect(button).toContain("hover:bg-[color-mix(in_oklab,var(--main-fill)_88%,black)]");
  });

  it("规定 3:键帽 <kbd> 不带 opacity", () => {
    const kbds = SOURCES.flatMap((s) => [...s.code.matchAll(/<kbd\b[^>]*>/g)].map((m) => `${s.rel}: ${m[0]}`));
    expect(kbds.length).toBeGreaterThanOrEqual(5);
    expect(kbds.filter((k) => /\bopacity-/.test(k))).toEqual([]);
  });

  it("规定 3:身份带上的字(品牌 / 题字 / 殿名 / 案号)不带 opacity;纹样层不是字,可以", () => {
    const rules = [...stripCode(CSS).matchAll(/([^{}]*\.identity-[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    expect(rules.length).toBeGreaterThan(10);
    const withOpacity = rules.filter((r) => /(?<![-\w])opacity\s*:/.test(r.body)).map((r) => r.sel);
    expect(withOpacity).toEqual([".identity-pattern"]);
  });
});
