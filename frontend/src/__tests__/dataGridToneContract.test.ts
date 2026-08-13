/**
 * Token contract for the shared data-grid's enum badges.
 *
 * Three commits (1d9fac4, c3e8cdb, 3ab941b) flattened every badge fill in the
 * app to a 10% tint of its status token, and 5e580e3 then RE-MEASURED five
 * light-mode `--color-status-*` values against that 10% tint, darkening them
 * until they cleared 4.5:1. Those token values are only correct for a 10%
 * fill: src/components/ui/Toast.tsx records that a 16% tint of the error
 * token measures 4.37:1, under AA.
 *
 * So the tint depth is not a style preference — it is an input to the token
 * values, and raising it silently invalidates them. d5af1e9 (the data-grid
 * extraction, which existed to PREVENT drift) shipped 16% and regressed every
 * badge on /audit and /permissions. This file makes that class of change fail
 * a test instead of a screen reader.
 *
 * Pure functions and a CSS read — no DOM, no browser, no new dependency. The
 * WCAG relative-luminance and contrast formulas are implemented inline below.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ENUM_TONE_CLASSES } from "@/components/ui/data-grid/columns";

/** The cap the rest of the app already uses. Anything above this invalidates the light-mode token measurements. */
const MAX_TINT_ALPHA = 0.1;
const AA_TEXT_CONTRAST = 4.5;

const GLOBALS_CSS = path.join(__dirname, "..", "..", "app", "globals.css");

// ---------------------------------------------------------------------------
// WCAG 2.x relative luminance + contrast ratio (hand-rolled, no dependency)
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

/** HSL (h in degrees, s/l as percentages) -> sRGB 0-255. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = lum - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

/** WCAG relative luminance: linearize each sRGB channel, then weight. */
function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (channel: number) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-composite `fg` at `alpha` over opaque `bg`, as a browser would. */
function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as Rgb;
}

// ---------------------------------------------------------------------------
// Parsing: globals.css light-mode tokens, and the Tailwind arbitrary values
// ---------------------------------------------------------------------------

/**
 * Merges every `.light { ... }` block in globals.css (there are two — the base
 * override near the top and the re-measured status block further down) into one
 * token map, later declarations winning, exactly as the cascade resolves them.
 */
function readLightModeTokens(): Record<string, string> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const tokens: Record<string, string> = {};
  for (const block of css.matchAll(/\.light\s*\{([^}]*)\}/g)) {
    for (const decl of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[decl[1]] = decl[2].trim();
    }
  }
  return tokens;
}

/** `"150 62% 28%"` -> rgb. Returns null for anything not a literal HSL triple (e.g. a var() indirection). */
function tokenToRgb(value: string | undefined): Rgb | null {
  if (!value) return null;
  const m = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
  if (!m) return null;
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

interface ToneFill {
  /** e.g. `--color-status-success` */
  token: string;
  /** Fill opacity; 1 when the utility declares none. */
  alpha: number;
}

/** Pulls the `bg-[hsl(var(--token)/alpha)]` fill out of a tone's class string. */
function parseBackground(classes: string): ToneFill | null {
  const m = /bg-\[hsl\(var\((--[\w-]+)\)\s*(?:\/\s*([\d.]+))?\)\]/.exec(classes);
  if (!m) return null;
  return { token: m[1], alpha: m[2] === undefined ? 1 : Number(m[2]) };
}

/** Pulls the `text-[hsl(var(--token))]` ink out of a tone's class string. */
function parseForegroundToken(classes: string): string | null {
  const m = /text-\[hsl\(var\((--[\w-]+)\)\s*(?:\/\s*[\d.]+)?\)\]/.exec(classes);
  return m ? m[1] : null;
}

// Enumerated from the map itself, never hardcoded — a tone added tomorrow is
// held to the same contract without anyone remembering to edit this file.
const TONES = Object.entries(ENUM_TONE_CLASSES);

describe("data-grid enum badge token contract", () => {
  it("declares at least one tone (guards against the map being renamed away)", () => {
    expect(TONES.length).toBeGreaterThan(0);
  });

  it.each(TONES)("tone %s fills with a status tint the CSS can resolve", (tone, classes) => {
    const fill = parseBackground(classes);
    expect(fill).not.toBeNull();
    expect(parseForegroundToken(classes)).not.toBeNull();
    // A fully opaque fill must be a surface token, not a status colour used raw.
    if (fill!.alpha === 1) {
      expect(fill!.token).toMatch(/^--color-surface-/);
    }
  });

  it.each(TONES)(
    "tone %s tints at no more than 10%% — the depth the light-mode tokens were measured against",
    (tone, classes) => {
      const fill = parseBackground(classes)!;
      if (fill.token.startsWith("--color-surface-")) return; // opaque surface, not a tint
      expect(fill.alpha).toBeLessThanOrEqual(MAX_TINT_ALPHA);
    }
  );

  it.each(TONES)(
    "tone %s clears AA in light mode at the tint it actually declares",
    (tone, classes) => {
      const fill = parseBackground(classes)!;
      const inkToken = parseForegroundToken(classes)!;
      const tokens = readLightModeTokens();

      const fillRgb = tokenToRgb(tokens[fill.token]);
      const inkRgb = tokenToRgb(tokens[inkToken]);
      const canvasRgb = tokenToRgb(tokens["--color-canvas"]);
      expect(canvasRgb).not.toBeNull();

      // Surface tokens resolve through var(--civ-hue) and are per-tenant; the
      // status tints are literal triples and are what 5e580e3 re-measured.
      if (!fillRgb || !inkRgb) return;

      const background = composite(fillRgb, fill.alpha, canvasRgb!);
      const ratio = contrastRatio(inkRgb, background);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }
  );
});

describe("WCAG helpers", () => {
  it("reproduces the reference black-on-white ratio", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });

  it("returns 1 for a colour against itself", () => {
    expect(contrastRatio([18, 52, 86], [18, 52, 86])).toBeCloseTo(1, 10);
  });

  it("converts HSL the way the CSS tokens are written", () => {
    expect(hslToRgb(0, 0, 100).map(Math.round)).toEqual([255, 255, 255]);
    expect(hslToRgb(0, 100, 50).map(Math.round)).toEqual([255, 0, 0]);
    expect(hslToRgb(150, 62, 28).map(Math.round)).toEqual([27, 116, 71]);
  });

  it("composites a fill at 0 and 1 alpha to the endpoints", () => {
    expect(composite([255, 0, 0], 0, [255, 255, 255])).toEqual([255, 255, 255]);
    expect(composite([255, 0, 0], 1, [255, 255, 255])).toEqual([255, 0, 0]);
  });
});
