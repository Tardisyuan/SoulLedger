/**
 * `app/globals.css` is the authority for colour. This file makes that true for
 * the three tables in `lib/chart-colors.ts` that `f62fdaa` did not reach, in
 * BOTH THEMES.
 *
 * `civilizationColourContract.test.ts` pinned STATE_COLORS and
 * CIVILIZATION_COLORS after both drifted off tokens they were written to
 * mirror. REALM_COLORS and CHART_SERIES are a worse case than drift: they never
 * mirrored anything. They are the stock Tailwind palette this file was born
 * with, sitting under a docstring that called the file a mirror of globals.css.
 *
 *   hsl(0 84% 60%)    = red-500    #ef4444   REALM_COLORS.HELL
 *   hsl(217 91% 60%)  = blue-500   #3b82f6   REALM_COLORS.PURGATORY, CHART_SERIES.realm
 *   hsl(142 76% 36%)  = green-600  #16a34a   REALM_COLORS.BLISS
 *   hsl(271 81% 56%)  = purple-600 #9333ea   CHART_SERIES.balance
 *
 * Two of those landed a couple of degrees from a live token — `217 91% 60%` is
 * 2° off `--color-verdict-purgatory` — which is the version of this failure
 * that survives review, because a near-miss reads as the token.
 *
 * WHY EVERY PIN IS NOW PER-THEME. `0b4f8fb` pinned all five tables to the
 * `:root` block, and `:root` is the DARK theme; globals.css declares a
 * different value for almost every one of these tokens under `.light`. So the
 * old file pinned half the contract and left the other half free — charts drew
 * dark-theme colours on light-theme pages, which is what BRIEF §4.5 recorded,
 * and no assertion here could see it. `lib/chart-colors.ts` now exports one
 * table per theme and every pin below runs over `THEMES`, so a light value is
 * exactly as pinned as its dark twin.
 *
 * CHART_CHROME is the opposite case and worth stating: five of its six entries
 * were already exact token mirrors. Only `tooltipBg` was stranded, by
 * `--color-surface-1` changing from a fixed `240 13% 7%` into the per-tenant
 * `[--civ-hue] …`. A token that varies has no single literal, so that
 * entry had to answer a design question; the answer and its premises are pinned
 * at the bottom of this file. Stage 11 changed which branch it mirrors — the
 * `:not([data-civ])` ramp rather than a hue value that used to be neutral —
 * and left the value it carries untouched.
 *
 * Same technique as the sibling file, and the same parser — imported from
 * `./support/globalsCssTokens`, not copied. Same rule too: **both directions**.
 * A token with no mirror entry is as red as a mirror entry with no token.
 *
 * The reasoning behind each individual pin is written once, on the table it
 * pins, in `lib/chart-colors.ts`. Repeating it here would be a second copy to
 * keep in sync.
 */
import {
  CIV_PREFIXES,
  LIGHT_EFFECTIVE_TOKENS,
  LIGHT_TOKENS,
  NO_CIV_TOKENS_BY_THEME,
  ROOT_TOKENS,
  THEMES,
  TOKENS_BY_THEME,
  type ThemeName,
  lastDeclarationOffset,
  literalOfIn,
  noCivLiteralOfIn,
  readRealmTypes,
  readCivAttrRules,
  resolveRampForCiv,
  resolveTriple,
  suffixesOf,
} from "./support/globalsCssTokens";
import { readFileSync } from "fs";
import { join } from "path";

import { CHART_COLORS, type ChartColors } from "@/lib/chart-colors";

/** A bare `L C H` triple, the shape every colour token in globals.css has. */
const OKLCH_TRIPLE = /^[\d.]+\s+[\d.]+\s+-?[\d.]+$/;

const REALM_TYPES = readRealmTypes();

/** Which token each realm type mirrors. One answer for both themes — the pin is a token, not a value. */
const REALM_TOKENS: Record<string, string> = {
  HELL: "--color-verdict-failed",
  PURGATORY: "--color-verdict-purgatory",
  BLISS: "--color-verdict-passed",
  NEUTRAL: "--color-ink-tertiary",
};

