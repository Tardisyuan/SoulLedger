/**
 * The `--color-status-{success,error,warning,info}` tokens are the SYSTEM
 * layer, and app/globals.css says so on the block that declares them:
 *
 *   "System-layer feedback: transient chrome only (toast, inline validation,
 *    banner), always beside an icon — never a row, a badge or a chart. A
 *    separate palette from the domain layer above even where values match,
 *    because role+form is what keeps two same-hued reds distinguishable."
 *
 * That rule lived only in that comment, and `app/realms/page.tsx` broke it in
 * the most visible place in the app: `REALM_TYPE_CONFIG` painted the HELL,
 * PURGATORY and BLISS badges with `--color-status-error`, `-info` and
 * `-success` — three feedback tokens on three domain enum members that already
 * had verdict tokens of their own (`--color-verdict-failed`, `-purgatory`,
 * `-passed`, the same three `REALM_COLORS` in lib/chart-colors.ts mirrors).
 *
 * WHY THAT SURVIVED REVIEW, and why a value comparison would never have caught
 * it: globals.css aliases the two palettes to IDENTICAL triples on purpose —
 * `--color-status-error` and `--color-verdict-failed` are both `0 84% 62%` in
 * dark and `0 78% 44%` in light. The badge looked exactly right. What was wrong
 * was which palette it had joined: re-tune the feedback reds for toast
 * legibility tomorrow and the realm badges follow, silently, for no reason
 * anyone would connect to the change. So this file compares TOKEN NAMES, not
 * colours — the only channel the defect is visible on.
 *
 * ── WHAT IT CATCHES ───────────────────────────────────────────────────────
 * Every module-level `const NAME = { … }` in app/, components/, lib/ and src/
 * (excluding tests) whose keys are ALL SCREAMING_SNAKE — the signature of a map
 * keyed by a domain enumeration: realm types, workflow statuses, verdicts,
 * roles — and whose values name a feedback token. The offenders are compared as
 * an EXACT SET against the record below, so all three of these turn it red:
 *
 *   - a new enum-keyed badge/row map anywhere in those trees reaching for a
 *     feedback token (the regression this exists to stop);
 *   - `REALM_TYPE_CONFIG` going back to `--color-status-*`;
 *   - one of the recorded offenders being fixed without its record being
 *     deleted, which is what keeps the list from turning into scenery.
 *
 * It also pins the feedback set itself by name, so a fifth `--color-status-*`
 * token landing in globals.css forces someone to say which layer it belongs to
 * rather than being silently swept into one.
 *
 * ── WHAT IT DOES NOT CATCH ────────────────────────────────────────────────
 * Deliberately not caught, because these ARE the documented use:
 *   - maps keyed by the feedback vocabulary itself (`success`/`error`/`info`/
 *     `warning`/`neutral` — `Toast.tsx::COLOR`, `data-grid/columns.tsx::
 *     ENUM_TONE_CLASSES`, `DomainValue.tsx::NUMBER_TONE_INK`). A caller mapping
 *     a domain value onto a TONE and the tone onto a token is the intended
 *     indirection; those tones are held to their own contract by
 *     dataGridToneContract.test.ts.
 *
 * Not caught, and a real gap rather than a decision:
 *   - a feedback token written inline in a JSX `className` ternary rather than
 *     through a module-level map. There are ~60 of those and most are
 *     legitimate (buttons, error banners, destructive-action confirmations);
 *     telling a banner from a badge needs the surrounding markup, which a token
 *     scan does not have.
 *
 * (Utility class names are deliberately not spelled out anywhere in this file.
 * tailwind.config.js scans `./src/**` — tests included — so a class name
 * written here becomes a real rule in the stylesheet.)
 *   - a map built inside a component body, or assembled from spreads.
 *   - a Tailwind alias, if one is ever added. There is none today: tailwind
 *     .config.js declares no `status` colour, so every use spells the custom
 *     property out, and the scan below asserts it found enough of them to be
 *     looking at something.
 *
 * No DOM and no browser: a directory walk and a brace count.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  FEEDBACK_STATUS_TOKENS,
  FRONTEND_ROOT,
  ROOT_TOKENS,
  suffixesOf,
} from "./support/globalsCssTokens";

/**
 * The feedback family, pinned by name.
 *
 * `FEEDBACK_STATUS_TOKENS` derives this as "every `--color-status-*` suffix
 * that is not a soul lifecycle state", which covers a new feedback token
 * automatically. This assertion is the other half: a new `--color-status-*`
 * that is NEITHER a feedback token nor a lifecycle state would be swept into
 * the derived set and silently start being policed as feedback. Failing here
 * makes classifying it a deliberate edit.
 */
