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
  readCivAttrRules,
  readSoulStates,
  suffixesOf,
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
      expect(rules[prefix]).toBe(`--color-civ-hue-${prefix}`);
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
