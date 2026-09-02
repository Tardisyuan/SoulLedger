/**
 * The keyboard focus ring: `:focus-visible` in app/globals.css, and the
 * `--color-focus` token it names.
 *
 * Split out of `statusTokenLayering.test.ts`, which asks the same question of a
 * different rule — WHICH TOKEN, not which colour — and reads the same
 * stylesheet through the same `support/globalsCssTokens` parser. The two were
 * one file until it passed the 500-line ceiling; neither half's assertions
 * changed in the move.
 *
 * No DOM and no browser: a stylesheet parse and some arithmetic.
 */
import { readFileSync } from "node:fs";
import {
  CIV_PREFIXES,
  GLOBALS_CSS,
  LIGHT_TOKENS,
  ROOT_TOKENS,
  SURFACE_TOKENS,
  THEMES,
  TOKENS_BY_THEME,
  hslTripleToRgb,
  resolveRampForCiv,
  resolveTriple,
} from "./support/globalsCssTokens";

// ───────────────────────────────────────────────────────────────────────────
// The keyboard focus ring.
//
// Same family of defect as the token-layering contract this was split from — a
// rule in globals.css whose only justification is a comment beside it — but the
// failure here is louder. The ring is
// the ONLY focus indicator in the app: 69 uses of the Tailwind outline-clearing
// utility across 22 files under app/, src/ and components/ remove the native
// one, and the single `:focus-visible` rule wins them back purely on
// `!important`. Delete the rule, or drop that one word, and every keyboard user
// loses their caret while nothing else in this repo changes: no type error, no
// snapshot diff, no visual difference at all to anyone clicking with a mouse.
// Before this block, a grep for `focus-visible` across `src/` and `e2e/`
// returned nothing.
//
// Two separate things are pinned here and they fail for different reasons:
//
//   THE RULE — that it exists, that it is `!important`, and that it names
//   `--color-focus` and nothing else. Named as an exact set rather than a
//   `toContain`, so "it mentions the right token" cannot stay green while the
//   accent sits beside it.
//
//   THE TOKEN — that both themes declare it, that it is a literal triple rather
//   than an alias, and that it clears WCAG 1.4.11's 3:1 for non-text UI on
//   every surface a focused control can sit in front of. `outline-offset` is
//   2px, so the ring lands on the background BEHIND the control: canvas plus
//   surface-1..4, for the neutral fallback ramp and each civilization's.
//
// WHY THE TOKEN IS ITS OWN AND NOT THE ACCENT, restated here because a future
// reader will be tempted to collapse them: `useAccentColor` in
// src/components/settings/SettingsDrawer.tsx writes `--color-accent` onto
// `document.documentElement` as an inline style, from a localStorage value the
// drawer accepts as any 6-digit hex. Inline styles on the root element beat
// every declaration in globals.css, so an accent-coloured ring is a focus
// indicator the user can delete by accident. It also measured 2.14:1 against
// light-mode white — a plain 1.4.11 failure before anyone touched a setting.
//
// The contrast maths is hand-rolled below rather than imported.
// `dataGridToneContract.test.ts` has the same two functions, which is a real
// duplication and is called out rather than hidden: the right home is
// `support/globalsCssTokens.ts`, and moving them there is a change to a module
// three other contract tests import, so it is left as its own edit. Both copies
// are self-checked against known values so a wrong one cannot be quietly wrong.
// ───────────────────────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number];

/** WCAG 2.x relative luminance: linearize each sRGB channel, then weight. */
function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The body of the bare `:focus-visible` rule in globals.css.
 *
 * Anchored to column 0 so it cannot match the `input:focus-visible,
 * textarea:focus-visible, select:focus-visible` block below it, which only
 * tightens the offset and carries no colour.
 *
 * This is the one thing `support/globalsCssTokens.ts` cannot answer — it reads
 * DECLARATION BLOCKS by selector into token maps, and the question here is
 * about a property in a rule, not a custom property. So the path comes from
 * that module and only the rule body is read here; no second token parser.
 *
 * Throws rather than returning "": a focus contract that silently stops finding
 * the rule it is about would pass over nothing, which is the exact defect the
 * rest of this file exists to prevent.
 */