/**
 * Realm types whose token is NOT in the `--color-verdict-*` family the table is
 * named for, and why each one is recorded rather than moved back into it.
 *
 * Compared as an exact set, so both ends redden: pinning a fourth realm outside
 * the palette without listing it here fails, and so does quietly moving NEUTRAL
 * back into the verdict family while leaving this entry standing.
 */
const REALMS_PINNED_OUTSIDE_THE_VERDICT_PALETTE: Record<string, string> = {
  NEUTRAL:
    "`RealmType.NEUTRAL` is a waypoint nobody is sentenced to (realms.py: " +
    "EU_ACHERON \"nobody is sentenced here\", EU_PLATO_MEADOW \"reachable " +
    "without being a destination\"), so no verdict token can mirror it. Not " +
    "--color-status-lost either: that is a lifecycle token meaning the soul " +
    "went missing. Pinned on --color-ink-tertiary, the authored dimmest " +
    "legible neutral. Full argument on REALM_COLORS in lib/chart-colors.ts.",
};

/**
 * `--color-verdict-*` tokens that no realm type mirrors, and why. The reverse
 * direction for REALM_COLORS: a fifth verdict token landing in globals.css
 * reddens this until someone decides whether it names a realm.
 */
const VERDICT_TOKENS_WITH_NO_REALM: Record<string, string> = {
  "--color-verdict-retry":
    "RETRY sends a case backwards through the workflow; it is a verdict about " +
    "the proceeding, not a destination. `RealmType` has no member for it and " +
    "`DispositionService` routes RETRY to an existing realm (the mountain, " +
    "the meadow) rather than to one of its own.",
};

const SERIES_TOKENS: Record<string, string> = {
  balance: "--color-accent",
  realm: "--color-accent",
  neutral: "--color-ink-tertiary",
};

const CHROME_TOKENS: Record<string, string> = {
  accent: "--color-accent",
  grid: "--color-hairline",
  axis: "--color-hairline",
  tick: "--color-ink-subtle",
  tooltipBg: "--color-surface-1",
  tooltipBorder: "--color-hairline",
};

/** Every mirror table in one theme's bundle, keyed by its property name. */
function allMirrors(theme: ThemeName): Record<string, Record<string, string>> {
  const c: ChartColors = CHART_COLORS[theme];
  return {
    STATE_COLORS: c.STATE_COLORS,
    CIVILIZATION_COLORS: c.CIVILIZATION_COLORS,
    REALM_COLORS: c.REALM_COLORS,
    CHART_SERIES: { ...c.CHART_SERIES },
    CHART_CHROME: { ...c.CHART_CHROME },
  };
}

/** Every `theme × key` pair, so `it.each` reads as one row per pin. */
function pins(tokens: Record<string, string>): [ThemeName, string][] {
  return THEMES.flatMap((theme) => Object.keys(tokens).map((key) => [theme, key] as [ThemeName, string]));
}

/**
 * Entries in lib/chart-colors.ts whose value matches no token in globals.css at
 * all, and the reason each is allowed to stand.
 *
 * **It is empty, and that is the current finding rather than an oversight.**
 * Every entry across all five tables in both themes now resolves to a declared
 * token. An empty allow-list says the answer today is *none*, which is a
 * different claim from there being no rule — and the rule is the point: this is
 * the sweep that would have caught `hsl(271 81% 56%)` (Tailwind purple-600)
 * sitting in a file whose docstring calls itself a mirror of globals.css, and
 * `hsl(217 91% 60%)` (blue-500) sitting 2° from --color-verdict-purgatory,
 * which is the shape a reviewer reads as "that IS the token".
 *
 * Adding an entry back has to be a deliberate edit here, with the reason.
 */
const CHART_COLOURS_MIRRORING_NO_TOKEN: Record<string, string> = {};

