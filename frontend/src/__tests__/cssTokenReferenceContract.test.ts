/**
 * Every `--color-*` / `--civ-*` custom property a component reaches for has to
 * be one `app/globals.css` actually declares.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 * `src/components/social/PostCard.tsx` and `ProfileCard.tsx` both opened with
 *
 *     bg-[hsl(var(--color-surface))]
 *
 * and globals.css has never declared `--color-surface`. It declares
 * `--color-surface-1` through `-4`; the unnumbered name is not an alias, it is
 * nothing. An undefined custom property makes `var()` resolve to the guaranteed
 * invalid value, `hsl()` fails to parse, and CSS drops THE WHOLE DECLARATION —
 * so both cards rendered with no background at all, transparent onto
 * `--color-canvas`, for as long as the typo stood.
 *
 * WHY NOTHING CAUGHT IT, and why this file is a source scan rather than a
 * render assertion. There is no error anywhere: not a TypeScript error (the
 * class is a string), not an ESLint error, not a Tailwind warning (arbitrary
 * values are passed through verbatim), not a console warning at runtime, and
 * not a jsdom failure — jsdom does not resolve custom properties, so a
 * `toHaveClass("bg-[hsl(var(--color-surface))]")` test would have been GREEN on
 * the broken code, asserting the presence of the bug. The failure mode is
 * silent in every channel except a human looking at the pixels, which is
 * exactly the class this repository keeps writing contract tests for.
 *
 * WHAT IT COMPARES. The reference side is read out of the source tree; the
 * declaration side is `ROOT_TOKENS` from `./support/globalsCssTokens` — the one
 * parser of globals.css, not a second copy. `:root` was verified to declare all
 * 42 tokens in the file (nothing is declared only under `.light` or only inside
 * a `[data-civ]` rule), so `ROOT_TOKENS` IS the complete declared set and a
 * token missing from it is missing from the stylesheet, in both themes.
 *
 * WHAT IT DOES NOT COMPARE. The reverse direction — a token declared in
 * globals.css that nothing references — is deliberately not asserted here. The
 * ramp and the civilization families are declared as complete sets on purpose,
 * and reddening on a momentarily unused member would only teach people to
 * delete tokens out of a ramp.
 *
 * THE TWO TOKENS THIS PARAGRAPH USED TO NAME AS EXAMPLES BOTH HAVE CALLERS,
 * and one of them had callers on the day the sentence was written. It read
 * "`--color-surface-4` and `--color-status-disposed` currently have no
 * caller". Re-measured 2026-09-04, with comments stripped first (this file's
 * own prose names the tokens it discusses, so a plain grep counts the sentence
 * it is checking):
 *
 *   --color-surface-4        4 callers — data-grid/ActionsMenu.tsx,
 *                            data-grid/FilterBar.tsx, ui/Button.tsx,
 *                            workflow/NodeEditModal.tsx
 *   --color-status-disposed  3 callers — app/ledger/page.tsx (STATE_DOT),
 *                            app/welcome/page.tsx, src/lib/soulStateBadge.ts
 *
 * `app/ledger/page.tsx::STATE_DOT` predates the sentence; `soulStateBadge.ts`
 * is newer (28c9bc9). So the claim was half wrong when written and got wronger
 * without anything changing colour — it is prose in a comment, not an
 * assertion, which is the whole reason it could rot in a file whose subject is
 * exactly this failure mode.
 *
 * The argument itself survives its examples: on the same measurement EVERY
 * `--color-*` / `--civ-*` token `:root` declares is referenced somewhere in
 * the scanned tree, so today the reverse assertion would pass — and would
 * still be the wrong assertion to add, because it goes red the moment a ramp
 * is completed one member ahead of its first caller.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { FRONTEND_ROOT, GLOBALS_CSS, ROOT_TOKENS } from "./support/globalsCssTokens";

/** Same roots and skips as `statusTokenLayering.test.ts`, for the same reason. */
const SOURCE_ROOTS = ["app", "components", "lib", "src"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__", "coverage"]);

/**
 * `__tests__` is skipped, and that exclusion is load-bearing rather than
 * incidental: `chartColourContract` asserts `resolveTriple` throws on
 * `var(--missing)`, and `dataGridToneContract`'s doc comments write
 * `var(--token)` as a placeholder. Those are prose and fixtures, not styling —
 * scanning them would redden this file on four names that no browser ever sees.
 */
const SOURCE_FILE = /\.(tsx?|css)$/;

/** Only the two families globals.css owns. `var(--tw-*)` etc. is not ours. */
const TOKEN_REFERENCE = /var\((--(?:color|civ)[\w-]*)\)/g;

export interface TokenReference {
  /** Path relative to the frontend root, POSIX-style. */
  file: string;
  /** 1-based, so the message pastes straight into an editor. */
  line: number;
  token: string;
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every `var(--color-*)` / `var(--civ-*)` in one file's text.
 *
 * Split out from the walk so the detector itself can be exercised on synthetic
 * input below. A scanner that has stopped matching cannot be told apart from a
 * codebase with nothing wrong in it by reading a green run, and this one has a
 * single regex standing between "no defects" and "no comparison".
 */
export function referencesIn(source: string, file: string): TokenReference[] {
  const found: TokenReference[] = [];
  source.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(TOKEN_REFERENCE)) {
      found.push({ file, line: index + 1, token: match[1] });
    }
  });
  return found;
}

