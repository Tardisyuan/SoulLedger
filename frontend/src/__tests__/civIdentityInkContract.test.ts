/**
 * `--color-civ-ink-*` — the civilization identity colour as TEXT.
 *
 * WHY A SEPARATE TOKEN FROM `--color-civ-mark-*`. The same split, for the same
 * reason, as `--color-accent` / `--color-accent-ink`: a fill and the glyphs
 * drawn on that fill cannot be one value. `Badge`'s `accent` tone already
 * carried the rule in its own comment — "the foreground is
 * `--color-accent-ink`, NOT `--color-accent` … a badge is text" — and
 * `CATEGORY_COLORS` in app/organizations/page.tsx copied that tone's 10/20/40
 * fill-text-border ladder while spelling its foreground `--color-civ-mark-*`.
 * It took the ladder and left the point of the ladder behind.
 *
 * WHAT THAT SHIPPED. A civilization badge is `text-02` — 12px, weight 500,
 * which is normal text at 4.5:1, not large text at 3:1. It is drawn on
 * `mark/0.2` over the surface of the *logged-in* tenant, and on /organizations
 * that is routinely a different civilization from the badge's own. Measured
 * across every host-tenant × surface-1..4 pair, at the mark's own lightness:
 *
 *     dark    cn 3.70   eu 3.68   eg 4.77   gr 4.82
 *     light   cn 4.16   eu 4.69   eg 3.29   gr 3.35
 *
 * On the two surfaces that page actually paints (`bg-surface-1`, hover
 * `surface-2`) four of the eight still failed: cn 3.93 / eu 3.92 dark,
 * eg 3.58 / gr 3.64 light.
 *
 * A SECOND LOCUS, FOUND BY LOOKING FOR THE SAME ROOT CAUSE ELSEWHERE.
 * `TenantSignal` draws the tenant's two-letter code at 11px in the collapsed
 * rail and the mobile chip, reading `hsl(var(--civ-mark))`. `--civ-mark` — the
 * per-tenant alias, unmapped-tenant fallback `215 8% 57%` — is declared once,
 * in `:root`, which is the DARK block. There is no `.light` override, so a
 * logged-out light-mode masthead drew those glyphs with a value measured
 * against a near-black canvas onto white: **3.23:1** in the rail, **2.84:1** in
 * the chip. `--civ-ink` is declared in both themes; the mark is left alone
 * because as a 7px dot it is a graphical object at 3.23:1 and passes 1.4.11.
 *
 * MARK IS THE GRAPHIC, INK IS THE TEXT. Dots, rules, borders and chart series
 * keep the mark. Anything with glyphs in it takes the ink.
 *
 * WHY THIS IS NOT IN `inkOnSurfaceContract.test.ts`, WHICH IS WHERE IT BELONGS.
 * That file is 499 lines and CLAUDE.md caps files at 500. It owns the ink ramp
 * and the `--color-accent-ink` block this one is modelled on, and both files
 * import the SAME `contrastRatio` / `hslTripleToRgb` / `compositeOver` out of
 * `./support/globalsCssTokens` rather than carrying copies — two readings of
 * one formula is the defect that support module exists to close.
 */
import {
  CIV_PREFIXES,
  LIGHT_TOKENS,
  ROOT_TOKENS,
  SURFACE_TOKENS,
  THEMES,
  compositeOver,
  contrastRatio,
  hslTripleToRgb,
  readCivAttrRules,
  resolveRampForCiv,
  suffixesOf,
  type ThemeName,
} from "./support/globalsCssTokens";

/** WCAG 2.x AA for normal-size text. Both call sites are 11–12px. */
const AA_NORMAL_TEXT = 4.5;

/**
 * The alpha `Badge`'s `accent` recipe fills with, which `CATEGORY_COLORS`
 * inherits. Written here as the number the stylesheet uses, so a change to the
 * recipe that this file does not follow shows up as a measurement that no
 * longer describes the badge rather than as a silent pass.
 */
const BADGE_FILL_ALPHA = 0.2;

const TOKENS_FOR: Record<ThemeName, Record<string, string>> = {
  dark: ROOT_TOKENS,
  light: LIGHT_TOKENS,
};

const rgbFor = (theme: ThemeName, civ: string, token: string) =>
  hslTripleToRgb(resolveRampForCiv(theme, civ, token));

// ---------------------------------------------------------------------------

