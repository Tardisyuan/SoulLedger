/**
 * `app/globals.css` is the authority for colour. This file makes that true.
 *
 * `lib/chart-colors.ts` exists for a real reason — Recharts props take concrete
 * values and cannot read CSS custom properties — but it was held to the tokens
 * by nothing except a `KEEP IN SYNC` comment, and that comment failed twice
 * without anyone noticing:
 *
 *   - `STATE_COLORS.JUDGING` was still `38 92% 50%`, the accent amber that a
 *     whole restyle had deliberately moved JUDGING off because it collided with
 *     every button and link. The live token is `20 88% 58%`.
 *   - `DISPOSED` and `REINCARNATING` were still `220 80% 62%` and
 *     `217 91% 60%` — the near-identical pair of blues that existed *before*
 *     DISPOSED was moved to purple so PURGATORY could take the blue. Charts
 *     were drawing two lifecycle states 3° apart.
 *   - `ALIVE` and `LOST` were also pre-split values (`160 84% 39%`, `0 0% 50%`).
 *   - `CIVILIZATION_COLORS` mirrored `--color-civ-cn/-eu/-eg`, three tokens
 *     that no longer exist under any name, and had no Greek entry at all.
 *
 * Every one of those is the same failure: a comment makes a claim on behalf of
 * code nobody re-derives. So this test re-derives it. It parses globals.css and
 * compares **in both directions** — a token with no mirror entry is as red as a
 * mirror entry with no token — because one-directional checks are how the
 * fourth civilization stayed invisible in the first place.
 *
 * No DOM and no browser: a file read and two regexes, the same technique
 * `backend/apps/ledger/test_readings.py::TestFrontendMemberListsAgree` uses to
 * hold the two ends of the ledger payload together.
 *
 * BOTH THEMES. `lib/chart-colors.ts` exports one table per theme, and every pin
 * below runs over `THEMES`. The earlier version pinned only `:root` — the dark
 * block — while globals.css declares a separately measured value for each of
 * these tokens under `.light`, so half the mirror was unpinned and charts drew
 * dark colours on light pages.
 *
 * SCOPE. This file covers the two tables keyed by a *domain enumeration* —
 * civilizations and lifecycle states — and the `[data-civ]` wiring that makes
 * the civilization tokens paint anything. `chartColourContract.test.ts` covers
 * the other three (REALM_COLORS, CHART_SERIES, CHART_CHROME), which were never
 * mirrors at all. Both import their parser from `./support/globalsCssTokens`
 * rather than each carrying a copy: two regex readers of one stylesheet is the
 * same defect these tests exist to close.
 */
import {
  CIV_PREFIXES,
  CIV_PREFIX_BY_TENANT_CODE,
  LIGHT_TOKENS,
  ROOT_TOKENS,
  TENANT_CODES,
  THEMES,
  TOKENS_BY_THEME,
  type ThemeName,
  asChartLiteral,
  civPairs,
  hslTripleToRgb,
  maxChannelDelta,
  readCivAttrRules,
  readSoulStates,
  resolveRampForCiv,
  suffixesOf,
  SURFACE_TOKENS,
} from "./support/globalsCssTokens";
import { CHART_COLORS } from "@/lib/chart-colors";

/** Every `theme × key` pair, so `it.each` reads as one row per pin. */
function pins(keys: readonly string[]): [ThemeName, string][] {
  return THEMES.flatMap((theme) => keys.map((key) => [theme, key] as [ThemeName, string]));
}

// ---------------------------------------------------------------------------