function readAllReferences(): TokenReference[] {
  const files = SOURCE_ROOTS.flatMap((root) => walk(path.join(FRONTEND_ROOT, root), []));
  if (files.length === 0) {
    throw new Error(
      `No .ts/.tsx/.css files under ${SOURCE_ROOTS.join(", ")} in ${FRONTEND_ROOT}. ` +
        `Fix this walker; do not delete the comparison.`
    );
  }
  return files.flatMap((file) =>
    referencesIn(readFileSync(file, "utf8"), path.relative(FRONTEND_ROOT, file).split(path.sep).join("/"))
  );
}

const REFERENCES = readAllReferences();
const DECLARED = new Set(Object.keys(ROOT_TOKENS));

describe("the scan is looking at something", () => {
  // Every assertion below is of the shape "nothing referenced is undeclared",
  // which an empty REFERENCES list satisfies perfectly. These four are what
  // stop that from being the way this file passes.

  it("finds token references across the source tree", () => {
    expect(REFERENCES.length).toBeGreaterThan(500);
    expect(new Set(REFERENCES.map((r) => r.file)).size).toBeGreaterThan(50);
  });

  it("reads the tokens the app is built out of", () => {
    const seen = [...new Set(REFERENCES.map((r) => r.token))];
    for (const token of ["--color-ink", "--color-surface-1", "--color-hairline", "--civ-hue"]) {
      expect(seen).toContain(token);
    }
  });

  it("reads globals.css itself, so a typo in the stylesheet is covered too", () => {
    expect(REFERENCES.some((r) => r.file === "app/globals.css")).toBe(true);
  });

  it("has a non-empty declaration set to compare against", () => {
    expect(DECLARED.size).toBeGreaterThan(30);
    expect([...DECLARED]).toContain("--color-surface-1");
    // The name the two social cards used. It is not a token and must not become
    // one by accident: adding it would make the ramp ambiguous rather than fix
    // anything, so this pins its absence.
    expect([...DECLARED]).not.toContain("--color-surface");
  });
});

describe("the detector rejects what it is here to catch", () => {
  // Exercised on synthetic text rather than on the repository, so it keeps
  // meaning something after the repository is clean.

  it("reports an undeclared token with its line", () => {
    const source = ['const a = "text-[hsl(var(--color-ink))]";', 'const b = "bg-[hsl(var(--color-surface))]";'].join(
      "\n"
    );
    const undeclared = referencesIn(source, "fake.tsx").filter((r) => !DECLARED.has(r.token));
    expect(undeclared).toEqual([{ file: "fake.tsx", line: 2, token: "--color-surface" }]);
  });

  it("ignores families globals.css does not own", () => {
    expect(referencesIn('style={{ width: "var(--tw-anything)" }}', "fake.tsx")).toEqual([]);
  });

  it("catches several references on one line", () => {
    const line = 'className="bg-[hsl(var(--color-surface-9))] text-[hsl(var(--color-ink-nope))]"';
    expect(referencesIn(line, "fake.tsx").map((r) => r.token)).toEqual([
      "--color-surface-9",
      "--color-ink-nope",
    ]);
  });
});

