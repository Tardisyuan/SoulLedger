/**
 * The one parser that reads `app/globals.css`, shared by every contract test
 * that holds something else to it: `chartColourContract` and
 * `civilizationColourContract` (the `lib/chart-colors.ts` mirror, both themes),
 * `dataGridToneContract` (badge tint depth vs the light-mode measurements),
 * `statusTokenLayering` (which palette a domain enum may draw from) and
 * `inkOnSurfaceContract` (every ink token against every surface token, per
 * tenant, per theme).
 *
 * Not a test file — `jest.config.js` matches `**\/__tests__/**\/*.test.ts(x)`
 * only, and `collectCoverageFrom` excludes `src/__tests__/**`, so this module is
 * imported and never collected.
 *
 * WHY IT IS A MODULE RATHER THAN A COPY IN EACH FILE. `civilizationColourContract`
 * and `chartColourContract` compare the same stylesheet from two angles, and two
 * regex parsers of one file is the identical defect these tests exist to close:
 * a second copy nobody re-derives. `backend/tests/test_workflow_preset_case_types.py`
 * imports its parser from `test_workflow_preset_node_types.py` for exactly this
 * reason — "copying would give two parsers that drift; importing gives one that
 * fails loudly if the module moves."
 *
 * Every function here throws rather than returning an empty result. A contract
 * test that silently stops finding what it compares is worse than no test:
 * `{}` and `[]` make every "both sides agree" assertion vacuously green.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { CIVILIZATION_CODES, CIVILIZATION_SHORT_CODES } from "@soulledger/core/config/civilizations";

export const FRONTEND_ROOT = path.join(__dirname, "..", "..", "..");
export const GLOBALS_CSS = path.join(FRONTEND_ROOT, "app", "globals.css");
export const SOULS_TS = path.join(FRONTEND_ROOT, "..", "packages", "core", "src", "api", "souls.ts");
export const EN_MESSAGES = path.join(FRONTEND_ROOT, "..", "packages", "core", "messages", "en.json");

const css = readFileSync(GLOBALS_CSS, "utf8");

/**
 * Merge every block with the given selector into one token map, later
 * declarations winning — exactly how the cascade resolves them. There is more
 * than one `:root` and more than one `.light` block in globals.css.
 *
 * Throws rather than returning `{}` if the selector matches nothing: a contract
 * test that silently stops finding what it compares is worse than no test, and
 * `{}` would make every "both sides agree" assertion vacuously green.
 */
/**
 * A block body with its CSS comments removed.
 *
 * THE BUG THIS EXISTS FOR. `readTokens` scanned block bodies for
 * `(--[\w-]+)\s*:\s*([^;]+);` including their comments. In `app/globals.css`
 * the note above `--color-karma-merit` reads "Renamed from
 * --color-merit/--color-demerit: this pair now has its own semantic identity
 * …". The regex matched `--color-demerit:` INSIDE that comment, and `[^;]+`
 * then ran forward to the next semicolon — the one ending the real
 * `--color-karma-merit: 150 62% 46%;` declaration.
 *
 * So `ROOT_TOKENS` carried a phantom `--color-demerit` holding a paragraph of
 * prose, and `--color-karma-merit` was `undefined` — invisible to every
 * contract test importing this module. Any assertion shaped "every karma token
 * is X" skipped merit silently, which is the clean-pass-over-nothing-examined
 * class this repository is built around.
 *
 * Only the DARK declaration was swallowed, because only it carries that
 * comment; `.light` had the token all along. So the two themes disagreed about
 * whether a token existed, and nothing said so.
 */
function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function readTokens(selector: string): Record<string, string> {
  const blocks = [...css.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "g"))];
  if (blocks.length === 0) {
    throw new Error(
      `No \`${selector}\` block found in ${GLOBALS_CSS}. If the file was ` +
        `restructured, fix this parser — do not delete the comparison.`
    );
  }
  const tokens: Record<string, string> = {};
  for (const block of blocks) {
    for (const decl of stripComments(block[1]).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[decl[1]] = decl[2].trim();
    }
  }
  return tokens;
}