function readFocusVisibleRule(): string {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const m = /^:focus-visible\s*\{([^}]*)\}/m.exec(css);
  if (m === null) {
    throw new Error(
      `No bare \`:focus-visible\` rule at column 0 in ${GLOBALS_CSS}. The app ` +
        `clears the native focus outline-solid in 22 files, so without this rule ` +
        `there is no keyboard focus indicator at all. If the rule moved, fix ` +
        `this reader — do not delete the comparison.`
    );
  }
  return m[1];
}

const FOCUS_RULE = readFocusVisibleRule();

/** The `outline-solid` declaration's value, `!important` included. */
function focusOutlineValue(): string {
  const m = /(?:^|;)\s*outline\s*:\s*([^;]+);/.exec(FOCUS_RULE);
  if (m === null) {
    throw new Error(
      `The \`:focus-visible\` rule in ${GLOBALS_CSS} declares no \`outline-solid\`. ` +
        `That rule is the app's only focus indicator.`
    );
  }
  return m[1].trim();
}

/** Every custom property named through `var()` in a declaration value. */
function varsIn(value: string): string[] {
  return [...value.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]).sort();
}

const FOCUS_TOKEN = "--color-focus";
const ACCENT_TOKEN = "--color-accent";
/** WCAG 2.2 SC 1.4.11 Non-text Contrast. */
const NON_TEXT_FLOOR = 3;

/**
 * Every background a focused control's ring can land on, per theme, derived
 * rather than listed: the canvas, plus each surface step resolved once for the
 * neutral `--civ-hue` fallback and once per civilization ramp.
 */
function ringBackgrounds(theme: (typeof THEMES)[number]): { label: string; triple: string }[] {
  const out = [{ label: "canvas", triple: resolveTriple(TOKENS_BY_THEME[theme], "--color-canvas") }];
  for (const surface of SURFACE_TOKENS) {
    out.push({ label: `neutral ${surface}`, triple: resolveTriple(TOKENS_BY_THEME[theme], surface) });
    for (const civ of CIV_PREFIXES) {
      out.push({ label: `${civ} ${surface}`, triple: resolveRampForCiv(theme, civ, surface) });
    }
  }
  return out;
}

describe("the focus-ring checks are looking at something", () => {
  it("the contrast maths agrees with values that are not in dispute", () => {
    // A wrong luminance function would make every ratio below meaningless in
    // whichever direction it was wrong, and a floor of 3 is loose enough to
    // swallow a fair-sized error silently.
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrastRatio([18, 52, 86], [18, 52, 86])).toBeCloseTo(1, 10);
  });

  it("the background set covers both the canvas and every ramp step", () => {
    // An empty or short list makes the 3:1 assertion vacuously green. Derived
    // from the stylesheet, so a fifth civilization widens it automatically —
    // but it can never silently narrow to nothing.
    for (const theme of THEMES) {
      const backgrounds = ringBackgrounds(theme);
      expect(backgrounds).toHaveLength(1 + SURFACE_TOKENS.length * (CIV_PREFIXES.length + 1));
      expect(backgrounds.length).toBeGreaterThan(10);
      expect(backgrounds.map((b) => b.label)).toContain("canvas");
    }
  });

  it("the two themes really do resolve to different surfaces", () => {
    // THEMES is the list `it.each` below is fed from, and that is the one
    // traversal in this file whose failure mode is silence: an `it.each([])`
    // declares no tests, contributes nothing to the run summary, and is
    // indistinguishable from a suite where everything passed. Pinned as an
    // exact set rather than a floor because dark and light are exhaustive —
    // a third theme is a decision someone should have to write down here.
    expect([...THEMES].sort()).toEqual(["dark", "light"]);

    // If `TOKENS_BY_THEME` ever collapsed to one map, the light-mode ratios
    // below would be re-measuring dark mode and reporting it as a pass.
    const dark = resolveTriple(TOKENS_BY_THEME.dark, "--color-canvas");
    const light = resolveTriple(TOKENS_BY_THEME.light, "--color-canvas");
    expect(dark).not.toEqual(light);
  });
});

