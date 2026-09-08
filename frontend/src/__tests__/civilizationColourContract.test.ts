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
    expect(ROOT_TOKENS["--color-surface-1"]).toBe("var(--civ-hue) 47% 7%");
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
 * The width, in pixels, below which a flat-field colour difference is not
 * something a reader can be asked to rely on.
 *
 * THIS IS STAGE 9'S NUMBER WITH ITS SIGN REVERSED, AND THAT IS THE POINT.
 * It was `RAMP_NEUTRALITY_CEILING = 8`: "the most any two tenants' surfaces may
 * differ before the ramp is claiming to do a job it was measured as unable to
 * do", set at the observed worst case (6/255) plus room. Stage 11 raised the
 * ramp's chroma deliberately, so the same 8 now marks the floor the ramp has to
 * clear rather than the ceiling it had to stay under.
 *
 * Reusing the value rather than picking a fresh one is deliberate: a threshold
 * chosen to make a new measurement pass is not a threshold. This one was chosen
 * before the change it now judges, by the review that argued the ramp expressed
 * nothing — so "the ramp is outside the band Stage 9 held it inside" is a claim
 * about the design, not about this file's arithmetic.
 */
const PERCEPTIBILITY_FLOOR = 8;

/**
 * How far the marks must lead the ramp for "identity leads, the ground follows"
 * to be true. UNCHANGED IN VALUE from the Stage 9 ruling — what changed is the
 * subject it is applied to; see the per-pair note on the pin below.
 */
const MARK_SEPARATION_MULTIPLE = 3;

function rampRgb(theme: ThemeName, prefix: string, token: string): [number, number, number] {
  return hslTripleToRgb(resolveRampForCiv(theme, prefix, token));
}

function markRgb(theme: ThemeName, prefix: string): [number, number, number] {
  return hslTripleToRgb(TOKENS_BY_THEME[theme][`--color-civ-mark-${prefix}`]);
}

/** Widest gap between one PAIR of tenants across the whole ramp, in one theme. */
function rampGapForPair(theme: ThemeName, a: string, b: string): number {
  return Math.max(
    ...SURFACE_TOKENS.map((token) => maxChannelDelta(rampRgb(theme, a, token), rampRgb(theme, b, token)))
  );
}

/** Widest gap between any two tenants across the whole ramp, in one theme. */
function widestRampGap(theme: ThemeName): number {
  return Math.max(...civPairs().map(([a, b]) => rampGapForPair(theme, a, b)));
}

/** Narrowest gap between any two tenants' marks, in one theme. */
function narrowestMarkGap(theme: ThemeName): number {
  return Math.min(...civPairs().map(([a, b]) => maxChannelDelta(markRgb(theme, a), markRgb(theme, b))));
}