describe("the parser is looking at something", () => {
  it("resolves a var() token down to a literal triple", () => {
    // The guard for the guard: if this stops substituting, every tooltipBg
    // assertion below compares two strings that both contain `var(`.
    //
    // THE SUBJECT MOVED WITH THE MIGRATION. It used to substitute `--civ-hue`
    // into `--color-surface-1`, because that is where the one var() in the
    // ramp lived; the ramp is per-tenant literals now and the indirection that
    // remains is the tenant's own plane token, which `resolveRampForCiv` reads.
    // A `:root` plane is a finished triple, so the pin is that it comes back
    // finished, and the substitution itself is exercised one line down where a
    // var() still exists.
    expect(resolveTriple(ROOT_TOKENS, "--color-surface-1")).toMatch(OKLCH_TRIPLE);
    expect(resolveTriple(ROOT_TOKENS, "--color-hairline")).toMatch(OKLCH_TRIPLE);
    expect(resolveRampForCiv("dark", CIV_PREFIXES[0], "--color-surface-1")).toMatch(OKLCH_TRIPLE);
    expect(
      resolveTriple({ "--a": "var(--b)", "--b": "0.5 0.1 200" }, "--a")
    ).toBe("0.5 0.1 200");
  });

  it("throws rather than returning a half-resolved value", () => {
    expect(() => resolveTriple(ROOT_TOKENS, "--color-nonexistent")).toThrow();
    expect(() => resolveTriple({ "--a": "var(--missing)" }, "--a")).toThrow();
  });

  it("found the realm types", () => {
    expect(REALM_TYPES).toEqual(expect.arrayContaining(["HELL", "NEUTRAL"]));
  });

  // ── the light side: the premises LIGHT_EFFECTIVE_TOKENS rests on ──────────
  it("resolves the light surface ramp, which only `:root` completes", () => {
    // WHY THIS TEST NO LONGER USES A DANGLING var() TO MAKE ITS POINT. It used
    // to: `.light` never redeclared `--civ-hue`, so resolving the light ramp
    // against the raw `.light` block threw, and the throw WAS the evidence that
    // `LIGHT_EFFECTIVE_TOKENS` is not `LIGHT_TOKENS`. `--civ-hue` is gone with
    // the OKLCH migration and `.light` declares every plane outright, so the
    // same distinction has to be shown on a token `.light` still stays silent
    // about — and it must be one, or `LIGHT_EFFECTIVE_TOKENS` would be a
    // synonym for `LIGHT_TOKENS` and the two maps' whole reason for existing
    // would be gone. `--color-focus` is declared in both; `--civ-mark` is
    // declared only in `:root`, which is the case that map exists for.
    expect(LIGHT_TOKENS["--civ-mark"]).toBeUndefined();
    expect(ROOT_TOKENS["--civ-mark"]).toMatch(OKLCH_TRIPLE);
    expect(LIGHT_EFFECTIVE_TOKENS["--civ-mark"]).toBe(ROOT_TOKENS["--civ-mark"]);
    // And the light ramp itself still resolves, on the effective map, to a
    // colour rather than to a name.
    expect(resolveTriple(LIGHT_EFFECTIVE_TOKENS, "--color-surface-1")).toMatch(OKLCH_TRIPLE);
    expect(resolveTriple(LIGHT_EFFECTIVE_TOKENS, "--color-surface-1")).not.toBe(
      resolveTriple(ROOT_TOKENS, "--color-surface-1")
    );
  });

  it("`.light` really does win over `:root` for every token it redeclares", () => {
    // The cascade claim LIGHT_EFFECTIVE_TOKENS is built on. `:root` and
    // `.light` have the same specificity (0,1,0), so source order decides —
    // and globals.css interleaves them `:root`, `.light`, `:root`, `.light`.
    // Reordering the file so a `:root` block landed last would silently make
    // the light mirror wrong while every other assertion here stayed green.
    const shared = Object.keys(LIGHT_TOKENS).filter((name) => name in ROOT_TOKENS);
    expect(shared.length).toBeGreaterThan(10);
    for (const name of shared) {
      expect(lastDeclarationOffset("\\.light", name)).toBeGreaterThan(
        lastDeclarationOffset(":root", name)
      );
    }
  });

  it("the no-cosmology blocks are ordered so the light one wins in light mode", () => {
    // THE SAME CASCADE CLAIM, ONE SPECIFICITY UP, AND IT NEEDS ITS OWN PIN
    // BECAUSE THE ONE ABOVE CANNOT SEE IT. `:root:not([data-civ])` and
    // `.light:not([data-civ])` are BOTH (0,2,0), so unlike the pair above
    // neither is rescued by being a class selector — only source order decides,
    // and both outrank plain `.light` wherever they sit. Swap them and a
    // logged-out light-mode screen paints the dark ramp: black canvas, white
    // text tokens, every other assertion in this file still green.
    //
    // Written against byte offsets rather than against `NO_CIV_TOKENS_BY_THEME`
    // on purpose. That map spreads the two blocks in the intended order, so it
    // would report the intended cascade no matter what the file said — a parser
    // agreeing with itself. Proven by mutation: swapping the two blocks in
    // globals.css leaves every other pin in this file passing and reddens only
    // this one.
    for (const name of Object.keys(NO_CIV_TOKENS_BY_THEME.light).filter(
      (n) => n.startsWith("--color-surface-") || n === "--color-canvas"
    )) {
      const dark = lastDeclarationOffset(":root:not\\(\\[data-civ\\]\\)", name);
      const light = lastDeclarationOffset("\\.light:not\\(\\[data-civ\\]\\)", name);
      expect(dark).toBeGreaterThan(-1);
      expect(light).toBeGreaterThan(dark);
    }
  });

  it("the two themes are different palettes, not one table copied twice", () => {
    // Without this, `LIGHT = DARK` would satisfy every per-token pin below the
    // moment someone "fixed" a failure by copying the dark values across —
    // which is exactly the bug being closed, wearing a passing test.
    const dark = allMirrors("dark");
    const light = allMirrors("light");
    const differing = Object.keys(dark).filter((table) =>
      Object.keys(dark[table]).some((key) => dark[table][key] !== light[table][key])
    );
    expect(differing.sort()).toEqual([
      "CHART_CHROME",
      "CHART_SERIES",
      "CIVILIZATION_COLORS",
      "REALM_COLORS",
      "STATE_COLORS",
    ]);
  });
});

