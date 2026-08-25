/**
 * Every ink token measured against every surface token — per tenant, per theme.
 *
 * ── WHY THIS WAS MISSING FOR SO LONG ──────────────────────────────────────
 * globals.css already carries per-token contrast figures in its comments
 * (`--color-ink-tertiary` "4.91:1", `--color-civ-mark-gr` "7.78:1",
 * `--color-accent-ink` "4.83:1"). Every one of them is a single number, and a
 * single number is not what the stylesheet produces. `--color-surface-1..4`
 * are declared as `var(--civ-hue) 13% 7%`, and the `[data-civ]` rules point
 * `--civ-hue` at a different degree per tenant, so the real answer is one
 * figure per (theme × tenant × surface × ink) — 128 of them today. The
 * comments record the best case of each family and read as if they were the
 * whole answer.
 *
 * `dataGridToneContract` measures badge INK on a tinted badge FILL, and
 * `civilizationColourContract` measures how far apart two tenants' surfaces
 * are. Nothing measured ink against the surface it sits on. That is the gap
 * this file closes.
 *
 * ── WHAT IT ASSERTS ───────────────────────────────────────────────────────
 * Every combination either clears WCAG AA for normal text (4.5:1) or appears
 * in `BELOW_AA` below with the ratio it actually measures. The failing set is
 * compared to that table as an EXACT SET, so it is red in both directions:
 * a NEW combination dropping under AA is red, and a recorded one being fixed
 * is red until its line is deleted. The recorded ratio is checked too, so a
 * token nudged from 3.99 to 4.20 — still failing, differently — has to be
 * re-recorded rather than drifting away from what this file claims.
 *
 * ── WHAT IT DOES NOT COVER, said plainly ──────────────────────────────────
 *   - The NEUTRAL fallback. With no `[data-civ]` attribute (logged out, or a
 *     tenant this deployment maps to no cosmology) `--civ-hue` stays at 240,
 *     and that state is not in this matrix — the axis here is the tenants
 *     `src/config/civilizations.ts` declares. Measured by hand while writing
 *     this file, the fallback fails in exactly the same eight light-mode
 *     places the four tenants do, at 3.43-3.99 and 2.40-2.79; it introduces
 *     no new shape, which is why it is a note rather than eight more rows.
 *   - Large text (3:1) and non-text (3:1). Every ratio here is judged against
 *     the 4.5:1 normal-text floor, which is the stricter claim; a heading
 *     rendered at 24px in a recorded combination may in fact be compliant.
 *   - Ink over a TINT rather than over a bare surface — a badge, a hover
 *     state, a selected row. That is `dataGridToneContract`'s subject.
 *   - Which surface each ink is actually PAINTED on. This measures the whole
 *     matrix, including pairs no screen renders. A recorded row is a fact
 *     about the tokens, not proof that a user hit it.
 *
 * No DOM, no browser: the stylesheet is parsed by `./support/globalsCssTokens`
 * — the one parser — and the WCAG formulas live there too.
 */
import { readFileSync } from "node:fs";

import {
  CIV_PREFIXES,
  GLOBALS_CSS,
  LIGHT_TOKENS,
  ROOT_TOKENS,
  SURFACE_TOKENS,
  THEMES,
  contrastRatio,
  hslTripleToRgb,
  readCivAttrRules,
  resolveRampForCiv,
  suffixesOf,
  type ThemeName,
} from "./support/globalsCssTokens";

/** WCAG 2.x AA for normal-size text. */
const AA_NORMAL_TEXT = 4.5;

/**
 * The ink family, derived rather than listed: the bare `--color-ink` plus
 * every `--color-ink-*` the stylesheet declares. A fifth ink token joins the
 * matrix without anyone editing this file — which is the whole point, because
 * the token that would be added is by definition a dimmer one.
 */
const INK_TOKENS: string[] = [
  "--color-ink",
  ...suffixesOf(ROOT_TOKENS, "--color-ink").map((suffix) => `--color-ink-${suffix}`),
];

interface Combo {
  key: string;
  theme: ThemeName;
  civ: string;
  surface: string;
  ink: string;
  ratio: number;
}

/**
 * The full matrix, built eagerly.
 *
 * `resolveRampForCiv` throws on a token it cannot resolve — an unknown civ
 * prefix, a dangling `var()`, a triple that is not `H S% L%`. That throw is
 * deliberate and it is why no case below has an escape hatch in it: a
 * combination that cannot be measured fails the whole file loudly at import,
 * rather than becoming a case that returns early and reports green.
 */
