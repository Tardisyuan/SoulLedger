/**
 * `app/globals.css` is the authority for colour. This file makes that true for
 * the three tables in `lib/chart-colors.ts` that `f62fdaa` did not reach.
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
 * CHART_CHROME is the opposite case and worth stating: five of its six entries
 * were already exact token mirrors. Only `tooltipBg` was stranded, by
 * `--color-surface-1` changing from a fixed `240 13% 7%` into the per-tenant
 * `var(--civ-hue) 13% 7%`. A token that varies has no single literal, so that
 * entry had to answer a design question; the answer and its premises are pinned
 * at the bottom of this file.
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
  LIGHT_TOKENS,
  ROOT_TOKENS,
  literalOf,
  readRealmTypes,
  resolveTriple,
  suffixesOf,
} from "./support/globalsCssTokens";
import {
  CHART_CHROME,
  CHART_SERIES,
  CIVILIZATION_COLORS,
  REALM_COLORS,
  STATE_COLORS,
} from "@/lib/chart-colors";

const REALM_TYPES = readRealmTypes();

/** Which token each realm type mirrors. */
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

/** Every mirror table in lib/chart-colors.ts, keyed by its export name. */
const ALL_MIRRORS: Record<string, Record<string, string>> = {
  STATE_COLORS,
  CIVILIZATION_COLORS,
  REALM_COLORS,
  CHART_SERIES: { ...CHART_SERIES },
  CHART_CHROME: { ...CHART_CHROME },
};

/**
 * Entries in lib/chart-colors.ts whose value matches no token in globals.css at
 * all, and the reason each is allowed to stand.
 *
 * **It is empty, and that is the current finding rather than an oversight.**
 * Every entry across all five tables now resolves to a declared token. An empty
 * allow-list says the answer today is *none*, which is a different claim from
 * there being no rule — and the rule is the point: this is the sweep that would
 * have caught `hsl(271 81% 56%)` (Tailwind purple-600) sitting in a file whose
 * docstring calls itself a mirror of globals.css, and `hsl(217 91% 60%)`
 * (blue-500) sitting 2° from --color-verdict-purgatory, which is the shape a
 * reviewer reads as "that IS the token".
 *
 * Adding an entry back has to be a deliberate edit here, with the reason.
 */
const CHART_COLOURS_MIRRORING_NO_TOKEN: Record<string, string> = {};

describe("the parser is looking at something", () => {
  it("resolves a var() token down to a literal triple", () => {
    // The guard for the guard: if this stops substituting, every tooltipBg
    // assertion below compares two strings that both contain `var(`.
    expect(resolveTriple(ROOT_TOKENS, "--color-surface-1")).toBe("240 13% 7%");
    expect(resolveTriple(ROOT_TOKENS, "--color-hairline")).toBe("220 8% 18%");
  });

  it("throws rather than returning a half-resolved value", () => {
    expect(() => resolveTriple(ROOT_TOKENS, "--color-nonexistent")).toThrow();
    expect(() => resolveTriple({ "--a": "var(--missing)" }, "--a")).toThrow();
  });

  it("found the realm types", () => {
    expect(REALM_TYPES).toEqual(expect.arrayContaining(["HELL", "NEUTRAL"]));
  });
});

