#!/usr/bin/env node
/**
 * Design tokens: one source, two outputs (fe-tokens §3.2, 2026-11-14).
 *
 *   packages/core/tokens/{primitive,semantic,component}.tokens.json   (DTCG 2025.10)
 *     → frontend/app/globals.css     the declarations between `@tokens:start` and `@tokens:end`
 *     → mobile/src/theme.generated.ts  the hex / rgba values theme.ts re-exports
 *
 *   node scripts/build-tokens.mjs          write both outputs
 *   node scripts/build-tokens.mjs --check  write nothing; exit 1 if either output is stale
 *
 * The CSS block is rewritten IN PLACE, line by line: every `--name: value;` line inside the markers gets
 * its value (and its `/* #hex *\/` note) from the JSON; comments, selectors and order stay as written, so
 * the institutional notes in globals.css are not regenerated away. A token the block does not declare yet
 * is appended to the last block of its selector; a line the JSON does not know is an error. Typography
 * tokens may also be read by part, `--x-size` / `--x-leading`, when the CSS declares those lines.
 *
 * Modes are CSS selectors (`$extensions["org.soulledger"].modes`); `$value` is `:root`. A mode the token
 * does not list falls back to `$value`, which is what the cascade does with a missing line. An alias is
 * written as `var(--target)` unless the token says `emit: "value"`, then as the target's value in that mode.
 *
 * No dependency: two outputs and one custom format (bare OKLCH triples) are shorter written than configured.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = "org.soulledger";
const SOURCES = ["primitive", "semantic", "component"].map((n) => `packages/core/tokens/${n}.tokens.json`);
const CSS = "frontend/app/globals.css";
const APP = "mobile/src/theme.generated.ts";
const ROOT_SEL = ":root";
const LIGHT = ".light";

// ── index ──────────────────────────────────────────────────────────────────
const byPath = new Map();
const byCss = new Map();
function walk(node, parts, name, inherited, type) {
  const { bare: _bare, ...own } = node.$extensions?.[EXT] ?? {};
  const ext = { ...inherited, ...own };
  type = node.$type ?? type;
  if ("$value" in node) {
    const entry = { path: parts.join("."), css: `--${name.join("-")}`, t: node, ext, type };
    if (byPath.has(entry.path)) throw new Error(`${entry.path}: defined twice`);
    byPath.set(entry.path, entry);
    if (ext.css !== false) byCss.set(entry.css, entry);
    return;
  }
  for (const [k, child] of Object.entries(node)) {
    if (k.startsWith("$") && k !== "$root") continue;
    const skip = k === "$root" || child.$extensions?.[EXT]?.bare;
    walk(child, [...parts, k], skip ? name : [...name, k], ext, type);
  }
}
for (const file of SOURCES) walk(JSON.parse(readFileSync(path.join(REPO, file), "utf8")), [], [], {}, undefined);

const isAlias = (v) => typeof v === "string" && /^\{[^}]+\}$/.test(v);
const target = (v) => {
  const e = byPath.get(v.slice(1, -1));
  if (!e) throw new Error(`alias ${v} points at no token`);
  return e;
};
const valueIn = (e, sel) => e.ext.modes?.[sel] ?? e.t.$value;
function resolve(e, sel) {
  for (let v = valueIn(e, sel), seen = 0; ; v = valueIn(e, sel)) {
    if (!isAlias(v)) return { e, v };
    if (++seen > 20) throw new Error(`${e.path}: alias cycle`);
    e = target(v);
  }
}

// ── formatting ─────────────────────────────────────────────────────────────
const fixed = (x, d) => (Number.isInteger(x) ? String(x) : x.toFixed(d));
const rgb = (c) => (c.hex ? [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16)) : c.components.map((x) => Math.round(x * 255)));
const dim = (d) => (typeof d === "number" ? String(d) : `${d.value}${d.unit}`);

function cssValue(e, v, part) {
  switch (e.type) {
    case "color": {
      if (v.colorSpace === "oklch") {
        const [L, C, H] = v.components;
        return { text: `${fixed(L, 6)} ${fixed(C, 6)} ${fixed(H, 4)}`, note: v.hex };
      }
      if (v.colorSpace === "srgb" && v.alpha !== undefined) return { text: `rgba(${rgb(v).join(", ")}, ${v.alpha})` };
      throw new Error(`${e.path}: no CSS form for ${JSON.stringify(v)}`);
    }
    case "typography":
      if (part === "size") return { text: dim(v.fontSize) };
      if (part === "leading") return { text: dim(v.lineHeight) };
      return { text: `${v.fontWeight} ${dim(v.fontSize)}/${dim(v.lineHeight)} ${v.fontFamily}` };
    case "dimension":
    case "duration":
      return { text: dim(v) };
    case "cubicBezier":
      return { text: `cubic-bezier(${v.join(", ")})` };
    case "number":
    case "string":
      return { text: String(v) };
    default:
      throw new Error(`${e.path}: unknown $type ${e.type}`);
  }
}

function emitCss(e, sel, part) {
  const v = valueIn(e, sel);
  if (isAlias(v) && e.ext.emit !== "value") return { text: `var(${target(v).css})` };
  const r = resolve(e, sel);
  return cssValue(r.e, r.v, part);
}

function lookup(name) {
  if (byCss.has(name)) return { e: byCss.get(name), part: "" };
  const m = name.match(/^(--.+)-(size|leading)$/);
  const e = m && byCss.get(m[1]);
  if (e?.type === "typography") return { e, part: m[2] };
  throw new Error(`${CSS}: ${name} is declared in the token block but no tokens JSON defines it`);
}

// ── globals.css ────────────────────────────────────────────────────────────
function buildCss(css) {
  const lines = css.split("\n");
  const start = lines.findIndex((l) => l.includes("/* @tokens:start"));
  const end = lines.findIndex((l) => l.includes("/* @tokens:end"));
  if (start < 0 || end < start) throw new Error(`${CSS}: @tokens:start / @tokens:end markers not found`);
  const stack = [];
  const seen = new Set();
  const lastClose = new Map(); // selector → index of its last block's closing line
  const indentOf = new Map();
  let inComment = false;
  for (let i = start; i < end; i++) {
    const s = lines[i].trim();
    if (inComment) {
      if (s.includes("*/")) inComment = false;
      continue;
    }
    if (s.startsWith("/*")) {
      inComment = !s.includes("*/");
      continue;
    }
    if (!s) continue;
    if (s === "}") {
      lastClose.set(stack.join(" "), i);
      stack.pop();
      continue;
    }
    if (s.endsWith("{")) {
      stack.push(s.slice(0, -1).trim());
      continue;
    }
    const m = lines[i].match(/^(\s*)(--[\w-]+): (.*?);(?: \/\* #[0-9A-Fa-f]{6} \*\/)?$/);
    if (!m) throw new Error(`${CSS}:${i + 1}: not a token declaration: ${s}`);
    const sel = stack.join(" ");
    const { e, part } = lookup(m[2]);
    const { text, note } = emitCss(e, sel, part);
    lines[i] = `${m[1]}${m[2]}: ${text};${note ? ` /* ${note} */` : ""}`;
    seen.add(`${sel}|${m[2]}`);
    indentOf.set(sel, m[1]);
  }
  // Tokens the block does not declare yet: append before the closing brace of the selector's last block.
  const inserts = [];
  for (const e of byCss.values()) {
    for (const sel of [ROOT_SEL, ...Object.keys(e.ext.modes ?? {})]) {
      if (seen.has(`${sel}|${e.css}`)) continue;
      if (!lastClose.has(sel)) throw new Error(`${e.path}: no \`${sel}\` block between the @tokens markers`);
      const { text, note } = emitCss(e, sel, "");
      inserts.push([lastClose.get(sel), `${indentOf.get(sel) ?? "    "}${e.css}: ${text};${note ? ` /* ${note} */` : ""}`]);
    }
  }
  for (const [at, line] of inserts.sort((a, b) => b[0] - a[0])) lines.splice(at, 0, line);
  return lines.join("\n");
}

