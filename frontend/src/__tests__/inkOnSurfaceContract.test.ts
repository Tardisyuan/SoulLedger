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
import {
  ROOT_TOKENS,
  THEMES,
  TOKENS_BY_THEME,
  compositeOver,
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
 * 渲染后的对比度。上面的矩阵只量「token 对 token」;下面三组补它看不见的那一类
 * (impeccable 扫描 2026-10-29 的三条新发现都在这里):
 *   A. `--color-main` 作字色 —— 四文明 × 两主题,落在它真实出现的底面上。唯一的出处是
 *      窄屏底栏当前项(GlobalNav.tsx `cell(current)`,12px semibold;底栏与它的抽屉都是 surface-1)。
 *   B. 白字 / ink × 0.7 透明度:身份带品牌与案号小字(globals.css `.identity-brand span`、
 *      `.identity-case[data-case] > span`,11px · 0.7,底是 main 压暗 10%)、主按钮上的键帽
 *      (白 × 0.7 叠 main)、页面上的键帽(`Kbd` 的 opacity-70,currentColor 是 ink 或 ink-muted)。
 *      合成同浏览器:gamma sRGB 上 source-over(`compositeOver`)。
 *   C. 字压斜纹:权限页「禁授」(PermissionMatrixTable.tsx `deny`,11px ink-subtle 压在 line 色
 *      1px 斜纹上),最差处就是字正好落在 line 上。
 * WCAG 1.4.3:正文 4.5,大字(≥ 18.66px,或 ≥ 14px 且 ≥ 700)3。这三组的字都是 11–12px,
 * 没有一格是大字,所以全部按 4.5;以后加进大字的格子用 AA_LARGE_TEXT。
 * ────────────────────────────────────────────────────────────────────────── */
const AA_LARGE_TEXT = 3;
const CIVS = ["cn", "eu", "eg", "gr"] as const;
const OPACITY = 0.7;
const rgbOf = (theme: ThemeName, name: string): Rgb => oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], name));
/** 身份带底:`color-mix(in srgb, main 90%, #111)`(数值由 plaqueTitleStaysLargeText 读 globals.css 钉住)。 */
const bandOf = (theme: ThemeName, civ: string): Rgb =>
  rgbOf(theme, `--color-civ-${civ}`).map((v) => Math.round(v * 0.9 + 17 * 0.1)) as unknown as Rgb;

type Cell = { key: string; ratio: number; min: number };
const cellOf = (key: string, fg: Rgb, bg: Rgb, min = AA_NORMAL_TEXT): Cell => ({ key, ratio: contrastRatio(fg, bg), min });

const RENDERED: Cell[] = THEMES.flatMap((theme) => {
  const onMain = rgbOf(theme, "--color-on-main");
  return [
    ...CIVS.map((civ) => cellOf(`${theme}:main-${civ} on surface-1`, rgbOf(theme, `--color-civ-${civ}`), rgbOf(theme, "--color-surface-1"))),
    ...CIVS.flatMap((civ) => {
      const band = bandOf(theme, civ);
      const main = rgbOf(theme, `--color-civ-${civ}`);
      return [
        cellOf(`${theme}:on-main×0.7 on band-${civ}`, compositeOver(onMain, band, OPACITY), band),
        cellOf(`${theme}:on-main×0.7 on main-${civ}`, compositeOver(onMain, main, OPACITY), main),
      ];
    }),
    ...["--color-ink", "--color-ink-muted"].flatMap((fg) =>
      TEXT_GROUNDS.map((bg) => cellOf(`${theme}:${fg}×0.7 on ${bg}`, compositeOver(rgbOf(theme, fg), rgbOf(theme, bg), OPACITY), rgbOf(theme, bg)))
    ),
    cellOf(`${theme}:--color-ink-subtle on --color-line (stripe)`, rgbOf(theme, "--color-ink-subtle"), rgbOf(theme, "--color-line")),
  ];
});

/**
 * 待 Design 定(2026-10-29 决定问 Design;这里不改配色 / 透明度 / 字阶)。每条写明位置与实测比值
 * (两位小数)。哪天某一格达标了,「仍不达标」那条会红 —— 删掉条目。不在这里的格子不达标就红。
 * E2E 侧同一批位置的白名单是 e2e/rendered-contrast.spec.ts 的 PENDING_DESIGN。
 */
