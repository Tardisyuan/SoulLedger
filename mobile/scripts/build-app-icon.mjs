#!/usr/bin/env node
/**
 * Builds every app / web icon from ONE source: assets/brand/soulledger-mark.svg
 * (the S-and-L balance mark, user's pick 2026-10-01; traced from a Midjourney render,
 * shading slivers dropped, the right pan's triangle turned into a real hole).
 *
 *   node mobile/scripts/build-app-icon.mjs
 *
 * WRITES
 *   mobile/assets/icon.png                      1024, gold mark on ink — iOS light + the default
 *   mobile/assets/icon-dark.png                 1024, gold mark on transparent — iOS dark (the system supplies the dark ground)
 *   mobile/assets/icon-mono.png                 1024, white mark on transparent — iOS tinted (the system tints by luminance)
 *   mobile/assets/android-icon-foreground.png   1024, gold mark inside the 66/108 safe circle — adaptive foreground
 *   mobile/assets/android-icon-monochrome.png   1024, same geometry, alpha only — Android 13 themed icon
 *   mobile/assets/notification-icon.png         96, white mark on transparent
 *   mobile/assets/splash-blank.png              336, transparent — the native splash's image: the
 *                                               splash is the INK ground alone (both modes), and
 *                                               src/coldStart.tsx writes the mark on it in strokes
 *                                               (src/brandMark.ts). HarmonyOS drops the icon anyway.
 *   frontend/app/icon.svg                       the browser-tab icon, vector
 *   docs/soulledger-mark.svg                    the README's mark, vector (gold on an ink rounded
 *                                               square: GitHub would paint the bare currentColor
 *                                               source black). Its own file, so the tab icon can change alone.
 */
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(APP, "..", "frontend");
export const GOLD = "#ECAA3D";
export const INK = "#131211";

const mark = readFileSync(join(APP, "assets/brand/soulledger-mark.svg"), "utf8");
const [, , , vw, vh] = mark.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/).map(Number);
const inner = mark.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** The mark centred on a square canvas, its WIDTH a share of the canvas. */
export function canvas({ size, share, color, ground, radius = 0 }) {
  const scale = (size * share) / vw;
  const x = (size - vw * scale) / 2;
  const y = (size - vh * scale) / 2;
  const [, ox, oy] = mark.match(/viewBox="([\d.]+) ([\d.]+)/).map(Number);
  const bg = ground ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${ground}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}` +
    `<g transform="translate(${x} ${y}) scale(${scale}) translate(${-ox} ${-oy})" color="${color}">${inner}</g></svg>`
  );
}

// Share of the canvas the mark's width takes. iOS: the traced render already sat at 61%.
// Android adaptive: the mark's bounding-box diagonal must fit the 66dp circle of 108dp —
// diagonal ≈ 1.37 × width, so width ≤ 61.1% / 1.37 ≈ 44%.
const IOS = 0.61;
const ADAPTIVE = 0.44;
const NOTIFY = 0.86;

const png = (svg, out, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(APP, "assets", out));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await Promise.all([
    png(canvas({ size: 1024, share: IOS, color: GOLD, ground: INK }), "icon.png", 1024),
    png(canvas({ size: 1024, share: IOS, color: GOLD }), "icon-dark.png", 1024),
    png(canvas({ size: 1024, share: IOS, color: "#FFFFFF" }), "icon-mono.png", 1024),
    png(canvas({ size: 1024, share: ADAPTIVE, color: GOLD }), "android-icon-foreground.png", 1024),
    png(canvas({ size: 1024, share: ADAPTIVE, color: "#000000" }), "android-icon-monochrome.png", 1024),
    png(canvas({ size: 96, share: NOTIFY, color: "#FFFFFF" }), "notification-icon.png", 96),
    png(`<svg xmlns="http://www.w3.org/2000/svg" width="336" height="336"/>`, "splash-blank.png", 336),
  ]);
  writeFileSync(join(WEB, "app/icon.svg"), canvas({ size: 64, share: 0.72, color: GOLD, ground: INK, radius: 14 }) + "\n");
  writeFileSync(join(APP, "..", "docs/soulledger-mark.svg"), canvas({ size: 112, share: 0.72, color: GOLD, ground: INK, radius: 24 }) + "\n");
  console.log("built 6 icon PNGs, the blank splash image, frontend/app/icon.svg and docs/soulledger-mark.svg from assets/brand/soulledger-mark.svg");
}