export const ROOT_TOKENS = readTokens(":root");
export const LIGHT_TOKENS = readTokens("\\.light");

/**
 * Byte offset of the LAST block matching `selector` that declares `name`, or
 * `-1`. Used to prove the cascade claim that `LIGHT_EFFECTIVE_TOKENS` rests on
 * rather than assuming it — `:root` and `.light` have the same specificity
 * (0,1,0), so which one wins is purely a question of source order, and
 * globals.css interleaves them: `:root`, `.light`, `:root`, `.light`.
 */
export function lastDeclarationOffset(selector: string, name: string): number {
  let offset = -1;
  const decl = new RegExp(`${name}\\s*:\\s*[^;]+;`);
  for (const block of css.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "g"))) {
    // Comments stripped for the same reason as in `readTokens` above: a
    // comment naming `--some-token:` would make this report an offset for a
    // declaration that is not there.
    if (decl.test(stripComments(block[1]))) offset = block.index ?? -1;
  }
  return offset;
}

/**
 * What a token actually resolves to when `<html>` carries `.light`.
 *
 * NOT the same thing as `LIGHT_TOKENS`. `.light` is an *override* block: it
 * redeclares the tokens whose light value differs and stays silent on the rest,
 * which then keep their `:root` value through the cascade. `--civ-hue` is the
 * one that matters here — `.light` never redeclares it, so the light surface
 * ramp interpolates the same neutral `240` fallback `:root` declares, and
 * `resolveTriple(LIGHT_TOKENS, "--color-surface-1")` would throw on a dangling
 * `var(--civ-hue)` rather than answer the question.
 *
 * Both maps are exported and both are load-bearing: `LIGHT_TOKENS` answers "did
 * `.light` declare this itself" (a civilization missing from it inherits the
 * DARK value and only breaks on one theme), while this map answers "what colour
 * does the user see". Neither substitutes for the other.
 */
export const LIGHT_EFFECTIVE_TOKENS: Record<string, string> = { ...ROOT_TOKENS, ...LIGHT_TOKENS };

/**
 * The ramp a screen with NO `[data-civ]` renders — logged out, or a tenant this
 * deployment maps to no cosmology.
 *
 * Before Stage 11 there was nothing to read: the fallback was the value
 * `--civ-hue: 240` interpolated into the same declarations every tenant used,
 * and at 13% saturation "the neutral branch" and "some tenant's branch" were
 * taken to be the same pixels anyway. The tinted ramp made 240° a deep
 * blue-violet 8° from European, so globals.css now declares the untinted ramp
 * outright under `:root:not([data-civ])` / `.light:not([data-civ])`.
 *
 * "THE SAME PIXELS ANYWAY" WAS max-channel TALKING. Re-measured in ΔE00 on
 * that old dark ramp, the 240° fallback sat 5.36-9.40 from Greek and
 * 4.26-7.27 from Egyptian — a colour, not a neutral, and only European was
 * genuinely close to it. This map's reason for existing is unchanged; what
 * changes is that reading it is not merely a Stage 11 concern.
 *
 * `readTokens(":root")` and `readTokens("\\.light")` do NOT see these blocks —
 * their patterns require the selector to be followed by whitespace and `{`,
 * and here it is followed by `:not(`. That is load-bearing in both directions:
 * the tenant-facing maps stay free of fallback values, and this map is the only
 * place the fallback can be measured. Read it wherever the subject is the
 * screen with no cosmology; `TOKENS_BY_THEME` remains the answer for a tenant.
 */
export const NO_CIV_ROOT_TOKENS = readTokens(":root:not\\(\\[data-civ\\]\\)");
export const NO_CIV_LIGHT_TOKENS = readTokens("\\.light:not\\(\\[data-civ\\]\\)");

export type ThemeName = "dark" | "light";

/** The two themes, as `ThemeContext` names them. Iterate this, never a literal pair. */
export const THEMES: ThemeName[] = ["dark", "light"];

/**
 * The resolved token map per theme. `dark` is the bare `:root` block because
 * `ThemeProvider` puts `.dark` on `<html>` and globals.css declares nothing
 * under `.dark` — dark IS `:root` here.
 */