// ── mobile/src/theme.generated.ts ─────────────────────────────────────────
function appValue(p, sel) {
  const e = byPath.get(p);
  if (!e) throw new Error(`app: no token ${p}`);
  const { e: r, v } = resolve(e, sel);
  if (r.type !== "color") throw new Error(`app: ${p} is not a colour`);
  if (v.colorSpace === "srgb" && v.alpha !== undefined) return `rgba(${rgb(v).join(",")},${v.alpha})`;
  if (!v.hex) throw new Error(`app: ${r.path} has no hex in ${sel}`);
  return v.hex;
}
const D = ROOT_SEL;
const L = LIGHT;
const pick = (table, sel) => Object.fromEntries(Object.entries(table).map(([k, p]) => [k, appValue(p, sel)]));
const civ = (c) => {
  const p = `color.civ.${c}`;
  return {
    glow: appValue(`${p}.glow`, D),
    tD: appValue(`${p}.ink`, D),
    tL: appValue(`${p}.ink`, L),
    sL: appValue(`${p}.$root`, L),
    sD: appValue(`${p}.$root`, D),
    mD: appValue(`${p}.metal`, D),
    mL: appValue(`${p}.metal`, L),
    sideD: appValue(`${p}.side`, D),
    sideL: appValue(`${p}.side`, L),
  };
};
const SCHEME = {
  main: "color.canvas",
  card: "color.surface-1",
  card2: "color.surface-2",
  ink: "color.ink",
  sub: "color.ink-muted",
  faint: "color.line-strong",
  line: "app.hair",
  line2: "app.hair2",
  field: "field",
  onSolid: "color.on-main",
  pos: "color.success",
  neg: "color.danger",
  onNeg: "color.on-danger",
};
const SEMANTIC = {
  pos: "color.success",
  posBg: "app.pos-bg",
  neg: "color.danger",
  negStrong: "color.danger-strong",
  onNeg: "color.on-danger",
  negInk: "color.danger-on-tint",
  negBg: "color.danger-tint",
  warn: "app.warn",
  warnBg: "color.warning-tint",
  lamp: "color.lamp",
  lampBg: "color.lamp-bg",
  scrim: "app.scrim",
};
const CIVS = ["cn", "eu", "eg", "gr"];

