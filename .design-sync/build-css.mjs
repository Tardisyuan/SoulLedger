// Compiles frontend/app/globals.css (Tailwind 4 source) into the plain CSS that
// design-sync ships as cfg.cssEntry. Run from the repo root before
// package-build.mjs:  node .design-sync/build-css.mjs
//
// Three things the Next build does that a static bundle has to do itself:
//   - Tailwind compile. Sources = Tailwind's auto-detection from frontend/,
//     plus .design-sync/previews so classes used only in previews exist.
//   - next/font. The --font-*-latin / plaque font variables are class names
//     next/font puts on <html>; here they are set on :root against Google
//     Fonts. The CJK stacks name the @fontsource families ("… Variable"); those
//     are rewritten to the Google Fonts family names.
//   - public/. url("/v2/…") assets are inlined as data URIs (designs have no
//     server root); the two local font files are copied next to the output so
//     the converter's extractFonts ships them under fonts/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const FE = join(ROOT, "frontend");
const SRC = join(FE, "app/globals.css");
const OUT_DIR = join(ROOT, ".design-sync/pkg/.generated/css");
const OUT = join(OUT_DIR, "soulledger.css");

const GOOGLE_FAMILIES = [
  "Archivo:wght@100..900",
  "Source+Serif+4:opsz,wght@8..60,200..900",
  "IBM+Plex+Mono:wght@400;500;600",
  "Noto+Sans+SC:wght@100..900",
  "Noto+Serif+SC:wght@200..900",
  "Noto+Sans+Egyptian+Hieroglyphs",
];
const googleUrl =
  "https://fonts.googleapis.com/css2?" + GOOGLE_FAMILIES.map((f) => `family=${f}`).join("&") + "&display=swap";

const FONT_VARS = `:root {
  --font-sans-latin: 'Archivo';
  --font-serif-latin: 'Source Serif 4';
  --font-mono-latin: 'IBM Plex Mono';
  --font-hieroglyphs: 'Noto Sans Egyptian Hieroglyphs';
}
`;

const MIME = { ".svg": "image/svg+xml", ".png": "image/png" };

const input =
  readFileSync(SRC, "utf8") + `\n@source "../../.design-sync/previews";\n`;
const result = await postcss([tailwind({ base: FE })]).process(input, { from: SRC });

let css = result.css
  .replace(/url\((["']?)\/fonts\/SoulLedgerGlyphs\.ttf\1\)/g, "url('./SoulLedgerGlyphs.ttf')")
  .replace(/url\((["']?)(\/v2\/[^"')]+)\1\)/g, (_, _q, p) => {
    const file = join(FE, "public", p);
    const mime = MIME[extname(p)];
    if (!mime) throw new Error(`no mime for ${p}`);
    return `url("data:${mime};base64,${readFileSync(file).toString("base64")}")`;
  })
  .replaceAll("'Noto Sans SC Variable'", "'Noto Sans SC'")
  .replaceAll("'Noto Serif SC Variable'", "'Noto Serif SC'")
  // Tailwind's `.space-y-*` rules each re-declare its internal `--tw-space-y-reverse: 0`;
  // design-sync's token scan reads every one as an unclassifiable design token. Dropping
  // them here leaves the value unchanged — Tailwind registers that property with
  // `@property … initial-value: 0` (and a `@layer properties` fallback), so 0 is what an
  // element gets anyway. Only the shipped copy changes; Tailwind's own output does not.
  .replace(/(:where\(\.[^{]*space-y-[^{]*\{)\s*--tw-space-y-reverse:\s*0;/g, "$1")
  // Same for `.divide-y` (Design 2026-10-03: one leftover under `:where(.divide-y > :not(:last-child))`).
  .replace(/(:where\(\.[^{]*divide-y[^{]*\{)\s*--tw-divide-y-reverse:\s*0;/g, "$1");

// Tailwind drops every CSS comment, so the `/* @kind … */` annotations written next to tokens in
// globals.css (Design's token classifier reads them: motion tokens are `other`, the brand pair is
// `color`) never reached the synced copy. Re-attach each one after its token's declarations here.
const kinds = new Map(
  [...readFileSync(SRC, "utf8").matchAll(/(--[\w-]+)\s*:[^;]*;\s*\/\*\s*@kind\s+(\w+)\s*\*\//g)].map((m) => [m[1], m[2]]),
);
for (const [name, kind] of kinds) {
  css = css.replace(new RegExp(`(${name}\\s*:[^;{}]*;)(?!\\s*/\\* @kind)`, "g"), `$1 /* @kind ${kind} */`);
}
// Tailwind's own theme defaults that land in the synced theme block have no line in globals.css
// to carry a comment; Design's check (2026-10-03) listed these four.
for (const name of ["--animate-spin", "--animate-pulse", "--default-transition-duration", "--default-transition-timing-function"]) {
  css = css.replace(new RegExp(`(${name}\\s*:[^;{}]*;)(?!\\s*/\\* @kind)`, "g"), "$1 /* @kind other */");
}
// Tailwind's internal `--tw-*` variables are set inside utility classes (`.ordinal`, `.blur`,
// `.-translate-x-full` …); Design's check reads each as an unclassified token. They cannot be
// dropped like the `space-y` / `divide-y` resets above — those equal the registered initial value,
// these ARE the utility (`translate: var(--tw-translate-x) …`). Mark every one `other`, by prefix,
// so a new Tailwind variable is covered too.
css = css.replace(/(--tw-[\w-]+\s*:[^;{}]*;)(?!\s*\/\* @kind)/g, "$1 /* @kind other */");
// The brand pair lives in its own `:root` block at the end of globals.css (outside both themes),
// which the sync's token scan does not read; it reads the top `:root` block below. Move the pair
// there, comments and all, and drop the late block from the shipped copy.
const brand = [...css.matchAll(/(--brand-[\w-]+\s*:[^;{}]*;\s*\/\* @kind \w+ \*\/)/g)].map((m) => m[1]);
css = css.replace(/:root\s*\{\s*(--brand-[\w-]+\s*:[^;{}]*;\s*\/\* @kind \w+ \*\/\s*)+\}/, "");
const unannotated = [...kinds.keys()].filter((n) => !n.startsWith("--brand-") && !css.includes(`${n}:`));
if (unannotated.length) console.error(`build-css: @kind tokens not in compiled output: ${unannotated.join(", ")}`);

const leftover = css.match(/url\((["']?)\/[^"')]*\1\)/g);
if (leftover) throw new Error(`root-relative url() left in output: ${[...new Set(leftover)].join(", ")}`);

mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(join(FE, "public/fonts/SoulLedgerGlyphs.ttf"), join(OUT_DIR, "SoulLedgerGlyphs.ttf"));
writeFileSync(OUT, `@import url("${googleUrl}");\n${FONT_VARS.replace(":root {\n", `:root {\n${brand.map((d) => `  ${d}\n`).join("")}`)}${css}`);
console.error(`build-css: ${OUT} (${(Buffer.byteLength(css) / 1024).toFixed(0)} KB)`);