const BOTTOM_BAR = "窄屏底栏当前项(GlobalNav.tsx `cell(current)`,12px semibold main 字)";
const BAND_SMALL = "身份带小字 11 · 0.7(globals.css `.identity-brand span`、`.identity-case[data-case] > span`)";
const KEYCAP_ON_MAIN = "主按钮上的键帽 ⌘⏎(JudgmentDeskStage.tsx `<Kbd>` 在 variant=primary 里,opacity-70)";
const KEYCAP = "键帽 opacity-70 叠 ink-muted(JudgmentDesk.tsx `Kbd`;JudgmentDeskStage「F」、JudgmentQueueConsole.tsx 同写法)";
const PENDING_DESIGN: ReadonlyArray<{ key: string; where: string; measured: number }> = [
  { key: "dark:main-cn on surface-1", where: BOTTOM_BAR, measured: 3.13 },
  { key: "dark:main-eu on surface-1", where: BOTTOM_BAR, measured: 3.29 },
  { key: "dark:main-eg on surface-1", where: BOTTOM_BAR, measured: 4.27 },
  { key: "dark:main-gr on surface-1", where: BOTTOM_BAR, measured: 4.09 },
  { key: "dark:on-main×0.7 on band-cn", where: BAND_SMALL, measured: 3.94 },
  { key: "dark:on-main×0.7 on band-eu", where: BAND_SMALL, measured: 3.85 },
  { key: "dark:on-main×0.7 on band-eg", where: BAND_SMALL, measured: 3.17 },
  { key: "dark:on-main×0.7 on band-gr", where: BAND_SMALL, measured: 3.26 },
  { key: "dark:on-main×0.7 on main-cn", where: KEYCAP_ON_MAIN, measured: 3.51 },
  { key: "dark:on-main×0.7 on main-eu", where: KEYCAP_ON_MAIN, measured: 3.45 },
  { key: "dark:on-main×0.7 on main-eg", where: KEYCAP_ON_MAIN, measured: 2.8 },
  { key: "dark:on-main×0.7 on main-gr", where: KEYCAP_ON_MAIN, measured: 2.9 },
  { key: "dark:--color-ink-muted×0.7 on --color-surface-1", where: KEYCAP, measured: 4.29 },
  { key: "dark:--color-ink-muted×0.7 on --color-surface-2", where: KEYCAP, measured: 3.87 },
  { key: "light:--color-ink-muted×0.7 on --color-canvas", where: KEYCAP, measured: 2.79 },
  { key: "light:--color-ink-muted×0.7 on --color-surface-1", where: KEYCAP, measured: 2.96 },
  { key: "light:--color-ink-muted×0.7 on --color-surface-2", where: KEYCAP, measured: 2.71 },
  {
    key: "light:--color-ink-subtle on --color-line (stripe)",
    where: "权限页「禁授」11px ink-subtle 压 line 斜纹(PermissionMatrixTable.tsx `deny`)",
    measured: 3.77,
  },
];

describe("渲染后的对比度(main 作字色 / × 0.7 / 斜纹)", () => {
  const pending = new Set(PENDING_DESIGN.map((p) => p.key));

  it("矩阵的大小对,键不重复(派生列表变空会让一切放行)", () => {
    expect(RENDERED).toHaveLength(THEMES.length * (CIVS.length * 3 + 2 * TEXT_GROUNDS.length + 1));
    expect(new Set(RENDERED.map((c) => c.key)).size).toBe(RENDERED.length);
  });

  it.each(PENDING_DESIGN.map((p) => [p.key, p] as const))("待 Design:%s 仍不达标且等于实测值(达标了就删条目)", (key, p) => {
    const c = RENDERED.find((x) => x.key === key);
    expect(c && { key, measured: Number(c.ratio.toFixed(2)), below: c.ratio < c.min }).toEqual({ key, measured: p.measured, below: true });
  });

  it.each(RENDERED.filter((c) => !pending.has(c.key)).map((c) => [c.key, c] as const))("%s 达标", (_key, c) => {
    expect(c.ratio).toBeGreaterThanOrEqual(c.min);
  });

  it("每一格的门槛都是 WCAG 的正文或大字门槛", () => {
    expect(RENDERED.every((c) => c.min === AA_NORMAL_TEXT || c.min === AA_LARGE_TEXT)).toBe(true);
  });
});
