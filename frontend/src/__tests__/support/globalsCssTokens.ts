/**
 * The one parser that reads `app/globals.css`, shared by every contract test
 * that holds something else to it: `chartColourContract` and
 * `civilizationColourContract` (the `lib/chart-colors.ts` mirror, both themes),
 * `dataGridToneContract` (badge tint depth vs the light-mode measurements) and
 * `statusTokenLayering` (which palette a domain enum may draw from).
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
import { CIVILIZATION_CODES, CIVILIZATION_SHORT_CODES } from "@/src/config/civilizations";

export const FRONTEND_ROOT = path.join(__dirname, "..", "..", "..");
export const GLOBALS_CSS = path.join(FRONTEND_ROOT, "app", "globals.css");
export const SOULS_TS = path.join(FRONTEND_ROOT, "lib", "api", "souls.ts");
export const EN_MESSAGES = path.join(FRONTEND_ROOT, "messages", "en.json");

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
    for (const decl of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
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
    if (decl.test(block[1])) offset = block.index ?? -1;
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
 * declaration in the same block — `--color-surface-1: var(--civ-hue) 13% 7%`
 * resolves to `240 13% 7%`, the `:root` fallback branch of the surface ramp.
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
  const blockPattern = /\[data-civ="([\w-]+)"\]\s*\{([^}]*)\}/g;
  for (const block of css.matchAll(blockPattern)) {
    const entry: CivAttrRule = {};
    for (const decl of block[2].matchAll(/--civ-(hue|mark):\s*var\((--[\w-]+)\)\s*;/g)) {
      entry[decl[1] as "hue" | "mark"] = decl[2];
    }
    rules[block[1]] = entry;
  }
  return rules;
}

/**
 * `Soul.current_state` from lib/api/souls.ts — the states the payload can
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
// 240° fallback". These answer "what does it look like for THIS civilization",
// which is the question the Stage 9 review asked and the reason globals.css no
// longer claims the ramp carries identity: the answers are all the same colour.
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
 * `"12 13% 7%"` -> `[20, 16, 16]`, sRGB 0-255.
 *
 * Assertions about whether two tenants look alike have to be made in the space
 * the eye reads, not in HSL: `12 13% 7%` and `232 13% 7%` are 220° apart as
 * numbers and 4/255 apart as pixels, and it is the second figure that decides
 * whether anyone can tell the tenants apart. Throws on anything that is not a
 * bare `H S% L%` triple rather than coercing `NaN` through and comparing it.
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

/** The widest single-channel gap between two colours, 0-255. */
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
