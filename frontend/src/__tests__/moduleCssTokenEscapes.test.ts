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
  "src/components/desk/desk.module.css": { type: 0, hex: 0, radius: 6, fallback: 8 },
  "src/components/dossier/dossier.module.css": { type: 0, hex: 0, radius: 2, fallback: 10 },
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