describe("the keyboard focus ring-3 is a rule that can be proven to exist", () => {
  it("the rule declares an outline-solid and marks it important", () => {
    // `!important` is not decoration. 69 uses of the outline-clearing utility
    // sit on the elements this rule targets; without the flag they all win.
    const value = focusOutlineValue();
    expect(value).toContain("!important");
    expect(value).toMatch(/\bsolid\b/);
    expect(value).toMatch(/\b2px\b/);
  });

  it("the outline-solid names the focus token and nothing else", () => {
    // An exact set, not a `toContain`. "It mentions --color-focus" would stay
    // green while the accent sat beside it in the same shorthand.
    expect(varsIn(focusOutlineValue())).toEqual([FOCUS_TOKEN]);
  });

  it("the outline-solid does not name the user-configurable accent", () => {
    // Said separately from the set comparison because this is the regression
    // with a name: `useAccentColor` writes --color-accent as an inline style on
    // <html> from a localStorage preference, so an accent-coloured ring is one
    // a user can erase by picking a pale colour in the settings drawer.
    expect(focusOutlineValue()).not.toContain(ACCENT_TOKEN);
    expect(varsIn(focusOutlineValue())).not.toContain(ACCENT_TOKEN);
  });
});

describe("--color-focus is a token of its own, in both themes", () => {
  it("is declared by :root AND by .light, not just inherited into light mode", () => {
    // `LIGHT_TOKENS` is the `.light` blocks alone. A token :root declares and
    // .light stays silent about keeps its DARK value through the cascade —
    // which for a ring is a light-mode failure that reads as a dark-mode pass.
    // `civilizationColourContract.test.ts` pins the same rule for the
    // civilization marks; this is that rule for the focus ring.
    expect(ROOT_TOKENS[FOCUS_TOKEN]).toBeDefined();
    expect(LIGHT_TOKENS[FOCUS_TOKEN]).toBeDefined();
  });

  it("is a literal triple in both themes, so no inline style can reach it", () => {
    // The clobber path is specifically `var(--color-accent)`: an inline style
    // on <html> beats globals.css, so aliasing this token to the accent hands
    // the focus ring back to the settings drawer. Any alias at all fails here —
    // the next one would need its own argument, made deliberately.
    for (const theme of THEMES) {
      const declared = TOKENS_BY_THEME[theme][FOCUS_TOKEN];
      expect(declared).toBeDefined();
      expect(declared).not.toContain("var(");
      // Throws unless it is a bare `H S% L%`, so this is an assertion too.
      expect(hslTripleToRgb(declared)).toHaveLength(3);
    }
  });

  it("is not the accent's value, so re-pointing it is red rather than invisible", () => {
    // Compared as text AND as pixels: `38 92% 50%` and `38.0 92% 50%` are the
    // same colour written two ways, and a "tidy-up" that copies the accent's
    // triple across is the thing this is here to catch.
    for (const theme of THEMES) {
      const focus = TOKENS_BY_THEME[theme][FOCUS_TOKEN];
      const accent = TOKENS_BY_THEME[theme][ACCENT_TOKEN];
      expect(accent).toBeDefined();
      expect(focus).not.toEqual(accent);
      expect(hslTripleToRgb(focus)).not.toEqual(hslTripleToRgb(accent));
    }
  });
});

describe("the focus ring-3 clears WCAG 1.4.11 on every surface it can land on", () => {
  it.each(THEMES)("%s mode: 3:1 against the canvas and every ramp step", (theme) => {
    const ring = hslTripleToRgb(TOKENS_BY_THEME[theme][FOCUS_TOKEN]);
    const measured: string[] = [];
    for (const { label, triple } of ringBackgrounds(theme)) {
      const ratio = contrastRatio(ring, hslTripleToRgb(triple));
      measured.push(label);
      // The label rides along in the message so a failure names the surface.
      expect({ surface: label, ratio: ratio >= NON_TEXT_FLOOR }).toEqual({
        surface: label,
        ratio: true,
      });
    }
    expect(measured.length).toBeGreaterThan(10);
  });

  it("the accent this ring-3 used to borrow would fail that floor in light mode", () => {
    // The reason the token exists, re-derived rather than quoted. If a future
    // accent value ever cleared 3:1 everywhere, this goes red and someone gets
    // to re-read the argument — which is still the runtime-clobber one, and
    // survives on its own.
    const accent = hslTripleToRgb(TOKENS_BY_THEME.light[ACCENT_TOKEN]);
    const failures = ringBackgrounds("light").filter(
      ({ triple }) => contrastRatio(accent, hslTripleToRgb(triple)) < NON_TEXT_FLOOR
    );
    expect(failures.length).toBe(ringBackgrounds("light").length);
  });
});