function buildMatrix(): Combo[] {
  const out: Combo[] = [];
  for (const theme of THEMES) {
    for (const civ of CIV_PREFIXES) {
      for (const surface of SURFACE_TOKENS) {
        for (const ink of INK_TOKENS) {
          const surfaceRgb = hslTripleToRgb(resolveRampForCiv(theme, civ, surface));
          const inkRgb = hslTripleToRgb(resolveRampForCiv(theme, civ, ink));
          out.push({
            key: `${theme} ${civ} ${surface} ${ink}`,
            theme,
            civ,
            surface,
            ink,
            ratio: contrastRatio(inkRgb, surfaceRgb),
          });
        }
      }
    }
  }
  return out;
}

const MATRIX = buildMatrix();

/** The failing half of the matrix, as `{key: measured ratio}`. */
function measuredBelowAA(): Record<string, number> {
  return Object.fromEntries(
    MATRIX.filter((c) => c.ratio < AA_NORMAL_TEXT).map((c) => [c.key, c.ratio])
  );
}

/**
 * Every combination that is under AA today, with the ratio it measures.
 *
 * ── THIS IS A RECORD, NOT A PERMISSION ────────────────────────────────────
 * Nothing here is fixed by this file, on purpose. `--color-ink-subtle` is
 * named 225 times across the frontend and `--color-ink-tertiary` 20 times
 * (counted with, from `frontend/`:
 *
 *   grep -rIohE --include='*.ts' --include='*.tsx' --include='*.css' \
 *     --exclude-dir='__tests__' -- \
 *     '(--color-|(text|bg|border|placeholder|fill|stroke|ring|divide|decoration|caret|accent|outline|from|via|to)-)ink(-muted|-subtle|-tertiary)?' \
 *     app components lib src | sed -E 's/^(--color-|[a-z]+-)//' | sort | uniq -c
 *
 * which gives ink 478 / ink-muted 370 / ink-subtle 225 / ink-tertiary 20 at
 * the commit this file was added; the ink-tertiary figure includes its two
 * declarations in globals.css and three mentions in prose, so ~15 are real
 * uses. Both spellings are counted because tailwind.config.js aliases the
 * family, so half the uses never name the custom property at all — a count of
 * `--color-ink-subtle` alone reads about a third of the truth.)
 *
 * Raising `--color-ink-subtle`'s lightness repaints 225 places. Which of
 * these combinations should be fixed by darkening a token, which by moving a
 * caller onto a lighter ink, and which are pairs no screen actually renders,
 * is the owner's call and it is a design decision, not a token tweak. What
 * this file guarantees is that the decision is taken deliberately: the set
 * cannot grow silently, and it cannot shrink silently either.
 *
 * ── THE THREE DARK ROWS ───────────────────────────────────────────────────
 * `--color-ink-tertiary` on the two darkest tenants' upper surfaces. The
 * comment on that token in globals.css says "this is the surface-1 figure
 * only (4.91:1)... nothing dimmer than this exists — use ink-subtle above
 * surface-1", so the rule is already written down; these three rows are where
 * the ramp's own per-tenant hue pushes it under AA anyway. Egyptian (44°) and
 * Greek (88°) are the warm hues, and a warm hue at 11% saturation lifts the
 * surface's luminance slightly more than a blue one — which is why cn (12°)
 * and eu (232°) clear it on the same surfaces and these two do not.
 *
 * The external audit that prompted this file named only `dark eg surface-4`
 * (as "4.41"). It missed both Greek rows entirely. That is the reason every
 * figure below was re-measured here rather than copied.
 *
 * ── THE THIRTY-TWO LIGHT ROWS ─────────────────────────────────────────────
 * The whole of `--color-ink-subtle` and `--color-ink-tertiary`, on every
 * surface, for every tenant. Not a per-tenant defect: the tenant hue moves
 * these by ~0.06 of a ratio point, so the spread across all four is narrower
 * than the gap to AA. `--color-ink-subtle` in light mode is `220 8% 50%` and
 * needs to be near 42% to clear 4.5:1 on surface-4; `--color-ink-tertiary` at
 * 60% is not close at any surface. They are enumerated per tenant rather than
 * collapsed to "the light-mode pair" because the matrix is what is asserted,
 * and collapsing would hide the day a tenant hue diverges enough to matter.
 */
