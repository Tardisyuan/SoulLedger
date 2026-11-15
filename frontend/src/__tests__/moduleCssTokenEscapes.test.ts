/**
 * @jest-environment node
 *
 * CSS Modules read the design tokens; they do not restate them (fe-tokens §3.5, 2026-11-14).
 *
 * The eslint design guard reads class names and literals in tsx. The three `.module.css` files of the
 * 第三十批 desk / dossier / doors were outside its view, and on 2026-11-14 they held 47 px font sizes
 * (13px, 12px/16px, `font: 600 11px/1 …`) while tsx held zero `text-[Npx]`. They now read the register
 * tokens (`--juan-*`, `--tai-*`, `--door-*`, `--mark-glyph` in globals.css, source
 * packages/core/tokens/). This file counts what is still written out by hand, per file:
 *
 *   type      a px / rem / em font size or line height, or a `font:` shorthand with a px size
 *   hex       a hex colour
 *   radius    a px border radius (v4 has 4 / 6 / pill; desk 14 / 22, dossier 10, doors 8 / 5 are not on it)
 *   fallback  `var(--x, …)`: the fallback is a second copy of the value that never renders, so nobody
 *             sees it drift (desk's `--juan` fallback said --font-serif where the token says --font-title)
 *
 * The counts must EQUAL the baseline: a new escape fails, and so does a removed one until the baseline is
 * lowered to match, so the numbers only go down. A `.module.css` file not listed has a baseline of 0.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const WEB = path.join(__dirname, "..", "..");
const SKIP = new Set(["node_modules", ".next", "coverage", "e2e", "public"]);

const BASELINE: Record<string, { type: number; hex: number; radius: number; fallback: number }> = {
  "src/components/desk/desk.module.css": { type: 0, hex: 0, radius: 5, fallback: 8 },
  "src/components/dossier/dossier.module.css": { type: 0, hex: 0, radius: 2, fallback: 7 },
  "src/components/layout/doors.module.css": { type: 0, hex: 0, radius: 3, fallback: 5 },
};

const DETECTORS = {
  type: /(?:font-size|line-height)\s*:[^;]*\d(?:px|rem|em)\b|\bfont\s*:[^;]*\d(?:px|rem)\b/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  radius: /\bborder(?:-[a-z]+)*-radius\s*:[^;]*\d+px/g,
  fallback: /var\(--[\w-]+\s*,/g,
};

function escapesIn(css: string) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return Object.fromEntries(
    Object.entries(DETECTORS).map(([k, re]) => [k, (code.match(re) ?? []).length]),
  ) as Record<keyof typeof DETECTORS, number>;
}

function moduleCss(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : moduleCss(path.join(dir, e.name));
    return e.name.endsWith(".module.css") ? [path.join(dir, e.name)] : [];
  });
}

const FILES = moduleCss(WEB)
  .map((f) => path.relative(WEB, f).split(path.sep).join("/"))
  .sort();

describe(".module.css files read the tokens", () => {
  it("finds the module stylesheets (non-vacuity)", () => {
    expect(FILES).toEqual(expect.arrayContaining(Object.keys(BASELINE)));
  });

  it("each holds exactly its baseline of hand-written values", () => {
    const off = FILES.map((f) => {
      const have = escapesIn(readFileSync(path.join(WEB, f), "utf8"));
      const want = BASELINE[f] ?? { type: 0, hex: 0, radius: 0, fallback: 0 };
      return JSON.stringify(have) === JSON.stringify(want) ? null : `${f}: ${JSON.stringify(have)} (baseline ${JSON.stringify(want)})`;
    }).filter(Boolean);
    // More than the baseline: use a token (globals.css `--juan-*` / `--tai-*`, or add one in
    // packages/core/tokens/ and run scripts/build-tokens.mjs). Fewer: lower the baseline above.
    expect(off).toEqual([]);
  });
});

/* app/*.css 自己(设计参照 2026-11-15 §9,主会话确认 1):令牌块(`@tokens:start` … `@tokens:end`)之外,globals.css 与
 * 打印样式里也写着档外的值 —— 演示首页的 10 / 12 / 14px 圆角、10.5px 字号、`cubic-bezier(0.4, 0, 0.2, 1)`。此前没有守卫看这里。
 * 规则同上:数等于基线,只许变小(改成 `var(--radius-control)` / `var(--radius-panel)`、`var(--text-2xs)`、`var(--ease-*)` 后把基线降下来)。
 * 只数普通声明:`--radius-control: 4px` / `--ease-enter: cubic-bezier(…)` 这类令牌定义本身不算(`(?<![\w-])` 与 `(?!--)`)。
 * 打印样式按纸面排(pt / mm),字号不在屏幕的档上,不数 type。 */
