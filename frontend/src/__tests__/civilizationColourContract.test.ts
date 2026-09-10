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
 *
 * WHICH METRIC ANSWERS "DO THESE LOOK ALIKE", AND WHY THE FILE NAMES TWO.
 * Every "N/255" figure this file used to reason with came from
 * `maxChannelDelta`, which reports the largest of three per-channel
 * differences and is therefore close to blind along the hue axis — the only
 * axis the civilization palette varies. It concluded that two pairs of tenants
 * were indistinguishable; in CIEDE2000 all six pairs are plainly separated, in
 * both themes. That conclusion, not the palette, is what Stage 12 corrected —
 * the tokens did not move.
 *
 * The channel metric is still here, in one pin, because its threshold `8` is a
 * ruling from a named review and channel steps have no ΔE00 equivalent to move
 * it to. Everything that makes a claim about PERCEPTION is measured in ΔE00,
 * and the implementation is held to Sharma et al.'s 34-pair test vector below
 * before any pin is allowed to rest on it. The full argument sits on
 * `PERCEPTIBILITY_FLOOR` and `MARK_LEAD_MARGIN`.
 */
import {
  CIV_PREFIXES,
  CIV_PREFIX_BY_TENANT_CODE,
  HUE_READBACK_SLACK_DEG,
  LIGHT_TOKENS,
  ROOT_TOKENS,
  TENANT_CODES,
  THEMES,
  TOKENS_BY_THEME,
  type Lab,
  type ThemeName,
  asChartLiteral,
  civPairs,
  deltaE00,
  deltaE00Rgb,
  hslHueOfOklch,
  oklchTripleToRgb,
  rgbToOklchTriple,
  maxChannelDelta,
  readCivAttrRules,
  readSoulStates,
  resolveRampForCiv,
  srgbToLab,
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
    // The `:root` ramp is inert — every mapped tenant overrides it from
    // `:root[data-civ]` and the unmapped screen from `:root:not([data-civ])` —
    // but it must still be a colour, because it is what a fifth civilization
    // would render on the day it has tokens and no rule. This used to pin the
    // literal string `[--civ-hue] 47% 7%`, which is the same job: it proved
    // the parser was reading declarations and not prose.
    expect(ROOT_TOKENS["--color-surface-1"]).toMatch(/^[\d.]+\s+[\d.]+\s+-?[\d.]+$/);
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

  it("gives every civilization a :root[data-civ] rule wired to its own ramp tokens", () => {
    // The enumeration point Greek was missing from. Tokens alone paint nothing.
    //
    // This used to read `rules[prefix].hue === "--color-civ-hue-<p>"`, one
    // pointer per tenant, because the five planes were `[--civ-hue] S% L%`
    // and the hue was the only per-tenant part. OKLCH cannot factor them that
    // way — at one HSL saturation and lightness the four tenants' OKLCH L
    // spreads 0.057 and C spreads 0.010 — so each plane is its own literal and
    // the rule points at five. Same invariant, wider carrier: a tenant with
    // tokens and no rule still renders neutral, and now so does a tenant whose
    // rule forgot one plane.
    const rules = readCivAttrRules();
    expect(Object.keys(rules).sort()).toEqual(CIV_PREFIXES);
    for (const prefix of CIV_PREFIXES) {
      for (const plane of RAMP_TOKENS) {
        expect(rules[prefix].ramp[plane]).toBe(
          `--color-civ-${plane.replace("--color-", "")}-${prefix}`
        );
      }
    }
  });

  it("gives every civilization a [data-civ] rule wired to its own mark token", () => {
    // The hue's twin, and the one Stage 10 needs. The masthead draws the mark
    // in three places — expanded lockup, collapsed rail, mobile chip — and none
    // of them knows which tenant it is rendering; they read `oklch(var(--civ-mark))`
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
    // hue token is interpolated as `oklch([--civ-hue] 13% 7%)`; a full triple
    // in that slot produces an invalid colour, so a "corrected" table of
    // triples would still have been the wrong shape.
    for (const tokens of [ROOT_TOKENS, LIGHT_TOKENS]) {
      expect(tokens[`--color-civ-hue-${prefix}`]).toMatch(/^\d+(\.\d+)?$/);
    }
  });

  it.each(CIV_PREFIXES)("--color-civ-mark-%s is a full OKLCH triple", (prefix) => {
    for (const tokens of [ROOT_TOKENS, LIGHT_TOKENS]) {
      expect(tokens[`--color-civ-mark-${prefix}`]).toMatch(/^[\d.]+\s+[\d.]+\s+-?[\d.]+$/);
    }
  });

  it.each(CIV_PREFIXES)("the mark and hue tokens for %s agree on the hue", (prefix) => {
    // IT READS THE HUE THROUGH A CONVERSION NOW, AND THE INVARIANT DID NOT
    // MOVE. While the tokens were HSL the mark's first component WAS the hue,
    // so this was a string comparison. `--color-civ-mark-cn` is now an OKLCH
    // triple whose H is 35.30 while the tenant's hue is 12 — those are the same
    // colour in two coordinate systems, not a disagreement, and comparing the
    // OKLCH H directly would need a tolerance nothing here has measured.
    // `hslHueOfOklch` converts back to the coordinate the rule was written in,
    // so the assertion stays exact and still fails for a mark that wanders off
    // its tenant's hue.
    for (const tokens of [ROOT_TOKENS, LIGHT_TOKENS]) {
      const hue = Number(tokens[`--color-civ-hue-${prefix}`]);
      const read = hslHueOfOklch(tokens[`--color-civ-mark-${prefix}`]);
      expect(Math.abs(read - hue)).toBeLessThan(HUE_READBACK_SLACK_DEG);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * THE RULE THAT WAS WRITTEN DOWN ONCE, OBEYED ONCE, ENFORCED LATE, AND THEN
 * ENFORCED IN THE WRONG COORDINATE.
 *
 * globals.css chose Greek's 88° over the 138° that maximises the gap to the
 * other three cosmologies, and said why on the token: 138 sits 94° from both
 * neighbours but only 12° off `--color-karma-merit` / `--color-status-alive` /
 * `--color-verdict-passed`. "A civilization whose identity colour IS the merit
 * colour is a misreading, not a legibility complaint — a hue clash is hard to
 * tell apart, a semantic clash is read as the wrong thing."
 *
 * That paragraph is the whole of the rule's existence. It was applied to the
 * one hue being chosen at the time and to no other, and prose does not fail, so
 * the tenants that were already violating it went on violating it. The first
 * enforcement of it measured HSL HUE ANGLE between `--color-civ-hue-*` and the
 * semantic tokens, because degrees are the units the paragraph is written in.
 *
 * ===========================================================================
 * THE HUE-ANGLE PIN IS ARCHIVED BELOW RATHER THAN KEPT, AND THIS IS WHY.
 * ===========================================================================
 *
 * Two things were wrong with it, and neither is a tuning problem:
 *
 * THE SUBJECT WAS NOT A COLOUR. `--color-civ-hue-*` is a bare number that
 * NOTHING IN THE STYLESHEET READS ANY MORE (its own comment says so — it fed
 * `--civ-hue` until the OKLCH migration). The pin compared that number against
 * the hue angle of the semantic tokens. What a reader actually sees is
 * `--color-civ-mark-*` and `--color-civ-ink-*`, full OKLCH triples, whose
 * lightness and chroma the comparison threw away before it started.
 *
 * AND DEGREES ARE NOT PERCEPTUALLY UNIFORM, so "legal" and "actually
 * distinguishable" were different sets. Both directions were measured, and
 * both are worse than a near miss:
 *
 *   - FALSE NEGATIVE. Greek at 137° — the design the 12° clearance was built
 *     to reject, one degree off — clears it: 12.79° (dark) / 12.66° (light) of
 *     hue angle from `--color-karma-merit`, comfortably over 12. The same pair
 *     measures 3.39 ΔE00 dark / 4.04 light. `PERCEPTIBLE_AT_A_GLANCE` is 3.5.
 *     The hue pin was passing a Greek that is not reliably distinguishable
 *     from the merit colour AT ALL, which is a weaker bar than the one the
 *     rule's own prose sets, let alone the stronger one it asks for.
 *   - FALSE POSITIVE, IN THE LIMIT. Egyptian's 1.18° from `--color-accent-hover`
 *     was written up as "the worst violation in the palette". Rotate Egyptian
 *     onto accent-hover's hue EXACTLY — 0.00° of clearance, the worst reading
 *     the metric can produce — and the two colours are 13.38 ΔE00 apart in dark
 *     and 30.56 in light. Muted gold (193,163,89) against signal yellow
 *     (251,192,45). The metric's maximum complaint about Egyptian describes two
 *     colours nobody would confuse.
 *
 * AND IT COULD NOT NAME THE RIGHT NEIGHBOUR FOR THE ONE TENANT THE RULE WAS
 * WRITTEN FOR. In hue angle, Greek's nearest semantic token is
 * `--color-accent-hover`, 45.18° away; `--color-karma-merit` is 61.79° off and
 * ranks fifth. In ΔE00 Greek's nearest semantic colour IS `--color-karma-merit`
 * (12.98 dark / 11.81 light), with accent-hover at 28.13. The token the 88°
 * decision exists to avoid is the one the old metric ranked as not-a-concern.
 *
 * ---------------------------------------------------------------------------
 * THE ARCHIVED MEASUREMENT, KEPT WHOLE, WITH THE NEW COLUMN BESIDE IT.
 *
 * Left: `--color-civ-hue-*` against the nearest semantic HUE ANGLE, with the
 * chroma floor applied (see below). Right: that tenant's MARK against the
 * nearest semantic COLOUR in ΔE00. Every verdict in the palette flips.
 *
 *              old: nearest hue angle          new: nearest ΔE00
 *   cn dark     7.79°  status-judging  VIOL     9.63  karma-demerit    clear
 *   cn light    0.00°  status-judging  VIOL     5.73  status-judging   clear
 *   eu dark     8.36°  status-lost   (floored)  11.10 status-info      clear
 *   eu light    8.36°  status-lost   (floored)  8.73  status-info      clear
 *   eg dark     1.18°  accent-hover    VIOL     11.57 status-warning   clear
 *   eg light    1.18°  accent-hover    VIOL     14.03 status-warning   clear
 *   gr dark    45.18°  accent-hover    clear    12.98 karma-merit      clear
 *   gr light   45.18°  accent-hover    clear    11.81 karma-merit      clear
 *
 * The inks, which the old pin never looked at, are wider everywhere except
 * where they are the same triple as the mark: cn 12.63 / 9.56, eu 11.24 / 8.73,
 * eg 11.61 / 15.14, gr 12.98 / 12.58 (dark / light).
 *
 * ---------------------------------------------------------------------------
 * WHAT THE ARCHIVED PIN CONCLUDED, AND WHICH OF IT SURVIVES.
 *
 * SURVIVES — EUROPEAN NEEDS NO CHANGE, and the reasoning generalises. The hue
 * pin needed a CHROMA FLOOR at 0.04 to reach that answer: `--color-status-lost`
 * sits at hue 223.64° with chroma 0.0248, 8.36° from European, and counting it
 * made European a violation whose only legal band was 235.64–246.10° — which is
 * 240° and its neighbourhood, forbidden by name in `chartColourContract` as the
 * no-cosmology fallback hue. A rule with no legal answer. The floor was
 * justified in prose: "hue angle is a proxy for 'the same colour' only while
 * both colours HAVE a hue; below some chroma the angle is arithmetic on a grey."
 *
 * That sentence is correct, and ΔE00 makes it structural instead of a
 * constant. Chroma is one of the three axes the formula already weighs, so a
 * drained blue-grey is simply far from a saturated periwinkle: `status-lost`
 * ranks 4th / 2nd / 4th / 4th (dark mark, dark ink, light mark, light ink) at
 * 12.71 / 12.23 / 16.38 / 16.38, never nearest, and `SEMANTIC_CHROMA_FLOOR`
 * and its `CHROMA_GAP` bimodality pin are both retired as unnecessary rather
 * than as wrong. The pin below re-derives that instead of asserting it.
 *
 * REFUTED — "EGYPTIAN IS THE WORST VIOLATION IN THE PALETTE." It is the widest
 * clearance of the four, in both themes (11.57 / 14.03). The whole apparatus
 * built on top of that reading goes with it: the feasible set that was measured
 * to be EMPTY (clearance needs eg >= 54.82°, `ActorsPage.test.tsx`'s /actors
 * section grounds need eg <= 48°), the finding that chroma could not rescue it
 * either (at 58° the light mark hits the sRGB gamut edge and renders olive),
 * and the two-tenant escape route that was written down rather than done
 * (move Greek to ~105°, let Egyptian take 58°). All of it was true arithmetic
 * about a defect that the measurement never established. Egyptian does not need
 * to move; Greek does not need to move to let it. THE /ACTORS AND GAMUT
 * FIGURES REMAIN VALID as constraints on any FUTURE Egyptian move — they were
 * measured, they are just no longer load-bearing for a fix nobody needs.
 *
 * REFUTED — "CHINESE IS STRUCTURALLY UNFIXABLE." The argument was that red is
 * what the cosmology is and the semantic layer owns the whole red band:
 * `status-error` / `karma-demerit` / `verdict-failed` at 0.00° and
 * `status-judging` at 19.79° (dark) / 20.00° (light), with 12° of clearance
 * from each leaving nothing between them. In ΔE00 Chinese clears in both
 * themes. Light Chinese is the tightest figure in the palette and the exact
 * hue identity behind it is real — `--color-civ-hue-cn: 20` IS `status-judging`
 * to two decimal places — but the mark is a deep terracotta (153,78,41) and
 * judging is a bright amber, and the formula rates that separation 5.73.
 *
 * IT IS ALSO THE THINNEST MARGIN THIS PIN HOLDS: 0.73 over the threshold, on
 * light Chinese, against `--color-status-judging`. That is stated here rather
 * than left to be discovered, because it is the pair a future light-mode
 * Chinese change will redden first, and because a reader is entitled to know
 * that "all four clear" is not "all four clear comfortably".
 *
 * THE EXEMPTION TABLE IS GONE, AND ITS OWN SELF-INVALIDATION IS WHAT REMOVED
 * IT. `CIV_HUE_EXEMPTIONS` carried `cn` and `eg` with a structural paragraph
 * each and threw if a listed tenant stopped violating the rule. Carried across
 * to this metric unchanged it throws for BOTH rows at once:
 *
 *     CIV_HUE_EXEMPTIONS excuses a tenant that no longer needs excusing in dark.
 *     The entry has become a claim about a defect that is gone — delete it AND
 *     the paragraph above it […]
 *       cn: red is what the cosmology is, and --color-status-error (0°) plus …
 *       eg: clearance needs >= 54.82° but the /actors section grounds need …
 *
 * So the mechanism did what it was built to do: it refused to let two
 * paragraphs about defects that do not exist stay standing as live claims. The
 * mechanism itself is retired with them — with nothing to excuse, an
 * allow-list is a lever nobody is holding, and re-introducing one means
 * re-introducing it deliberately with the reason attached.
 *
 * ===========================================================================
 * WHY 5 ΔE00, AND WHY IT IS THE ONLY NUMBER THAT WAS AVAILABLE.
 * ===========================================================================
 *
 * The band is fixed at both ends by the derivation this rule already made,
 * re-measured in the new metric. Both ends are re-derived by the pin below
 * rather than quoted, so neither can go stale:
 *
 *   - THE END IT REJECTED. Greek at 138°, built the way the original decision
 *     imagined it — the mark's own lightness and chroma held, the hue rotated
 *     until it reads back at 138 — is 3.26 ΔE00 from `--color-karma-merit` in
 *     dark and 3.96 in light. The threshold has to redden that in both themes,
 *     so it must exceed 3.96.
 *   - THE END IT ACCEPTED. Greek at 88° is 12.98 dark / 11.81 light from the
 *     same token. The threshold has to keep that green, so it must not exceed
 *     11.81.
 *
 * Legal band: (3.96, 11.81]. Then two rules this file already lives by close it
 * to a single value:
 *
 *   - A THRESHOLD COMES FROM THE PUBLISHED LADDER, NOT FROM THIS PALETTE. That
 *     is the rule `PERCEPTIBLE_AT_A_GLANCE` and `MARK_LEAD_MARGIN` were both
 *     chosen under. The CIEDE2000 ladder has rungs at 1 (imperceptible below),
 *     2 (close inspection), 3.5 (at a glance) and 5 (obvious). EXACTLY ONE OF
 *     THEM FALLS INSIDE (3.96, 11.81]. Had the band excluded 5 there would have
 *     been no defensible number, and the honest report would have been that the
 *     metric change needs its own review rather than a constant.
 *   - AND IT MUST BE STRONGER THAN "AT A GLANCE", which the rule's own prose
 *     demands: "a hue clash is hard to tell apart, a semantic clash is READ AS
 *     the wrong thing." Being read as the wrong meaning is a stricter
 *     requirement than being hard to tell apart, so 3.5 is a floor this
 *     threshold has to clear, not a candidate for it. 5 — "obvious rather than
 *     merely visible" — is the next rung up, and the pin below asserts that
 *     ordering so the two constants cannot silently converge.
 *
 * WHY THE REJECTED CASE DOES NOT SUPPLY THE NUMBER THIS TIME, unlike the 12°
 * it supplied to the archived pin. 3.26 / 3.96 straddles 3.5. Under a
 * perceptual metric the historical rejection of 138° turns out to carry no
 * information beyond the weakest rung this file already owns — it was refusing
 * a design that fails "distinguishable at a glance", which nothing needed a new
 * constant to refuse. The case still fixes the LOWER BOUND of the band, and
 * that is the whole of what it can honestly do. The historical judgement is
 * vindicated, not overturned: 138° really was too close, and by more than its
 * author could show in degrees.
 *
 * WHY NOT 8. `PERCEPTIBILITY_FLOOR` is 8 and sits inside the band, and reusing
 * the numeral would be the exact failure that constant's own comment names:
 * "channel steps have no ΔE00 equivalent — a 'migrated 8' would be a new number
 * wearing an old number's authority". 8 measures a per-channel difference out
 * of 255. It is not a ΔE00 and cannot be spent as one.
 *
 * THAT 5 EQUALS `MARK_LEAD_MARGIN` IS THE SAME RUNG, NOT A COPY. That constant
 * is a MARGIN — a subtraction between two ΔE00 figures, "the mark leads the
 * ramp by an obvious step". This one is an ABSOLUTE distance between two
 * colours. They agree numerically because both were taken from the same
 * published rung for the same stated reason, which is what a ladder is for.
 *
 * ===========================================================================
 * THE SUBJECT, AND WHAT IS STILL NOT IN IT.
 * ===========================================================================
 *
 * MARK AND INK, both themes, against every semantic token — the things that get
 * painted. `--color-civ-ink-*` is the identity made readable as text and is
 * drawn on badges; it was outside the archived pin entirely because a hue token
 * has only one number per tenant. Note that it is not always a second data
 * point: dark Greek and light European declare ink and mark as the SAME triple.
 *
 * NOT THE RAMP. `--color-surface-*` and `--color-canvas` carry the tenant too,
 * but they are grounds rather than identity, they are held by their own pins
 * (`MARK_LEAD_MARGIN`, `inkOnSurfaceContract`), and the ramp is not pinned to
 * the tenant hue at all: measured across all five planes it drifts 0.00–3.29°
 * from the declared hue for seven of the eight tenant×theme combinations, and
 * light Chinese drifts 5.00–10.00° by design (its ground is the one that is
 * not the hue token desaturated — see `--color-civ-hue-cn` in `.light`).
 * Judging a ground against a semantic foreground is a different claim and
 * would need its own derivation. (An earlier note gave this range as
 * 0.24–3.29; that was the DARK half only.)
 *
 * THE SCAN, NOT A ROSTER. Unchanged from the archived pin and still the half
 * most likely to rot: the semantic set is derived by EXCLUSION from every
 * `--color-*` the stylesheet declares — take away the per-tenant `--color-civ-*`
 * family (that is the subject), the ramp (`--color-surface-*`, `--color-canvas`)
 * and the achromatic chrome (`--color-ink*`, `--color-hairline*`). Whatever is
 * left names a MEANING, and a new family of meanings is included the day it is
 * declared rather than the day someone remembers this file. What IS new: the
 * pin now asserts that every surviving candidate parses as a bare OKLCH triple.
 * The archived version read chroma off each one and compared it to a floor, and
 * `NaN >= 0.04` is false — so a token declared as `var(…)` would have been
 * dropped from the comparison silently. Measured today: 20 candidates per
 * theme, none of them non-triple, so nothing was in fact being dropped.
 *
 * ===========================================================================
 * WHAT THIS METRIC STILL CANNOT SEE, SAID PLAINLY.
 * ===========================================================================
 *
 * ΔE00 measures DISCRIMINATION — can these two be told apart, side by side,
 * small difference — and the rule is about IDENTIFICATION: will this be read as
 * that meaning, seen alone, from memory, in a badge the size of a word. No
 * published metric answers the second question, and this one is fitted on
 * exactly the regime the rule is not about. Two consequences worth holding:
 *
 *   - It will pass a tenant sitting on a semantic token's exact hue as long as
 *     lightness or chroma separate them. Light Chinese IS that case today, at
 *     0.00° and 5.73. The archived metric was right that the hue identity is
 *     real; it was wrong that the hue identity is the whole question.
 *   - `MARK_LEAD_MARGIN`'s comment already records that CIEDE2000 was fitted
 *     for differences under about 5, and every figure this pin judges is above
 *     it. The ordering is trustworthy; the exact spacing between 9.63 and 14.03
 *     is not a claim the formula makes.
 *
 * The honest summary is that this metric is strictly better than the one it
 * replaces — it has no measured false positives or false negatives here, and it
 * removed a constant instead of adding one — and that it is still a proxy.
 */
const SEMANTIC_CLASH_DELTA_E = 5;

/** The mark is the identity; the ink is the identity made readable. Both are painted. */
const IDENTITY_KINDS = ["mark", "ink"] as const;

/** The case the rule rejected, in the units it was rejected in. See above. */
const REJECTED_GREEK_HSL_HUE = 138;

describe("no civilization's identity colour is a semantic colour", () => {
  /** Every `--color-*` that names a MEANING — derived by exclusion, never listed. */
  function semanticCandidates(tokens: Record<string, string>): string[] {
    return Object.keys(tokens)
      .filter(
        (name) =>
          name.startsWith("--color-") &&
          !/^--color-(civ-|surface-|canvas$|ink($|-)|hairline)/.test(name)
      )
      .sort();
  }

  function semanticColours(theme: ThemeName): { name: string; rgb: [number, number, number] }[] {
    const tokens = TOKENS_BY_THEME[theme];
    return semanticCandidates(tokens).map((name) => ({
      name,
      rgb: oklchTripleToRgb(tokens[name]),
    }));
  }

  /** Nearest semantic colour to one identity token, with the name kept for the failure message. */
  function nearestSemantic(
    theme: ThemeName,
    prefix: string,
    kind: string
  ): { name: string; d: number } {
    const rgb = oklchTripleToRgb(TOKENS_BY_THEME[theme][`--color-civ-${kind}-${prefix}`]);
    return semanticColours(theme)
      .map((s) => ({ name: s.name, d: deltaE00Rgb(rgb, s.rgb) }))
      .sort((a, b) => a.d - b.d)[0];
  }

  /** Shortest way round the circle, so 358° and 2° are 4° apart and not 356°. */
  function hueDistance(a: number, b: number): number {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /**
   * The hypothetical the rule rejected, reconstructed the way its author framed
   * it: the SAME COLOUR turned to a different hue. Lightness and chroma are the
   * mark's own, and OKLCH hue is searched until the HSL readback — the
   * coordinate `--color-civ-hue-*` is written in — lands on the target.
   */
  function rotateToHslHue(triple: string, targetHsl: number): string {
    const [L, C] = triple.split(/\s+/).map(Number);
    let best = triple;
    let bestErr = Infinity;
    for (let h = 0; h < 360; h += 0.01) {
      const candidate = `${L} ${C} ${h}`;
      const err = hueDistance(hslHueOfOklch(candidate), targetHsl);
      if (err < bestErr) {
        bestErr = err;
        best = candidate;
      }
    }
    return best;
  }

  // -- FIRST: the scanner found something. An empty scan and a clean palette
  // -- produce the same `toEqual([])`, and this repository has shipped that
  // -- shape before. Every floor here sits well under today's figure, so an
  // -- unrelated token arriving does not redden it.
  it("scans a semantic palette that is actually there", () => {
    expect(THEMES).toHaveLength(2);
    for (const theme of THEMES) {
      const names = semanticCandidates(TOKENS_BY_THEME[theme]);
      expect(names.length).toBeGreaterThanOrEqual(15);
      // Named because they are the three the Greek derivation argued from, and
      // a derivation whose subject silently left the scan is worth a red run.
      expect(names).toContain("--color-karma-merit");
      expect(names).toContain("--color-status-alive");
      expect(names).toContain("--color-verdict-passed");
      // The token the archived hue metric said Egyptian was colliding with.
      expect(names).toContain("--color-accent-hover");
      // Every family the exclusion rule is supposed to keep, kept.
      for (const family of ["--color-status-", "--color-verdict-", "--color-karma-"]) {
        expect(names.filter((n) => n.startsWith(family)).length).toBeGreaterThan(0);
      }
      // And every family it is supposed to drop, dropped — asserted so a
      // widened regex that swallowed the ramp would show up as a red run
      // rather than as a suspiciously large clearance.
      for (const name of names) {
        expect(name).not.toMatch(/^--color-(civ-|surface-|canvas$|ink($|-)|hairline)/);
      }
      // And every survivor is a colour this pin can actually measure. A
      // `var(…)` here used to fall out of the comparison without a word,
      // because the chroma floor it met was `NaN >= 0.04`.
      for (const name of names) {
        expect(TOKENS_BY_THEME[theme][name].trim()).toMatch(/^[\d.]+\s+[\d.]+\s+[\d.]+$/);
      }
    }
    // All four cosmologies are in the comparison, in both themes, both kinds.
    expect(CIV_PREFIXES.length).toBeGreaterThanOrEqual(4);
    for (const theme of THEMES) {
      for (const prefix of CIV_PREFIXES) {
        for (const kind of IDENTITY_KINDS) {
          expect(TOKENS_BY_THEME[theme][`--color-civ-${kind}-${prefix}`]).toMatch(
            /^[\d.]+\s+[\d.]+\s+[\d.]+$/
          );
        }
      }
    }
  });

  // -- THEN: the threshold's provenance, executable. Both ends are re-measured
  // -- from the stylesheet on every run, so a change to Greek's mark or to
  // -- `--color-karma-merit` that invalidates the derivation reddens the
  // -- derivation rather than quietly leaving 5 standing on a dead argument.
  it("puts the threshold between the case the rule rejected and the case it accepted", () => {
    // Stronger than "at a glance", because the rule's own words ask for it.
    expect(SEMANTIC_CLASH_DELTA_E).toBeGreaterThan(PERCEPTIBLE_AT_A_GLANCE);

    for (const theme of THEMES) {
      const tokens = TOKENS_BY_THEME[theme];
      const merit = oklchTripleToRgb(tokens["--color-karma-merit"]);
      const accepted = deltaE00Rgb(oklchTripleToRgb(tokens["--color-civ-mark-gr"]), merit);
      const rejectedTriple = rotateToHslHue(
        tokens["--color-civ-mark-gr"],
        REJECTED_GREEK_HSL_HUE
      );
      const rejected = deltaE00Rgb(oklchTripleToRgb(rejectedTriple), merit);

      // The reconstruction is the colour it claims to be, in the coordinate the
      // decision was written in — otherwise the lower bound is measured on
      // something else entirely.
      expect(hueDistance(hslHueOfOklch(rejectedTriple), REJECTED_GREEK_HSL_HUE)).toBeLessThan(
        HUE_READBACK_SLACK_DEG
      );
      expect(Number(tokens["--color-civ-hue-gr"])).toBe(88);

      expect(rejected).toBeLessThan(SEMANTIC_CLASH_DELTA_E);
      expect(accepted).toBeGreaterThan(SEMANTIC_CLASH_DELTA_E);
    }
  });

  // -- THEN: no violations. Collected rather than asserted one at a time so a
  // -- red run names every offending tenant with its distance and the token it
  // -- collided with — "eg mark 1.18 from --color-accent-hover" is reviewable,
  // -- "expected 1.18 to be >= 5" is not.
  it.each(THEMES)("%s: every tenant's mark and ink clears every semantic colour", (theme) => {
    const offenders: string[] = [];
    for (const prefix of CIV_PREFIXES) {
      for (const kind of IDENTITY_KINDS) {
        const nearest = nearestSemantic(theme, prefix, kind);
        if (nearest.d >= SEMANTIC_CLASH_DELTA_E) continue;
        offenders.push(
          `${prefix} ${kind} is ${nearest.d.toFixed(2)} ΔE00 from ${nearest.name} — ` +
            `under the ${SEMANTIC_CLASH_DELTA_E} ΔE00 clearance`
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("needs no chroma floor, because the grey that forced one is not the nearest colour", () => {
    // Non-circular on purpose. The archived pin EXCLUDED `--color-status-lost`
    // by a constant so that European would not be judged against a grey it
    // happens to share a hue angle with. This asserts the thing that made the
    // constant unnecessary: with the grey fully in the scan, the formula still
    // ranks it behind a saturated neighbour, in both themes and for both the
    // mark and the ink. Raise that token's chroma and this goes red — which is
    // the point at which a floor would become a real question again.
    for (const theme of THEMES) {
      for (const kind of IDENTITY_KINDS) {
        const rgb = oklchTripleToRgb(TOKENS_BY_THEME[theme][`--color-civ-${kind}-eu`]);
        const lost = deltaE00Rgb(
          rgb,
          oklchTripleToRgb(TOKENS_BY_THEME[theme]["--color-status-lost"])
        );
        const nearest = nearestSemantic(theme, "eu", kind);
        expect(nearest.name).not.toBe("--color-status-lost");
        expect(lost).toBeGreaterThan(nearest.d);
      }
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Sharma, Wu & Dalal (2005), "The CIEDE2000 Color-Difference Formula:
 * Implementation Notes, Supplementary Test Data, and Mathematical
 * Observations", Table 1 — 34 Lab pairs and their ΔE00, published for the
 * express purpose of catching implementation errors.
 *
 * `[L1, a1, b1, L2, a2, b2, expected]`.
 *
 * WHY THE WHOLE TABLE AND NOT A SPOT CHECK. The rows are not a random sample;
 * they are adversarial by design, and MEASURED — not assumed — the two hue
 * wraps are caught by disjoint, small subsets of them:
 *
 *   - THE MEAN-HUE WRAP (`hBarp`). Replacing its three cases with a plain
 *     `(h1' + h2') / 2` leaves 28 rows green and reddens 11, 12, 15, 16, 17,
 *     19. Rows 9-12 hold a1 = 2.49, a2 = -2.49 and walk b2 across zero
 *     (-0.0010 -> +0.0009, +0.0010, +0.0011, +0.0012), stepping the published
 *     answer 7.1792 -> 7.2195; rows 13-15 do the same on the b axis
 *     (4.8045 -> 4.7461). The broken form returns 7.179153 where 7.2195 is
 *     published — it lands on the OTHER SIDE of a real step, which no
 *     eyeball on a colour swatch would ever question.
 *   - THE HUE-DIFFERENCE FOLD (`dhp`). `dhp` is not `h2' - h1'`: when the two
 *     angles straddle 0°/360° the raw difference is ~±350° for colours a few
 *     degrees apart, so it folds into (-180, 180]. Dropping the fold reddens
 *     only rows 16, 17 and 19 — and two of those three miss by 0.0001 and
 *     0.0007. A tolerance loose enough to feel "reasonable" would let a
 *     broken implementation through.
 *   - Rows 33-34 sit at L* 0.9-6.8, near-black, which is where this
 *     repository's dark ramp lives — the region where the L*a*b* transfer
 *     switches to its linear segment.
 *
 * So no subset of this table is safe to drop: the two wraps are caught by
 * six rows and three rows respectively, overlapping in three. A ΔE00 wrong in
 * only those is worse than no ΔE00 at all — right about most colours,
 * authoritative-looking, and wrong precisely about the near-grey and near-red
 * pairs nobody re-derives by eye. That is the whole argument for this block.
 */
const SHARMA_CIEDE2000_CASES: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
  [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
  [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
  [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -1.1848, -84.8006, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -0.9009, -85.5211, 50.0, 0.0, -82.7485, 1.0],
  [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
  [50.0, -1.0, 2.0, 50.0, 0.0, 0.0, 2.3669],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.001, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0012, 7.2195],
  [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.001, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
  [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
  [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
  [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
  [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.903],
  [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
  [50.0, 2.5, 0.0, 50.0, 3.1736, 0.5854, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2972, 0.0, 1.0],
  [50.0, 2.5, 0.0, 50.0, 1.8634, 0.5757, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2592, 0.335, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
];

/**
 * `oklchTripleToRgb` is the floor under everything else in this file, and it
 * arrived with the migration that rewrote every token from `H S% L%` to
 * `L C H`. A conversion that is subtly wrong is worse than no conversion: it
 * reads as authoritative, every ratio and every ΔE00 in the repository is
 * computed through it, and nothing else would report the error.
 *
 * SO IT IS HELD TO PUBLISHED VALUES, THE WAY ΔE00 IS HELD TO SHARMA'S TABLE.
 * The three sRGB primaries' OKLCH coordinates below are the ones CSS Color 4
 * §9.3 gives (Björn Ottosson's, from the article the matrices come from):
 * red oklch(62.7955% 0.257683 29.2339), green oklch(86.644% 0.294827
 * 142.4953), blue oklch(45.2014% 0.313214 264.052).
 *
 * AND TO THE BROWSER, WHICH IS THE PART A UNIT TEST CANNOT DO. jsdom does not
 * rasterise, so this file can only prove the arithmetic is self-consistent and
 * matches the spec's numbers. The other half was measured out of band, in
 * Chromium and Firefox, by painting every declared token twice — once as the
 * `hsl()` triple it used to be and once as the `oklch()` triple it is now —
 * and reading the pixels back: 104/104 identical, opaque, in both engines.
 * That measurement is what licenses the round-trip pin below to stand for what
 * a screen shows. The full-page evidence is the 32-screenshot comparison the
 * migration was accepted on.
 */
describe("the OKLCH conversion every colour pin runs through", () => {
  const PRIMARIES: [string, [number, number, number]][] = [
    ["0.627955 0.257683 29.2339", [255, 0, 0]],
    ["0.86644 0.294827 142.4953", [0, 255, 0]],
    ["0.452014 0.313214 264.052", [0, 0, 255]],
    ["1 0 0", [255, 255, 255]],
    ["0 0 0", [0, 0, 0]],
    ["0.599871 0 0", [128, 128, 128]],
  ];

  /**
   * Five tokens straight out of globals.css, beside the sRGB Chromium actually
   * paints them as — read back from a screenshot during the migration, not
   * computed here.
   *
   * WHY THE PRIMARIES ARE NOT ENOUGH, MEASURED RATHER THAN ASSUMED. Every row
   * of `PRIMARIES` is a channel at 0 or 255, or an achromatic grey. Changing
   * the sRGB transfer exponent from 1/2.4 to 1/2.41 leaves all six of them
   * byte-identical — the endpoints are fixed points of any gamma, and mid-grey
   * happened to round the same way — so that mutation passed the whole block
   * until these rows were added. They are the mid-tones with chroma, which is
   * where a transfer-function or matrix error first shows up in a channel.
   */
  const MEASURED: [string, [number, number, number]][] = [
    ["0.770351 0.164635 70.6613", [245, 159, 10]], // --color-accent, both themes
    ["0.496252 0.108981 156.0004", [27, 116, 71]], // --color-status-alive, light
    ["0.642606 0.10097 276.6787", [125, 135, 202]], // --color-civ-mark-eu, dark
    ["0.520424 0.014972 266.5999", [101, 105, 114]], // --color-ink-tertiary, light
    ["0.138985 0.030107 40.9464", [19, 5, 2]], // --color-civ-canvas-cn, dark
  ];

  it.each(PRIMARIES)("%s is the sRGB colour CSS Color 4 says it is", (triple, rgb) => {
    expect(oklchTripleToRgb(triple)).toEqual(rgb);
  });

  it.each(MEASURED)("%s is the sRGB the browser paints it as", (triple, rgb) => {
    expect(oklchTripleToRgb(triple)).toEqual(rgb);
  });

  it("the measured rows are tokens this stylesheet actually declares", () => {
    // Otherwise the row above is a pin on a number nobody keeps true. Each
    // measured triple must appear as some token's value in one of the themes,
    // so renaming or retuning the token reddens this rather than leaving a
    // stale reference standing beside a changed file.
    const declared = new Set([
      ...Object.values(TOKENS_BY_THEME.dark),
      ...Object.values(TOKENS_BY_THEME.light),
    ]);
    for (const [triple] of MEASURED) expect(declared).toContain(triple);
  });

  it("round-trips every declared token through sRGB without moving a channel", () => {
    // The property the migration rests on: the OKLCH triples in globals.css
    // name exactly the sRGB colours the HSL triples named. Checked over the
    // whole palette rather than a sample, and over the per-tenant ramp too,
    // because the ramp is where the migration had to expand one declaration
    // into twenty and is therefore where a typo would hide.
    const declared = [
      ...Object.values(TOKENS_BY_THEME.dark),
      ...Object.values(TOKENS_BY_THEME.light),
      ...THEMES.flatMap((theme) =>
        CIV_PREFIXES.flatMap((civ) =>
          RAMP_TOKENS.map((token) => resolveRampForCiv(theme, civ, token))
        )
      ),
    ].filter((value) => /^[\d.]+\s+[\d.]+\s+-?[\d.]+$/.test(value));
    // Not a sample: if this list emptied, the loop below would pass over
    // nothing and say so in the summary as a green test.
    expect(declared.length).toBeGreaterThan(80);
    for (const triple of declared) {
      const rgb = oklchTripleToRgb(triple);
      expect(oklchTripleToRgb(rgbToOklchTriple(rgb))).toEqual(rgb);
    }
  });

  it("throws on a value that is not a triple rather than measuring NaN", () => {
    // The failure mode this file exists to prevent, one layer down: a token
    // that stops parsing must name itself, not return `[NaN, NaN, NaN]` and
    // make every ratio computed from it `NaN` — which compares false against
    // every threshold and reads as a colour problem.
    expect(() => oklchTripleToRgb("38 92% 50%")).toThrow();
    expect(() => oklchTripleToRgb("var(--color-accent)")).toThrow();
    expect(() => oklchTripleToRgb("")).toThrow();
  });

  it("clamps out-of-gamut coordinates instead of emitting a negative channel", () => {
    // No token in globals.css is out of sRGB — that was checked over all 104
    // during the migration — but OKLCH can address colours sRGB cannot, and a
    // future token that strays must come back as a paintable colour rather
    // than as `rgb(-12, …)`, which no downstream formula here would reject.
    const [r, g, b] = oklchTripleToRgb("0.7 0.4 150");
    for (const channel of [r, g, b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});

describe("the ΔE00 the ramp pins rest on is the published formula", () => {
  it("carries the whole Sharma table, not a sample of it", () => {
    // Pin the subject set, not the parse. A truncated table is a green run over
    // a formula nobody checked, and the rows that matter most (9-15, the hue
    // wrap) sit in the middle where a truncation would drop them silently.
    expect(SHARMA_CIEDE2000_CASES).toHaveLength(34);
  });

  it.each(SHARMA_CIEDE2000_CASES.map((row, i) => [i + 1, row] as const))(
    "row %i reproduces the published ΔE00",
    (_row, [L1, a1, b1, L2, a2, b2, expected]) => {
      // Four decimals is the precision the paper publishes. A looser tolerance
      // would swallow exactly the failures this table exists to expose: the
      // 7.1792/7.2195 step across the hue wrap is 0.04 wide.
      expect(deltaE00([L1, a1, b1] as Lab, [L2, a2, b2] as Lab)).toBeCloseTo(expected, 4);
    }
  );

  it("is symmetric, which the table only covers for one pair", () => {
    // Rows 7 and 8 are the same colours in both orders and the paper gives them
    // the same answer. Every other row is one-directional, and the wrap
    // branches are the kind of code that can be right forwards and wrong
    // backwards, so the property is asserted over the whole table rather than
    // trusted from the one pair that states it.
    for (const [L1, a1, b1, L2, a2, b2] of SHARMA_CIEDE2000_CASES) {
      const forward = deltaE00([L1, a1, b1] as Lab, [L2, a2, b2] as Lab);
      const backward = deltaE00([L2, a2, b2] as Lab, [L1, a1, b1] as Lab);
      expect(backward).toBeCloseTo(forward, 10);
    }
  });

  it("reads sRGB the way the CSS does — white, black and a known mid tone", () => {
    // `deltaE00` is fed by `srgbToLab`, and a correct ΔE00 on a wrong Lab is
    // the same defect one layer down. Reference values: sRGB white is
    // L* 100 / a* 0 / b* 0 under D65 by construction, black is L* 0, and
    // mid-grey 128 is L* ≈ 53.585.
    const [wL, wA, wB] = srgbToLab([255, 255, 255]);
    expect(wL).toBeCloseTo(100, 4);
    expect(wA).toBeCloseTo(0, 4);
    expect(wB).toBeCloseTo(0, 4);
    expect(srgbToLab([0, 0, 0])[0]).toBeCloseTo(0, 10);
    expect(srgbToLab([128, 128, 128])[0]).toBeCloseTo(53.5851, 3);
    // AND THE CHROMA AXES ARE ACTUALLY POPULATED. Every assertion above is
    // satisfied by a `srgbToLab` that returns `[L, 0, 0]` — the three
    // references are all achromatic — and such an implementation would discard
    // the hue axis this entire file is about while still looking plausible.
    // sRGB pure red is L* 53.24, a* 80.09, b* 67.20.
    const [rL, rA, rB] = srgbToLab([255, 0, 0]);
    expect(rL).toBeCloseTo(53.2408, 3);
    expect(rA).toBeCloseTo(80.0925, 3);
    expect(rB).toBeCloseTo(67.2032, 3);
    // And the end-to-end statement the ramp pins actually make.
    expect(deltaE00Rgb([255, 255, 255], [0, 0, 0])).toBeCloseTo(100, 4);
    expect(deltaE00Rgb([19, 5, 2], [19, 5, 2])).toBe(0);
  });

  it("sees a difference max-channel cannot — the pair that started Stage 12", () => {
    // Chinese and Egyptian dark canvas. Identical R, identical B, one channel
    // of difference: max-channel says 9, which Stage 11 read as "the same
    // ground". This is the concrete regression, pinned by value so that a ΔE00
    // that quietly stopped seeing hue could not pass by returning something
    // small-but-nonzero.
    expect(maxChannelDelta([19, 5, 2], [19, 14, 2])).toBe(9);
    expect(deltaE00Rgb([19, 5, 2], [19, 14, 2])).toBeCloseTo(6.04, 2);
  });
});

// ---------------------------------------------------------------------------

/**
 * The width, IN sRGB CHANNEL STEPS, below which Stage 9 ruled a flat-field
 * colour difference could not be relied on.
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
 *
 * ------------------------------------------------------------------------
 * STAGE 12 KEPT THIS NUMBER AND STOPPED BELIEVING IT ON ITS OWN.
 *
 * `maxChannelDelta` is close to blind along the hue axis, which is the only
 * axis this palette varies. Chinese `(19, 5, 2)` and Egyptian `(19, 14, 2)`
 * share R and B exactly, so it reports 9 — and Stage 11 wrote that pair up as
 * barely separable. In ΔE00 the same pair is 6.04, past "obvious at a glance".
 * The ramp was right; the sentence about it was not.
 *
 * WHY 8 IS STILL HERE — TWO REASONS, AND THE SECOND WAS A SURPRISE.
 *
 * The expected one: it carries a provenance nothing else in this file does. It
 * is the figure a named review chose while arguing the opposite conclusion,
 * which is what makes the pin below a statement about the design rather than
 * about arithmetic. Channel steps have no ΔE00 equivalent — a "migrated 8"
 * would be a new number wearing an old number's authority, the exact failure
 * this round exists to undo.
 *
 * THE ONE FOUND BY MUTATION: THE ΔE00 PINS DO NOT REPLACE THIS ONE, BECAUSE
 * THEY DO NOT CATCH WHAT IT CATCHES. Reverting the dark ramp to Stage 9's
 * saturations (13/12/11/11) reddens this pin at once — widest pair drops to
 * 4/255 — and leaves BOTH ΔE00 pins green: measured on the Stage 9 ramp, the
 * widest pair per surface is 5.36 to 8.47 ΔE00 and every pair reaches 3.62 to
 * 8.47 somewhere on it. Both are above "perceptible at a glance".
 *
 * Read that the other way and it is the sharper finding of Stage 12: Stage 9's
 * own ruling — "at 13% saturation the ramp cannot express a hue at all, every
 * tenant renders on what is in practice the same near-black" — is contradicted
 * by the perceptual metric too. That ramp was visible. It was quiet, and quiet
 * is a legitimate thing to reject; "expresses nothing" was the blind metric
 * talking, in 2 of 3 channels, both times.
 *
 * So this pin is what defends Stage 11's LOUDNESS and the ΔE00 pins are what
 * defend the tenant being EXPRESSED, and neither subsumes the other. Deleting
 * this one in the name of migrating to a better metric would have removed the
 * only assertion that fails when the ramp is flattened back.
 * ------------------------------------------------------------------------
 */
const PERCEPTIBILITY_FLOOR = 8;

/**
 * ΔE00 3.5 — "perceptible at a glance" on the standard CIEDE2000 ladder
 * (<1 imperceptible, 1-2 on close inspection, 2-3.5 at a glance, >5 obvious).
 *
 * Deliberately the WEAKEST rung that means anything, because the claim being
 * pinned is "the ramp expresses the tenant", not "the ramp shouts". Taken from
 * the metric's published scale and not from this palette: the measurements it
 * judges are 3.30 to 20.87, so a number fitted to the data would have been 3.5
 * — and the data has since moved under it, which is exactly why a fitted
 * number would have been the wrong kind of number. The low end was 4.11, then
 * 3.30 when the Chinese light hue moved to 20 deg, and is 2.56 now that its
 * ground carries real chroma (globals.css, `--color-civ-hue-cn` and
 * `--color-civ-canvas-cn` in `.light`). It is the Chinese/Egyptian pair on
 * light surface-1 throughout, and it is NOT what this constant judges: the
 * pins below take the WIDEST pair per plane and the WIDEST plane per pair, so
 * the tightest figure either of them sees is 4.66. If a future change puts
 * 2.56 itself under a pin, the number to move is the palette, not this
 * constant.
 */
const PERCEPTIBLE_AT_A_GLANCE = 3.5;

/**
 * How far the marks must LEAD the ramp, in ΔE00, for "identity leads, the
 * ground follows" to still be true.
 *
 * THIS REPLACES `MARK_SEPARATION_MULTIPLE = 3`, AND IT IS A DIFFERENT SHAPE OF
 * CLAIM, NOT A RETUNED ONE. Three separate reasons, in the order they bind:
 *
 *  1. A RATIO OF TWO ΔE00 FIGURES IS NOT A QUANTITY THE FORMULA SUPPORTS.
 *     CIEDE2000 was fitted on small differences — roughly ΔE00 < 5 — between
 *     moderately light surface colours. The marks are 18 to 52 ΔE00 apart,
 *     far outside that. "51 is three times as different as 17" is a sentence
 *     the formula never makes; "51 is much further apart than 17" is. What
 *     ΔE00 does claim is that equal INCREMENTS are equally perceptible, so
 *     the supported form of "leads by a margin" is a subtraction.
 *  2. THE OLD 3x CARRIED NO RULING TO PRESERVE. Unlike `PERCEPTIBILITY_FLOOR`
 *     above, 3 was never chosen by a review that argued something; it was
 *     "a wide multiple". There is no provenance to strand, so the constant is
 *     free to change units. That asymmetry between the two pins is the whole
 *     reason one migrated and one did not.
 *  3. TRANSPLANTING 3x WOULD SIMPLY BE FALSE TODAY. Measured per pair, mark
 *     ÷ widest ramp in ΔE00 is 2.11-2.84 dark and 3.25-4.31 light. Nothing
 *     about the design changed; the metric did. Keeping 3 would redden a
 *     correct palette, and lowering it to 2 would be picking the number the
 *     measurement handed over — which this file has already said is not a
 *     threshold.
 *
 * WHY 5. It is the coarsest rung of the same published ladder
 * `PERCEPTIBLE_AT_A_GLANCE` is taken from: the point at which a difference is
 * obvious rather than merely visible. The pin then reads — whatever the ground
 * is doing, the mark is at least one OBVIOUS step further apart than the
 * ground. Measured worst case today is 10.12 (dark eg/gr), so the number was
 * plainly not fitted to the data; had it been, it would read 10.
 *
 * WHAT A MARGIN GIVES UP, SAID PLAINLY. A multiple scales: a ramp that got
 * very loud would have had to be out-shouted proportionally. A margin does
 * not, so this pin alone would tolerate ramp 40 / mark 45. It is safe to give
 * that up here and nowhere else because the ceiling on ramp chroma is already
 * enforced by name in the file that owns it — `inkOnSurfaceContract` asserts
 * its failing ink x surface set as an EXACT set, so the ramp cannot get louder
 * without that test going red first.
 */
const MARK_LEAD_MARGIN = 5;

/**
 * THE RAMP THE FOUR PINS BELOW JUDGE — and as of Stage 13 it is not
 * `SURFACE_TOKENS`.
 *
 * `SURFACE_TOKENS` is derived by prefix and so contains `--color-surface-1..4`
 * and nothing else. `--color-canvas` is not named `--color-surface-*`, so for
 * as long as these pins ran over that list they measured every plane a tenant
 * paints EXCEPT the largest one. The comment inside the describe below said so
 * in as many words, and declined to widen the subject on the grounds that
 * "widening the subject is a design decision about whether light mode should
 * tint its page ground, not a metric fix".
 *
 * That decision has now been taken — `.light` declares
 * `--color-canvas: [--civ-hue] 100% 96.5%`, the derivation is on the token
 * in globals.css — so the subject widens with it. Dark canvas has carried the
 * tenant hue since Stage 11 and was equally unmeasured here; both join at once,
 * because the reason for excluding either was the same reason.
 *
 * WHAT THIS BUYS, AND IT IS THE MUTATION THAT PROVED IT: setting light
 * `--color-canvas` back to `0 0% 100%` now reddens two of the pins below with
 * `--color-canvas` named and 0.00 beside it. Before the widening the same
 * mutation left this entire file green — a flat page ground for every tenant
 * was outside everything this file asserts.
 *
 * NOT A LOOSENING IN THE OTHER DIRECTION EITHER. Every threshold below is
 * unmoved (`PERCEPTIBILITY_FLOOR` 8, `PERCEPTIBLE_AT_A_GLANCE` 3.5,
 * `MARK_LEAD_MARGIN` 5); this list only gets longer, so each pin has strictly
 * more chances to fail than it had.
 */
const RAMP_TOKENS: string[] = [...SURFACE_TOKENS, "--color-canvas"];

function rampRgb(theme: ThemeName, prefix: string, token: string): [number, number, number] {
  return oklchTripleToRgb(resolveRampForCiv(theme, prefix, token));
}

function markRgb(theme: ThemeName, prefix: string): [number, number, number] {
  return oklchTripleToRgb(TOKENS_BY_THEME[theme][`--color-civ-mark-${prefix}`]);
}

/** Widest CHANNEL gap between one PAIR of tenants across the whole ramp, in one theme. */
function rampGapForPair(theme: ThemeName, a: string, b: string): number {
  return Math.max(
    ...RAMP_TOKENS.map((token) => maxChannelDelta(rampRgb(theme, a, token), rampRgb(theme, b, token)))
  );
}

/** Widest CHANNEL gap between any two tenants across the whole ramp, in one theme. */
function widestRampGap(theme: ThemeName): number {
  return Math.max(...civPairs().map(([a, b]) => rampGapForPair(theme, a, b)));
}

/** Narrowest CHANNEL gap between any two tenants' marks, in one theme. */
function narrowestMarkGap(theme: ThemeName): number {
  return Math.min(...civPairs().map(([a, b]) => maxChannelDelta(markRgb(theme, a), markRgb(theme, b))));
}

// The same three questions asked in ΔE00. Deliberately named `…DeltaE` beside
// the `…Gap` originals rather than replacing them in place: a reader comparing
// a red run against the figures in these comments has to be able to tell which
// metric produced which number, and two functions with one name is how that
// stops being possible.

/** How far apart one pair of tenants looks on one surface, in one theme. */
function rampDeltaE(theme: ThemeName, a: string, b: string, token: string): number {
  return deltaE00Rgb(rampRgb(theme, a, token), rampRgb(theme, b, token));
}

/** The surface on which a pair looks furthest apart, in one theme. */
function widestRampDeltaEForPair(theme: ThemeName, a: string, b: string): number {
  return Math.max(...RAMP_TOKENS.map((token) => rampDeltaE(theme, a, b, token)));
}

/** How far apart one pair of tenants' marks look, in one theme. */
function markDeltaE(theme: ThemeName, a: string, b: string): number {
  return deltaE00Rgb(markRgb(theme, a), markRgb(theme, b));
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
   * =====================================================================
   * STAGE 12: EVERY FIGURE IN THE FOUR PARAGRAPHS ABOVE IS A max-channel
   * FIGURE, AND ONE OF THE CONCLUSIONS DRAWN FROM THEM IS FALSE.
   *
   * The paragraph that stood here said: "the ramp does not separate EVERY pair
   * perceptibly — Chinese/Egyptian (32deg apart) measures 9/255 dark and
   * 5-9/255 light, Egyptian/Greek 7-8 and 5-7." Those channel counts are
   * correct. The word "perceptibly" is not a thing they can establish.
   * `maxChannelDelta` takes the largest of three per-channel differences, so
   * two colours differing only in ONE channel — which is what a hue shift at
   * fixed lightness produces — are reported at a fraction of how they look.
   * Chinese `(19, 5, 2)` and Egyptian `(19, 14, 2)` share R and B exactly.
   *
   * Re-measured in CIEDE2000, the ramp separates ALL SIX PAIRS in BOTH themes:
   *
   *                     dark canvas   light surface-1
   *     Chinese-Egyptian     6.04            2.56
   *     Egyptian-Greek       7.03            4.25
   *     Chinese-European     8.65            7.02
   *     European-Egyptian   11.32            7.96
   *     Chinese-Greek       13.33            6.89
   *     European-Greek      14.60           10.01
   *
   * (The three Chinese rows in the light column read 4.11 / 5.96 / 8.41 before
   * that tenant's LIGHT hue was rotated 12 -> 20 deg, and 3.30 / 6.18 / 7.56
   * between that rotation and the chroma raise that finally took its page
   * ground out of the blush region. Dark did not move in either round. See
   * `--color-civ-hue-cn` and `--color-civ-canvas-cn` in the `.light` block of
   * globals.css for the derivations and the costs.)
   *
   * — against a ladder where 2-3.5 is "perceptible at a glance" and >5 is
   * obvious. Across surface-1..4 the same pairs run 5.46 to 20.87. The two
   * pairs Stage 11 wrote off are the two narrowest, and both are comfortably
   * visible. Nothing about the palette changed at Stage 12; a metric that
   * cannot see hue was used to judge a palette that varies only in hue.
   *
   * SO THE FIRST PIN IS NOW TWO PINS RATHER THAN A REPLACED ONE. The
   * channel-unit assertion stays exactly as it was, because `8` encodes Stage
   * 9's ruling and has nowhere to be migrated to (see `PERCEPTIBILITY_FLOOR`).
   * Beside it, two ΔE00 assertions say what the channel one cannot: no SURFACE
   * goes flat, and no PAIR goes unexpressed. The second of those is the
   * sentence Stage 11 believed it could not write.
   *
   * ONE THING THE ΔE00 PINS USED NOT TO SAY, because it was true and awkward:
   * in light mode `--color-canvas` was flat `0 0% 100%` for every tenant, so
   * all six pairs measured exactly 0.00 there. globals.css said "CANVAS IS IN
   * THE RAMP NOW" without that qualifier, and Stage 11's own measured-result
   * list quietly omitted light canvas while giving dark canvas. It was out of
   * scope here only because `SURFACE_TOKENS` is `--color-surface-*` and canvas
   * is not one; widening the subject was a design decision about whether light
   * mode should tint its page ground, not a metric fix.
   *
   * STAGE 13 TOOK THAT DECISION AND THE SUBJECT WIDENED WITH IT. Light canvas
   * is `[--civ-hue] 100% 96.5%` and the pins below run over `RAMP_TOKENS` —
   * surface-1..4 PLUS canvas, both themes. See the block on that constant for
   * why this is a widening and not a retune, and for the mutation that shows
   * the old shape could not see a flat page ground at all.
   *
   * ALSO NOT SAFE TO CARRY OVER: the "5.0x-7.6x" per-pair lead above. In ΔE00
   * the same pairs measure 2.11x-4.31x — the palette did not move, the ratio
   * is simply not transferable between metrics, and ratios of large ΔE00
   * figures are not supported by the formula at all. That is why the second
   * pin below is now a MARGIN. The derivation is on `MARK_LEAD_MARGIN`.
   * =====================================================================
   *
   * NOT covered here, on purpose, unchanged from Stage 9: the ramp losing its
   * `[--civ-hue]` wiring altogether. `chartColourContract.test.ts` pins that
   * by name in both themes. Nor is AA covered here — `inkOnSurfaceContract`
   * asserts its failing set as an EXACT set, so the ceiling on how much chroma
   * the ramp may carry is already enforced, once, in the file that owns it.
   */
  it.each(THEMES)("%s: every surface separates the tenants it can be asked to", (theme) => {
    // Collected rather than asserted one at a time so a red run names every
    // surface that went flat at once — "surface-2 widest pair at 3" is a
    // reviewable sentence; "expected 3 to be > 8" is not.
    //
    // STILL IN CHANNEL STEPS. This is Stage 9's threshold judged in Stage 9's
    // units; the ΔE00 pin that follows is the one that can be believed about
    // perception. Measured today, surface-1..4 then canvas:
    // dark 17/17/17/16 + 17, light 10/15/16/15 + 18.
    const flat = RAMP_TOKENS.map((token) => ({
      where: token,
      widest: Math.max(
        ...civPairs().map(([a, b]) => maxChannelDelta(rampRgb(theme, a, token), rampRgb(theme, b, token)))
      ),
    })).filter((row) => row.widest <= PERCEPTIBILITY_FLOOR);
    expect(flat).toEqual([]);
  });

  it.each(THEMES)("%s: no surface goes perceptually flat between its widest pair", (theme) => {
    // The same subject as the pin above — per plane, the pair that separates
    // furthest — asked in ΔE00. Measured today, surface-1..4 then canvas:
    // dark 17.79/19.66/20.87/20.02 + 14.60,
    // light 10.01/14.02/14.95/14.07 + 15.98, against a floor of 3.5.
    //
    // NOT A REPLACEMENT FOR THE PIN ABOVE, AND THAT IS MEASURED RATHER THAN
    // ASSUMED: on the Stage 9 ramp this reads 5.36-8.47 and stays green while
    // the channel pin goes red at 4/255. It is a floor against a surface losing
    // its tint, not against the ramp being turned back down.
    //
    // AND IT IS THE PIN THAT CATCHES A FLAT PAGE GROUND. A light canvas back at
    // `0 0% 100%` is six pairs at exactly 0.00, which reddens here by name.
    // The channel pin above catches it too, at 0/255 — both, because a flat
    // white ground fails on both metrics, which is not true of the Stage 9
    // ramp and is why neither pin was dropped.
    const flat = RAMP_TOKENS.map((token) => ({
      where: token,
      widestDeltaE: Number(
        Math.max(...civPairs().map(([a, b]) => rampDeltaE(theme, a, b, token))).toFixed(2)
      ),
    })).filter((row) => row.widestDeltaE < PERCEPTIBLE_AT_A_GLANCE);
    expect(flat).toEqual([]);
  });

  it.each(THEMES)("%s: every pair of tenants is expressed somewhere on the ramp", (theme) => {
    // THE ASSERTION STAGE 11 BELIEVED IT COULD NOT MAKE. Its subject is the
    // PAIR, not the surface: for each pair, the plane on which the two look
    // furthest apart has to be visibly apart. Narrowest today is 9.11 dark
    // (Egyptian/Greek) and 4.66 light (Chinese/Egyptian, on surface-3) — the
    // very pairs max-channel reported at 7-8 and called too close to rely on.
    // The light figure was 6.42 (Egyptian/Greek) until the Chinese light hue
    // moved to 20 deg, which put a different pair at the bottom of this column
    // at 5.68; the chroma raise on that tenant's ground took the same pair to
    // 4.66.  Both moves are recorded in the `.light` block of globals.css. The light figure ROSE from 5.85 when
    // canvas joined `RAMP_TOKENS`, which is what widening a `Math.max` does:
    // this pin can only get easier as the list grows, and that is why it is not
    // the pin that defends the page ground. The two per-plane pins above are.
    //
    // Same caveat as its neighbour: on the Stage 9 ramp this also stays green
    // (3.62-8.47), so it is not the assertion that holds the ramp at Stage 11's
    // volume. What it holds is the SENTENCE Stage 11 got wrong — that some pair
    // of tenants is beyond the ramp's reach. None is.
    const unexpressed = civPairs()
      .map(([a, b]) => ({
        pair: `${a}/${b}`,
        bestDeltaE: Number(widestRampDeltaEForPair(theme, a, b).toFixed(2)),
      }))
      .filter((row) => row.bestDeltaE < PERCEPTIBLE_AT_A_GLANCE);
    expect(unexpressed).toEqual([]);
  });

  it.each(THEMES)("%s: for every pair, the mark leads the ramp by the margin", (theme) => {
    // PER PAIR, not narrowest-against-widest — the shape Stage 11 corrected,
    // kept. Two tenants whose grounds are nearly identical are exactly the ones
    // whose marks have to carry the distinction, and a global comparison
    // averages that case away: it can report a healthy figure while the one
    // pair that needs it fails.
    //
    // A MARGIN AND NOT A MULTIPLE — see `MARK_LEAD_MARGIN` for why a ratio of
    // two ΔE00 numbers is not a quantity CIEDE2000 supports. Measured leads
    // today: dark 10.12-30.17, light 11.60-38.29, against a floor of 5. The
    // light figures TIGHTENED by ~0.9 when canvas joined `RAMP_TOKENS`: the
    // ramp side of the subtraction is a `Math.max` over the planes, so a wider
    // list can only shrink the mark's lead. This pin therefore did get harder,
    // unlike the one above it.
    const short = civPairs()
      .map(([a, b]) => ({
        pair: `${a}/${b}`,
        rampDeltaE: Number(widestRampDeltaEForPair(theme, a, b).toFixed(2)),
        markDeltaE: Number(markDeltaE(theme, a, b).toFixed(2)),
        lead: Number((markDeltaE(theme, a, b) - widestRampDeltaEForPair(theme, a, b)).toFixed(2)),
      }))
      .filter((row) => row.lead < MARK_LEAD_MARGIN);
    expect(short).toEqual([]);
  });

  /**
   * The order of the planes, which is a Stage 13 decision and was until now
   * written down only in a comment.
   *
   * Tinting the light page ground was not a matter of changing one value: at
   * L 100% the chroma ceiling is exactly zero (c = S x min(L, 1-L)), so the
   * canvas had to come down, and the only room below 100% belonged to
   * surface-1..4 — whose deepest step is pinned at 93.5% by
   * `--color-ink-tertiary`'s AA floor. The ground therefore moved BELOW the
   * card plane, and light mode stopped being the mirror image of dark:
   *
   *     dark    canvas < surface-1 < surface-2 < surface-3 < surface-4
   *     light   surface-4 < surface-3 < surface-2 < canvas < surface-1
   *
   * Both themes now agree on the half that matters — the ground sits below the
   * card plane and cards rise off it — and disagree, as they already did
   * before Stage 13, on which way the nested wells go from there.
   *
   * WHY THIS NEEDS A PIN OF ITS OWN. Every other assertion in this file is
   * about how far apart two TENANTS are on one plane. None of them can see the
   * planes colliding with each other or swapping places: canvas back above
   * surface-1, or surface-2 back at the 96.5% the canvas now occupies, leaves
   * the per-tenant spreads untouched and every pin above green. What it breaks
   * is the elevation reading — cards flush with the ground, or table headers
   * indistinguishable from the page.
   *
   * IN THE TOKEN'S OWN LIGHTNESS, NOT IN LUMINANCE, and the difference is not
   * pedantry: a warm hue at the same L renders brighter than a cool one, so
   * ordering four tenants by relative luminance would put Greek surface-3
   * above Chinese surface-2 and report a scrambled ramp on a correct palette.
   * L is the axis the ramp is actually built on.
   *
   * THE AXIS SURVIVED THE MIGRATION AND GOT BETTER. This read the third
   * component of an HSL triple; it reads the first of an OKLCH one. The ramp
   * was BUILT on HSL L, so that was the right axis then by construction — but
   * HSL L is not perceptual, which is why every claim about how the planes
   * READ (the ΔE00 figures above and in globals.css) had to be measured in a
   * different space than the one the ramp was written in. OKLCH L is
   * perceptual, so the ordering axis and the perception axis are finally the
   * same one. The ORDER itself is unchanged, which is the point: this pin was
   * green before the migration and is green after it, on the same pixels.
   *
   * NOT A SEPARATION CLAIM. It says the planes are ordered and distinct, not
   * that adjacent ones are far apart — surface-2/-3 and -3/-4 measure
   * 0.61..0.78 and 0.61..0.80 ΔE00, under the rung at which a flat-field
   * difference is visible at all, and they measured 0.76..0.90 and 0.82..0.85
   * before Stage 13, which is under it too. That is recorded on
   * `--color-canvas` in globals.css as the cost of fitting five planes into
   * the 6.5 lightness points AA leaves; a pin asserting they were perceptible
   * would be asserting something this ramp has never done.
   */
  const EXPECTED_ASCENDING: Record<ThemeName, string[]> = {
    dark: ["--color-canvas", "--color-surface-1", "--color-surface-2", "--color-surface-3", "--color-surface-4"],
    light: ["--color-surface-4", "--color-surface-3", "--color-surface-2", "--color-canvas", "--color-surface-1"],
  };

  function lightnessOf(theme: ThemeName, prefix: string, token: string): number {
    const triple = resolveRampForCiv(theme, prefix, token);
    const m = /^(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?$/.exec(triple);
    if (m === null) throw new Error(`Cannot read a lightness out of ${JSON.stringify(triple)}`);
    return Number(m[1]);
  }

  it.each(THEMES)("%s: the five planes keep their order, for every tenant", (theme) => {
    // Per tenant, and this is where it stops being a formality. While the ramp
    // was `[--civ-hue] S% L%` a tenant could not in principle reorder
    // anything — one hue substituted into five fixed lightnesses. The OKLCH
    // ramp is five literals per tenant with no shared L, so nothing about the
    // declaration keeps the planes in order any more and this pin is the only
    // thing that does.
    for (const prefix of CIV_PREFIXES) {
      const byLightness = [...EXPECTED_ASCENDING[theme]]
        .map((token) => ({ token, l: lightnessOf(theme, prefix, token) }))
        .sort((a, b) => a.l - b.l);
      expect(byLightness.map((row) => row.token)).toEqual(EXPECTED_ASCENDING[theme]);
      // Strictly ascending, so two planes landing on one lightness is a failure
      // and not a tie the sort quietly resolves in the expected direction.
      for (let i = 1; i < byLightness.length; i += 1) {
        expect(byLightness[i].l).toBeGreaterThan(byLightness[i - 1].l);
      }
      // And distinct as rendered pixels, which lightness alone does not
      // guarantee once rounding to whole sRGB channels is in play.
      const rendered = EXPECTED_ASCENDING[theme].map((token) => rampRgb(theme, prefix, token).join(","));
      expect(new Set(rendered).size).toBe(EXPECTED_ASCENDING[theme].length);
    }
  });

  it("names every plane the ramp has, so the order pin cannot go stale", () => {
    // The failure this guards is a fifth surface arriving and the pin above
    // silently continuing to order four of them. Asserted as an exact set
    // against the derived list rather than a length, so a RENAMED token is
    // caught too.
    for (const theme of THEMES) {
      expect([...EXPECTED_ASCENDING[theme]].sort()).toEqual([...RAMP_TOKENS].sort());
    }
  });

  /**
   * The defect that has now been diagnosed twice and fixed twice: a light page
   * ground that reads as pink.
   *
   * WHY IT NEEDS A PIN RATHER THAN A COMMENT. Stage 13 tinted the light ground
   * and Chinese came out pink; the fix rotated it 12 -> 20 degrees and wrote
   * the reasoning down; the ground still read as pink on review. The rotation
   * was not wrong, it was not enough, and NOTHING went red in between — the
   * only record that the region existed was prose, and prose does not fail.
   *
   * THE AXIS, AND WHY THE FIRST ATTEMPT AT IT DID NOT WORK. The 20-degree
   * round tested `a* > b*` and treated crossing it as the fix. That test is
   * satisfied at Lab hue 45 — still squarely peach — and it went green while
   * the complaint stood. The honest form of the same idea is the hue ANGLE,
   * which is the ratio that comparison of a* against b* was reaching for.
   * Measured on named sRGB colours through this file's own `srgbToLab`:
   *
   *     mistyrose    (255,228,225)  Lab hue 28.9   unmistakably pink
   *     seashell     (255,245,238)  Lab hue 64.6   off-white, pink undertone
   *     linen        (250,240,230)  Lab hue 74.4   warm neutral
   *     antiquewhite (250,235,215)  Lab hue 80.9   warm neutral
   *
   * The ground that was rejected on review sat at 55.1 — BELOW seashell. It is
   * now 65.4..74.3 — the page ground itself landing on 74.3, which is `linen`
   * to within a tenth — and the floor is 60: above the region no reviewer has
   * accepted, below the region every warm neutral in that table occupies. The
   * margin is 5.4 degrees, on surface-1, which is the least tinted plane and
   * therefore the one nearest every boundary.
   *
   * WRITTEN FOR EVERY TENANT, NOT FOR CHINESE. A wedge is a fact about pale
   * colours, not about one cosmology: any ramp whose hue lands in it will read
   * the same way. European (283..286) and Greek (127..129) clear it by
   * construction and Egyptian (93..96) by a wide margin, so today it binds one
   * tenant — but a future tenant given a red identity would meet the same
   * geometry, and would meet it here rather than on review.
   *
   * DARK IS EXCLUDED AND THAT IS DELIBERATE. At L 14 the same hue is oxblood,
   * not pink; the Chinese dark ramp sits at Lab hue 30..38 and is correct
   * there. The defect is a property of pale tints, so the pin is too.
   */
  const BLUSH_WEDGE_CEILING_DEG = 60;

  it("no tenant's light ramp sits in the blush wedge", () => {
    const inWedge = CIV_PREFIXES.flatMap((prefix) =>
      RAMP_TOKENS.map((token) => {
        const [, a, b] = srgbToLab(rampRgb("light", prefix, token));
        return {
          where: `light ${prefix} ${token}`,
          labHueDeg: Number((((Math.atan2(b, a) * 180) / Math.PI + 360) % 360).toFixed(1)),
        };
      })
    ).filter((row) => row.labHueDeg < BLUSH_WEDGE_CEILING_DEG);
    expect(inWedge).toEqual([]);
  });

  it("neither figure is degenerate, and the marks still lead overall", () => {
    // Guard the guard. If `resolveRampForCiv` silently started returning one
    // colour for every civilization the first pin would read 0 — which now goes
    // RED rather than green, the one thing the inversion improved for free. The
    // second pin would still pass on a collapsed ramp, so the shape of the
    // measurement is asserted here and not only its verdict.
    //
    // BOTH METRICS ARE CHECKED FOR DEGENERACY, and that is not belt-and-braces:
    // they fail in different ways. `maxChannelDelta` returning 0 means the
    // colours are byte-identical; `deltaE00Rgb` returning 0 can ALSO mean the
    // Lab conversion collapsed — a broken `srgbToLab` that returned a constant
    // would make every ΔE00 pin above read 0 and go red, but a broken one that
    // returned only L* would keep the ramp pins alive on lightness alone while
    // silently discarding the hue axis this whole file is about.
    for (const theme of THEMES) {
      expect(widestRampGap(theme)).toBeGreaterThan(0);
      expect(narrowestMarkGap(theme)).toBeGreaterThan(PERCEPTIBILITY_FLOOR);
      expect(narrowestMarkGap(theme)).toBeGreaterThan(widestRampGap(theme));
      // THE ΔE00 TWIN OF THE LINE ABOVE IS DELIBERATELY ABSENT, AND IT IS
      // ABSENT BECAUSE IT IS FALSE. "narrowest mark > widest ramp" compares two
      // DIFFERENT pairs of tenants — the mismatch Stage 11 already called out
      // when it moved the mark pin to per-pair — and in channel units it
      // survives only because that metric inflates the marks (45 against 17).
      // Written in ΔE00 it goes red on correct colours: narrowest mark is
      // Egyptian/Greek at 19.23 dark, widest ramp is European/Greek at 20.87.
      // Nothing is wrong with the palette; the comparison is meaningless. The
      // per-pair `MARK_LEAD_MARGIN` pin above is the honest form of it, and it
      // already implies the ordering for every pair that actually shares a
      // screen. The channel-unit line is kept as the historical record of a
      // check this file used to believe, not because it proves anything.
      expect(
        Math.max(...civPairs().map(([a, b]) => widestRampDeltaEForPair(theme, a, b)))
      ).toBeGreaterThan(PERCEPTIBLE_AT_A_GLANCE);
      // Two tenants at the SAME lightness and different hue must not measure 0:
      // this is the one assertion that fails if `srgbToLab` loses a and b.
      // Chinese and European surface-1 are `12 47% 7%` and `232 47% 7%` — one
      // HSL lightness, 220° apart.
      expect(rampDeltaE(theme, "cn", "eu", "--color-surface-1")).toBeGreaterThan(
        PERCEPTIBLE_AT_A_GLANCE
      );
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
