/**
 * @jest-environment node
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { globsToMatcher } from "jest-util";

/**
 * The suite's own shape: which files run, and roughly how much runs in them.
 *
 * WHY THIS EXISTS. The backend has `test_collection_scope.py`, which pins the
 * set of `apps/*&#47;tests.py` modules and floors the number of tests collected from
 * them, because `pytest.ini` losing `tests.py` from `python_files` would take
 * several hundred tests out of the run and leave the suite green. The frontend
 * had no counterpart. `jest.config.js`'s `testMatch` is the same single point of
 * failure, and a file that stops matching it does not fail — it stops existing,
 * which is not a state a test run reports.
 *
 * The general rule this is an instance of: **pin the subject set, not the
 * parse.** A check that scans for offenders is clean when it scans nothing, so
 * "did the scanner find something" is the wrong question — finding nothing is
 * the passing state. What has to be asserted is that the set being examined is
 * the set we believe is being examined. Every contract test in this directory
 * that derives its subject from a scan already carries a floor of its own
 * (`SOURCE_FILES.length > 30` in domainDisplayContract, `OBJECT_CONSTS.length >
 * 40` in statusTokenLayering, `CIV_PREFIXES.length > 1` in
 * civilizationColourContract). This file is the floor for the layer above them:
 * the files themselves.
 *
 * WHAT THIS DOES NOT CATCH, said plainly because the failure mode of a file
 * like this is reading as more complete than it is. It counts `it(` / `test(`
 * *declarations* by regex, not tests. An `it.each` whose list goes empty keeps
 * its declaration and contributes zero tests, and nothing here would notice.
 * That case is covered per-file by the floors named above, on the lists those
 * `each` calls are fed from — which is where it belongs, because only the file
 * that owns the list knows how long it should be.
 */

// Which files jest collects is DERIVED, not pinned by name (2026-11-10,
// test-suite review 2026-11-10 §2.2). The name list this replaced had to
// gain a line for every new test file, so the commonest way to see this file red
// was adding a test, which has nothing to do with the incident it guards: a file
// that LOOKS like a test and is not collected. That incident is checked directly
// below, from two sides that do not depend on each other:
//
//   on disk   every file under frontend/ whose name says "test" (`.test.` /
//             `.spec.`, any js/ts extension) or that sits in a `__tests__/`
//             directory outside its helper subtree;
//   in jest   the same walk filtered through jest.config.js's own `roots`,
//             `testMatch` and `testPathIgnorePatterns`, matched with the matcher
//             jest itself uses (`jest-util`'s globsToMatcher).
//
// The two must be equal. What was given up: deleting a test file no longer
// needs a line here. Git history and review carry that; the floor below catches
// the bulk case (a directory dropped, the walk returning nothing).

const FRONTEND = path.resolve(__dirname, "../..");
const JEST_CONFIG = require(path.join(FRONTEND, "jest.config.js")) as {
  rootDir: string;
  roots?: string[];
  testMatch: string[];
  testPathIgnorePatterns?: string[];
};

/** Not walked. `e2e/` is Playwright's testDir (its `.spec.ts` files are a
 *  different runner's, collected by playwright.config.ts); the rest are build
 *  and report output. */
const NOT_SOURCE = new Set(["node_modules", ".next", "coverage", "e2e", "playwright-report", "test-results"]);

/** What may sit in a `__tests__/` directory without being a test. */
const isHelper = (file: string) =>
  file.split(path.sep).includes("support") || file.endsWith(".d.ts");

const LOOKS_LIKE_A_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Floors at about 90% of the measured values (2026-11-13: 378 files,
 *  4 349 declarations). They were 300 / 900 against 377 / ~4 300, so four
 *  fifths of the suite could go and stay green. A floor is only a guard while it
 *  sits near the number: when the suite has grown by a tenth, raise them. Lower
 *  one on purpose, with the reason, if a block of tests is genuinely retired. */
const MIN_FILES = 340;

/** Floor, not a pin — `it.each` makes the real test count larger and it moves
 *  whenever a table grows. */
const MIN_DECLARATIONS = 3900;

