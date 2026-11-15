/**
 * @jest-environment node
 *
 * One seal motion and one breath, everywhere (Design v4 batch 53 G1 / G2).
 *
 * The web plays them from CSS tokens (`--stamp*`, `--now-breath*`, generated from
 * packages/core/tokens/component.tokens.json); the apps play them from SEAL_MOTION /
 * BREATHE_MOTION in packages/core/src/config/motion.ts. This holds the two equal, and holds
 * what Design took out: the judgment page's 1.7× drop and its ring of civilization glow, and
 * the spine's endless breathing.
 *
 * Read as text: jsdom runs no CSS animations, so a render cannot see a duration or a keyframe.
 * Mutations seen red: `--now-breath-count` → `infinite` (the iteration test); a glow box-shadow
 * back in `seal-stamp` (the halo test).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { BREATHE_MOTION, SEAL_MOTION } from "@soulledger/core/config/motion";

const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");
const CSS = read("app", "globals.css");
const DOSSIER = read("src", "components", "dossier", "dossier.module.css");
const SEAL_TSX = read("src", "components", "plaque", "Seal.tsx");

const token = (name: string) => {
  const m = new RegExp(`^\\s*${name}: ([^;]+);`, "m").exec(CSS);
  if (!m) throw new Error(`${name} is not declared in globals.css`);
  return m[1].trim();
};
const ms = (v: string) => (v.endsWith("ms") ? Number(v.slice(0, -2)) : Number(v.slice(0, -1)) * 1000);
/** The body of the first `selector {` block (one level of braces). */
const block = (src: string, selector: string) => {
  const i = src.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`no ${selector} block`);
  let depth = 0;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error(`${selector} block is not closed`);
};

describe("落印 (G1): the web's tokens are the apps' SEAL_MOTION", () => {
  it("200ms, scale 1.18 → 1, on cubic-bezier(.2,.8,.2,1)", () => {
    expect(ms(token("--stamp"))).toBe(SEAL_MOTION.durationMs);
    expect(Number(token("--stamp-scale"))).toBe(SEAL_MOTION.scaleFrom);
    expect(token("--stamp-ease")).toBe(`cubic-bezier(${SEAL_MOTION.easing.join(", ")})`);
    expect(SEAL_MOTION).toMatchObject({ durationMs: 200, scaleFrom: 1.18, scaleTo: 1, opacityFrom: 0 });
  });

  it("the keyframes start from the token scale at opacity 0, and carry no halo", () => {
    const frames = block(CSS, "@keyframes seal-stamp");
    expect(frames).toMatch(/transform: scale\(var\(--stamp-scale\)\)/);
    expect(frames).toMatch(/opacity: 0/);
    expect(frames).not.toMatch(/box-shadow|glow|1\.7/);
    expect(block(CSS, ".stamp-in")).toMatch(/animation: seal-stamp var\(--stamp\) var\(--stamp-ease\) both/);
  });

  it("Seal no longer runs its own WAAPI drop or glow ring: it wears the shared class", () => {
    expect(SEAL_TSX).not.toMatch(/\.animate\(|STAMP_KEYFRAMES|STAMP_GLOW|scale\(1\.7\)|--color-glow/);
    expect(SEAL_TSX).toMatch(/stamp-in/);
    // The case desk's DossierSeal had its own copy in the module css; it is gone too.
    expect(DOSSIER).not.toMatch(/seal-stamp|stampIn/);
  });

  it("reduce motion: no scale, a 120ms fade", () => {
    expect(ms(token("--stamp-reduced"))).toBe(SEAL_MOTION.reduced.durationMs);
    expect(SEAL_MOTION.reduced.scaleFrom).toBe(1);
    expect(block(CSS, "@keyframes seal-fade")).not.toMatch(/scale/);
    const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{\s*\.stamp-in \{([^}]*)\}/g)].map((m) => m[1]);
    expect(reduced).toHaveLength(1);
    expect(reduced[0]).toMatch(/animation-name: seal-fade !important/);
    expect(reduced[0]).toMatch(/animation-duration: var\(--stamp-reduced\) !important/);
  });
});

describe("呼吸 (G2): the spine's current point breathes three times, then stops", () => {
  it("2.4s period, three iterations — the tokens are BREATHE_MOTION", () => {
    expect(ms(token("--now-breath"))).toBe(BREATHE_MOTION.periodMs);
    expect(token("--now-breath-count")).toBe(String(BREATHE_MOTION.iterations));
    expect(BREATHE_MOTION).toMatchObject({ periodMs: 2400, iterations: 3 });
  });

  it("plays --now-breath-count times, never infinite", () => {
    const breath = block(DOSSIER, ".breath");
    expect(breath).toMatch(/animation: spine-now var\(--now-breath\) ease-in-out var\(--now-breath-count\)/);
    expect(breath).not.toMatch(/infinite/);
  });

  it("scale 1 → 1.06, opacity 1 → .7, about its own centre", () => {
    const frames = block(DOSSIER, "@keyframes spine-now");
    expect(frames).toMatch(new RegExp(`transform: scale\\(${BREATHE_MOTION.scale[1]}\\)`));
    expect(frames).toMatch(new RegExp(`opacity: ${BREATHE_MOTION.opacity[1]}`));
    expect(block(DOSSIER, ".breath")).toMatch(/transform-box: fill-box/);
  });

  it("reduce motion: it does not breathe at all", () => {
    expect(DOSSIER).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.breath \{\s*animation: none;/);
  });

  it("the empty state's seal does not breathe: the old breathing class is gone", () => {
    expect(CSS).not.toMatch(/empty-breathe/);
  });
});