function buildApp() {
  const out = {
    v4: { dark: pick(SCHEME, D), light: pick(SCHEME, L), civ: Object.fromEntries(CIVS.map((c) => [c, civ(c)])) },
    NEUTRAL_CIV: civ("neutral"),
    FAINT_TEXT: { dark: appValue("color.faint-text", D), light: appValue("color.faint-text", L) },
    semantic: { dark: pick(SEMANTIC, D), light: pick(SEMANTIC, L) },
    seal: Object.fromEntries(CIVS.map((c) => [c, { dark: appValue(`color.civ.${c}.seal`, D), light: appValue(`color.civ.${c}.seal`, L) }])),
  };
  return (
    "// Generated by scripts/build-tokens.mjs from packages/core/tokens/*.tokens.json. Do not edit: change the\n" +
    "// JSON and run `node scripts/build-tokens.mjs` (`--check` fails when this file is stale). theme.ts re-exports it.\n" +
    Object.entries(out)
      .map(([k, v]) => `export const ${k} = ${JSON.stringify(v, null, 2)} as const;\n`)
      .join("")
  );
}

// ── run ────────────────────────────────────────────────────────────────────
const check = process.argv.includes("--check");
const outputs = [
  [CSS, buildCss(readFileSync(path.join(REPO, CSS), "utf8"))],
  [APP, buildApp()],
];
let stale = 0;
for (const [rel, text] of outputs) {
  const file = path.join(REPO, rel);
  let old = null;
  try {
    old = readFileSync(file, "utf8");
  } catch {
    // a missing output is stale
  }
  if (old === text) continue;
  if (check) {
    stale++;
    console.error(`${rel} is stale: run \`node scripts/build-tokens.mjs\` and commit the result.`);
  } else {
    writeFileSync(file, text);
    console.log(`wrote ${rel}`);
  }
}
process.exit(stale ? 1 : 0);
