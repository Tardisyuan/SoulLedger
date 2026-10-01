/**
 * 规范 v3 toast 的颜色:实心 ink 底、反白字;失败是实心冷玫红(--color-danger)底。
 *
 * 读 `app/globals.css` 的 `.toast` 与 `.toast[data-type="error"]` 两条规则,取出它们
 * 名字的 token,在两种主题下算对比度。要防的是一个已经量到的坑:深色主题的
 * --color-danger 是 #FF7A9A,白字在上面只有 2.47:1。字色若写成 #fff 或某个
 * 「两种主题都偏白」的 token,下面的深色那一格会红。
 *
 * 焦点环也算一对:全局 --color-focus 等于 --color-ink,压在 ink 底上看不见,所以
 * `.toast-close:focus-visible` 换成字色 —— 它要和两种底都分得开(非文字 3:1)。
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
function tokenOf(selector: string, property: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
  const body = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1];
  if (body === undefined) throw new Error(`no rule ${selector} in globals.css`);
  const m = new RegExp(`(?:^|[\\s;])${property}:\\s*oklch\\(var\\((--color-[a-z0-9-]+)\\)\\)`).exec(body);
  if (!m) throw new Error(`${selector} has no ${property}: oklch(var(--color-…))`);
  return m[1];
}

const ratio = (theme: ThemeName, fg: string, bg: string) =>
  contrastRatio(
    oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], fg)),
    oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], bg))
  );

const TEXT = tokenOf(".toast", "color");
const INK_BG = tokenOf(".toast", "background");
const ERROR_BG = tokenOf('.toast[data-type="error"]', "background");
const RING = tokenOf(".toast-close:focus-visible", "outline-color");

describe("toast · 规范 v3 的两种底", () => {
  it("普通 toast 是实心 ink 底,失败是实心冷玫红底", () => {
    expect(INK_BG).toBe("--color-ink");
    expect(ERROR_BG).toBe("--color-danger");
  });

  it("两种底共用一个字色,而且它不是写死的白", () => {
    // 不在 tokenOf 能读到的形状里(例如 `color: #fff`)会在上面抛错;这里再断言名字。
    expect(TEXT).toBe("--color-surface-1");
    expect(CSS).not.toMatch(/\.toast\[data-type="error"\]\s*\{[^}]*color:\s*#/);
  });

  it.each(THEMES.flatMap((t) => [[t, INK_BG] as const, [t, ERROR_BG] as const]))(
    "%s: 字色在 %s 上 ≥ 4.5:1",
    (theme, bg) => {
      expect(ratio(theme, TEXT, bg)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(THEMES.flatMap((t) => [[t, INK_BG] as const, [t, ERROR_BG] as const]))(
    "%s: 关闭按钮的焦点环在 %s 上 ≥ 3:1",
    (theme, bg) => {
      expect(ratio(theme, RING, bg)).toBeGreaterThanOrEqual(3);
    }
  );

  it("那个坑是真的:深色冷玫红上的白字不过 AA —— 所以字色不能是白", () => {
    const white = oklchTripleToRgb("1 0 0");
    const danger = oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME.dark, "--color-danger"));
    expect(contrastRatio(white, danger)).toBeLessThan(4.5);
  });
});
