/**
 * @jest-environment node
 */
/**
 * The three E2E route tables are `app/` minus a written-down list of exceptions.
 *
 * WHY. `no-route-overflows-the-document`, `the-api-mock-models-what-the-app-calls` and `rendered-contrast` each had a
 * hand-written table; together they opened 33 of the 64 static routes and nothing compared them with `app/`
 * (docs/audit/2026-11-13-test-review.md §2 #5). They now spread `routesFor(<table>)` from `e2e/routes.ts`. Playwright
 * is not run on a push that does not touch the frontend, and never in jest, so this is what keeps that arrangement
 * honest: every page is opened or excused with a reason, no excuse outlives its page, and no spec has gone back to a
 * table of its own.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { EXCLUDE, SIGNED_OUT, STATIC_ROUTES, routesFor, type RouteTable } from "../../e2e/routes";
import { FRONTEND_DIR, pageRoutes } from "./support/appRoutes";

const SPEC_OF: Record<RouteTable, string> = {
  overflow: "e2e/no-route-overflows-the-document.spec.ts",
  apiMock: "e2e/the-api-mock-models-what-the-app-calls.spec.ts",
  contrast: "e2e/rendered-contrast.spec.ts",
};
const TABLES = Object.keys(SPEC_OF) as RouteTable[];

/** What is wrong with one table: a route neither opened nor excused, an excuse for no page, an excuse with no reason. */
function problems(staticRoutes: string[], opened: string[], excluded: Record<string, string>): string[] {
  const out: string[] = [];
  for (const route of staticRoutes) {
    const here = Number(opened.includes(route)) + Number(route in excluded);
    if (here === 0) out.push(`${route}: neither opened nor excluded`);
    if (here === 2) out.push(`${route}: both opened and excluded`);
  }
  for (const [route, reason] of Object.entries(excluded)) {
    if (!staticRoutes.includes(route)) out.push(`${route}: excluded, but there is no such static page under app/`);
    if (reason.trim().length < 8) out.push(`${route}: excluded without a reason`);
  }
  for (const route of opened) if (!staticRoutes.includes(route)) out.push(`${route}: opened, but there is no such page`);
  return out;
}

/** The body of a spec's `const ROUTES = [ … ];`. */
function routesLiteral(table: RouteTable): string {
  const src = readFileSync(path.join(FRONTEND_DIR, SPEC_OF[table]), "utf8");
  const m = /const ROUTES\s*=\s*\[([\s\S]*?)\n\];/.exec(src);
  if (!m) throw new Error(`${SPEC_OF[table]}: no \`const ROUTES = [ … ];\` — this guard reads the table by that name`);
  return m[1].replace(/^\s*\/\/.*$/gm, "");
}

describe("the E2E route tables follow app/", () => {
  it("reads a real set of pages", () => {
    // Every check below is a loop: over nothing, it passes.
    expect(STATIC_ROUTES.length).toBeGreaterThanOrEqual(50);
    expect(STATIC_ROUTES).toEqual(expect.arrayContaining(["/", "/dashboard", "/login", "/souls"]));
    expect(STATIC_ROUTES.some((route) => route.includes("["))).toBe(false);
    expect(STATIC_ROUTES.length).toBe(pageRoutes().filter((page) => !page.route.includes("[")).length);
  });

  it.each(TABLES)("%s: every static page is opened, or excluded with a reason, and no exclusion is stale", (table) => {
    expect(problems(STATIC_ROUTES, routesFor(table), EXCLUDE[table])).toEqual([]);
    expect(routesFor(table).length).toBeGreaterThan(STATIC_ROUTES.length / 2);
  });

  it.each(TABLES)("%s: the spec takes its static routes from routes.ts and writes none by hand", (table) => {
    const literal = routesLiteral(table);
    expect(literal).toContain(`...routesFor("${table}")`);
    // What else may be in the table: detail pages, whose id comes from a fixture (`/souls/${SOULS[0].id}`).
    const written = [...literal.matchAll(/(["'`])(\/[^"'`]*)\1/g)].map((m) => m[2]);
    expect(written.filter((route) => !route.includes("${"))).toEqual([]);
  });

  it("the pages opened signed out are real pages", () => {
    expect([...SIGNED_OUT].filter((route) => !STATIC_ROUTES.includes(route))).toEqual([]);
  });

  it("the check itself can fail", () => {
    const pages = ["/a", "/b", "/c"];
    expect(problems(pages, ["/a", "/b"], { "/c": "needs a one-time token" })).toEqual([]);
    expect(problems(pages, ["/a"], { "/c": "needs a one-time token" })).toEqual(["/b: neither opened nor excluded"]);
    expect(problems(pages, ["/a", "/b"], { "/c": "needs a one-time token", "/gone": "was removed last month" })).toEqual([
      "/gone: excluded, but there is no such static page under app/",
    ]);
    expect(problems(pages, ["/a", "/b"], { "/c": " " })).toEqual(["/c: excluded without a reason"]);
    expect(problems(pages, ["/a", "/b", "/c"], { "/c": "needs a one-time token" })).toEqual(["/c: both opened and excluded"]);
  });
});
