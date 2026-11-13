/**
 * @jest-environment node
 */
/**
 * `e2e/fixtures.ts` `BACKGROUND_PATHS` names paths, and names every one the app calls.
 *
 * WHY. The list is the E2E mock's "these may fall through to an empty page" exception. Until 2026-11-13 it was four
 * whole prefixes (`/notifications/`, `/menus/`, `/social/`, `/audit-logs/`), so a new endpoint under any of them was
 * answered `200 {results: []}` and no spec noticed (docs/audit/2026-11-13-test-review.md §3.3). It is exact paths now,
 * written from a reading of `packages/core/src/api`. This test is that reading, repeated on every run: each path the
 * API modules call under those four prefixes is either in the list or has a default handler. A new endpoint there
 * turns this red before Playwright ever runs, and the fix is one line in fixtures.ts — a handler, or the list.
 *
 * The list is read as text: fixtures.ts imports `@playwright/test`, which jest does not load.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { FRONTEND_DIR } from "./support/appRoutes";

const FIXTURES = readFileSync(path.join(FRONTEND_DIR, "e2e/fixtures.ts"), "utf8");
const API_DIR = path.join(FRONTEND_DIR, "..", "packages/core/src/api");
const PREFIXES = ["notifications", "menus", "social", "audit-logs"];

/** The regular expressions between `const BACKGROUND_PATHS: RegExp[] = [` and its `];`, one per line. */
function backgroundPaths(src = FIXTURES): RegExp[] {
  const block = /const BACKGROUND_PATHS: RegExp\[\] = \[\n([\s\S]*?)\n\];/.exec(src);
  if (!block) throw new Error("BACKGROUND_PATHS not found in e2e/fixtures.ts: this guard reads it by that declaration");
  return block[1]
    .split("\n")
    .map((line) => /^\s*\/(\^.+)\/,\s*$/.exec(line)?.[1])
    .filter((source): source is string => !!source)
    .map((source) => new RegExp(source));
}

/** `this.on("GET", "/social/profiles/:id/", …)` → the same anchored pattern `toRegExp` builds in fixtures.ts. */
function handlerPaths(src = FIXTURES): RegExp[] {
  return [...src.matchAll(/this\.on\(\s*"\w+",\s*"([^"]+)"/g)].map(
    (m) => new RegExp(`^${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "[^/]+")}$`),
  );
}

/** Every path literal under the four prefixes in the API modules; a `${param}` becomes a concrete segment. */
function calledPaths(): string[] {
  const found = new Set<string>();
  const literal = new RegExp(`["\`](/(?:${PREFIXES.join("|")})/[^"\`]*)["\`]`, "g");
  for (const file of readdirSync(API_DIR).filter((name) => name.endsWith(".ts"))) {
    for (const m of readFileSync(path.join(API_DIR, file), "utf8").matchAll(literal)) {
      found.add(m[1].replace(/\$\{[^}]+\}/g, "7"));
    }
  }
  return [...found].sort();
}

describe("the E2E mock's background paths", () => {
  it("reads a real list and a real set of calls", () => {
    // One entry per prefix today; an entry this reader cannot parse (not `/^…$/,` on a line of its own) is one short.
    expect(backgroundPaths().length).toBe(FIXTURES.split("const BACKGROUND_PATHS")[1].split("\n];")[0].match(/^\s*\/[^/]/gm)?.length);
    expect(backgroundPaths().length).toBeGreaterThanOrEqual(PREFIXES.length);
    expect(handlerPaths().length).toBeGreaterThan(100);
    expect(calledPaths().length).toBeGreaterThanOrEqual(25);
    expect(calledPaths()).toEqual(expect.arrayContaining(["/notifications/", "/social/posts/7/", "/audit-logs/export/"]));
  });

  it("are whole paths, not prefixes", () => {
    expect(backgroundPaths().filter((re) => !re.source.startsWith("^") || !re.source.endsWith("$")).map(String)).toEqual([]);
    // An endpoint nobody has written yet, under each prefix, at either depth: the list must not already allow it.
    const invented = PREFIXES.flatMap((p) => [`/${p}/7/not-yet-written/`, `/${p}/not/yet/written/`]);
    expect(invented.filter((p) => backgroundPaths().some((re) => re.test(p)))).toEqual([]);
  });

  it("cover every path the API modules call under those prefixes, or a handler does", () => {
    const allowed = [...backgroundPaths(), ...handlerPaths()];
    expect(calledPaths().filter((p) => !allowed.some((re) => re.test(p)))).toEqual([]);
  });
});