export const TOKENS_BY_THEME: Record<ThemeName, Record<string, string>> = {
  dark: ROOT_TOKENS,
  light: LIGHT_EFFECTIVE_TOKENS,
};

/**
 * What a browser computes for a screen with no `[data-civ]`, per theme.
 *
 * The cascade, spelled out because the order is the whole content of it: both
 * `:not([data-civ])` selectors are (0,2,0) and beat plain `:root` / `.light`
 * (0,1,0) wherever they sit, so between the two of them only source order
 * decides — and `.light:not([data-civ])` is written after
 * `:root:not([data-civ])` in globals.css for exactly that reason.
 */
export const NO_CIV_TOKENS_BY_THEME: Record<ThemeName, Record<string, string>> = {
  dark: { ...ROOT_TOKENS, ...NO_CIV_ROOT_TOKENS },
  light: { ...ROOT_TOKENS, ...LIGHT_TOKENS, ...NO_CIV_ROOT_TOKENS, ...NO_CIV_LIGHT_TOKENS },
};

/** The literal a mirror entry has to carry for a token as the NO-cosmology screen renders it. */
export function noCivLiteralOfIn(theme: ThemeName, name: string): string {
  return asChartLiteral(resolveTriple(NO_CIV_TOKENS_BY_THEME[theme], name));
}

/** Suffixes of every token matching a `--prefix-<suffix>` family, sorted. */
export function suffixesOf(tokens: Record<string, string>, family: string): string[] {
  const hits = Object.keys(tokens)
    .filter((name) => name.startsWith(`${family}-`))
    .map((name) => name.slice(family.length + 1));
  return [...new Set(hits)].sort();
}

/** `--color-civ-mark-cn: 12 55% 58%;` -> `hsl(12 55% 58%)`, the literal form chart-colors uses. */
export function asChartLiteral(triple: string): string {
  return `hsl(${triple})`;
}

/**
 * A token's value with every `var(--x)` inside it replaced by that token's own
 * declaration in the same block — `--color-surface-1: var(--civ-hue) 47% 7%`
 * resolves to `240 47% 7%`. Note what that is and is not: it is the `:root`
 * declaration with `:root`'s own `--civ-hue`, and since Stage 11 that is NOT
 * what a screen without `[data-civ]` renders — see `NO_CIV_TOKENS_BY_THEME`.
 *
 * One substitution pass, and it throws if anything is still unresolved rather
 * than handing back a string containing `var(` that no `expect` would ever
 * match by accident.
 */
export function resolveTriple(tokens: Record<string, string>, name: string): string {
  const raw = tokens[name];
  if (raw === undefined) {
    throw new Error(`\`${name}\` is not declared in ${GLOBALS_CSS}.`);
  }
  const resolved = raw.replace(/var\((--[\w-]+)\)/g, (_whole, ref: string) => {
    const value = tokens[ref];
    if (value === undefined) throw new Error(`\`${name}\` refers to undeclared \`${ref}\`.`);
    return value;
  });
  if (resolved.includes("var(")) {
    throw new Error(`\`${name}\` still contains a var() after one pass: ${resolved}`);
  }
  return resolved;
}

/** The literal a mirror entry has to carry for the named token, in one theme. */
export function literalOfIn(theme: ThemeName, name: string): string {
  return asChartLiteral(resolveTriple(TOKENS_BY_THEME[theme], name));
}

/** The dark-theme literal a mirror entry has to carry for the named token. */
export function literalOf(name: string): string {
  return literalOfIn("dark", name);
}

/**
 * The `[data-civ="X"]` rules, mapped to the token each points `--civ-hue` at.
 * These are what actually retint the surface ramp; tokens without a rule are
 * inert, which is precisely how GREEK rendered on the neutral 240° fallback
 * while looking, in the stylesheet, fully wired up.
 */
