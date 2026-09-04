/**
 * The bottom-rule tab is spelled in exactly one place.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 * The string `px-4 py-2 text-03 font-medium transition-colors border-b-2
 * -mb-px` was written SIX times: five inline copies (judgment, dashboard,
 * workflow, and twice in workflow/[id]) and one that had already been given a
 * name in `app/notifications/page.tsx`. Naming it there also REORDERED the
 * active/inactive strings — `border-… text-…` where the five wrote
 * `text-… border-…` — so the sixth copy was independently reformatted while
 * still rendering identically. That is exactly the state `CIVILIZATION_ICONS`
 * was found in (1f68be0): equal values, drifted spelling.
 *
 * What makes it worth a guard rather than only a cleanup is WHICH token is in
 * there. `TAB_ON` names `--color-accent-ink`, and accent-vs-accent-ink is the
 * mistake this codebase keeps making one site at a time (globals.css's own
 * token note, `Badge.tsx:70-74`, `app/welcome/page.tsx:134-138`, and four
 * masthead hovers). Correcting one of six copies leaves five disagreeing, and
 * nothing anywhere goes red.
 *
 * ── WHY IT PINS THE SUBJECT SET, NOT JUST THE ABSENCE ─────────────────────
 * "No file contains this string" is clean when it scans nothing, which is the
 * failure mode `suiteShape.test.ts` names: a scanner that stops finding files
 * passes loudest. So the scan is required to (a) reach a floor of source files
 * and (b) FIND the string in `src/lib/tabClasses.ts` — the one file that is
 * supposed to have it. If the module is renamed or the constants inlined back
 * into it under another spelling, this reddens instead of quietly passing.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";

const FRONTEND_ROOT = path.join(__dirname, "..", "..");

/** The same roots and skips `cssTokenReferenceContract` and `statusTokenLayering` scan. */
const SOURCE_ROOTS = ["app", "components", "lib", "src"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__", "coverage"]);
const SOURCE_FILE = /\.(tsx?|css)$/;

/** The module that is allowed to spell it, relative to the frontend root. */
const HOME = path.join("src", "lib", "tabClasses.ts");

/** The geometry half of the recipe — the part all six copies shared verbatim. */
const GEOMETRY = "border-b-2 -mb-px";

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (SOURCE_FILE.test(entry.name)) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  for (const root of SOURCE_ROOTS) walk(path.join(FRONTEND_ROOT, root));
  return out;
}

const FILES = sourceFiles();

describe("the tab recipe is written once", () => {
  it("scans a plausible number of source files", () => {
    // The floor, without which every assertion below is vacuously green.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("`src/lib/tabClasses.ts` is among them and does spell it", () => {
    // Presence, asserted before absence: this is what proves the scanner is
    // looking where it thinks it is.
    const home = FILES.find((f) => path.relative(FRONTEND_ROOT, f) === HOME);
    expect(home).toBeDefined();
    expect(readFileSync(home as string, "utf8")).toContain(GEOMETRY);
  });

  it("and nothing else does", () => {
    const offenders = FILES.map((f) => path.relative(FRONTEND_ROOT, f))
      .filter((rel) => rel !== HOME)
      .filter((rel) => readFileSync(path.join(FRONTEND_ROOT, rel), "utf8").includes(GEOMETRY));
    expect(offenders).toEqual([]);
  });
});

describe("the six strips read it from there", () => {
  /**
   * Pinned by name rather than counted. Adding one importer and dropping
   * another nets to zero under a count, and "a page stopped using the shared
   * recipe" is precisely the edit a count would wave through.
   */
  const EXPECTED_IMPORTERS = [
    "app/dashboard/page.tsx",
    "app/judgment/page.tsx",
    "app/notifications/page.tsx",
    "app/workflow/[id]/page.tsx",
    "app/workflow/page.tsx",
  ];

  it("exactly these files import the module", () => {
    const importers = FILES.map((f) => path.relative(FRONTEND_ROOT, f))
      .filter((rel) =>
        readFileSync(path.join(FRONTEND_ROOT, rel), "utf8").includes('from "@/src/lib/tabClasses"')
      )
      .sort();
    expect(importers).toEqual(EXPECTED_IMPORTERS);
  });
});

describe("the selected tab is painted in the ink token, not the fill token", () => {
  /**
   * Presence AND absence. `toContain("--color-accent-ink")` alone stays green
   * on `text-[hsl(var(--color-accent))] border-[hsl(var(--color-accent-ink))]`
   * — the two tokens swapped, which is the defect wearing the right substring.
   */
  it("TAB_ON draws its text in --color-accent-ink", () => {
    expect(TAB_ON).toContain("text-[hsl(var(--color-accent-ink))]");
    expect(TAB_ON).not.toContain("text-[hsl(var(--color-accent))]");
  });

  it("TAB_ON draws its 2px rule in --color-accent", () => {
    // The rule is a non-text mark on the container's hairline, not text; it
    // keeps the fill token, and swapping the pair has to be visible here.
    expect(TAB_ON).toContain("border-[hsl(var(--color-accent))]");
    expect(TAB_ON).not.toContain("border-[hsl(var(--color-accent-ink))]");
  });

  it("TAB_OFF carries no accent at all", () => {
    expect(TAB_OFF).not.toContain("--color-accent");
  });

  it("TAB_BASE carries the geometry and no colour", () => {
    expect(TAB_BASE).toContain(GEOMETRY);
    expect(TAB_BASE).not.toContain("hsl(");
  });
});