const EXPECTED_FEEDBACK_TOKENS = [
  "--color-status-error",
  "--color-status-info",
  "--color-status-success",
  "--color-status-warning",
];

const SOURCE_ROOTS = ["app", "components", "lib", "src"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__", "coverage"]);

interface ObjectConst {
  /** Path relative to the frontend root, POSIX-style. */
  file: string;
  name: string;
  /** Top-level keys, in source order. */
  keys: string[];
  /** The literal body, brace to brace. */
  body: string;
}

/** `export const NAME: SomeType = {` — module level only, so the `{` ends the line. */
const OBJECT_CONST = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*\{\s*$/;
/** `KEY:`, `"KEY":`, `'KEY':` at one level of indentation inside the literal. */
const OBJECT_KEY = /^\s*(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/;

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every module-level object literal in the source tree.
 *
 * Brace counting rather than a TypeScript parse: the shape being looked for is
 * `const NAME = {` at column 0, which is unambiguous without a syntax tree, and
 * adding a parser dependency to see it would be the more fragile choice. The
 * "found enough to be looking at something" assertions below are what keep a
 * regex that quietly stops matching from turning this file green.
 */
function readObjectConsts(): ObjectConst[] {
  const files = SOURCE_ROOTS.flatMap((root) => walk(path.join(FRONTEND_ROOT, root), []));
  if (files.length === 0) {
    throw new Error(
      `No .ts/.tsx files under ${SOURCE_ROOTS.join(", ")} in ${FRONTEND_ROOT}. ` +
        `Fix this walker; do not delete the comparison.`
    );
  }
  const found: ObjectConst[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const declaration = OBJECT_CONST.exec(lines[i]);
      if (declaration === null) continue;
      let depth = 1;
      const keys: string[] = [];
      const body: string[] = [];
      for (let j = i + 1; j < lines.length && depth > 0; j++) {
        const line = lines[j];
        if (depth === 1) {
          const key = OBJECT_KEY.exec(line);
          if (key !== null) keys.push(key[1] ?? key[2] ?? key[3]);
        }
        body.push(line);
        for (const ch of line) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          if (depth === 0) break;
        }
      }
      found.push({
        file: path.relative(FRONTEND_ROOT, file).split(path.sep).join("/"),
        name: declaration[1],
        keys,
        body: body.join("\n"),
      });
    }
  }
  return found;
}

const OBJECT_CONSTS = readObjectConsts();

/** A map keyed by a domain enumeration: every key SCREAMING_SNAKE, at least one key. */
function isEnumKeyed(entry: ObjectConst): boolean {
  return entry.keys.length > 0 && entry.keys.every((key) => /^[A-Z][A-Z0-9_]*$/.test(key));
}

/** `path/to/file.tsx::CONST_NAME` for every enum-keyed map naming a feedback token. */
function enumKeyedMapsUsingFeedbackTokens(): string[] {
  return OBJECT_CONSTS.filter(
    (entry) => isEnumKeyed(entry) && FEEDBACK_STATUS_TOKENS.some((token) => entry.body.includes(token))
  )
    .map((entry) => `${entry.file}::${entry.name}`)
    .sort();
}

/**
 * Domain-enum-keyed maps still painting with system-feedback tokens, and why
 * each is recorded rather than fixed in the pass that added this file.
 *
 * `app/realms/page.tsx::REALM_TYPE_CONFIG` is deliberately ABSENT: it is the
 * one this pass fixed, onto `--color-verdict-*` and `--color-ink-tertiary`, and
 * its absence here is what makes a revert red.
 *
 * These four are the same defect at a lower stake — the badge is on a workflow
 * or sync row rather than the realms grid — and, unlike the realm types, none
 * of them has a domain palette obviously waiting for it. `PENDING`/`ACCEPTED`/
 * `PROCESSED` describe how an OPERATION went, which is closer to the feedback
 * layer's actual meaning than a destination realm ever was; `JUDGE`/`GUARDIAN`/
 * `EXECUTOR` are identities with no verdict or lifecycle token at all. Deciding
 * what each should become is a palette question, not a rename, so they are
 * recorded with the token they use rather than guessed at.
 *
 * `app/workflow/[id]/page.tsx::VERDICT_COLORS` is the one with an obvious
 * answer — `PASSED`/`FAILED` have `--color-verdict-passed`/`-failed` — and it
 * is left here only because that page is `CONFIRMED`/`REJECTED`/`SKIPPED` too,
 * which are approval-step outcomes rather than verdicts on a soul, and mixing
 * two palettes inside one badge map would be worse than either.
 */
const ENUM_MAPS_STILL_ON_FEEDBACK_TOKENS: Record<string, string> = {
  "app/actors/page.tsx::ROLE_BADGE_CLASSES":
    "JUDGE/GUARDIAN/EXECUTOR/CONDUIT are actor identities. There is no " +
    "identity palette for them — --color-civ-mark-* is tenant identity, not " +
    "role — so this needs a palette decision, not a rename.",
  "app/death-sync/page.tsx::STATUS_COLORS":
    "PENDING/ACCEPTED/PROCESSED/FAILED/DUPLICATE/PARTIAL are the outcome of a " +
    "sync OPERATION, which is what the feedback layer is for. Recorded rather " +
    "than fixed because the argument for moving it is weak, not absent: it is " +
    "still rendered as a badge on a row.",
  "app/dispatch/[id]/page.tsx::STATUS_COLORS":
    "PROPOSED/APPROVED/REJECTED/EXECUTED/CANCELLED — same shape as death-sync: " +
    "the state of a request being processed, not a judgement about a soul.",
  "app/workflow/[id]/page.tsx::STATUS_COLORS":
    "PENDING/APPROVED/REJECTED/SKIPPED/ESCALATED are approval-step states. " +
    "ESCALATED already uses --color-verdict-retry, so this map straddles both " +
    "palettes and needs deciding as a whole.",
  "app/workflow/[id]/page.tsx::VERDICT_COLORS":
    "PASSED/FAILED have verdict tokens waiting, but CONFIRMED/REJECTED/SKIPPED " +
    "are approval-step outcomes; half-moving the map would leave one badge row " +
    "drawn from two palettes.",
};

describe("the scan is looking at something", () => {
  it("found the source tree", () => {
    // Every assertion below is a set comparison, and an empty scan makes them
    // all vacuously green.
    expect(OBJECT_CONSTS.length).toBeGreaterThan(40);
    expect(OBJECT_CONSTS.some((entry) => entry.file.startsWith("app/"))).toBe(true);
    expect(OBJECT_CONSTS.some((entry) => entry.file.startsWith("src/"))).toBe(true);
  });

  it("parses a known map's keys, not just its name", () => {
    const realms = OBJECT_CONSTS.find((e) => e.file === "app/realms/page.tsx" && e.name === "REALM_TYPE_CONFIG");
    expect(realms).toBeDefined();
    expect(realms!.keys).toEqual(["HELL", "PURGATORY", "BLISS", "NEUTRAL"]);
    expect(isEnumKeyed(realms!)).toBe(true);
  });

  it("tells a domain-enum map from a tone map", () => {
    const tones = OBJECT_CONSTS.find((e) => e.name === "ENUM_TONE_CLASSES");
    expect(tones).toBeDefined();
    expect(isEnumKeyed(tones!)).toBe(false);
  });

  it("the feedback family is the four tokens the rule was written about", () => {
    expect(FEEDBACK_STATUS_TOKENS).toEqual(EXPECTED_FEEDBACK_TOKENS);
    // And the derivation is a real subtraction, not the whole family renamed:
    // the lifecycle states must still be in `--color-status-*` and out of this.
    expect(suffixesOf(ROOT_TOKENS, "--color-status").length).toBeGreaterThan(
      FEEDBACK_STATUS_TOKENS.length
    );
    expect(FEEDBACK_STATUS_TOKENS).not.toContain("--color-status-lost");
  });

  it("the tokens are spelled out in source, not hidden behind a Tailwind alias", () => {
    // If a `text-error` utility is ever added to tailwind.config.js, the scan
    // stops seeing most uses and this number collapses.
    const uses = OBJECT_CONSTS.filter((entry) =>
      FEEDBACK_STATUS_TOKENS.some((token) => entry.body.includes(token))
    );
    expect(uses.length).toBeGreaterThan(5);
  });
});

describe("system-feedback tokens stay off domain-enum badges and rows", () => {
  it("the offenders are exactly the ones recorded", () => {
    expect(enumKeyedMapsUsingFeedbackTokens()).toEqual(
      Object.keys(ENUM_MAPS_STILL_ON_FEEDBACK_TOKENS).sort()
    );
  });

  it("the realm badge map is not among them", () => {
    // Said separately from the set comparison because this is the one the file
    // was written for, and a reader should not have to diff two lists to see
    // it. Absence, not presence: `REALM_TYPE_CONFIG` naming a verdict token
    // would stay true while it ALSO named a feedback token.
    expect(enumKeyedMapsUsingFeedbackTokens()).not.toContain(
      "app/realms/page.tsx::REALM_TYPE_CONFIG"
    );
  });

  it("the realm badge map draws from the same palette the realm chart does", () => {
    // The positive half. `REALM_COLORS` in lib/chart-colors.ts is pinned to
    // these four tokens by chartColourContract.test.ts, so naming them here
    // ties the badge and the chart legend to one palette rather than two that
    // happen to agree today.
    //
    // The utilities are PARSED rather than compared as literal strings, and
    // that is not a style choice. tailwind.config.js scans `./src/**/*.{ts,tsx}`
    // — this file included — so an arbitrary-value utility written out here is
    // a class name Tailwind generates a real CSS rule for. An earlier draft
    // built one from a template literal, and the unsubstituted `${token}`
    // reached the stylesheet as a rule whose value no CSS parser accepts; the
    // dev server refused to start. The comment warning about it did the same
    // thing a second time, by quoting the shape. Parsing the utilities apart
    // keeps both the assertion and its explanation out of the scanner.
    const realms = OBJECT_CONSTS.find(
      (e) => e.file === "app/realms/page.tsx" && e.name === "REALM_TYPE_CONFIG"
    )!;
    const byRealm: Record<string, string> = {
      HELL: "--color-verdict-failed",
      PURGATORY: "--color-verdict-purgatory",
      BLISS: "--color-verdict-passed",
      NEUTRAL: "--color-ink-tertiary",
    };
    expect(Object.keys(byRealm)).toEqual(realms.keys);

    /** `{utility: [token, alpha]}` for every `x-[hsl(var(--t)/a)]` on the line. */
    const utilities = (line: string): Record<string, [string, string]> => {
      const out: Record<string, [string, string]> = {};
      for (const m of line.matchAll(/(\w[\w-]*)-\[hsl\(var\((--[\w-]+)\)(?:\/([\d.]+))?\)\]/g)) {
        out[m[1]] = [m[2], m[3] ?? "1"];
      }
      return out;
    };
    const lineFor = (realm: string) =>
      realms.body.split("\n").find((l) => l.trimStart().startsWith(`${realm}:`));

    for (const [realm, token] of Object.entries(byRealm)) {
      const line = lineFor(realm);
      expect(line).toBeDefined();
      const found = utilities(line!);
      expect(found.bg).toEqual([token, "0.1"]);
      expect(found.border).toEqual([token, "0.3"]);
    }

    // NEUTRAL's LABEL is ink-muted, not ink-tertiary: ink-tertiary text over a
    // 10% tint of itself measures 2.56:1 in light mode, under the 4.5:1 AA
    // floor. The fill and border carry the pinned token; the text does not.
    // Asserted as an equality, so "the right token is present" cannot pass
    // while the wrong one sits beside it.
    expect(utilities(lineFor("NEUTRAL")!).text).toEqual(["--color-ink-muted", "1"]);

    // And the other three DO tint at the depth the light-mode tokens were
    // measured against — 10%, the cap dataGridToneContract.test.ts enforces on
    // the shared badge tones. A realm badge is the same kind of badge.
    for (const realm of ["HELL", "PURGATORY", "BLISS"]) {
      expect(utilities(lineFor(realm)!).text).toEqual([byRealm[realm], "1"]);
    }
  });
});