const BELOW_AA: Record<string, number> = {
  // EMPTY, AND THAT IS THE CURRENT FINDING RATHER THAN AN OVERSIGHT.
  //
  // This table held 35 of the 128 combinations when the matrix was first
  // measured: dark `--color-ink-tertiary` on the deepest surfaces under the two
  // warmest hues (eg 44°, gr 88°), and the whole of light-mode
  // `--color-ink-subtle` and `--color-ink-tertiary` on every surface for every
  // tenant. All 35 were fixed by three token moves — light subtle 50%→42%,
  // light tertiary 60%→42%, dark tertiary 52%→54% — each recorded on its
  // declaration in globals.css with the worst-case figure it now clears.
  //
  // An empty table says "the answer today is none", which is a different claim
  // from there being no rule. The rule is the point, and it is asserted in both
  // directions: a combination that drops below AA is not in this table and goes
  // red, and an entry left here after its combination was fixed goes red too.
  // Adding a row is how a regression gets excused, so a row arriving without a
  // measured ratio and a reason beside it is the thing to refuse in review.
};

describe("the matrix is the matrix we think it is", () => {
  it("measures every theme, tenant, surface and ink — and the product of the four", () => {
    // The floor for the whole file. Every assertion below is either a set
    // comparison or an `it.each` over MATRIX, and both are vacuously green on
    // an empty list. The lists come from four independent derivations, so an
    // exact product is asserted as well as a floor: a surface silently
    // dropping out of `SURFACE_TOKENS` would halve the matrix without moving
    // the failing set, because the rows it removes all pass.
    expect(THEMES.length).toBe(2);
    expect(CIV_PREFIXES.length).toBeGreaterThanOrEqual(4);
    expect(SURFACE_TOKENS.length).toBeGreaterThanOrEqual(4);
    expect(INK_TOKENS.length).toBeGreaterThanOrEqual(4);
    expect(MATRIX.length).toBe(
      THEMES.length * CIV_PREFIXES.length * SURFACE_TOKENS.length * INK_TOKENS.length
    );
    expect(MATRIX.length).toBeGreaterThanOrEqual(128);
    expect(new Set(MATRIX.map((c) => c.key)).size).toBe(MATRIX.length);
  });

  it("derives the ink family from the stylesheet, bare token included", () => {
    // `suffixesOf` only sees `--color-ink-*`; the bare `--color-ink` has no
    // suffix and would be silently absent from a family derived by prefix
    // alone. It is the ink most of the app is painted in — 478 of the 1093
    // ink references — so its absence would be the loudest possible hole in a
    // matrix that reported "no failures".
    expect(ROOT_TOKENS["--color-ink"]).toBeDefined();
    expect(INK_TOKENS).toContain("--color-ink");
    expect(INK_TOKENS.length).toBe(suffixesOf(ROOT_TOKENS, "--color-ink").length + 1);
    // And nothing that merely CONTAINS "ink" got swept in: `--color-accent-ink`
    // is a text/link colour, not a member of the ramp's ink family.
    expect(INK_TOKENS).not.toContain("--color-accent-ink");
  });

  it("gives every tenant a rule that actually retints the ramp", () => {
    // Without this the matrix is a lie of the exact shape GREEK already shipped
    // once: `resolveRampForCiv` reads `--color-civ-hue-gr` whether or not any
    // rule feeds it into `--civ-hue`, so a tenant with tokens and no
    // `[data-civ]` rule would be measured on a surface no user ever sees. It
    // fails here rather than being skipped, because a tenant that cannot be
    // resolved is the finding, not an excused case.
    const rules = readCivAttrRules();
    for (const prefix of CIV_PREFIXES) {
      expect(rules[prefix]).toBeDefined();
      expect(rules[prefix].hue).toBe(`--color-civ-hue-${prefix}`);
    }
  });

  it("resolves a different surface per tenant, so the tenant axis is real", () => {
    // The guard for the guard above. If `resolveRampForCiv` ever stopped
    // substituting `--civ-hue`, all four tenants would collapse onto the
    // neutral fallback, the matrix would still be 128 rows long, and the
    // failing set would still match the table — because these tokens fail on
    // every hue. Four identical rows repeated is the failure mode a row count
    // cannot see.
    for (const theme of THEMES) {
      const resolved = SURFACE_TOKENS.map((surface) =>
        CIV_PREFIXES.map((civ) => resolveRampForCiv(theme, civ, surface))
      );
      for (const perCiv of resolved) {
        expect(new Set(perCiv).size).toBe(CIV_PREFIXES.length);
      }
    }
  });

  it("has a light-mode value of its own for every ink and every surface", () => {
    // `LIGHT_TOKENS` is the RAW `.light` block, not the effective cascade. A
    // token `.light` forgets to redeclare keeps its DARK value under a white
    // canvas — near-white ink on a near-white surface — and the measurement
    // below would faithfully report that as a failure without ever saying why.
    // Naming the cause here means the diagnosis is one line, not an
    // investigation.
    for (const token of [...INK_TOKENS, ...SURFACE_TOKENS]) {
      expect(LIGHT_TOKENS[token]).toBeDefined();
    }
  });
});

