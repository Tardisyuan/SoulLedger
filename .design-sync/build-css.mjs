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
  "Ma+Shan+Zheng",
  "UnifrakturMaguntia",
  "Josefin+Slab:wght@600;700",
  "Cinzel:wght@600",
  "GFS+Didot",
  "Noto+Sans+Egyptian+Hieroglyphs",
];
const googleUrl =
  "https://fonts.googleapis.com/css2?" + GOOGLE_FAMILIES.map((f) => `family=${f}`).join("&") + "&display=swap";

const FONT_VARS = `:root {
  --font-sans-latin: 'Archivo';
  --font-serif-latin: 'Source Serif 4';
  --font-mono-latin: 'IBM Plex Mono';
  --font-ma-shan-zheng: 'Ma Shan Zheng';
  --font-unifraktur: 'UnifrakturMaguntia';
  --font-josefin-slab: 'Josefin Slab';
  --font-cinzel: 'Cinzel';
  --font-gfs-didot: 'GFS Didot';
  --font-hieroglyphs: 'Noto Sans Egyptian Hieroglyphs';
  --font-lxgw-seal: 'LXGW Seal';
}
@font-face {
  font-family: 'LXGW Seal';
  src: url('./LXGWSeal-Regular.ttf') format('truetype');
  font-display: swap;
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
  .replaceAll("'Noto Serif SC Variable'", "'Noto Serif SC'");

const leftover = css.match(/url\((["']?)\/[^"')]*\1\)/g);
if (leftover) throw new Error(`root-relative url() left in output: ${[...new Set(leftover)].join(", ")}`);

mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(join(FE, "public/fonts/SoulLedgerGlyphs.ttf"), join(OUT_DIR, "SoulLedgerGlyphs.ttf"));
copyFileSync(join(FE, "src/components/plaque/fonts/LXGWSeal-Regular.ttf"), join(OUT_DIR, "LXGWSeal-Regular.ttf"));
writeFileSync(OUT, `@import url("${googleUrl}");\n${FONT_VARS}${css}`);
console.error(`build-css: ${OUT} (${(Buffer.byteLength(css) / 1024).toFixed(0)} KB)`);