export interface CivAttrRule {
  /** The token `--civ-hue` is pointed at, or undefined if the rule omits it. */
  hue?: string;
  /** The token `--civ-mark` is pointed at, or undefined if the rule omits it. */
  mark?: string;
  /** The token `--civ-ink` is pointed at, or undefined if the rule omits it. */
  ink?: string;
}

/**
 * The `[data-civ="…"]` rules, as {prefix: {hue, mark}}.
 *
 * Both aliases in one parser rather than one function per alias: two regex
 * readers of one stylesheet is the defect this whole support file exists to
 * stop, and a second reader is how the two would drift into disagreeing about
 * what a rule even is. The declarations are read individually inside each
 * rule body, so adding a third alias does not silently empty the map — which
 * is what the previous whole-body regex would have done the moment
 * `--civ-mark` was added beside `--civ-hue`.
 */
export function readCivAttrRules(): Record<string, CivAttrRule> {
  const rules: Record<string, CivAttrRule> = {};
  // Quote style and line breaks are NOT part of the contract. This pattern
  // required `[data-civ="cn"] { … }` on one line with double quotes, and the
  // Tailwind v4 upgrade — which reformats the stylesheet it rewrites — turned
  // them into multi-line blocks with single quotes. The parser then found
  // nothing and the assertion compared two empty lists' worth of civilizations,
  // which is the shape this whole file exists to prevent.
  const blockPattern = /\[data-civ=['"]([\w-]+)['"]\]\s*\{([^}]*)\}/g;
  for (const block of css.matchAll(blockPattern)) {
    const entry: CivAttrRule = {};
    for (const decl of block[2].matchAll(/--civ-(hue|mark|ink):\s*var\((--[\w-]+)\)\s*;/g)) {
      entry[decl[1] as "hue" | "mark" | "ink"] = decl[2];
    }
    rules[block[1]] = entry;
  }
  if (Object.keys(rules).length === 0) {
    // Loud, not empty. An empty map makes every caller's `toEqual([])` pass.
    throw new Error(
      `Parsed no [data-civ] rules out of ${GLOBALS_CSS}. Fix this parser — ` +
        `an empty result turns every civilization assertion into a comparison ` +
        `of two empty lists.`
    );
  }
  return rules;
}

/**
 * `Soul.current_state` from packages/core/src/api/souls.ts — the states the payload can
 * actually carry, read as text because Jest sees the type only at compile time
 * and a type cannot be iterated at runtime. This is the reverse direction for
 * STATE_COLORS: without it, a state the API can send but no chart can colour
 * stays green forever.
 */
export function readSoulStates(): string[] {
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
 * The realm types the UI can render, read from the bundle it renders their
 * labels from. Same reason `current_state` is read out of souls.ts: `Realm`
 * types `realm_type` as a bare `string`, so there is no union to iterate, and
 * `realms.types` is the enumeration the pages actually key off — it matches
 * `RealmType` in backend/apps/realms/models.py.
 */
export function readRealmTypes(): string[] {
  const bundle = JSON.parse(readFileSync(EN_MESSAGES, "utf8")) as {
    realms?: { types?: Record<string, string> };
  };
  const types = Object.keys(bundle.realms?.types ?? {});
  if (types.length === 0) {
    throw new Error(
      `\`realms.types\` is empty or missing in ${EN_MESSAGES}. Fix this ` +
        `parser; do not delete the comparison.`
    );
  }
  return types;
}

/**
 * The `--color-status-*` tokens that belong to the SYSTEM-FEEDBACK layer rather
 * than the soul lifecycle, derived as the set difference rather than listed.
 *
 * globals.css writes the rule on the block itself: "System-layer feedback:
 * transient chrome only (toast, inline validation, banner), always beside an
 * icon — never a row, a badge or a chart." The two groups share the
 * `--color-status-` prefix but are different layers, and the only thing telling
 * them apart in the stylesheet is a comment.
 *
 * Deriving this as "every `--color-status-*` suffix that is not a soul
 * lifecycle state" means a fifth feedback token added tomorrow is covered
 * without anyone editing this file, and a new *lifecycle* state added to
 * `Soul.current_state` leaves the set alone. A new `--color-status-*` that is
 * neither reddens `statusTokenLayering.test.ts`, which pins this set by name —
 * on purpose, so that classifying a new token is a deliberate edit.
 */
export const FEEDBACK_STATUS_TOKENS: string[] = suffixesOf(ROOT_TOKENS, "--color-status")
  .filter((suffix) => !readSoulStates().some((state) => state.toLowerCase() === suffix))
  .map((suffix) => `--color-status-${suffix}`)
  .sort();

/**
 * The one prefix rule, and it is now written once for real: this reads
 * `CIVILIZATION_SHORT_CODES` from config/civilizations rather than re-deriving
 * the split, which is what this comment used to claim while the production code
 * kept its own copy. A helper under `__tests__/` cannot be imported by
 * `TenantContext`, so "written once" was true of this file and of nothing else.
 *
 * Keyed by tenant code rather than by civilization because the CSS token
 * families and the `[data-civ]` rules are keyed by the prefix, and the callers
 * here start from a tenant. A *fifth* civilization turns these tests red the
 * moment it is added to the config — the enumeration point Greek slipped
 * through.
 */
export const CIV_PREFIX_BY_TENANT_CODE = Object.fromEntries(
  Object.entries(CIVILIZATION_CODES).map(([civ, code]) => [code, CIVILIZATION_SHORT_CODES[civ]])
) as Record<string, string>;

export const TENANT_CODES = Object.values(CIVILIZATION_CODES) as string[];
export const CIV_PREFIXES = [...new Set(Object.values(CIV_PREFIX_BY_TENANT_CODE))].sort();

// ---------------------------------------------------------------------------
// The surface ramp, resolved per tenant.
//
// `resolveTriple` above answers "what does surface-1 look like on the neutral
// 240° fallback". These answer "what does it look like for THIS civilization".
//
// This comment used to end "the answers are all the same colour", which was
// Stage 9's finding and was left standing through Stage 11's retint. It is
// false twice over now: the ramp does carry the tenant, and the metric that
// made "the same colour" sound defensible for the closer pairs was
// `maxChannelDelta`, which cannot see hue. Measured in ΔE00 the four answers
// are 4.11 to 20.87 apart depending on pair, surface and theme — no two of
// them are the same colour anywhere on the ramp except light-mode canvas,
// which `.light` declares as flat `0 0% 100%` for every tenant and which is
// not in `SURFACE_TOKENS`.
// ---------------------------------------------------------------------------

/** Every `--color-surface-N` token, derived from the stylesheet rather than listed. */
export const SURFACE_TOKENS: string[] = suffixesOf(ROOT_TOKENS, "--color-surface").map(
  (suffix) => `--color-surface-${suffix}`
);

if (SURFACE_TOKENS.length === 0) {
  throw new Error(
    `No \`--color-surface-*\` tokens found in ${GLOBALS_CSS}. Fix this parser; ` +
      `do not delete the comparison — an empty list makes every ramp assertion ` +
      `vacuously green.`
  );
}

/**
 * `"12 47% 7%"` -> `[26, 13, 9]`, sRGB 0-255.
 *
 * Assertions about whether two tenants look alike have to be made in the space
 * the eye reads, not in HSL. The example that made the point when this was
 * written: `12 13% 7%` and `232 13% 7%` are 220° apart as numbers and 4/255
 * apart as pixels. Stage 11 raised the ramp's chroma and the same pair now
 * measures 17/255 — the arithmetic did not change, the design did.
 *
 * THAT SENTENCE USED TO END "and it is still the second figure that decides
 * whether anyone can tell them apart", AND IT IS THAT ENDING THAT WAS WRONG.
 * sRGB is where the comparison has to *start* — HSL cannot answer it at all —
 * but a count of sRGB channel steps is not what decides it either. See the
 * CIEDE2000 block at the foot of this file: this function is now the input to
 * `srgbToLab`, and ΔE00 is the figure the assertions rest on. Stage 12 changed
 * no colour, only which number gets believed.
 *
 * Throws on anything that is not a bare `H S% L%` triple rather than coercing
 * `NaN` through and comparing it.
 */
export function hslTripleToRgb(triple: string): [number, number, number] {
  const m = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(triple.trim());
  if (m === null) {
    throw new Error(`Not a bare \`H S% L%\` triple: ${JSON.stringify(triple)}`);
  }
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(255 * channel(0)), Math.round(255 * channel(8)), Math.round(255 * channel(4))];
}

/**
 * A ramp token resolved as the named civilization renders it — `--civ-hue`
 * bound to that civilization's `--color-civ-hue-*` the way its `[data-civ]`
 * rule binds it, instead of to the neutral `:root` fallback.
 *
 * The override is a local copy; `TOKENS_BY_THEME` is not mutated, so
 * `chartColourContract`'s pin that `--civ-hue` is still `240` in both themes
 * keeps meaning what it says.
 */
export function resolveRampForCiv(theme: ThemeName, prefix: string, name: string): string {
  const tokens = TOKENS_BY_THEME[theme];
  const hue = tokens[`--color-civ-hue-${prefix}`];
  if (hue === undefined) {
    throw new Error(`No \`--color-civ-hue-${prefix}\` in the ${theme} tokens of ${GLOBALS_CSS}.`);
  }
  return resolveTriple({ ...tokens, "--civ-hue": hue }, name);
}

/**
 * The widest single-channel gap between two colours, 0-255.
 *
 * NEARLY BLIND TO HUE, WHICH IS THE AXIS THIS PALETTE USES. Two colours can
 * share two of three channels exactly and differ obviously to the eye:
 * Chinese `(19, 5, 2)` and Egyptian `(19, 14, 2)` are 9 by this function and
 * 6.04 by `deltaE00Rgb`, i.e. plainly different. Every "N/255" claim written
 * before Stage 12 came from here, and the ones that concluded a PAIR was
 * indistinguishable were wrong for this reason.
 *
 * Still exported, still used, on purpose: `PERCEPTIBILITY_FLOOR` in
 * `civilizationColourContract.test.ts` is a channel-unit threshold set by a
 * named review, and a threshold does not survive being restated in units its
 * review never used. It is kept beside a ΔE00 pin, not replaced by one.
 * For any NEW comparison, reach for `deltaE00Rgb`.
 */
export function maxChannelDelta(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

/** Every unordered pair of civilization prefixes. */
export function civPairs(): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < CIV_PREFIXES.length; i += 1) {
    for (let j = i + 1; j < CIV_PREFIXES.length; j += 1) out.push([CIV_PREFIXES[i], CIV_PREFIXES[j]]);
  }
  if (out.length === 0) throw new Error("No civilization pairs — CIV_PREFIXES is too short to compare.");
  return out;
}

// ---------------------------------------------------------------------------
// WCAG 2.x contrast.
//
// `hslTripleToRgb` above answers "what colour is this token". These answer
// "can anyone read that ink on that surface", which is a different question
// from every comparison in this file so far: the ramp assertions ask whether
// two tenants look ALIKE, and these ask whether two layers look DIFFERENT
// enough. Both are measured in sRGB, and neither can be asked in HSL.
//
// NOTE FOR WHOEVER TOUCHES `dataGridToneContract.test.ts` NEXT. That file
// carries its own private `relativeLuminance`/`contrastRatio` (plus a
// `composite`, which nothing else needs yet) written before this pair existed.
// Two implementations of one formula is the same defect this module was
// created to close, and the reason the copy is still there is scheduling, not
// design: the file was owned by another change in flight when
// `inkOnSurfaceContract` landed. Fold it onto these — its own "reproduces the
// reference black-on-white ratio" test moves with it — rather than adding a
// third.
//
// One deliberate difference from that copy, stated because a silent one would
// be worse: this pair is fed by `hslTripleToRgb`, which ROUNDS to whole sRGB
// channels, while the copy's `hslToRgb` keeps fractions. Rounding is what a
// browser rasterises, and the gap is under 0.01 of a ratio point — but it is
// not zero, so a figure measured here and a figure measured there may differ
// in the third decimal.
// ---------------------------------------------------------------------------

export type Rgb = readonly [number, number, number];

/** WCAG relative luminance: linearise each sRGB channel, then weight. */
export function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number): number => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * `fg` at `alpha` over `bg`, as the browser composites it — the only way to get
 * the real background of text sitting on a `bg-[hsl(var(--x)/0.2)]` fill.
 *
 * Naive source-over on already-gamma-encoded sRGB, which is what CSS actually
 * does for `hsl(... / a)` over an opaque backdrop. Linearising first would be
 * more correct physically and would NOT match what the user sees, and matching
 * the browser is the entire point of a contrast pin.
 */
