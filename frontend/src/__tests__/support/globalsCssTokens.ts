/**
 * The one parser that reads `app/globals.css`, shared by the two contract tests
 * that hold `lib/chart-colors.ts` to it.
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
import { CIVILIZATION_CODES } from "@/src/config/civilizations";

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

/** The dark-theme literal a mirror entry has to carry for the named token. */
export function literalOf(name: string): string {
  return asChartLiteral(resolveTriple(ROOT_TOKENS, name));
}

/**
 * The `[data-civ="X"]` rules, mapped to the token each points `--civ-hue` at.
 * These are what actually retint the surface ramp; tokens without a rule are
 * inert, which is precisely how GREEK rendered on the neutral 240° fallback
 * while looking, in the stylesheet, fully wired up.
 */
export function readCivAttrRules(): Record<string, string> {
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
 * The one prefix rule, written once. `TenantContext` derives the `[data-civ]`
 * attribute as `tenantCode.split("_")[0].toLowerCase()`; the CSS token families
 * are keyed by that same prefix. Deriving it here from `CIVILIZATION_CODES`
 * rather than hardcoding `["cn","eu","eg","gr"]` is what makes a *fifth*
 * civilization turn the tests red the moment it is added to the config — which
 * is the enumeration point Greek slipped through.
 */
export const CIV_PREFIX_BY_TENANT_CODE = Object.fromEntries(
  Object.values(CIVILIZATION_CODES).map((code) => [code, code.split("_")[0].toLowerCase()])
) as Record<string, string>;

export const TENANT_CODES = Object.values(CIVILIZATION_CODES) as string[];
export const CIV_PREFIXES = [...new Set(Object.values(CIV_PREFIX_BY_TENANT_CODE))].sort();
