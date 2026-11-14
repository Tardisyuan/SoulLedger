// Writes the shell font subsets and app/fonts-shell.css (expert design wave 2, fe-perf items 8–9, fe-visual §3.1).
//
//   public/fonts/shell-sans.woff2         Noto Sans SC (variable, wght kept) cut to the shell's characters
//   public/fonts/title-serif.woff2        Noto Serif SC (variable) cut to the shell's title characters
//   public/fonts/juan-latin.woff2         EB Garamond roman, Latin only  → 'Juan Latin' (size-adjust)
//   public/fonts/juan-latin-italic.woff2  EB Garamond italic, Latin only
//   app/fonts-shell.css                   the four @font-face rules, unicode-range listing exactly the cut characters
//
// Any character outside a subset falls through the stack to the 101 fontsource shards, which load after first
// paint (app/FontShards.tsx). So a missing character costs a shard, never a tofu.
//
// Tool: pyftsubset (fontTools). Nothing in node_modules writes woff2 with variations kept (checked 2026-11-14:
// no subset-font / fonteditor-core / harfbuzzjs; Next's bundled fontkit cannot write woff2). woff2 needs brotli:
//   pip install fonttools brotli
// Sources are the full fonts (fontsource ships only the shards), from github.com/google/fonts, OFL:
//   ofl/notosanssc/NotoSansSC[wght].ttf   ofl/notoserifsc/NotoSerifSC[wght].ttf
//   ofl/ebgaramond/EBGaramond[wght].ttf   ofl/ebgaramond/EBGaramond-Italic[wght].ttf
// Run: node frontend/scripts/gen-font-subsets.mjs --sans <ttf> --serif <ttf> --garamond <ttf> --garamond-italic <ttf>
// Rerun after changing the shell namespaces' strings: a character added there and not rerun falls to a shard
// (slower, still correct).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pack = JSON.parse(readFileSync(path.join(root, "..", "packages/core/messages/zh-Hans.json"), "utf8"));

// The knobs. Shell = what every page and the landing page draw before any data arrives.
const SHELL_NAMESPACES = ["nav", "common", "landing", "demo", "desk", "shell", "doors", "footer", "loading"];
// Characters drawn by components, not language packs (seal, merit marks, station numerals, door glyphs).
const FIXED_TEXT = "冥功过一二三四五六七八九十审册律司人间我";
const TITLE_KEY = /(^|_)(title|heading|head|name)$|Title$/;
const BUDGET_KB = 360; // shell + title; the landing target is ≤ 400 KB with Geist on top
// Tuned on screen 2026-11-14 (16px, 「生于Ravenna」): Han 「生」 spans -0.57..13.38, so its visual centre is ~6.4 above the
// baseline; at 100% the x-height is 6.5 (level with it) and the cap height 10.5 (75% of the Han glyph). 108% gave 7.0 / 81%.
const SIZE_ADJUST = "100%";

const CJK = /[　-〿㐀-䶿一-鿿＀-￯]/u;
function* strings(node, key = "") {
  if (typeof node === "string") yield [key, node];
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) yield* strings(v, k);
}
function shellChars(messages, titlesOnly = false) {
  const out = new Set();
  for (const ns of SHELL_NAMESPACES)
    for (const [k, s] of strings(messages[ns]))
      if (!titlesOnly || TITLE_KEY.test(k) || ns === "doors") for (const c of s) if (CJK.test(c)) out.add(c);
  if (!titlesOnly) for (const c of FIXED_TEXT) out.add(c);
  return [...out].sort();
}

/** `U+4E00-4E02,U+4E05` from a sorted list of characters. */
function unicodeRange(chars) {
  const cps = chars.map((c) => c.codePointAt(0)).sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < cps.length; ) {
    let j = i;
    while (j + 1 < cps.length && cps[j + 1] === cps[j] + 1) j++;
    const h = (n) => n.toString(16).toUpperCase();
    parts.push(i === j ? `U+${h(cps[i])}` : `U+${h(cps[i])}-${h(cps[j])}`);
    i = j + 1;
  }
  return parts.join(", ");
}

const LATIN = "U+0000-024F, U+2000-206F";
const face = (family, file, range, extra = "") =>
  `@font-face {\n  font-family: '${family}';\n  src: url('/fonts/${file}') format('woff2');\n` +
  `  font-weight: 100 900;\n  font-display: swap;${extra}\n  unicode-range: ${range};\n}\n`;

function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${name} <path to the full font>; see the header`);
    return process.argv[i + 1];
  };
  const shell = shellChars(pack);
  const title = shellChars(pack, true);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "font-subsets-"));
  const cut = (src, out, opts) => {
    execFileSync("pyftsubset", [src, ...opts, "--flavor=woff2", "--layout-features=*", "--no-hinting",
      "--desubroutinize", `--output-file=${path.join(root, "public/fonts", out)}`], { stdio: "inherit" });
    return statSync(path.join(root, "public/fonts", out)).size;
  };
  const textFile = (name, chars) => {
    const f = path.join(tmp, name);
    writeFileSync(f, chars.join(""));
    return `--text-file=${f}`;
  };
  const sizes = {
    "shell-sans.woff2": cut(arg("sans"), "shell-sans.woff2", [textFile("shell.txt", shell)]),
    "title-serif.woff2": cut(arg("serif"), "title-serif.woff2", [textFile("title.txt", title)]),
    "juan-latin.woff2": cut(arg("garamond"), "juan-latin.woff2", [`--unicodes=${LATIN.replace(/ /g, "")}`]),
    "juan-latin-italic.woff2": cut(arg("garamond-italic"), "juan-latin-italic.woff2", [`--unicodes=${LATIN.replace(/ /g, "")}`]),
  };
  const sizeAdjust = `\n  size-adjust: ${SIZE_ADJUST};`;
  writeFileSync(
    path.join(root, "app/fonts-shell.css"),
    `/* GENERATED by frontend/scripts/gen-font-subsets.mjs from packages/core/messages/zh-Hans.json. Do not edit.\n` +
      `   ${shell.length} shell characters, ${title.length} title characters. Loaded in the critical CSS; the\n` +
      `   fontsource shards cover everything else after first paint (app/FontShards.tsx). */\n` +
      face("SoulLedger Shell Sans", "shell-sans.woff2", unicodeRange(shell)) +
      face("SoulLedger Title Serif", "title-serif.woff2", unicodeRange(title)) +
      face("Juan Latin", "juan-latin.woff2", LATIN, sizeAdjust) +
      face("Juan Latin", "juan-latin-italic.woff2", LATIN, `\n  font-style: italic;${sizeAdjust}`),
  );
  for (const [f, b] of Object.entries(sizes)) console.log(`${f}  ${(b / 1024).toFixed(1)} KB`);
  const kb = (sizes["shell-sans.woff2"] + sizes["title-serif.woff2"]) / 1024;
  if (kb > BUDGET_KB) {
    console.error(`shell + title = ${kb.toFixed(1)} KB > ${BUDGET_KB} KB budget: trim SHELL_NAMESPACES or TITLE_KEY`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
