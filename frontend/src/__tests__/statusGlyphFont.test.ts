/**
 * Design E 组:「迷失」◌ must come from the same font as ✓✕◇↺ — ◌ is the dotted-circle
 * placeholder for combining marks, and in a fallback font its advance width drifts.
 *
 * Measured 2026-09-30, before the bundled face: the web badge stack (Plex Mono `latin`
 * subset → Noto Sans SC Variable → OS) drew ✓✕○▣◇◎↺↻ from Noto Sans SC and ◌ from the
 * OS, because no Noto Sans SC slice lists U+25CC. The App's Archivo has none of them,
 * so every glyph was an OS fallback of its own.
 *
 * What is pinned here:
 *   1. the font file actually carries every glyph the status tables use (web and App),
 *      read from its own cmap — a unicode-range naming a code point the file does not
 *      have would still fall through, silently;
 *   2. the web @font-face covers exactly the web glyphs and is FIRST in all three stacks;
 *   3. the App ships the same bytes (one font, two platforms).
 * The screenshots on Windows / Android are a human's job; this is the part a test can own.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { SOUL_STATE_GLYPH } from "@/src/lib/soulStateBadge";
import { VERDICT_GLYPH } from "@/src/lib/verdictGlyph";

const REPO = path.join(__dirname, "..", "..", "..");
const WEB_FONT = path.join(REPO, "frontend/public/fonts/SoulLedgerGlyphs.ttf");
const APP_FONT = path.join(REPO, "mobile/assets/fonts/SoulLedgerGlyphs.ttf");
const CSS = readFileSync(path.join(REPO, "frontend/app/globals.css"), "utf8");
const APP_RULES = readFileSync(path.join(REPO, "mobile/src/rules.ts"), "utf8");

/** Code points in a TrueType font's format-4 (BMP) cmap subtable. Enough for these glyphs. */
function cmapCodepoints(buf: Buffer): Set<number> {
  const numTables = buf.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("latin1", rec, rec + 4) === "cmap") cmap = buf.readUInt32BE(rec + 8);
  }
  if (cmap < 0) throw new Error("no cmap table");
  const out = new Set<number>();
  const n = buf.readUInt16BE(cmap + 2);
  for (let i = 0; i < n; i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    if (buf.readUInt16BE(sub) !== 4) continue;
    const segX2 = buf.readUInt16BE(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const offsets = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = buf.readUInt16BE(ends + s * 2);
      const start = buf.readUInt16BE(starts + s * 2);
      const delta = buf.readInt16BE(deltas + s * 2);
      const roAt = offsets + s * 2;
      const ro = buf.readUInt16BE(roAt);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        const gid = ro === 0 ? (c + delta) & 0xffff : buf.readUInt16BE(roAt + ro + (c - start) * 2);
        if (gid !== 0) out.add(c);
      }
    }
  }
  return out;
}

const cps = (glyphs: Iterable<string>) => [...new Set([...glyphs].map((g) => g.codePointAt(0)!))].sort((a, b) => a - b);
const hex = (c: number) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;

/** Every glyph a web status / verdict badge draws. */
const WEB_GLYPHS = cps([...Object.values(SOUL_STATE_GLYPH), ...Object.values(VERDICT_GLYPH)]);
/** Every glyph an App badge draws, read from mobile/src/rules.ts (it imports React Native's theme). */
const APP_GLYPHS = cps([...APP_RULES.matchAll(/glyph: "([^"]+)"/g)].map((m) => m[1]));

describe("status glyphs come from one bundled font (Design E 组)", () => {
  it("the subject sets are the ones we think: ◌ and ✓✕◇↺ are in both", () => {
    for (const g of ["◌", "✓", "✕", "◇", "↺"]) {
      expect(WEB_GLYPHS).toContain(g.codePointAt(0));
      expect(APP_GLYPHS).toContain(g.codePointAt(0));
    }
    expect(APP_GLYPHS.length).toBeGreaterThanOrEqual(10);
  });

  it("the font file carries every web and App badge glyph", () => {
    const have = cmapCodepoints(readFileSync(WEB_FONT));
    expect([...WEB_GLYPHS, ...APP_GLYPHS].filter((c) => !have.has(c)).map(hex)).toEqual([]);
  });

  it("the App ships the same bytes the web serves", () => {
    expect(readFileSync(APP_FONT).equals(readFileSync(WEB_FONT))).toBe(true);
  });

  it("the web @font-face claims exactly the web glyphs — no letters, nothing the tables do not use", () => {
    const face = /@font-face\s*{[^}]*font-family:\s*'SoulLedger Glyphs'[^}]*}/.exec(CSS)?.[0] ?? "";
    expect(face).toContain("url('/fonts/SoulLedgerGlyphs.ttf')");
    const range = /unicode-range:\s*([^;]+);/.exec(face)?.[1] ?? "";
    const claimed = range.split(",").map((r) => parseInt(r.trim().replace(/^U\+/i, ""), 16)).sort((a, b) => a - b);
    expect(claimed.map(hex)).toEqual(WEB_GLYPHS.map(hex));
  });

  it.each(["--font-sans", "--font-serif", "--font-mono"])("%s puts it first", (token) => {
    const stack = new RegExp(`${token}:\\s*([^;]+);`).exec(CSS)?.[1] ?? "";
    expect(stack.trim().startsWith("'SoulLedger Glyphs',")).toBe(true);
  });
});
