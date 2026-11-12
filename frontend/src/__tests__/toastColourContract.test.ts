/**
 * @jest-environment node
 *
 * 第三十批「卷宗」第 1 步的 toast(Design v4 第三十批第一节第 3 条):底一律 surface-2(card2),字 ink,
 * 语义色只在左侧 3px 色条与图标上。v3 的「实心 ink 底、失败实心冷玫红底」随之撤掉。
 *
 * 读 `app/globals.css` 的 `.toast`、`.toast[data-type=…]`、`.toast-icon` 几条规则,取出它们名字的
 * token,在两种主题下算对比度:字与图标是文字(≥ 4.5),成功 / 失败的色条与关闭按钮的焦点环是非文字(≥ 3)。
 * 缺席也断言:没有任何一种 toast 再换底色 —— 语义色回到底上就是 v3 那块实心底。
 */
import { readFileSync } from "node:fs";
import {
  GLOBALS_CSS,
  THEMES,
  TOKENS_BY_THEME,
  contrastRatio,
  oklchTripleToRgb,
  resolveTriple,
  type ThemeName,
} from "./support/globalsCssTokens";

const CSS = readFileSync(GLOBALS_CSS, "utf8");

/** 某条规则体里某个属性引用的那个 `--color-*` token 名。 */
function bodyOf(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
  const body = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1];
  if (body === undefined) throw new Error(`no rule ${selector} in globals.css`);
  return body;
}

function tokenOf(selector: string, property: string): string {
  const m = new RegExp(`(?:^|[\\s;])${property}:\\s*oklch\\(var\\((--color-[a-z0-9-]+)\\)\\)`).exec(bodyOf(selector));
  if (!m) throw new Error(`${selector} has no ${property}: oklch(var(--color-…))`);
  return m[1];
}

/** The bar colour a `.toast…` rule sets through `--toast-c: var(--color-…)`. */
function barOf(selector: string): string {
  const m = /--toast-c:\s*var\((--color-[a-z0-9-]+)\)/.exec(bodyOf(selector));
  if (!m) throw new Error(`${selector} sets no --toast-c`);
  return m[1];
}

const ratio = (theme: ThemeName, fg: string, bg: string) =>
  contrastRatio(
    oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], fg)),
    oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], bg))
  );

const TEXT = tokenOf(".toast", "color");
const BG = tokenOf(".toast", "background");
const RING = tokenOf(".toast-close:focus-visible", "outline-color");
const ICONS = {
  info: tokenOf(".toast-icon", "color"),
  success: tokenOf('.toast[data-type="success"] .toast-icon', "color"),
  error: tokenOf('.toast[data-type="error"] .toast-icon', "color"),
};
const BARS = { success: barOf('.toast[data-type="success"]'), error: barOf('.toast[data-type="error"]') };

describe("toast · 第三十批:一种底,语义色只在色条与图标", () => {
  it("底是 surface-2、字是 ink;成功 / 失败的色条与图标是同一个语义色", () => {
    expect(BG).toBe("--color-surface-2");
    expect(TEXT).toBe("--color-ink");
    expect(BARS).toEqual({ success: "--color-success", error: "--color-danger" });
    expect(ICONS).toEqual({ info: "--color-ink-muted", success: "--color-success", error: "--color-danger" });
  });

  it("没有哪一种 toast 换底色或字色(那是 v3 的实心底)", () => {
    for (const type of ["success", "error", "info"]) {
      const rule = new RegExp(`\\.toast\\[data-type="${type}"\\]\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? "";
      expect(rule).not.toMatch(/background|(?:^|[\s;])color:/);
    }
  });

  it("色条是 --toast-bar 粗的 inset 阴影,宽 360", () => {
    expect(bodyOf(".toast")).toMatch(/inset var\(--toast-bar\) 0 0 oklch\(var\(--toast-c\)\)/);
    expect(bodyOf("#toast-container")).toMatch(/width:\s*360px;/);
  });

  it.each(THEMES.flatMap((t) => [TEXT, ...Object.values(ICONS)].map((fg) => [t, fg] as const)))(
    "%s: %s 在底上 ≥ 4.5:1",
    (theme, fg) => {
      expect(ratio(theme, fg, BG)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(THEMES.flatMap((t) => [RING, ...Object.values(BARS)].map((fg) => [t, fg] as const)))(
    "%s: %s(非文字)在底上 ≥ 3:1",
    (theme, fg) => {
      expect(ratio(theme, fg, BG)).toBeGreaterThanOrEqual(3);
    }
  );
});