describe("the parser is looking at something", () => {
  // If any of these break, every assertion below goes vacuously green. They are
  // the "mutate the thing it guards" guard for the guard itself.
  it("reads a token whose comment names another token", () => {
    // THE SWALLOW, PINNED. `readTokens` used to scan block bodies INCLUDING
    // their comments. The note above `--color-karma-merit` says "Renamed from
    // --color-merit/--color-demerit: this pair now has its own semantic
    // identity …" — the declaration regex matched `--color-demerit:` inside
    // that prose and `[^;]+` ran on to the semicolon ending the real
    // declaration. `--color-karma-merit` came back `undefined` and a phantom
    // `--color-demerit` held a paragraph.
    //
    // Every contract test importing this module was blind to that token, so an
    // assertion shaped "every karma token is X" skipped merit and passed.
    //
    // Only the DARK declaration carries that comment, so `.light` had the token
    // all along — the two themes disagreed about whether it existed and nothing
    // said so. Both are asserted.
    //
    // Checked by KEY PRESENCE and not by value: merit shares `150 62% 46%` with
    // --color-verdict-passed, --color-status-alive and --color-status-success
    // in dark, so a value comparison cannot tell a token that was read from one
    // that was never seen.
    expect(ROOT_TOKENS).toHaveProperty("--color-karma-merit");
    expect(LIGHT_TOKENS).toHaveProperty("--color-karma-merit");
  });

  it("gives every token a value shaped like a value", () => {
    // The general form, and it is NOT a name check. The phantom this caught was
    // called `--color-demerit` — squarely inside the `--color-*` family — so
    // "no token outside the known families" would have passed it happily. What
    // gives a swallowed comment away is its VALUE: prose spans lines and runs
    // long, and no real token value does either.
    //
    // Proven independent: with the key-presence assertion above neutered, this
    // one still goes red on its own when the comment stripping is removed.
    const misshapen = Object.entries({ ...ROOT_TOKENS, ...LIGHT_TOKENS })
      .filter(([, value]) => value.includes("\n") || value.length > 60)
      .map(([name, value]) => `${name} = ${value.slice(0, 40)}…`);
    expect(misshapen).toEqual([]);
  });

  it("found more than one civilization", () => {
    expect(CIV_PREFIXES.length).toBeGreaterThan(1);
    expect(TENANT_CODES.length).toBe(CIV_PREFIXES.length);
  });

  it("found real token blocks in globals.css", () => {
    expect(Object.keys(ROOT_TOKENS).length).toBeGreaterThan(20);
    expect(Object.keys(LIGHT_TOKENS).length).toBeGreaterThan(20);
    expect(ROOT_TOKENS["--color-surface-1"]).toBe("var(--civ-hue) 13% 7%");
  });

  it("found the soul lifecycle states", () => {
    expect(readSoulStates()).toEqual(expect.arrayContaining(["ALIVE", "JUDGING"]));
  });
});