describe("the surface ramp carries the tenant, and the mark still leads it", () => {
  /**
   * THE RULING THIS PINS, AND IT IS NOT THE ONE THIS BLOCK USED TO PIN.
   *
   * Stage 1 §4.9 asked for civilization identity to be surface-first and
   * globals.css was built that way. Stage 9 measured it, found 4-6/255 between
   * any two tenants in either theme, and ruled the ramp a near-neutral floor
   * with `--color-civ-mark-*` carrying recognition alone — while naming the
   * change that would reverse it: "raising the ramp's saturation to ~35-40% ...
   * is a design change needing its own review". Stage 11 is that review and it
   * reversed the ruling. The ramp now separates tenants by 16-17/255 in dark
   * and 10-16/255 in light, and every ink x surface pair still clears AA.
   *
   * SO THE FIRST PIN IS NOT THE OLD PIN RETUNED. Its old form asserted the ramp
   * sat BELOW the threshold of perception; that sentence is now false on
   * purpose, and moving `8` up to `20` to keep it green would have been the
   * assertion outliving its subject. It is replaced by its inverse — the ramp
   * must reach ABOVE that same threshold — which is a different claim measured
   * against the same, unmoved number.
   *
   * THE SECOND PIN KEPT ITS NUMBER AND CHANGED ITS SUBJECT, which is the part
   * worth reading. It compared the NARROWEST mark gap against the WIDEST ramp
   * gap — two different pairs of tenants. That was sound while every ramp pair
   * measured the same 4-6/255, and it stopped being sound the moment the ramp
   * varied: it was weighing Chinese/Egyptian's marks (the narrowest, 45-51)
   * against Chinese/European's ramp (the widest, 16-17), which is not a
   * relationship anyone could act on. Per pair the measured lead is 5.0x-7.6x,
   * comfortably past the 3x this file has always asked for; the global form
   * fails in light mode at 2.8x purely by mismatching the pairs.
   *
   * WHAT THE FIRST PIN DELIBERATELY DOES NOT SAY. The ramp does not separate
   * EVERY pair perceptibly — Chinese/Egyptian (32deg apart) measures 9/255 dark
   * and 5-9/255 light, Egyptian/Greek 7-8 and 5-7. Hue at 7% and 93.5%
   * lightness has a chroma ceiling and adjacent hues run into it. That is
   * precisely why the second pin is the load-bearing one: the ground tells some
   * tenants apart, the mark tells all of them apart, and the ordering between
   * the two channels is the invariant.
   *
   * NOT covered here, on purpose, unchanged from Stage 9: the ramp losing its
   * `var(--civ-hue)` wiring altogether. `chartColourContract.test.ts` pins that
   * by name in both themes. Nor is AA covered here — `inkOnSurfaceContract`
   * asserts its failing set as an EXACT set, so the ceiling on how much chroma
   * the ramp may carry is already enforced, once, in the file that owns it.
   */
  it.each(THEMES)("%s: every surface separates the tenants it can be asked to", (theme) => {
    // Collected rather than asserted one at a time so a red run names every
    // surface that went flat at once — "surface-2 widest pair at 3" is a
    // reviewable sentence; "expected 3 to be > 8" is not.
    const flat = SURFACE_TOKENS.map((token) => ({
      where: token,
      widest: Math.max(
        ...civPairs().map(([a, b]) => maxChannelDelta(rampRgb(theme, a, token), rampRgb(theme, b, token)))
      ),
    })).filter((row) => row.widest <= PERCEPTIBILITY_FLOOR);
    expect(flat).toEqual([]);
  });

  it.each(THEMES)("%s: for every pair, the mark leads the ramp by the multiple", (theme) => {
    // PER PAIR, not narrowest-against-widest. Two tenants whose grounds are
    // nearly identical are exactly the ones whose marks have to carry the
    // distinction, and a global comparison averages that case away — it can
    // report a healthy ratio while the one pair that needs it fails.
    const short = civPairs()
      .map(([a, b]) => ({
        pair: `${a}/${b}`,
        ramp: rampGapForPair(theme, a, b),
        mark: maxChannelDelta(markRgb(theme, a), markRgb(theme, b)),
      }))
      .filter((row) => row.mark < row.ramp * MARK_SEPARATION_MULTIPLE);
    expect(short).toEqual([]);
  });

  it("neither figure is degenerate, and the marks still lead overall", () => {
    // Guard the guard. If `resolveRampForCiv` silently started returning one
    // colour for every civilization the first pin would read 0 — which now goes
    // RED rather than green, the one thing the inversion improved for free. The
    // second pin would still pass on a collapsed ramp, so the shape of the
    // measurement is asserted here and not only its verdict.
    for (const theme of THEMES) {
      expect(widestRampGap(theme)).toBeGreaterThan(0);
      expect(narrowestMarkGap(theme)).toBeGreaterThan(PERCEPTIBILITY_FLOOR);
      expect(narrowestMarkGap(theme)).toBeGreaterThan(widestRampGap(theme));
      // The measurement Stage 9's ruling rested on and Stage 11 moved: two
      // tenants 220deg apart used to land 4/255 apart here. They no longer do,
      // and the assertion is kept in its original form — different, not merely
      // further apart — because a ramp that stopped varying would satisfy every
      // gap-based check by reading as maximally flat.
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
