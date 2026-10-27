/**
 * @jest-environment node
 *
 * `frontend/jest.always-run.txt` must name exactly the tests that read files.
 *
 * The pre-push hook (and `scripts/run-gates.sh --affected`) runs only the jest
 * tests `--findRelatedTests` connects to the changed files. That graph is
 * built from imports. A test that reads `app/globals.css`, a language pack or
 * another source file through `fs` / `child_process` / `git` depends on that
 * file without importing it, so a change to the file selects nothing and the
 * contract test built to catch it never runs. Those tests run on every
 * selective push instead, from the list this file checks.
 *
 * The list is derived, not curated: a test belongs on it when its source — or a
 * module it imports by a relative path, e.g. `support/globalsCssTokens.ts` —
 * matches READS_FILES below. Missing entries and stale entries both fail, so
 * the list cannot drift in either direction. Proven red on 2026-09-30 by adding
 * a throwaway test that called `readFileSync` and was not on the list.
 *
 * This file reads files itself, so it is on the list.
 *
 * EACH LINE ALSO NAMES WHAT THE TEST READS (2026-10-27). When nothing under
 * frontend/ or packages/ changed, run-gates.sh runs only the lines naming a
 * top-level entry the push changed, or `*`. The labels are derived like the
 * list: the repository's top-level entries (`git ls-tree`) that the test's
 * source, or a module it imports by a relative path, quotes or uses as a path
 * segment — comments stripped. A test that runs git or a subprocess, or reaches
 * the repository root without naming anything, is `*`; one that names nothing
 * and has no such reach reads only frontend/ and says `frontend`. Same rule as
 * backend/tests/reads-outside-backend.txt.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const FRONTEND = path.resolve(__dirname, "..", "..");
const LIST = path.join(FRONTEND, "jest.always-run.txt");

// Any way a test reaches a file without importing it. `\bgit\s` is loose on
// purpose (a comment mentioning git matches too): over-listing costs a few
// seconds, under-listing is a silent hole.
const READS_FILES =
  /readFileSync|readdirSync|globSync|execSync|execFileSync|spawnSync|existsSync|statSync|lstatSync|opendirSync|['"](node:)?(fs|fs\/promises|child_process|glob)['"]|\bgit\s/;

const SKIP_DIRS = new Set(["node_modules", ".next", "coverage", "e2e", "public"]);

function testDirs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === "__tests__") out.push(full);
    else out.push(...testDirs(full));
  }
  return out;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

function resolveRelative(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const memo = new Map<string, boolean>();
function readsFiles(file: string): boolean {
  if (memo.has(file)) return memo.get(file)!;
  memo.set(file, false); // cycle guard
  const src = readFileSync(file, "utf8");
  let result = READS_FILES.test(src);
  if (!result) {
    for (const m of src.matchAll(/(?:from|import|require\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolveRelative(file, m[1]);
      if (target && /\.tsx?$/.test(target) && readsFiles(target)) {
        result = true;
        break;
      }
    }
  }
  memo.set(file, result);
  return result;
}

function sourceWithImports(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return "";
  seen.add(file);
  let src = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const m of src.matchAll(/(?:from|import|require\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = resolveRelative(file, m[1]);
    if (target && /\.tsx?$/.test(target)) src += "\n" + sourceWithImports(target, seen);
  }
  return src;
}

const TOP_LEVEL = execFileSync("git", ["ls-tree", "--name-only", "HEAD"], {
  cwd: path.resolve(FRONTEND, ".."),
})
  .toString()
  .trim()
  .split("\n");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function derivedLabel(rel: string): string {
  const src = sourceWithImports(path.join(FRONTEND, rel));
  if (/execSync|execFileSync|spawnSync|\bgit\s/.test(src)) return "*";
  const names = TOP_LEVEL.filter((t) => new RegExp(`(['"\`/])${escapeRe(t)}(['"\`/])`).test(src));
  if (names.length) return names.join(" ");
  const reachesRoot = /REPO|repoRoot|ROOT\b|"\.\.", "\.\.", "\.\."|\.\.\/\.\.\/\.\./.test(src);
  return reachesRoot ? "*" : "frontend";
}

function derived(): string[] {
  return testDirs(FRONTEND)
    .flatMap(filesUnder)
    .filter((f) => /\.test\.tsx?$/.test(f) && readsFiles(f))
    .map((f) => path.relative(FRONTEND, f).split(path.sep).join("/"))
    .sort();
}

function listedLines(): string[] {
  return readFileSync(LIST, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function listed(): string[] {
  return listedLines()
    .map((l) => l.split(/\s+/)[0])
    .sort();
}

describe("jest.always-run.txt", () => {
  it("is derived from something (non-vacuity)", () => {
    // 2026-09-30: 51 tests read files. A regex that stopped matching anything
    // would make both sides empty and this file green over nothing.
    expect(derived().length).toBeGreaterThan(30);
  });

  it("names every test that reads files", () => {
    const have = new Set(listed());
    const missing = derived().filter((f) => !have.has(f));
    // Add them to frontend/jest.always-run.txt. A file-reading test left off
    // it does not run on a selective push unless something it imports changed.
    expect(missing).toEqual([]);
  });

  it("names nothing else", () => {
    const want = new Set(derived());
    const stale = listed().filter((f) => !want.has(f));
    // Deleted, renamed, or no longer reading files: remove them.
    expect(stale).toEqual([]);
  });

  it("labels each test with the top-level entries it reads", () => {
    const wrong = listedLines()
      .map((l) => {
        const [file, ...labels] = l.split(/\s+/);
        const want = derivedLabel(file);
        return labels.join(" ") === want ? null : `${file} ${want}`;
      })
      .filter(Boolean);
    // Replace these lines in frontend/jest.always-run.txt with the ones shown.
    expect(wrong).toEqual([]);
  });

  it("labels are not all `*` (non-vacuity)", () => {
    const labels = listedLines().map((l) => l.split(/\s+/).slice(1).join(" "));
    expect(labels.filter((l) => l === "*").length).toBeLessThan(labels.length / 2);
    expect(labels.some((l) => l.split(" ").includes("backend"))).toBe(true);
  });
});