describe("the ink tokens exist and are wired, in both themes", () => {
  it("declares an ink token for every civilization, and none it does not have", () => {
    for (const tokens of [ROOT_TOKENS, LIGHT_TOKENS]) {
      expect(suffixesOf(tokens, "--color-civ-ink")).toEqual(CIV_PREFIXES);
    }
  });

  it("gives every civilization a [data-civ] rule wired to its own ink token", () => {
    // Tokens alone paint nothing. This is the enumeration point Greek was
    // missing from when only the hue existed.
    const rules = readCivAttrRules();
    expect(Object.keys(rules).sort()).toEqual(CIV_PREFIXES);
    for (const prefix of CIV_PREFIXES) {
      expect(rules[prefix].ink).toBe(`--color-civ-ink-${prefix}`);
    }
  });

  it.each(CIV_PREFIXES)("--color-civ-ink-%s is a full HSL triple", (prefix) => {
    for (const tokens of [ROOT_TOKENS, LIGHT_TOKENS]) {
      expect(tokens[`--color-civ-ink-${prefix}`]).toMatch(/^\d+(\.\d+)?\s+[\d.]+%\s+[\d.]+%$/);
    }
  });

  it.each(CIV_PREFIXES)("ink, mark and hue for %s agree on the hue", (prefix) => {
    // Lightness is the only axis the ink is allowed to move. An ink on a
    // different hue is not "the same identity, made readable" — it is a fifth
    // colour, and the thing the reader is meant to recognise has changed.
    for (const tokens of [ROOT_TOKENS, LIGHT_TOKENS]) {
      const hue = tokens[`--color-civ-hue-${prefix}`];
      expect(tokens[`--color-civ-ink-${prefix}`].split(/\s+/)[0]).toBe(hue);
      expect(tokens[`--color-civ-ink-${prefix}`].split(/\s+/)[1]).toBe(
        tokens[`--color-civ-mark-${prefix}`].split(/\s+/)[1]
      );
    }
  });

  it("declares the unmapped-tenant `--civ-ink` fallback in BOTH themes", () => {
    // The gap this token was added to close. `--civ-mark` is declared only in
    // `:root`; an alias holding a LIGHTNESS and declared in one theme is a
    // value measured for one canvas and painted on two.
    expect(ROOT_TOKENS["--civ-ink"]).toMatch(/^\d+(\.\d+)?\s+[\d.]+%\s+[\d.]+%$/);
    expect(LIGHT_TOKENS["--civ-ink"]).toMatch(/^\d+(\.\d+)?\s+[\d.]+%\s+[\d.]+%$/);
    expect(LIGHT_TOKENS["--civ-ink"]).not.toBe(ROOT_TOKENS["--civ-ink"]);
  });
});

// ---------------------------------------------------------------------------

/**
 * Every (theme × ink's civilization × host tenant × surface) the badge can be
 * drawn on. The host axis is the one a single-civilization reading misses:
 * /organizations lists all four cosmologies inside ONE logged-in tenant's ramp.
 */
const BADGE_COMBOS = THEMES.flatMap((theme) =>
  CIV_PREFIXES.flatMap((inkCiv) =>
    CIV_PREFIXES.flatMap((hostCiv) =>
      SURFACE_TOKENS.map((surface) => ({
        theme,
        inkCiv,
        key: `${theme} ${inkCiv}-badge on ${hostCiv} ${surface}`,
        ratio: contrastRatio(
          rgbFor(theme, inkCiv, `--color-civ-ink-${inkCiv}`),
          compositeOver(
            rgbFor(theme, inkCiv, `--color-civ-mark-${inkCiv}`),
            rgbFor(theme, hostCiv, surface),
            BADGE_FILL_ALPHA
          )
        ),
      }))
    )
  )
);

/** The ink as bare glyphs on its own tenant's backgrounds — corpus, grounds panel, rail. */
const BARE_COMBOS = THEMES.flatMap((theme) =>
  CIV_PREFIXES.flatMap((civ) =>
    [...SURFACE_TOKENS, "--color-canvas"].map((bg) => ({
      theme,
      civ,
      key: `${theme} ${civ} ink on ${bg}`,
      ratio: contrastRatio(rgbFor(theme, civ, `--color-civ-ink-${civ}`), rgbFor(theme, civ, bg)),
    }))
  )
);

