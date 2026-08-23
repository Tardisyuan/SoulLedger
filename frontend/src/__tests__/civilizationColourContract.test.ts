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
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { CIVILIZATION_COLORS, STATE_COLORS } from "@/lib/chart-colors";
import { CIVILIZATION_CODES } from "@/src/config/civilizations";

const FRONTEND_ROOT = path.join(__dirname, "..", "..");
const GLOBALS_CSS = path.join(FRONTEND_ROOT, "app", "globals.css");
const SOULS_TS = path.join(FRONTEND_ROOT, "lib", "api", "souls.ts");

const css = readFileSync(GLOBALS_CSS, "utf8");

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Merge every block with the given selector into one token map, later
 * declarations winning — exactly how the cascade resolves them. There is more
 * than one `:root` and more than one `.light` block in globals.css.
 *
 * Throws rather than returning `{}` if the selector matches nothing: a contract
 * test that silently stops finding what it compares is worse than no test, and
 * `{}` would make every "both sides agree" assertion below vacuously green.
 */
function readTokens(selector: string): Record<string, string> {
  const blocks = [...css.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "g"))];
  if (blocks.length === 0) {
    throw new Error(
      `No \`${selector}\` block found in ${GLOBALS_CSS}. If the file was ` +
        `restructured, fix this parser — do not delete the comparison.`
    );
  }
  const tokens: Record<string, string> = {};
  for (const block of blocks) {
    for (const decl of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[decl[1]] = decl[2].trim();
    }
  }
  return tokens;
}

const ROOT_TOKENS = readTokens(":root");
const LIGHT_TOKENS = readTokens("\\.light");

/** Suffixes of every token matching a `--prefix-<suffix>` family, sorted. */
function suffixesOf(tokens: Record<string, string>, family: string): string[] {
  const hits = Object.keys(tokens)
    .filter((name) => name.startsWith(`${family}-`))
    .map((name) => name.slice(family.length + 1));
  return [...new Set(hits)].sort();
}

/** `--color-civ-mark-cn: 12 55% 58%;` -> `hsl(12 55% 58%)`, the literal form chart-colors uses. */
function asChartLiteral(triple: string): string {
  return `hsl(${triple})`;
}

/**
 * The `[data-civ="X"]` rules, mapped to the token each points `--civ-hue` at.
 * These are what actually retint the surface ramp; tokens without a rule are
 * inert, which is precisely how GREEK rendered on the neutral 240° fallback
 * while looking, in the stylesheet, fully wired up.
 */
function readCivAttrRules(): Record<string, string> {
  const rules: Record<string, string> = {};
  const pattern = /\[data-civ="([\w-]+)"\]\s*\{\s*--civ-hue:\s*var\((--[\w-]+)\)\s*;?\s*\}/g;
  for (const m of css.matchAll(pattern)) rules[m[1]] = m[2];
  return rules;
}

/**
 * `Soul.current_state` from lib/api/souls.ts — the states the payload can
 * actually carry, read as text because Jest sees the type only at compile time
 * and a type cannot be iterated at runtime. This is the reverse direction for
 * STATE_COLORS: without it, a state the API can send but no chart can colour
 * stays green forever.
 */
function readSoulStates(): string[] {
  const source = readFileSync(SOULS_TS, "utf8");
  const m = /^\s*current_state:\s*("[A-Z_]+"(?:\s*\|\s*"[A-Z_]+")*)\s*;/m.exec(source);
  if (m === null) {
    throw new Error(
      `Could not find the \`current_state\` union in ${SOULS_TS}. Fix this ` +
        `parser; do not delete the comparison.`
    );
  }
  const members = [...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
  if (members.length === 0) throw new Error(`current_state parsed empty in ${SOULS_TS}`);
  return members;
}

/**
 * The one prefix rule, written once. `TenantContext` derives the `[data-civ]`
 * attribute as `tenantCode.split("_")[0].toLowerCase()`; the CSS token families
 * are keyed by that same prefix. Deriving it here from `CIVILIZATION_CODES`
 * rather than hardcoding `["cn","eu","eg","gr"]` is what makes a *fifth*
 * civilization turn this file red the moment it is added to the config — which
 * is the enumeration point Greek slipped through.
 */
const CIV_PREFIX_BY_TENANT_CODE = Object.fromEntries(
  Object.values(CIVILIZATION_CODES).map((code) => [code, code.split("_")[0].toLowerCase()])
) as Record<string, string>;

const TENANT_CODES = Object.values(CIVILIZATION_CODES) as string[];
const CIV_PREFIXES = [...new Set(Object.values(CIV_PREFIX_BY_TENANT_CODE))].sort();

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
  it("keys off tenant codes — one per civilization, no more and no less", () => {
    // Forward AND reverse in one assertion: an extra key and a missing key are
    // both a failed set equality.
    expect(Object.keys(CIVILIZATION_COLORS).sort()).toEqual([...TENANT_CODES].sort());
  });

  it.each(TENANT_CODES)("%s carries the dark-mode mark token verbatim", (code) => {
    const prefix = CIV_PREFIX_BY_TENANT_CODE[code];
    const token = ROOT_TOKENS[`--color-civ-mark-${prefix}`];
    expect(token).toBeDefined();
    expect(CIVILIZATION_COLORS[code]).toBe(asChartLiteral(token));
  });

  it("has no entry pointing at a token that does not exist", () => {
    // The reverse direction, said the other way round: this is what would have
    // caught `CN_DIYU: hsl(38 92% 50%)` mirroring `--color-civ-cn` years after
    // `--color-civ-cn` stopped existing.
    const declared = new Set(
      suffixesOf(ROOT_TOKENS, "--color-civ-mark").map((s) => asChartLiteral(ROOT_TOKENS[`--color-civ-mark-${s}`]))
    );
    for (const value of Object.values(CIVILIZATION_COLORS)) {
      expect([...declared]).toContain(value);
    }
  });
});

describe("STATE_COLORS mirrors --color-status-<state> exactly", () => {
  const SOUL_STATES = readSoulStates();

  it("covers every state the payload can carry, and nothing else", () => {
    expect(Object.keys(STATE_COLORS).sort()).toEqual([...SOUL_STATES].sort());
  });

  it.each(SOUL_STATES)("%s carries the dark-mode status token verbatim", (state) => {
    const token = ROOT_TOKENS[`--color-status-${state.toLowerCase()}`];
    expect(token).toBeDefined();
    expect(STATE_COLORS[state]).toBe(asChartLiteral(token));
  });

  it.each(SOUL_STATES)("%s has a light-mode token too", (state) => {
    // Charts do not follow `.light`, so this is not about the chart — it is
    // about the badge that renders the same state elsewhere on the page.
    expect(LIGHT_TOKENS[`--color-status-${state.toLowerCase()}`]).toBeDefined();
  });

  it("does not reuse one hue for two lifecycle states", () => {
    // The concrete regression: DISPOSED (220°) and REINCARNATING (217°) were
    // 3° apart in this map long after the tokens moved them 90° apart. Two
    // states rendered in one colour is the failure; identical *values* is the
    // symptom this can actually see.
    const values = Object.values(STATE_COLORS);
    expect(new Set(values).size).toBe(values.length);
  });
});
