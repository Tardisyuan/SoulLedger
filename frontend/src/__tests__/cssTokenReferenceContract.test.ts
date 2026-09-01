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
 * ramp and the civilization families are declared as complete sets on purpose
 * (`--color-surface-4` and `--color-status-disposed` currently have no caller),
 * and reddening on an unused token would only teach people to delete tokens.
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