describe("REALM_COLORS mirrors the verdict palette, and names where it cannot", () => {
  it("covers every realm type the UI can render, and nothing else", () => {
    expect(Object.keys(REALM_COLORS).sort()).toEqual([...REALM_TYPES].sort());
  });

  it("the pinning table covers exactly the same keys", () => {
    expect(Object.keys(REALM_TOKENS).sort()).toEqual(Object.keys(REALM_COLORS).sort());
  });

  it.each(Object.keys(REALM_TOKENS))("%s carries its dark-mode token verbatim", (realm) => {
    expect(REALM_COLORS[realm]).toBe(literalOf(REALM_TOKENS[realm]));
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

  it("NEUTRAL is not drawn as a lost soul, and not as any verdict", () => {
    // Absence, not presence. `--color-status-lost` is the answer that looks
    // right and says the wrong thing, and it would keep every "NEUTRAL has a
    // token" assertion above green while doing so.
    expect(REALM_COLORS.NEUTRAL).not.toBe(literalOf("--color-status-lost"));
    for (const suffix of suffixesOf(ROOT_TOKENS, "--color-verdict")) {
      expect(REALM_COLORS.NEUTRAL).not.toBe(literalOf(`--color-verdict-${suffix}`));
    }
  });

  it("does not draw two realm types in one colour", () => {
    const values = Object.values(REALM_COLORS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("CHART_SERIES mirrors globals.css", () => {
  const series = { ...CHART_SERIES } as Record<string, string>;

  it("the pinning table covers exactly the same keys", () => {
    expect(Object.keys(SERIES_TOKENS).sort()).toEqual(Object.keys(series).sort());
  });

  it.each(Object.keys(SERIES_TOKENS))("%s carries its dark-mode token verbatim", (key) => {
    expect(series[key]).toBe(literalOf(SERIES_TOKENS[key]));
  });

  it("balance and realm share one token on purpose", () => {
    // Asserted rather than left implicit: this is the one place in the five
    // tables where two entries are deliberately identical, so a future reader
    // finding them equal has something that says it was meant. Not a
    // uniqueness assertion, which would be false here — see the CHART_SERIES
    // docstring in lib/chart-colors.ts for why neither has anything to encode.
    expect(SERIES_TOKENS.balance).toBe("--color-accent");
    expect(SERIES_TOKENS.realm).toBe("--color-accent");
    expect(series.balance).toBe(series.realm);
  });

  it("the unknown-state fallback is not the LOST colour", () => {
    // An unrecognised state rendering identically to LOST is the wrong value
    // sitting exactly where the right one belongs.
    expect(series.neutral).not.toBe(literalOf("--color-status-lost"));
    for (const state of Object.keys(STATE_COLORS)) {
      expect(series.neutral).not.toBe(STATE_COLORS[state]);
    }
  });
});

describe("CHART_CHROME mirrors globals.css", () => {
  const chrome = { ...CHART_CHROME } as Record<string, string>;

  it("the pinning table covers exactly the same keys", () => {
    expect(Object.keys(CHROME_TOKENS).sort()).toEqual(Object.keys(chrome).sort());
  });

  it.each(Object.keys(CHROME_TOKENS))("%s carries its dark-mode token verbatim", (key) => {
    expect(chrome[key]).toBe(literalOf(CHROME_TOKENS[key]));
  });

  // ── tooltipBg: the premises the "does not follow the tenant" decision rests on
  it("surface-1 is still the tenant-variable token that forced the decision", () => {
    // If surface-1 ever stops interpolating --civ-hue, tooltipBg is an ordinary
    // literal mirror again and the paragraph arguing the fallback is stale.
    expect(ROOT_TOKENS["--color-surface-1"]).toContain("var(--civ-hue)");
    expect(LIGHT_TOKENS["--color-surface-1"]).toContain("var(--civ-hue)");
  });

  it("the hue it resolves to is the neutral fallback, not any tenant's", () => {
    // 240 is what `:root` declares for logged-out screens and tenants this
    // deployment does not map. If a civilization ever claimed 240, the tooltip
    // would silently become that tenant's colour while claiming to be neutral.
    expect(ROOT_TOKENS["--civ-hue"]).toBe("240");
    for (const prefix of CIV_PREFIXES) {
      expect(ROOT_TOKENS[`--color-civ-hue-${prefix}`]).not.toBe(ROOT_TOKENS["--civ-hue"]);
    }
  });
});

describe("every entry in lib/chart-colors.ts mirrors a declared token", () => {
  it("across all five tables, with the exceptions named", () => {
    const declared = new Set(Object.keys(ROOT_TOKENS).map((name) => literalOf(name)));
    const unmirrored: string[] = [];
    for (const [table, map] of Object.entries(ALL_MIRRORS)) {
      for (const [key, value] of Object.entries(map)) {
        if (!declared.has(value)) unmirrored.push(`${table}.${key}`);
      }
    }
    expect(unmirrored.sort()).toEqual(Object.keys(CHART_COLOURS_MIRRORING_NO_TOKEN).sort());
  });

  it("compares against a real set of tokens", () => {
    // Without this the assertion above passes trivially if `declared` empties.
    expect(new Set(Object.keys(ROOT_TOKENS).map((n) => literalOf(n))).size).toBeGreaterThan(20);
    expect(Object.values(ALL_MIRRORS).every((m) => Object.keys(m).length > 0)).toBe(true);
  });
});