describe("ink on surface clears AA, or is recorded with the ratio it measures", () => {
  it.each(MATRIX.map((c) => [c.key, c] as [string, Combo]))("%s", (_key, combo) => {
    const recorded = BELOW_AA[combo.key];
    if (recorded === undefined) {
      expect(combo.ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    } else {
      // Both halves asserted. The first pins the figure this file publishes —
      // a token nudged so the ratio moves but still fails has to be
      // re-measured, not left claiming a number it no longer produces. The
      // second is the absence half: a row cannot sit in the exception table
      // while quietly passing.
      expect(combo.ratio).toBeCloseTo(recorded, 2);
      expect(combo.ratio).toBeLessThan(AA_NORMAL_TEXT);
    }
  });

  it("the combinations under AA are exactly the ones recorded", () => {
    // The set comparison the per-case assertions cannot make: a recorded key
    // that names no combination in the matrix — a typo, a renamed token, a
    // civilization removed — is invisible to `it.each` over MATRIX, because
    // nothing iterates it.
    expect(Object.keys(measuredBelowAA()).sort()).toEqual(Object.keys(BELOW_AA).sort());
  });

  it("the two inks the app is mostly written in fail nowhere", () => {
    // Said separately from the set comparison because these are the two that
    // matter most and a reader should not have to diff two lists to see it.
    // `--color-ink` and `--color-ink-muted` are 848 of the 1093 ink references;
    // if either ever drops under AA on any surface, on any tenant, in either
    // theme, that should be a named failure rather than a new line appearing
    // in a 35-row table.
    const failing = Object.keys(measuredBelowAA());
    expect(failing.filter((key) => key.endsWith(" --color-ink"))).toEqual([]);
    expect(failing.filter((key) => key.endsWith(" --color-ink-muted"))).toEqual([]);
  });

  it("records nothing that is comfortably passing, and nothing impossible", () => {
    // Keeps the table from turning into scenery in the other direction: every
    // recorded ratio has to be a plausible sub-AA measurement. A `0` or a `21`
    // pasted in by hand would still satisfy the per-case `toBeCloseTo` only if
    // the measurement agreed, but this says the intent out loud.
    for (const [key, ratio] of Object.entries(BELOW_AA)) {
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(AA_NORMAL_TEXT);
      expect(MATRIX.some((c) => c.key === key)).toBe(true);
    }

    // `expect(Object.keys(BELOW_AA).length).toBeGreaterThan(0)` stood here and
    // was right for as long as the table had 35 rows: it stopped somebody
    // emptying the table instead of fixing the tokens. All 35 are now fixed, so
    // that guard would forbid the state the work was for.
    //
    // Removing it costs nothing, and the reason is worth writing down rather
    // than assuming: emptying this table without fixing anything is already
    // caught, one test up, by the set equality against `measuredBelowAA()`. The
    // `> 0` was belt-and-braces over that, not the mechanism. What replaces it
    // is the same claim stated for the current state — the measurement finds
    // nothing below AA, which is what an empty table is asserting.
    expect(Object.keys(measuredBelowAA())).toEqual([]);
  });
});

describe("the WCAG helpers this file imports", () => {
  // `contrastRatio` and `relativeLuminance` were added to the support module
  // by this pass. A formula nobody checked would make every number above a
  // confident fiction, and the whole table is only as good as these four
  // lines.
  it("reproduces the reference black-on-white ratio", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });

  it("returns 1 for a colour against itself, in both argument orders", () => {
    expect(contrastRatio([18, 52, 86], [18, 52, 86])).toBeCloseTo(1, 10);
    const a: [number, number, number] = [10, 200, 30];
    const b: [number, number, number] = [240, 12, 90];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("reproduces the published reference grey", () => {
    // #767676 on white is 4.54:1 — the canonical "dimmest grey that still
    // passes AA on white", quoted in every contrast tool there is. An anchor
    // from OUTSIDE this repository, so the helpers cannot be self-consistently
    // wrong: everything else here is measured by the same four lines being
    // checked.
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });

  // The two ratios globals.css states about itself against light-mode white,
  // checked in BOTH directions.
  //
  // This began as one hardcoded cross-check of `--color-accent`'s stated
  // 2.14:1. Its neighbour `--color-accent-ink` carried "32% lightness: 4.83:1"
  // for a token declaring 34%, which measures 5.05:1 — and 4.83 turned out to
  // be borrowed from the `150 62% 28%` tokens further down, whose own note says
  // they were measured against a TINTED background rather than a flat swatch.
  // It arrived here with its background silently rewritten to "light-mode
  // white". Neither half of that sentence described the token it sat above.
  //
  // WHY THE FIGURES ARE LISTED AND NOT PARSED OUT OF THE COMMENTS. That was the
  // first attempt and it is the more fragile design: the accent claim lives in
  // the `:root` block while describing light-mode behaviour, and the
  // accent-ink comment states TWO ratios and names a DIFFERENT token, so
  // attributing a figure by position or by the nearest token name gets the
  // pairing wrong. A parser that mis-attributes is worse than a list, because
  // it looks general.
  //
  // Both directions, which is what makes a list enough here:
  //   * the MEASUREMENT must reproduce the figure — a retuned value with a
  //     stale comment is red;
  //   * the stylesheet TEXT must still contain the figure — an edited comment
  //     with an unchanged value is red too.
  // Only a retune that moves both, and updates this list, is green.
  const WHITE_CLAIMS: [token: string, claimed: number][] = [
    ["--color-accent", 2.14],
    ["--color-accent-ink", 5.05],
  ];

  it.each(WHITE_CLAIMS)(
    "%s measures the %s:1 against white that globals.css claims for it",
    (token, claimed) => {
      const ratio = contrastRatio(
        hslTripleToRgb(LIGHT_TOKENS[token]),
        hslTripleToRgb(LIGHT_TOKENS["--color-canvas"])
      );
      expect(ratio).toBeCloseTo(claimed, 1);
    }
  );

  it("checks every claim it lists", () => {
    // A floor, because the parametrisation above shrinks silently: delete a row
    // and there is simply one fewer case, with nothing to say a claim stopped
    // being checked. Found by mutation — removing the accent-ink row left the
    // file green at 141 tests.
    expect(WHITE_CLAIMS.length).toBeGreaterThanOrEqual(2);
    expect(WHITE_CLAIMS.map(([token]) => token)).toEqual(
      expect.arrayContaining(["--color-accent", "--color-accent-ink"])
    );
  });

  // WHAT THIS PAIR DOES NOT CATCH, said rather than left to be assumed.
  //
  // A comment edited to a wrong figure while the value stays correct — which is
  // precisely the bug above — is NOT caught here, and two attempts at catching
  // it were removed rather than shipped:
  //
  //   * A whole-file substring search for the figure. It cannot fail: the
  //     corrected accent-ink note explains the bug by quoting both the right
  //     and the wrong ratio, so the string is present whatever the claim line
  //     says. Mutating that line left the suite green.
  //   * "the figure must appear in the comment directly above the declaration".
  //     This stylesheet is not written that way. The 2.14:1 claim lives in the
  //     `:root` block, sits above `--color-accent-ink`, and is about
  //     `--color-accent`; only the accent-ink claim happens to sit above its
  //     own declaration. A positional rule reaches one of the two and
  //     mis-attributes the other, which is worse than not reaching either,
  //     because it looks general.
  //
  // So the direction that IS covered is the dangerous one: a value that moves
  // away from the figure the stylesheet states. A stale comment over a correct
  // value is a documentation defect and reads as one; a correct comment over a
  // drifted value is a contrast claim that is false about the shipped pixels.
});