export function compositeOver(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => alpha * fg[i] + (1 - alpha) * bg[i]) as unknown as Rgb;
}

/** WCAG contrast ratio, 1:1 to 21:1. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// CIEDE2000 — how far apart two colours LOOK.
//
// WHY THIS EXISTS, AND WHAT IT REPLACES. `maxChannelDelta` above is the metric
// every "N/255" figure in this repository was measured with, and it is close to
// blind along the hue axis, which is the axis civilization identity lives on.
// The case that made it undeniable, both from the DARK ramp:
//
//     Chinese canvas  (19,  5, 2)
//     Egyptian canvas (19, 14, 2)
//
// R identical, B identical, only G differs — so `maxChannelDelta` reports 9,
// and Stage 11 read that as "these two tenants are, in practice, the same
// ground". CIEDE2000 puts the same pair at 6.04, which is past "obvious at a
// glance". The sentence was wrong, not the colours: the previous round shipped
// a ramp that works and a description of it that does not.
//
// `maxChannelDelta` IS NOT DELETED, and that is a decision rather than an
// oversight — see `PERCEPTIBILITY_FLOOR` in
// `civilizationColourContract.test.ts` for why the channel-unit threshold keeps
// its own pin.
//
// THE LIMIT OF THIS METRIC, STATED HERE SO NOBODY HAS TO REDISCOVER IT.
// CIEDE2000 was fitted on small differences (roughly ΔE00 < 5) between
// moderately light surface colours. Both ends of this ramp are outside that:
// dark surfaces sit near L* 5, light ones near L* 97, and the marks are 20-50
// ΔE00 apart, well past the fitted range. So the numbers here are a far better
// guide than max-channel — the screenshots agree with them and disagree with
// max-channel — but they are not exact above about 5, and NO ASSERTION IN THIS
// REPOSITORY SHOULD TREAT A RATIO OF TWO LARGE ΔE00 FIGURES AS MEANINGFUL.
// That constraint is what reshaped the mark-versus-ramp pin; the reasoning is
// written out where that pin lives.
//
// NOT SHARED WITH THE WCAG PAIR ABOVE, on purpose: `relativeLuminance`
// linearises at WCAG's 0.03928 and this linearises at the sRGB spec's 0.04045.
// They are the same curve with two different published thresholds, and folding
// them together would silently change one formula's answer to satisfy the
// other's source. Two functions, two citations, one comment saying so.
// ---------------------------------------------------------------------------

/** CIE L*a*b*, D65. */
export type Lab = readonly [number, number, number];