const APP_BASELINE: Record<string, { type: number; radius: number; easing: number }> = {
  // 2026-11-15 实数。type 里有 4 处是触屏输入框的 16 / 24(那两条规则是有意的字面值)。
  "app/globals.css": { type: 21, radius: 23, easing: 8 },
};

const APP_DETECTORS = {
  type: /(?<![\w-])(?:font-size|line-height)\s*:[^;{}]*\d(?:px|rem|em)\b|(?<![\w-])font\s*:[^;{}]*\d(?:px|rem)\b/g,
  radius: /(?<![\w-])border(?:-[a-z]+)*-radius\s*:[^;{}]*\d+px/g,
  easing: /(?<![\w-])(?!--)[a-z-]+\s*:[^;{}]*cubic-bezier\(/g,
};

function appEscapesIn(css: string, kinds: (keyof typeof APP_DETECTORS)[] = ["type", "radius", "easing"]) {
  const start = css.indexOf("/* @tokens:start");
  const end = css.indexOf("/* @tokens:end");
  const outside = start >= 0 && end > start ? css.slice(0, start) + css.slice(end) : css;
  const code = outside.replace(/\/\*[\s\S]*?\*\//g, "");
  return Object.fromEntries(
    (Object.keys(APP_DETECTORS) as (keyof typeof APP_DETECTORS)[]).map((k) => [k, kinds.includes(k) ? (code.match(APP_DETECTORS[k]) ?? []).length : 0]),
  ) as Record<keyof typeof APP_DETECTORS, number>;
}

const PRINT = new Set(["app/print.css", "app/print-slip-ink.css", "app/verdict-doc.css"]);
const APP_FILES = readdirSync(path.join(WEB, "app"))
  .filter((f) => f.endsWith(".css"))
  .map((f) => `app/${f}`)
  .sort();

describe("app/*.css outside the token block reads the tokens too", () => {
  it("finds globals.css and its token block (non-vacuity)", () => {
    expect(APP_FILES).toContain("app/globals.css");
    expect(readFileSync(path.join(WEB, "app/globals.css"), "utf8")).toContain("/* @tokens:end");
  });

  it("each holds exactly its baseline of hand-written radius / size / easing", () => {
    const off = APP_FILES.map((f) => {
      const have = appEscapesIn(readFileSync(path.join(WEB, f), "utf8"), PRINT.has(f) ? ["radius", "easing"] : undefined);
      const want = APP_BASELINE[f] ?? { type: 0, radius: 0, easing: 0 };
      return JSON.stringify(have) === JSON.stringify(want) ? null : `${f}: ${JSON.stringify(have)} (baseline ${JSON.stringify(want)})`;
    }).filter(Boolean);
    expect(off).toEqual([]);
  });

  it.each([
    ["font-size: 10.5px;", "type"],
    ["border-radius: 14px;", "radius"],
    ["transition: opacity 160ms cubic-bezier(0.4, 0, 0.2, 1);", "easing"],
  ] as const)("%s → %s", (css, kind) => {
    expect(appEscapesIn(`.x { ${css} }`)[kind]).toBe(1);
  });

  it.each([
    "--text-2xs--line-height: 16px;",
    "--radius-control: 4px;",
    "--ease-enter: cubic-bezier(0.2, 0.8, 0.2, 1);",
    "border-radius: var(--radius-panel);",
    "transition: opacity var(--transition-duration-fast) var(--ease-standard);",
  ])("passes %s", (css) => {
    expect(appEscapesIn(`.x { ${css} }`)).toEqual({ type: 0, radius: 0, easing: 0 });
  });

  it("does not count inside the token block", () => {
    expect(appEscapesIn("/* @tokens:start */ .x { border-radius: 9px; } /* @tokens:end */")).toEqual({ type: 0, radius: 0, easing: 0 });
  });
});

describe("the detector rejects what it is here to catch", () => {
  it.each([
    ["font-size: 13px;", "type"],
    ["line-height: 20px;", "type"],
    ["font: 600 11px/1 var(--font-title);", "type"],
    ["font: var(--tai, 400 14px/22px var(--font-sans));", "type"],
    ["color: #E35D3F;", "hex"],
    ["border-radius: 10px;", "radius"],
    ["border-top-left-radius: 6px;", "radius"],
    ["height: var(--spine-h, 44px);", "fallback"],
  ] as const)("%s → %s", (css, kind) => {
    expect(escapesIn(`.x { ${css} }`)[kind]).toBe(1);
  });

  it.each([
    "font-size: var(--tai-label-size);",
    "line-height: var(--tai-label-leading);",
    "font: var(--juan);",
    "line-height: 1;",
    "color: oklch(var(--color-ink));",
    "border-radius: var(--radius-pill);",
    "/* font-size: 13px; #fff; border-radius: 4px */",
  ])("passes %s", (css) => {
    expect(escapesIn(`.x { ${css} }`)).toEqual({ type: 0, hex: 0, radius: 0, fallback: 0 });
  });
});