describe("every referenced custom property is declared in globals.css", () => {
  it("has no dangling --color-* / --civ-* reference anywhere in app/, components/, lib/ or src/", () => {
    const dangling = REFERENCES.filter((r) => !DECLARED.has(r.token)).map(
      (r) => `${r.file}:${r.line}  ${r.token}`
    );
    // Thrown rather than passed to `expect` as a second argument: Jest's
    // `expect` takes exactly one, so a message handed to it is a TS error at
    // best and silently dropped at worst — and the whole value of this test is
    // that the reader is told what to do about the name it just found.
    if (dangling.length > 0) {
      throw new Error(
        `Undeclared custom properties. \`hsl(var(--undeclared))\` does not fall ` +
          `back — the browser drops the whole declaration, so the element renders ` +
          `with no background/colour at all and nothing warns. Either declare the ` +
          `token in ${GLOBALS_CSS} or point the reference at an existing one.\n\n` +
          dangling.join("\n")
      );
    }
    expect(dangling).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/**
 * MARK IS THE GRAPHIC, INK IS THE TEXT.
 *
 * `--color-civ-ink-*` / `--civ-ink` exist because the identity mark, drawn at
 * its own lightness as 11-12px glyphs, failed WCAG AA in four of eight
 * civilization x theme combinations — see civIdentityInkContract.test.ts for
 * the measurements and the two places that shipped. That split survives only
 * as long as nobody spells a mark into a text property again, and a single
 * mark bound to a `text-…` utility, added back later, looks exactly like the
 * three legitimate `bg-`/`border-` uses beside it.
 *
 * NOTE THE CLASS NAME IS NOT WRITTEN OUT ANYWHERE IN THIS FILE. Tailwind v4
 * scans every source file it is pointed at, `__tests__` included, and it does
 * not know prose from markup — the first draft of this comment quoted the
 * offending class verbatim and the production stylesheet duly grew a real
 * `color:hsl(var(--civ-mark))` rule that no element in the app carries. A
 * comment that emits CSS is a claim about the build that is true only because
 * the comment is there.
 *
 * So this reads the *property*, not the token. Fills, borders, rules and the
 * 7px identity dot keep the mark and are untouched here; a colour/text binding
 * is the only thing rejected.
 *
 * It lives in this file rather than in the ink contract because the walker is
 * here. A second copy of `walk` is the defect `support/globalsCssTokens.ts`
 * was extracted to stop, and adding one to police a rule about not
 * duplicating decisions would be its own joke.
 */
describe("the civilization mark is never used as text", () => {
  /** The mark bound to a text utility class, or to `color:` in a style object. */
  const MARK_AS_TEXT = /text-\[[^\]]*var\(--(?:color-)?civ-mark|(?:^|[^-\w])color:\s*["'`]?hsl\(\s*var\(--(?:color-)?civ-mark/;

  const sources = SOURCE_ROOTS.flatMap((root) => walk(path.join(FRONTEND_ROOT, root), []));

  it("has files to scan, so the rule cannot pass on an empty list", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("still finds the mark used as a graphic, so the pattern is not just missing everything", () => {
    // The control. Without this, deleting every `--civ-mark` in the app would
    // make the rule below green and read as compliance.
    const asGraphic = sources.filter((f) =>
      /(?:bg-|border-|background:|borderColor:)[^\n]*var\(--(?:color-)?civ-mark/.test(
        readFileSync(f, "utf8")
      )
    );
    expect(asGraphic.length).toBeGreaterThan(0);
  });

  it("has no civilization mark bound to a text colour", () => {
    const offenders = sources
      .filter((f) => MARK_AS_TEXT.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(FRONTEND_ROOT, f).split(path.sep).join("/"));
    if (offenders.length > 0) {
      throw new Error(
        `A civilization mark is being drawn as text. Use \`--civ-ink\` (or ` +
          `\`--color-civ-ink-<prefix>\` where the tenant is not the logged-in one) ` +
          `— the mark's lightness is measured for fills and rules, not glyphs.\n\n` +
          offenders.join("\n")
      );
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/**
 * ONE SPELLING FOR A COLOUR TOKEN, AND IT IS THE BRACKETED ONE.
 *
 * `text-ink`, `bg-surface-1`, `border-hairline` and 25 more spellings used to
 * work: Tailwind 3's config defined each utility's value as
 * `'hsl(var(--color-ink))'` in its own namespace, so the `hsl()` lived in the
 * class and the variable held the raw triple. The v4 migration moved that into
 * `@theme`, which puts the wrapper into a variable of the SAME name — and
 * `:root` in `@layer base` re-declares that name as the triple, outranking the
 * `theme` layer. Every one of those utilities became `color: 210 11% 96%`,
 * which is not a colour, so the browser dropped it.
 *
 * 433 call sites across 63 files, and nothing went red: `tsc`, `eslint`, 2039
 * tests and `next build` were all green. `text-ink` even LOOKED right, because
 * it inherits body's ink. What actually shipped was the rest: every
 * `text-ink-subtle` rendered at full ink (hierarchy gone) and every
 * `border-hairline` fell back to `currentColor` (a hairline drawn at full ink).
 * Measured on the production build with a control group on one page — 10 of 10
 * bracketed spellings dimmed correctly, 2 of 2 bare spellings did not.
 *
 * The two spellings cannot coexist under one variable name, so this rule keeps
 * the repo on one. It has to be the bracketed one: the raw triple is what makes
 * an alpha modifier possible, and hundreds of sites need it.
 */
// NOTE FOR ANY FUTURE CODEMOD: the strings inside this describe are FIXTURES.
// `'className="text-ink"'` here is the thing being detected, not a class being
// shipped, and rewriting it to the bracketed form turns the detector's own
// self-test into a tautology. A scripted rewrite did exactly that once — it
// converted five fixtures and the block went red, which is the only reason it
// was noticed. Skip this file, or restore the fixtures afterwards.
describe("colour tokens are referenced one way only", () => {
  /** Every colour family `app/globals.css` owns, longest first so `ink` cannot eat `ink-subtle`. */
  const COLOUR_TOKENS = [
    "surface-1", "surface-2", "surface-3", "surface-4", "canvas",
    "hairline-strong", "hairline-tertiary", "hairline",
    "ink-muted", "ink-subtle", "ink-tertiary", "ink",
    "accent-hover", "accent",
  ];

  /** The properties Tailwind can colour. `divide-` and `placeholder-` are in because both shipped. */
  const COLOURABLE = "bg|text|border|divide|ring|fill|stroke|outline|placeholder";

  /**
   * A bare token after a colourable prefix, with any variant chain in front.
   * The negative lookbehind on `-` keeps it off `--color-ink` inside a bracket.
   */
  const BARE = new RegExp(
    `(?<![\\w-])((?:[a-z][a-z0-9-]*:)*)(${COLOURABLE})-(${COLOUR_TOKENS.join("|")})(?![\\w-])`
  );

  const sources = SOURCE_ROOTS.flatMap((root) => walk(path.join(FRONTEND_ROOT, root), []));

  /** Comments blanked, offsets preserved — prose that names a class is not a class. */
  const codeOnly = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
       .replace(/(?<![:\w])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

  it("has files to scan, so the rule cannot pass on an empty list", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("catches the spellings it exists to catch, and spares the ones it must", () => {
    // The detector, tested on both sides. Without this the rule could be
    // silently inert and read as compliance.
    expect(BARE.test('className="text-ink"')).toBe(true);
    expect(BARE.test('className="hover:bg-surface-2"')).toBe(true);
    expect(BARE.test('className="divide-y divide-hairline"')).toBe(true);
    expect(BARE.test('"active:border-accent"')).toBe(true);

    // The bracketed form is the whole point — it must never trip.
    expect(BARE.test('className="text-[hsl(var(--color-ink))]"')).toBe(false);
    expect(BARE.test('className="bg-[hsl(var(--color-surface-1)/0.2)]"')).toBe(false);
    expect(BARE.test('className="hover:text-[hsl(var(--color-accent-hover))]"')).toBe(false);
    // Nor may it fire on words that merely end in a token name.
    expect(BARE.test('className="text-blackish"')).toBe(false);
    expect(BARE.test("const inkStyle = 1;")).toBe(false);
  });

  it("ignores a bare spelling that only appears in prose", () => {
    // Comments in this repo do quote these class names on purpose — including
    // the note in globals.css explaining why they were removed.
    expect(BARE.test(codeOnly("// use text-ink here"))).toBe(false);
    expect(BARE.test(codeOnly("/* was bg-surface-1 before */"))).toBe(false);
    expect(BARE.test(codeOnly('x = "text-ink";'))).toBe(true);
  });

  it("has no bare colour-token class anywhere in the source tree", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const code = codeOnly(readFileSync(file, "utf8"));
      code.split("\n").forEach((line, i) => {
        const m = BARE.exec(line);
        if (m) {
          offenders.push(
            `${path.relative(FRONTEND_ROOT, file).split(path.sep).join("/")}:${i + 1}  ${m[0]}`
          );
        }
      });
    }
    if (offenders.length > 0) {
      throw new Error(
        `Bare colour-token classes. These generate no CSS: the utility resolves ` +
          `to \`var(--color-x)\`, which holds a raw HSL triple, which is not a ` +
          `colour — so the browser drops the declaration and the element renders ` +
          `with the inherited value. Nothing else in the build will tell you. ` +
          `Write \`text-[hsl(var(--color-ink))]\` instead.\n\n` +
          offenders.join("\n")
      );
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/**
 * A SKELETON MAY NOT BE FILLED FROM THE SURFACE RAMP.
 *
 * Skeleton blocks are among the ~29% of surface fills in this app that ship
 * with no border, so the fill is the only thing separating them from what they
 * sit on — and the surface ramp cannot do that job. Measured 2026-09-02:
 * `--color-surface-1` against the canvas is 1.046:1 dark / 1.050:1 light, and
 * `animate-pulse` halves the opacity, putting the trough at **1.021:1**. Twenty
 * blocks across three `loading.tsx` files and the shared `skeleton.tsx`
 * primitive were drawn that way — a loading state nobody could see.
 *
 * `--color-hairline` is the token that already means "the quietest visible
 * boundary": 1.438:1 full, 1.153:1 at the trough. It also belongs to neither
 * ramp, so using it here moves none of the 128 pinned ink-on-surface
 * combinations.
 */
describe("skeletons are visible against what they sit on", () => {
  const sources = SOURCE_ROOTS.flatMap((root) => walk(path.join(FRONTEND_ROOT, root), []));

  /**
   * ANY quoted class string that pulses AND fills from the surface ramp.
   *
   * Deliberately NOT anchored on `className=`. The first version was, and it
   * missed the one site that matters most: `components/ui/skeleton.tsx` — the
   * shared primitive every other skeleton is built from — writes its classes as
   * a bare string inside a `cn([...])` array, with no attribute in front of it.
   * The mutation test caught this: reverting that file's fill to
   * `--color-surface-2` left the rule green. Same shape as the `cva()` array
   * strings that defeated an earlier scan in this repo.
   */
  const PULSING_SURFACE =
    /(?:animate-pulse[^"'`\n]*bg-\[hsl\(var\(--color-surface-|bg-\[hsl\(var\(--color-surface-[^"'`\n]*animate-pulse)/;

  it("catches the pattern it exists to catch, and spares the ones it must", () => {
    expect(PULSING_SURFACE.test('className="h-8 animate-pulse bg-[hsl(var(--color-surface-1))]"')).toBe(true);
    expect(PULSING_SURFACE.test('className="bg-[hsl(var(--color-surface-2))] animate-pulse"')).toBe(true);
    // The shape the first version missed: a bare string in a `cn([...])` array.
    expect(PULSING_SURFACE.test("  'animate-pulse bg-[hsl(var(--color-surface-2))]',")).toBe(true);
    // The fix, and unrelated surface use, must both pass.
    expect(PULSING_SURFACE.test('className="h-8 animate-pulse bg-[hsl(var(--color-hairline))]"')).toBe(false);
    expect(PULSING_SURFACE.test('className="bg-[hsl(var(--color-surface-1))] border"')).toBe(false);
  });

  it("has files to scan", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("has no pulsing block filled from the surface ramp", () => {
    const offenders = sources
      .filter((f) => PULSING_SURFACE.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(FRONTEND_ROOT, f).split(path.sep).join("/"));
    if (offenders.length > 0) {
      throw new Error(
        `A skeleton is filled from the surface ramp. At 1.05:1 — 1.02:1 once ` +
          `animate-pulse halves the opacity — the block is invisible against ` +
          `what it sits on. Fill it from \`--color-hairline\` instead.\n\n` +
          offenders.join("\n")
      );
    }
    expect(offenders).toEqual([]);
  });
});