describe("civilization identity: globals.css is the authority", () => {
  it("declares a hue token for every civilization, and none it does not have", () => {
    expect(suffixesOf(ROOT_TOKENS, "--color-civ-hue")).toEqual(CIV_PREFIXES);
  });

  it("declares a mark token for every civilization, and none it does not have", () => {
    expect(suffixesOf(ROOT_TOKENS, "--color-civ-mark")).toEqual(CIV_PREFIXES);
  });

  it("light mode declares exactly the same civilization tokens as dark", () => {
    // A civilization present in `:root` but absent from `.light` inherits the
    // dark value in light mode rather than failing — silently, and only on one
    // theme, which is the hardest kind of gap to see.
    expect(suffixesOf(LIGHT_TOKENS, "--color-civ-hue")).toEqual(CIV_PREFIXES);
    expect(suffixesOf(LIGHT_TOKENS, "--color-civ-mark")).toEqual(CIV_PREFIXES);
  });

  it("gives every civilization a [data-civ] rule wired to its own hue token", () => {
    // The enumeration point Greek was missing from. Tokens alone paint nothing.
    const rules = readCivAttrRules();
    expect(Object.keys(rules).sort()).toEqual(CIV_PREFIXES);
    for (const prefix of CIV_PREFIXES) {
      expect(rules[prefix].hue).toBe(`--color-civ-hue-${prefix}`);
    }
  });

  it("gives every civilization a [data-civ] rule wired to its own mark token", () => {
    // The hue's twin, and the one Stage 10 needs. The masthead draws the mark
    // in three places — expanded lockup, collapsed rail, mobile chip — and none
    // of them knows which tenant it is rendering; they read `hsl(var(--civ-mark))`
    // and let this rule decide. A civilization with a hue alias and no mark
    // alias therefore paints an identity dot with no colour, on the one element
    // whose whole job is saying which cosmology this is.
    const rules = readCivAttrRules();
    for (const prefix of CIV_PREFIXES) {
      expect(rules[prefix].mark).toBe(`--color-civ-mark-${prefix}`);
    }
  });

  it.each(CIV_PREFIXES)("--color-civ-hue-%s is a bare hue degree, not an HSL triple", (prefix) => {
    // This is the whole reason the `--color-civ-*` table in
    // docs/design-handoff/tokens.md was deleted instead of recalibrated. The
    // hue token is interpolated as `hsl(var(--civ-hue) 13% 7%)`; a full triple
    // in that slot produces an invalid colour, so a "corrected" table of
    // triples would still have been the wrong shape.
    for (const tokens of [ROOT_TOKENS, LIGHT_TOKENS]) {
      expect(tokens[`--color-civ-hue-${prefix}`]).toMatch(/^\d+(\.\d+)?$/);
    }
  });

  it.each(CIV_PREFIXES)("--color-civ-mark-%s is a full HSL triple", (prefix) => {
    for (const tokens of [ROOT_TOKENS, LIGHT_TOKENS]) {
      expect(tokens[`--color-civ-mark-${prefix}`]).toMatch(/^\d+(\.\d+)?\s+[\d.]+%\s+[\d.]+%$/);
    }
  });

  it.each(CIV_PREFIXES)("the mark and hue tokens for %s agree on the hue", (prefix) => {
    for (const tokens of [ROOT_TOKENS, LIGHT_TOKENS]) {
      const hue = tokens[`--color-civ-hue-${prefix}`];
      expect(tokens[`--color-civ-mark-${prefix}`].split(/\s+/)[0]).toBe(hue);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * The most any two tenants' surfaces may differ, as pixels, before the ramp is
 * claiming to do a job it was measured as unable to do.
 *
 * Observed today: 6/255, at surface-2 and surface-4 in dark mode. The Stage 9
 * headline figure is surface-1's 4/255 between Chinese (12deg) and European
 * (232deg) — 220deg apart, the widest separation the palette has and a
 * deliberately chosen one. Light mode is flatter still, 2-5/255, because HSL
 * chroma collapses toward white.
 *
 * 8 is that worst case plus room to retune lightness. It is nowhere near the
 * ~35-40% saturation that would make the ramp actually express a hue, which is
 * the point: raising the ramp to carry identity repaints every screen in the
 * app and is a design decision with its own review, not a token tweak. This
 * number turning red IS that review being demanded.
 */
const RAMP_NEUTRALITY_CEILING = 8;

/** How far above the ramp the marks must sit for "identity lives on the mark" to be true. */
const MARK_SEPARATION_MULTIPLE = 3;

function rampRgb(theme: ThemeName, prefix: string, token: string): [number, number, number] {
  return hslTripleToRgb(resolveRampForCiv(theme, prefix, token));
}

function markRgb(theme: ThemeName, prefix: string): [number, number, number] {
  return hslTripleToRgb(TOKENS_BY_THEME[theme][`--color-civ-mark-${prefix}`]);
}

/** Widest gap between any two tenants across the whole ramp, in one theme. */
function widestRampGap(theme: ThemeName): number {
  return Math.max(
    ...SURFACE_TOKENS.flatMap((token) =>
      civPairs().map(([a, b]) => maxChannelDelta(rampRgb(theme, a, token), rampRgb(theme, b, token)))
    )
  );
}

/** Narrowest gap between any two tenants' marks, in one theme. */
function narrowestMarkGap(theme: ThemeName): number {
  return Math.min(...civPairs().map(([a, b]) => maxChannelDelta(markRgb(theme, a), markRgb(theme, b))));
}

describe("the surface ramp is a near-neutral floor, and the mark is the identity", () => {
  /**
   * THE RULING THIS PINS. Stage 1 §4.9 asked for civilization identity to be
   * surface-first, and globals.css was built that way. Stage 9 measured it and
   * it does not work: at 13% saturation and 7% lightness the ramp cannot
   * express a hue at all, so every tenant renders on what is in practice the
   * same near-black. The owner's decision was to accept that — the ramp is a
   * neutral floor, `--color-civ-mark-*` carries recognition on its own — rather
   * than raise the ramp's saturation, which repaints the entire application.
   *
   * The failure mode this exists to catch is nobody reading that decision and
   * assuming the ramp works. Two ways that shows up in a diff: someone raises
   * the ramp's saturation so it "finally" tints per tenant (first pin), or
   * someone flattens the marks toward each other on the theory that the ramp is
   * already separating the tenants (second pin).
   *
   * NOT covered here, on purpose: the ramp losing its `var(--civ-hue)` wiring
   * altogether. That collapses every tenant to one literal, which these
   * assertions would read as *maximum* neutrality and pass. It is a different
   * decision and `chartColourContract.test.ts` already pins it by name, in both
   * themes — duplicating it here would give two checks nobody re-derives.
   */
  it.each(THEMES)("%s: no two tenants' surfaces separate by more than the ceiling", (theme) => {
    // Collected rather than asserted one at a time so a red run names every
    // offending surface and pair at once — "surface-2 cn/eu at 61" is a
    // reviewable sentence; "expected 61 to be <= 8" is not.
    const offenders = SURFACE_TOKENS.flatMap((token) =>
      civPairs()
        .map(([a, b]) => ({
          where: `${token} ${a}/${b}`,
          delta: maxChannelDelta(rampRgb(theme, a, token), rampRgb(theme, b, token)),
        }))
        .filter((row) => row.delta > RAMP_NEUTRALITY_CEILING)
    );
    expect(offenders).toEqual([]);
  });

  it.each(THEMES)("%s: the marks separate tenants by a wide multiple of what the ramp does", (theme) => {
    const ramp = widestRampGap(theme);
    const mark = narrowestMarkGap(theme);
    // Derived, not a second magic number: the claim is a *relationship*. If the
    // ramp ever out-separates the marks — either because it got louder or
    // because they got quieter — the sentence "identity lives on the mark" has
    // stopped being true and this file said so first.
    expect(mark).toBeGreaterThanOrEqual(ramp * MARK_SEPARATION_MULTIPLE);
  });

  it("the ramp is measurably flatter than the marks, and neither figure is degenerate", () => {
    // Guard the guard. If `resolveRampForCiv` silently started returning one
    // colour for every civilization, the first pin would read 0 and pass; if
    // `hslTripleToRgb` returned zeroes, both would. Assert the shape of the
    // measurement, not only its verdict.
    for (const theme of THEMES) {
      expect(widestRampGap(theme)).toBeGreaterThan(0);
      expect(narrowestMarkGap(theme)).toBeGreaterThan(RAMP_NEUTRALITY_CEILING);
      // Two tenants 220deg apart still land within a few points of each other:
      // this is the measurement the ruling rests on, restated as an assertion.
      expect(rampRgb(theme, "cn", "--color-surface-1")).not.toEqual(
        rampRgb(theme, "eu", "--color-surface-1")
      );
    }
  });
});

describe("CIVILIZATION_COLORS mirrors --color-civ-mark-* exactly", () => {
  it.each(THEMES)("%s keys off tenant codes — one per civilization, no more and no less", (theme) => {
    // Forward AND reverse in one assertion: an extra key and a missing key are
    // both a failed set equality.
    expect(Object.keys(CHART_COLORS[theme].CIVILIZATION_COLORS).sort()).toEqual([...TENANT_CODES].sort());
  });

  it.each(pins(TENANT_CODES))("%s: %s carries the mark token verbatim", (theme, code) => {
    const prefix = CIV_PREFIX_BY_TENANT_CODE[code];
    const token = TOKENS_BY_THEME[theme][`--color-civ-mark-${prefix}`];
    expect(token).toBeDefined();
    expect(CHART_COLORS[theme].CIVILIZATION_COLORS[code]).toBe(asChartLiteral(token));
  });

  it.each(THEMES)("%s has no entry pointing at a token that does not exist", (theme) => {
    // The reverse direction, said the other way round: this is what would have
    // caught `CN_DIYU: hsl(38 92% 50%)` mirroring `--color-civ-cn` years after
    // `--color-civ-cn` stopped existing.
    const tokens = TOKENS_BY_THEME[theme];
    const declared = new Set(
      suffixesOf(tokens, "--color-civ-mark").map((s) => asChartLiteral(tokens[`--color-civ-mark-${s}`]))
    );
    for (const value of Object.values(CHART_COLORS[theme].CIVILIZATION_COLORS)) {
      expect([...declared]).toContain(value);
    }
  });

  it("does not paint two civilizations the same, in either theme", () => {
    // The mark is tenant IDENTITY; two tenants sharing one is the whole
    // failure the Greek hue was chosen to avoid. Checked per theme because the
    // light marks are separately authored values, not a formula applied to the
    // dark ones.
    for (const theme of THEMES) {
      const values = Object.values(CHART_COLORS[theme].CIVILIZATION_COLORS);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("STATE_COLORS mirrors --color-status-<state> exactly", () => {
  const SOUL_STATES = readSoulStates();

  it.each(THEMES)("%s covers every state the payload can carry, and nothing else", (theme) => {
    expect(Object.keys(CHART_COLORS[theme].STATE_COLORS).sort()).toEqual([...SOUL_STATES].sort());
  });

  it.each(pins(SOUL_STATES))("%s: %s carries the status token verbatim", (theme, state) => {
    const token = TOKENS_BY_THEME[theme][`--color-status-${state.toLowerCase()}`];
    expect(token).toBeDefined();
    expect(CHART_COLORS[theme].STATE_COLORS[state]).toBe(asChartLiteral(token));
  });

  it.each(SOUL_STATES)("%s is declared by `.light` itself, not inherited from `:root`", (state) => {
    // NOT the same check as the pin above, and not made redundant by it. That
    // one compares against the EFFECTIVE light value, which falls back to the
    // `:root` declaration when `.light` is silent — so a state missing from
    // `.light` would satisfy it while rendering the dark colour on a white
    // page. This is the assertion that sees the omission.
    expect(LIGHT_TOKENS[`--color-status-${state.toLowerCase()}`]).toBeDefined();
  });

  it.each(THEMES)("%s does not reuse one hue for two lifecycle states", (theme) => {
    // The concrete regression: DISPOSED (220°) and REINCARNATING (217°) were
    // 3° apart in this map long after the tokens moved them 90° apart. Two
    // states rendered in one colour is the failure; identical *values* is the
    // symptom this can actually see.
    const values = Object.values(CHART_COLORS[theme].STATE_COLORS);
    expect(new Set(values).size).toBe(values.length);
  });
});