describe("REALM_COLORS mirrors the verdict palette, and names where it cannot", () => {
  it.each(THEMES)("%s covers every realm type the UI can render, and nothing else", (theme) => {
    expect(Object.keys(CHART_COLORS[theme].REALM_COLORS).sort()).toEqual([...REALM_TYPES].sort());
  });

  it("the pinning table covers exactly the same keys", () => {
    expect(Object.keys(REALM_TOKENS).sort()).toEqual(Object.keys(CHART_COLORS.dark.REALM_COLORS).sort());
  });

  it.each(pins(REALM_TOKENS))("%s: %s carries its token verbatim", (theme, realm) => {
    expect(CHART_COLORS[theme].REALM_COLORS[realm]).toBe(literalOfIn(theme, REALM_TOKENS[realm]));
  });

  it("every --color-verdict-* token either names a realm or is recorded as naming none", () => {
    const declared = suffixesOf(ROOT_TOKENS, "--color-verdict").map((s) => `--color-verdict-${s}`);
    const accounted = new Set([
      ...Object.values(REALM_TOKENS).filter((t) => t.startsWith("--color-verdict-")),
      ...Object.keys(VERDICT_TOKENS_WITH_NO_REALM),
    ]);
    expect([...accounted].sort()).toEqual(declared.sort());
  });

  it("the realms pinned outside the verdict palette are exactly the ones recorded", () => {
    const outside = Object.entries(REALM_TOKENS)
      .filter(([, token]) => !token.startsWith("--color-verdict-"))
      .map(([realm]) => realm);
    expect(outside.sort()).toEqual(Object.keys(REALMS_PINNED_OUTSIDE_THE_VERDICT_PALETTE).sort());
  });

  it.each(THEMES)("%s: NEUTRAL is not drawn as a lost soul, and not as any verdict", (theme) => {
    // Absence, not presence. `--color-status-lost` is the answer that looks
    // right and says the wrong thing, and it would keep every "NEUTRAL has a
    // token" assertion above green while doing so.
    const neutral = CHART_COLORS[theme].REALM_COLORS.NEUTRAL;
    expect(neutral).not.toBe(literalOfIn(theme, "--color-status-lost"));
    for (const suffix of suffixesOf(ROOT_TOKENS, "--color-verdict")) {
      expect(neutral).not.toBe(literalOfIn(theme, `--color-verdict-${suffix}`));
    }
  });

  it.each(THEMES)("%s: does not draw two realm types in one colour", (theme) => {
    const values = Object.values(CHART_COLORS[theme].REALM_COLORS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("CHART_SERIES mirrors globals.css", () => {
  it("the pinning table covers exactly the same keys", () => {
    expect(Object.keys(SERIES_TOKENS).sort()).toEqual(Object.keys(CHART_COLORS.dark.CHART_SERIES).sort());
  });

  it.each(pins(SERIES_TOKENS))("%s: %s carries its token verbatim", (theme, key) => {
    const series = { ...CHART_COLORS[theme].CHART_SERIES } as Record<string, string>;
    expect(series[key]).toBe(literalOfIn(theme, SERIES_TOKENS[key]));
  });

  it.each(THEMES)("%s: balance and realm share one token on purpose", (theme) => {
    // Asserted rather than left implicit: this is the one place in the five
    // tables where two entries are deliberately identical, so a future reader
    // finding them equal has something that says it was meant. Not a
    // uniqueness assertion, which would be false here — see the CHART_SERIES
    // docstring in lib/chart-colors.ts for why neither has anything to encode.
    expect(SERIES_TOKENS.balance).toBe("--color-accent");
    expect(SERIES_TOKENS.realm).toBe("--color-accent");
    expect(CHART_COLORS[theme].CHART_SERIES.balance).toBe(CHART_COLORS[theme].CHART_SERIES.realm);
  });

  it.each(THEMES)("%s: the unknown-state fallback is not the LOST colour", (theme) => {
    // An unrecognised state rendering identically to LOST is the wrong value
    // sitting exactly where the right one belongs.
    const { CHART_SERIES, STATE_COLORS } = CHART_COLORS[theme];
    expect(CHART_SERIES.neutral).not.toBe(literalOfIn(theme, "--color-status-lost"));
    for (const state of Object.keys(STATE_COLORS)) {
      expect(CHART_SERIES.neutral).not.toBe(STATE_COLORS[state]);
    }
  });
});

describe("CHART_CHROME mirrors globals.css", () => {
  it("the pinning table covers exactly the same keys", () => {
    expect(Object.keys(CHROME_TOKENS).sort()).toEqual(Object.keys(CHART_COLORS.dark.CHART_CHROME).sort());
  });

  it.each(pins(CHROME_TOKENS))("%s: %s carries its token verbatim", (theme, key) => {
    const chrome = { ...CHART_COLORS[theme].CHART_CHROME } as Record<string, string>;
    // tooltipBg is resolved on the NO-cosmology branch and every other key on
    // the ordinary one. That is not a special case bolted on to keep a test
    // green — it is the decision recorded in chart-colors.ts ("the tooltip does
    // not follow the tenant"), and it is the one key whose token is
    // tenant-variable, so it is the only key where the two branches differ.
    const literal = key === "tooltipBg" ? noCivLiteralOfIn : literalOfIn;
    expect(chrome[key]).toBe(literal(theme, CHROME_TOKENS[key]));
  });

  // ── tooltipBg: the premises the "does not follow the tenant" decision rests on
  it("surface-1 is still the tenant-variable token that forced the decision", () => {
    // If surface-1 ever stops varying by tenant, tooltipBg is an ordinary
    // literal mirror again and the paragraph arguing the fallback is stale.
    //
    // THE EVIDENCE MOVED FROM THE DECLARATION TO THE RULES. `toContain(
    // "[--civ-hue]")` worked because the tenant axis was visible in the
    // plane's own `:root` declaration. Since the OKLCH migration that
    // declaration is a finished (and inert) triple and the tenant axis lives
    // in `:root[data-civ]`, so the same fact is read from there. Stated as
    // "four tenants, four different colours" as well, which is what the
    // decision actually rests on — a rule that pointed all four at one token
    // would satisfy a wiring check and still make tooltipBg a literal mirror.
    const rules = readCivAttrRules();
    for (const prefix of CIV_PREFIXES) {
      expect(rules[prefix].ramp["--color-surface-1"]).toBeDefined();
    }
    for (const theme of THEMES) {
      const perTenant = CIV_PREFIXES.map((civ) =>
        resolveRampForCiv(theme, civ, "--color-surface-1")
      );
      expect(new Set(perTenant).size).toBe(CIV_PREFIXES.length);
    }
  });

  it("the branch it mirrors is the one a screen with no cosmology renders", () => {
    // WHAT CHANGED IN STAGE 11, AND WHY THIS ASSERTION IS NOT THE OLD ONE
    // RETUNED. The old pin read `--civ-hue === "240"` and called that the
    // neutral fallback. It was, while the ramp was near-neutral: 240° at 13%
    // saturation is the same near-black as every tenant's.
    //
    // STAGE 12 WITHDREW THAT LAST CLAUSE. "The same near-black" came from
    // max-channel, which reads a hue-only difference as almost nothing. In
    // CIEDE2000, on the old dark ramp, 240° measured 5.36-9.40 from Greek and
    // 4.26-7.27 from Egyptian — a visible colour, on every logged-out screen,
    // the whole time. Only European (8° away) was truly indistinguishable
    // from it. The pin below is unaffected and its motivation is stronger:
    // 240° was never neutral, Stage 11 only made that impossible to miss.
    //
    // At the tinted saturations 240° is a deep blue-violet 8° from European (232°), so
    // "resolve surface-1 with --civ-hue" stopped naming a neutral colour and
    // started naming a fifth cosmology nobody declared. globals.css answers it
    // with a selector instead of a value, and this pins the selector's output.
    //
    // The old check is kept as its second half rather than deleted: 240 must
    // still belong to no civilization, because a cosmology claiming it would
    // make `:root:not([data-civ])`'s neutral ramp read as that tenant.
    for (const theme of THEMES) {
      expect(NO_CIV_TOKENS_BY_THEME[theme]["--color-surface-1"]).not.toContain("var(");
      for (const prefix of CIV_PREFIXES) {
        expect(TOKENS_BY_THEME[theme][`--color-civ-hue-${prefix}`]).not.toBe("240");
      }
    }
    // And the two branches really do differ, so this is measuring something:
    // if the fallback blocks were deleted, `NO_CIV_TOKENS_BY_THEME` would fall
    // back to the tinted declaration and this file would still be green.
    expect(noCivLiteralOfIn("dark", "--color-surface-1")).not.toBe(
      literalOfIn("dark", "--color-surface-1")
    );
  });
});

describe("every entry in lib/chart-colors.ts mirrors a declared token", () => {
  it.each(THEMES)("%s: across all five tables, with the exceptions named", (theme) => {
    const tokens = TOKENS_BY_THEME[theme];
    // Both branches count as declared: `tooltipBg` deliberately mirrors the
    // no-cosmology ramp (see above), and that literal exists in globals.css
    // just as much as the tenant-facing one does.
    const declared = new Set([
      ...Object.keys(tokens).map((name) => literalOfIn(theme, name)),
      ...Object.keys(NO_CIV_TOKENS_BY_THEME[theme]).map((name) => noCivLiteralOfIn(theme, name)),
    ]);
    const unmirrored: string[] = [];
    for (const [table, map] of Object.entries(allMirrors(theme))) {
      for (const [key, value] of Object.entries(map)) {
        if (!declared.has(value)) unmirrored.push(`${table}.${key}`);
      }
    }
    expect(unmirrored.sort()).toEqual(Object.keys(CHART_COLOURS_MIRRORING_NO_TOKEN).sort());
  });

  it.each(THEMES)("%s: compares against a real set of tokens", (theme) => {
    // Without this the assertion above passes trivially if `declared` empties.
    const tokens = TOKENS_BY_THEME[theme];
    expect(new Set(Object.keys(tokens).map((n) => literalOfIn(theme, n))).size).toBeGreaterThan(20);
    expect(Object.values(allMirrors(theme)).every((m) => Object.keys(m).length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("no chart picks its own colour", () => {
  // The tables above are pinned to globals.css, which is worth nothing for a
  // series whose colour never came from a table. `LazyBarChart` defaulted
  // `fill` to `"#f59e0b"` — a literal declared nowhere else, invisible to every
  // assertion in this file, and inherited by whichever caller did not choose.
  //
  // That caller was the dashboard's tenant comparison chart, so four
  // cosmologies were drawn as one amber series directly above four cards that
  // each carried their own civilization mark: two views of the same four
  // tenants on one screen, one of them saying they were a single category. The
  // swatch on those cards was never the redundant half — it is the legend, and
  // the chart is the thing it keys.
  //
  // Read as source rather than rendered: the wrappers are inside a
  // `dynamic(() => import("recharts"))` factory, so there is no component to
  // mount without pulling recharts into jsdom, and the regression is a default
  // parameter — a property of the declaration, not of any render.
  const CHARTS_SRC = readFileSync(
    join(process.cwd(), "src/components/charts/LazyDashboardCharts.tsx"),
    "utf8"
  );
  const DASHBOARD_SRC = readFileSync(join(process.cwd(), "app/dashboard/page.tsx"), "utf8");

  // Every chart wrapper this file declares, pinned by name.
  //
  // A count, or "contains WrappedBarChart", would leave the block below
  // scanning a file it no longer describes. `WrappedAdminBarChart` and
  // `WrappedPieChart` used to be here and had zero callers anywhere in the app
  // — grep found only their own definitions and the export list — so their
  // copies of `"#f59e0b"` and `"#6b7280"` were literals carried by nothing.
  // Deleting them turned this pin red, which is the pin doing its job: the
  // subject set changed and the check that examines it had to be told.
  const WRAPPERS = [
    "WrappedBarChart",
    "WrappedDashboardPieChart",
    "WrappedSoulLineChart",
    "WrappedLifespanBarChart",
  ];

  it("the parser is looking at something", () => {
    // Both files must actually contain the wrappers and the series this
    // describe block reasons about, or every assertion below is vacuous.
    const found = WRAPPERS.filter((name) => CHARTS_SRC.includes(name));
    expect(found).toEqual(WRAPPERS);
    // And nothing else: a fifth wrapper is a fifth place a colour can be
    // chosen, and it has to be added here before the rules below cover it.
    const declared = (CHARTS_SRC.match(/return function (Wrapped\w+)/g) ?? []).map((m) =>
      m.replace("return function ", "")
    );
    expect(declared.sort()).toEqual([...WRAPPERS].sort());
    expect(DASHBOARD_SRC).toContain("const tenantData");
  });

  it("gives no chart a default fill to fall back on", () => {
    // `fill = "…"` anywhere in this file is a colour no caller chose. Making
    // the prop required is what turns "which colour is this series" into a
    // question with an answer at every call site.
    expect(CHARTS_SRC).not.toMatch(/\bfill\s*=\s*["'`]/);
  });

  it("leaves no colour literal in the chart components at all", () => {
    // The general form of the rule above, and the one that catches the shape
    // that survived it. `fill` was not the only hardcoded colour in this file:
    // both pie wrappers ended their cell fallback chain in `"#6b7280"` — stock
    // Tailwind gray-500, declared nowhere in globals.css, unreachable by every
    // pin in this file, and a fixed value in both themes where every other
    // neutral in the app moves between them.
    //
    // A per-datum colour with a literal at the end of the chain is the same
    // defect as a defaulted prop wearing a different shape: the palette is
    // consulted first and quietly abandoned when it has nothing to say. Both
    // pies now take a required `fallbackFill`, so the palette is what answers
    // when the datum does not.
    //
    // Matched as any hex literal rather than as that one value, because the
    // next one to land will not be `#6b7280`. Chart fills cannot be `oklch(var(…))`
    // — the dashboard's own comment records that recharts fills do not follow
    // the `.light` cascade, which is why `useChartColors` resolves them in JS —
    // so a literal here is always a colour that escaped the tables above.
    // Comments stripped first, and the first run of this assertion is why:
    // it went red on the two literals quoted in the paragraph above, which
    // exist to explain the rule rather than to paint anything. This file has
    // hit that before — `statusTokenLayering` carries a comment recording that
    // quoting the offending shape reproduced the offence, because Tailwind
    // scans `src/**` and a utility written inside a comment becomes a real CSS
    // rule. Stripping comments narrows the assertion to what actually renders,
    // which is what it was always about.
    const code = CHARTS_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("fallbackFill");
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it("makes the legend and the chart agree about an unmapped tenant", () => {
    // The half the assertion above cannot see, and the half that stayed broken
    // one round longer. The per-civilization swatch is the legend for the bars;
    // when the bars fell back to CHART_SERIES.neutral and the swatch fell back
    // to `"#6b7280"`, an unmapped tenant was drawn in two different greys — the
    // legend contradicting its own chart in the smaller way, one viewport after
    // the larger contradiction was fixed. `#6b7280` is gray-500 and fixed
    // across both themes; the token moves between them, so they also diverged
    // by theme.
    //
    // Asserted as "both name the same fallback" rather than "neither is a hex",
    // because the failure is disagreement rather than literalness: two
    // different tokens would be just as wrong and a hex-only check would pass.
    const code = DASHBOARD_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // `[^\n]*?` and not `[^\]]+`: one of the two subscripts is
    // `stats.tenants[i].tenant_code`, so a class that stops at the first `]`
    // matches the inner one, fails the `??` that follows, and finds a single
    // fallback where there are two — which is a count assertion passing itself
    // a wrong number rather than reporting a disagreement.
    const fallbacks = code.match(/CIVILIZATION_COLORS\[[^\n]*?\]\s*\?\?\s*([A-Za-z_$][\w.$]*)/g) ?? [];
    expect(fallbacks.length).toBe(2);
    const named = fallbacks.map((f) => f.split("??")[1].trim());
    expect(new Set(named).size).toBe(1);
    expect(named[0]).toBe("CHART_SERIES.neutral");
  });

  it("colours the tenant comparison chart per tenant, from the mark table", () => {
    // The positive half, and the one that would go red if someone deleted the
    // per-datum colour and let the bars share one fill again. Asserted against
    // CIVILIZATION_COLORS by name: a hand-written per-tenant palette here would
    // be a sixth table for this file to pin, which is the whole failure above.
    const tenantData = /const tenantData[\s\S]*?\}\)\) \?\? \[\];/.exec(DASHBOARD_SRC);
    expect(tenantData).not.toBeNull();
    expect(tenantData![0]).toContain("CIVILIZATION_COLORS[tenant.tenant_code]");
  });
});
