/**
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
  contrastRatio,
  oklchTripleToRgb,
  resolveTriple,
  suffixesOf,
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
 * 规范 v2 §二 的警示橙 #A65000 只对 bg 与 s1 量过对比(设计稿 `webBg = [bg, s1]`),
 * 放在浅色 s2(#ebe1cd)上是 4.29:1,过不了 AA。色值是 Design 定的,不在这里改;
 * 这一格记成例外 —— 规则因此是「警示字不放在 s2 上」—— 并在下面断言它**确实**不过,
 * 免得哪天色值改好了而例外还留着。已作为待定项报给 Design。
 */
const KNOWN_BELOW_AA: ReadonlyArray<readonly [ThemeName, string, string]> = [["light", "--color-warning", "--color-surface-2"]];
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

  it.each(KNOWN_BELOW_AA)("known exception still below AA (else delete it): %s %s on %s", (theme, fg, bg) => {
    expect(ratio(theme, fg, bg)).toBeLessThan(AA_NORMAL_TEXT);
  });

  it.each(MATRIX)("%s: %s on %s ≥ 4.5:1", (theme, fg, bg) => {
    expect(ratio(theme, fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("SURFACE_3_HAS_NO_TEXT: the subtle ink really does fail there, so the rule is load-bearing", () => {
    expect(ratio("light", "--color-ink-subtle", "--color-surface-3")).toBeLessThan(AA_NORMAL_TEXT);
  });
});