const D65_WHITE = { x: 0.95047, y: 1.0, z: 1.08883 };

/**
 * sRGB (0-255, gamma-encoded) -> CIE L*a*b* under D65.
 *
 * IEC 61966-2-1 linearisation, the sRGB->XYZ matrix at D65, then the CIE L*a*b*
 * transfer with its linear segment below (6/29)^3 — the segment matters here
 * rather than being pedantry, because the dark ramp lives at Y ≈ 0.004, which
 * is inside it.
 */
export function srgbToLab([r, g, b]: Rgb): Lab {
  const linear = (channel: number): number => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / D65_WHITE.x;
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / D65_WHITE.y;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / D65_WHITE.z;
  const delta = 6 / 29;
  const f = (t: number): number =>
    t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
  const fy = f(y);
  return [116 * fy - 16, 500 * (f(x) - fy), 200 * (fy - f(z))];
}

const RAD = Math.PI / 180;

/**
 * CIEDE2000 colour difference, kL = kC = kH = 1.
 *
 * WRITTEN OUT RATHER THAN IMPORTED because `packages/core` and `frontend` carry
 * no colour-science dependency and this module is the one parser these contract
 * tests share; a new runtime dependency for six numbers is a worse trade than
 * forty lines with a published test vector behind them.
 *
 * A WRONG CIEDE2000 IS WORSE THAN NO CIEDE2000. It reads as authoritative and
 * fails by a few percent rather than visibly, and the two places it is most
 * often wrong are both below:
 *
 *   - THE HUE-DIFFERENCE BRANCH. `dhp` is not `h2' - h1'`. When the two hue
 *     angles straddle 0°/360° the raw difference is ~±350° for two colours a
 *     few degrees apart, so it is folded into (-180, 180]. Getting this wrong
 *     leaves most pairs correct and blows up exactly the near-grey and
 *     near-red pairs — the ones nobody eyeballs.
 *   - THE MEAN-HUE BRANCH. `hbarp` has the same wrap plus a third case for
 *     `C1' * C2' === 0` (an achromatic colour has no hue to average), and it
 *     feeds `T` and the RT rotation term, so an error there moves the answer
 *     without ever producing an obviously silly number.
 *
 * Both are pinned by Sharma et al. (2005) "The CIEDE2000 Color-Difference
 * Formula: Implementation Notes, Supplementary Test Data, and Mathematical
 * Observations" — its 34-pair table exists for precisely these branches, and
 * `civilizationColourContract.test.ts` runs the whole table. Do not edit this
 * function without watching that test.
 */