/** Everything that makes jest run less than the file says without failing:
 *  `.only` / `.skip` / `.todo` / `.failing` on it / test / describe (also behind
 *  `.concurrent`, and whatever follows: `(`, `.each(`, a template table), and the
 *  jasmine aliases (f-it, x-it, x-test, f-describe, x-describe). The lookbehind
 *  keeps `benefit(`, `obj.fit(` and `submit.only(` out. */
const RUNS_LESS_THAN_WRITTEN =
  /(?<![.\w$])(?:(?:it|test|describe)(?:\.concurrent)?\.(?:only|skip|todo|failing)\b|(?:fit|xit|xtest|fdescribe|xdescribe)(?=\s*[.(`]))/g;

const runsLessThanWritten = (source: string) =>
  [...source.matchAll(RUNS_LESS_THAN_WRITTEN)].map((match) => match[0]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (NOT_SOURCE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ALL_FILES = walk(FRONTEND);
const rel = (file: string) => path.relative(FRONTEND, file);

const withRootDir = (pattern: string) => pattern.replace(/<rootDir>/g, JEST_CONFIG.rootDir);
const ROOTS = (JEST_CONFIG.roots ?? ["<rootDir>"]).map(withRootDir);
const matchesTestMatch = globsToMatcher(JEST_CONFIG.testMatch.map(withRootDir));
const IGNORED = (JEST_CONFIG.testPathIgnorePatterns ?? ["/node_modules/"]).map(
  (pattern) => new RegExp(withRootDir(pattern))
);

/** What jest collects, absolute paths. */
const COLLECTED = ALL_FILES.filter(
  (file) =>
    ROOTS.some((root) => file.startsWith(root + path.sep)) &&
    matchesTestMatch(file) &&
    !IGNORED.some((re) => re.test(file))
).sort();

const IN_TESTS_DIR = (file: string) => rel(file).split(path.sep).includes("__tests__");

/** What a reader would take for a test, absolute paths. */
const LOOKS_LIKE_TESTS = ALL_FILES.filter(
  (file) => LOOKS_LIKE_A_TEST.test(path.basename(file)) || (IN_TESTS_DIR(file) && !isHelper(rel(file)))
).sort();

describe("the suite is the suite we think it is", () => {
  it("collects every file that looks like a test, and nothing else", () => {
    // A file renamed to `.spec.tsx`, given a suffix `testMatch` no longer
    // matches, put in a `__tests__/` without `.test.` in its name, moved out of
    // `roots`, or caught by a new `testPathIgnorePatterns` entry stops running
    // without failing — the suite reports one fewer file and nothing reports
    // that as a problem. Here it is on one side of this diff and not the other.
    expect(COLLECTED.map(rel)).toEqual(LOOKS_LIKE_TESTS.map(rel));
  });

  it("derives the collected set the way jest does, at least for this file", () => {
    // This file is running, so jest collected it. If the derivation above says
    // otherwise, the derivation is wrong and the equality above means nothing.
    expect(COLLECTED).toContain(__filename);
  });

  it("finds a non-trivial number of them, so the walk itself is doing something", () => {
    // The guard for the guard: two empty sets are equal.
    expect(COLLECTED.length).toBeGreaterThanOrEqual(MIN_FILES);
  });

  it("gives every collected file at least one test to run", () => {
    // A file that collects and declares nothing is invisible in a run summary:
    // it contributes a passing suite with zero tests. Everything that used to
    // be in it is simply not being asserted any more.
    const empty = COLLECTED.filter((file) => {
      const source = readFileSync(file, "utf8");
      return !/(?:^|\n)\s*(?:it|test)(?:\.each\([\s\S]*?\))?\s*\(/.test(source);
    });
    expect(empty.map(rel)).toEqual([]);
  });

  it("declares at least as many tests as it used to", () => {
    // Catches the shape the file list cannot: a `describe` block deleted, or an
    // early `return` inside one, leaving the file present and most of its
    // assertions gone.
    const declarations = COLLECTED.reduce((total, file) => {
      const source = readFileSync(file, "utf8");
      return total + (source.match(/(?:^|\n)\s*(?:it|test)(?:\.each\([\s\S]*?\))?\s*\(/g) ?? []).length;
    }, 0);
    expect(declarations).toBeGreaterThanOrEqual(MIN_DECLARATIONS);
  });

  it("runs the whole of every file — no .only, no .skip, no alias of either", () => {
    // `.only` is the dangerous one. It does not fail: jest runs the one test,
    // reports the rest as skipped, and exits green. A summary reading
    // "1 passed, 40 skipped" is the same colour as one reading "41 passed", and
    // it is the shape most likely to be committed by accident, because it is
    // what you write while debugging.
    const offenders: string[] = [];
    for (const file of COLLECTED) {
      for (const hit of runsLessThanWritten(readFileSync(file, "utf8"))) {
        offenders.push(`${rel(file)}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("recognises every spelling of only / skip, and nothing that merely looks like one", () => {
    // The scan above is clean when its pattern matches nothing, so the pattern
    // is tested on its own. Until 2026-11-13 it knew `.only(` and `.skip(` and
    // let the jasmine aliases, `.only.each` and `.todo` through.
    // `@` stands for nothing: it keeps these samples from being offenders in
    // this file, which the scan above reads like any other.
    const sample = (text: string) => text.replace(/@/g, "");
    const caught = [
      'it@.only("a", () => {})',
      'test@.skip("a", () => {})',
      "describe@.only('a', () => {})",
      "describe@.skip('a', () => {})",
      "it@.only.each([1, 2])('a %s', () => {})",
      "it@.skip.each([1, 2])('a %s', () => {})",
      "describe@.only.each([1])('a', () => {})",
      "test@.only.each`\n a | b\n`('x', () => {})",
      'it@.todo("write this")',
      'test@.failing("a", () => {})',
      'it@.concurrent.only("a", async () => {})',
      '  f@it("a", () => {})',
      '  x@it("a", () => {})',
      'x@test("a", () => {})',
      'f@describe("a", () => {})',
      'x@describe("a", () => {})',
      "f@it.each([1])('a', () => {})",
      "x@it  ('a', () => {})",
    ].map(sample);
    for (const line of caught) expect([line, runsLessThanWritten(line).length]).toEqual([line, 1]);

    const clean = [
      'it("a", () => {})',
      "it.each([1, 2])('a %s', () => {})",
      "describe.each([1])('a', () => {})",
      'test.concurrent("a", async () => {})',
      "benefit(1)",
      "exit(0)",
      "chart.fit()",
      "form.submit.only()",
      "const fit = 1",
      "// no .only, no .skip",
    ];
    for (const line of clean) expect([line, runsLessThanWritten(line)]).toEqual([line, []]);
  });

  it("never stubs the permission gate itself", () => {
    // Three suites used to carry this:
    //
    //     jest.mock("@/src/components/rbac/RequirePermission", () => ({
    //       RequirePermission: ({ children }) => children,
    //     }));
    //
    // The stub ignores the `permissions` prop and renders children
    // unconditionally, so inside those files a gate could be **deleted
    // outright** — or pointed at a codename that does not exist — and all
    // 1689 tests stayed green. Verified, not assumed: removing
    // `<RequirePermission permissions="soul.delete">` from SoulHeaderActions
    // failed nothing until `permissionGatesActuallyWithhold.test.tsx` existed.
    //
    // E2E does not compensate. `e2e/fixtures.ts` authenticates as ADMIN, and
    // `usePermissions` returns true for ADMIN before it reads the string — on
    // that path a gate and its absence are behaviourally identical.
    //
    // The rule is the whole module, not "the passthrough shape". A stub that
    // does consult the prop is a reimplementation of the thing under test, and
    // the repo has already been bitten by a stub that reproduced the defect it
    // was standing in for (see docs/design-handoff/BRIEF.md §4.6 on the
    // `DomainEnum` stub). Mock `@/src/contexts/TenantContext` instead and let
    // the real gate run — that is what the three suites do now.
    // 逐行判断,不用正则:这份文件和那份守卫都在**注释里**引用了那段桩代码,
    // 而注释行以 `//` 或 ` * ` 开头。第一版用正则扫全文,把两份说明这条规则的
    // 文件自己报成了违规者 —— 一个连自己的文档都读成违规的扫描器,说明它读的
    // 不是代码。
    const offenders = COLLECTED.map(rel).filter((file) =>
      readFileSync(path.join(FRONTEND, file), "utf8")
        .split("\n")
        .some(
          (line) =>
            line.trimStart().startsWith("jest.mock(") &&
            line.includes("rbac/RequirePermission")
        )
    );
    expect(offenders).toEqual([]);
  });
});
