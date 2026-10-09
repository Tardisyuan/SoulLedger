#!/usr/bin/env node
/**
 * Regenerates the officer App's icons from the BrandMark outline (A14 §1, 2026-10-09):
 *
 *   node scripts/gen-officer-icons.mjs          (from the repo root; needs `sharp`, in node_modules)
 *
 * The nine strokes are NOT traced: the path data is read from packages/core/src/config/brandMark.ts
 * (`SHAPE`, the same outline the web `BrandMark` and the App's cold start draw).
 *
 *   mobile-officer/assets/icon.png                       iOS 1024, paper #EFEFEB full bleed (no corner
 *                                                        radius: the system masks it), ink #181A17 mark
 *                                                        52% high (532 px), visual centre 8 px up
 *   mobile-officer/assets/android-icon-foreground.png    adaptive foreground, 108 dp on a transparent
 *                                                        1024 canvas, mark 40 dp high, centred inside
 *                                                        the 66 dp safe circle
 *   mobile-officer/assets/android-icon-monochrome.png    the same drawing: Android 13 themed icons
 *   mobile-officer/assets/ic_stat_officer.png            notification small icon, 24 dp at 96 px (x4),
 *                                                        mark 18 dp high, WHITE on transparent -- the
 *                                                        system tints it, never export it in ink
 *
 * The adaptive background is the plain colour in app.json (`backgroundColor` #EFEFEB). The splash stays
 * light (app.json): paper ground, no dark variant. `icon-dark.png` / `icon-mono.png` (iOS dark and
 * tinted) are not part of this spec and are left as they are.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "mobile-officer", "assets");

const PAPER = "#EFEFEB";
const INK = "#181A17";

const source = readFileSync(join(root, "packages", "core", "src", "config", "brandMark.ts"), "utf8");
const grab = (re) => source.match(re)[1];
const viewBox = grab(/VIEWBOX = "([^"]+)"/);
const MARK_W = Number(grab(/MARK_WIDTH = (\d+)/));
const MARK_H = Number(grab(/MARK_HEIGHT = (\d+)/));
const shapeBlock = grab(/SHAPE: readonly string\[\] = \[([\s\S]*?)\];/);
const SHAPE = [...shapeBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (SHAPE.length !== 3 || !viewBox) throw new Error("brandMark.ts no longer has the shape this script reads");

/** An SVG of `size` px square holding the mark `markHeight` px high, its centre at (cx, cy). */
function svg({ size, markHeight, cx, cy, fill, ground }) {
  const markWidth = (markHeight * MARK_W) / MARK_H;
  const paths = SHAPE.map((d) => `<path d="${d}" fill-rule="evenodd" clip-rule="evenodd"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${ground ? `<rect width="${size}" height="${size}" fill="${ground}"/>` : ""}
<svg x="${cx - markWidth / 2}" y="${cy - markHeight / 2}" width="${markWidth}" height="${markHeight}" viewBox="${viewBox}" fill="${fill}">${paths}</svg>
</svg>`;
}

const png = (name, spec) => sharp(Buffer.from(svg(spec)), { density: 72 }).png().toFile(join(out, name));

// iOS 1024: mark 52% = 532 px; visual centre moved up 8 px.
await png("icon.png", { size: 1024, markHeight: 532, cx: 512, cy: 512 - 8, fill: INK, ground: PAPER });

// Android adaptive: 108 dp -> 1024 px. 40 dp mark = 379.26 px; centred (safe circle is 66 dp).
const dp = 1024 / 108;
const adaptive = { size: 1024, markHeight: 40 * dp, cx: 512, cy: 512, fill: INK };
await png("android-icon-foreground.png", adaptive);
await png("android-icon-monochrome.png", adaptive);

// Notification small icon: 24 dp at 96 px, mark 18 dp = 72 px, white.
await png("ic_stat_officer.png", { size: 96, markHeight: 18 * 4, cx: 48, cy: 48, fill: "#FFFFFF" });

console.log("officer icons written to", out);