export function deltaE00(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const cBar = (C1 + C2) / 2;
  const cBar7 = cBar ** 7;
  const G = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  // atan2(0, 0) is 0 in IEEE, so the explicit achromatic case is not redundant
  // paranoia — it is the difference between "no hue" and "hue 0°, which is red".
  const hueAngle = (ap: number, bb: number): number => {
    if (ap === 0 && bb === 0) return 0;
    const h = Math.atan2(bb, ap) / RAD;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hueAngle(a1p, b1);
  const h2p = hueAngle(a2p, b2);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  // THE WRAP. Fold the raw angle difference into (-180, 180]; an achromatic
  // member contributes no hue difference at all.
  let dhp: number;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else {
    const raw = h2p - h1p;
    if (Math.abs(raw) <= 180) dhp = raw;
    else if (raw > 180) dhp = raw - 360;
    else dhp = raw + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

  const lBarp = (L1 + L2) / 2;
  const cBarp = (C1p + C2p) / 2;

  // THE OTHER WRAP. The mean of 350° and 10° is 0°, not 180°.
  let hBarp: number;
  if (C1p * C2p === 0) hBarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hBarp = (h1p + h2p + 360) / 2;
  else hBarp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos((hBarp - 30) * RAD) +
    0.24 * Math.cos(2 * hBarp * RAD) +
    0.32 * Math.cos((3 * hBarp + 6) * RAD) -
    0.2 * Math.cos((4 * hBarp - 63) * RAD);

  const dTheta = 30 * Math.exp(-(((hBarp - 275) / 25) ** 2));
  const cBarp7 = cBarp ** 7;
  const RC = 2 * Math.sqrt(cBarp7 / (cBarp7 + 25 ** 7));
  const SL = 1 + (0.015 * (lBarp - 50) ** 2) / Math.sqrt(20 + (lBarp - 50) ** 2);
  const SC = 1 + 0.045 * cBarp;
  const SH = 1 + 0.015 * cBarp * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;

  const tL = dLp / SL;
  const tC = dCp / SC;
  const tH = dHp / SH;
  return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
}

/**
 * How far apart two sRGB colours look, in ΔE00 — the call every contract test
 * should make. Fed by `hslTripleToRgb`, so it measures the rounded channels a
 * browser actually rasterises rather than the exact HSL the stylesheet declares.
 */
export function deltaE00Rgb(a: Rgb, b: Rgb): number {
  return deltaE00(srgbToLab(a), srgbToLab(b));
}