describe("the matrix is the matrix we think it is", () => {
  it("measures the product of all four axes, and is not empty", () => {
    // An empty list makes every `toEqual([])` below vacuously green, which is
    // the exact failure mode this repo keeps rediscovering.
    expect(SURFACE_TOKENS.length).toBe(4);
    expect(CIV_PREFIXES.length).toBeGreaterThanOrEqual(4);
    expect(BADGE_COMBOS).toHaveLength(
      THEMES.length * CIV_PREFIXES.length * CIV_PREFIXES.length * SURFACE_TOKENS.length
    );
    expect(BARE_COMBOS).toHaveLength(THEMES.length * CIV_PREFIXES.length * 5);
  });

  it("resolves a different background per host tenant, so the host axis is real", () => {
    const perHost = CIV_PREFIXES.map((civ) => resolveRampForCiv("light", civ, "--color-surface-4"));
    expect(new Set(perHost).size).toBe(CIV_PREFIXES.length);
  });
});

describe("civilization ink clears AA everywhere it is painted", () => {
  it.each(THEMES.flatMap((t) => CIV_PREFIXES.map((c) => [`${t} ${c}`, t, c] as const)))(
    "%s badge text on every host tenant and surface",
    (_key, theme, civ) => {
      const failing = BADGE_COMBOS.filter(
        (c) => c.theme === theme && c.inkCiv === civ && c.ratio < AA_NORMAL_TEXT
      ).map((c) => `${c.key} = ${c.ratio.toFixed(2)}:1`);
      expect(failing).toEqual([]);
    }
  );

  it("bare ink on its own tenant's surfaces and canvas", () => {
    const failing = BARE_COMBOS.filter((c) => c.ratio < AA_NORMAL_TEXT).map(
      (c) => `${c.key} = ${c.ratio.toFixed(2)}:1`
    );
    expect(failing).toEqual([]);
  });

  it("keeps headroom rather than sitting flush on the line", () => {
    // Every value was solved to >= 4.6 against the worst of the 32 badge
    // pairings. A token one rounding away from failing is one surface tweak
    // away from failing silently, and the surface ramp is tuned more often
    // than an identity colour is.
    expect(Math.min(...BADGE_COMBOS.map((c) => c.ratio))).toBeGreaterThanOrEqual(4.6);
  });

  it("the unmapped-tenant fallback clears AA on the canvas of its own theme", () => {
    for (const theme of THEMES) {
      const ink = hslTripleToRgb(TOKENS_FOR[theme]["--civ-ink"]);
      const canvas = hslTripleToRgb(TOKENS_FOR[theme]["--color-canvas"]);
      const mark = hslTripleToRgb(ROOT_TOKENS["--civ-mark"]);
      expect(contrastRatio(ink, canvas)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      // The chip fills with `--civ-mark / 0.13` over that canvas.
      expect(contrastRatio(ink, compositeOver(mark, canvas, 0.13))).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT
      );
    }
  });
});

// ---------------------------------------------------------------------------

describe("the split is load-bearing, not decoration", () => {
  /**
   * THE CONTROL. Every assertion above also passes in a world where
   * `--color-civ-ink-*` was never introduced and the marks happen to be
   * readable — it would just be measuring a token that agrees with the mark.
   * So this measures the counterfactual directly: draw the badge in the MARK,
   * as the code did before, and require that it still fails somewhere.
   *
   * If this ever goes red it is not necessarily a bug. It means the marks were
   * retuned into AA-safe territory and the two tokens could be collapsed back
   * into one — a real finding, and one worth reading rather than silencing.
   */
  it("drawing the badge in the mark instead of the ink still fails somewhere", () => {
    const failing = THEMES.flatMap((theme) =>
      CIV_PREFIXES.flatMap((inkCiv) =>
        CIV_PREFIXES.flatMap((hostCiv) =>
          SURFACE_TOKENS.map((surface) => ({
            key: `${theme} ${inkCiv} on ${hostCiv} ${surface}`,
            ratio: contrastRatio(
              rgbFor(theme, inkCiv, `--color-civ-mark-${inkCiv}`),
              compositeOver(
                rgbFor(theme, inkCiv, `--color-civ-mark-${inkCiv}`),
                rgbFor(theme, hostCiv, surface),
                BADGE_FILL_ALPHA
              )
            ),
          }))
        )
      )
    ).filter((c) => c.ratio < AA_NORMAL_TEXT);
    expect(failing.length).toBeGreaterThan(0);
  });
});
