/**
 * A page that asks the server for page N must give the user a way to change N.
 *
 * THE LEFTOVER THIS CLOSES. `cfe9f99` fixed two list pages that requested a
 * page and rendered no pagination — records past the twentieth were on screen
 * nowhere and reachable by nothing. Its own commit message says: "这一条目前
 * 没有自动守卫,我不假装它有 … 留给后续." The reason given was that `.results`
 * is perfectly legitimate wherever pagination already exists, so the two cannot
 * be told apart by text.
 *
 * That reasoning was about the wrong signal. `.results` says a response was
 * paginated, which proves nothing. **Requesting `page` does**: a caller that
 * names a page number has conceded there is more than one, and owes the reader
 * a way to get to the others. So the rule reads the REQUEST, not the response.
 *
 * WHAT COUNTS AS A WAY, AND WHY IT IS NOT A LIST OF COMPONENT NAMES. The first
 * draft required `<Pagination>` or `<SearchSelectField>` in the page. It passed,
 * and it was worthless: `app/souls/page.tsx` contains `<Pagination>` only inside
 * a comment ("DataTable renders its own <Pagination>"), so the rule cleared the
 * repo's busiest list page on a sentence. Deleting every pagination control from
 * that page left the guard green — measured.
 *
 * Pagination reaches the screen five different ways here: rendered directly (4
 * pages), inside `<DataTable>`, inside `<DataGrid>`, hand-built into PageShell's
 * `pagination` slot (corpus, tenants), and replaced by server-side search
 * (dispatch/propose). Enumerating those five means a sixth silently exempts
 * whatever page invents it.
 *
 * So the rule reads the STATE, which every one of the five shares: a page that
 * requests `page` must contain something able to set it to a value that is not a
 * constant — `onPageChange`, or a `setPage(...)` whose argument is not a
 * literal. `setPage(1)` alone does not count; that is a filter reset, and a page
 * that can only ever reset to the first page is precisely the bug.
 *
 * `<SearchSelectField>` is the one accepted alternative, because narrowing the
 * set server-side is an honest answer to "there are more than fit". It is not a
 * loophole only because that control has its own contract —
 * `searchSelectIsServerFiltered.test.ts` — proving it does not filter on the
 * client. Without that, "a search box exists" would have cleared the original
 * `<select>` bug too.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is not a nicety. The first draft matched
 * `\bpage:\s` against raw source and flagged app/actors and app/ledger — on the
 * English prose "the split on this page: Osiris" and "the 功過格 account page:
 * six ruled". Neither file requests a page at all. Two false accusations out of
 * three hits, from reading documentation as if it were code.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { FRONTEND_ROOT } from "./support/globalsCssTokens";

/**
 * Route entry points, not the source tree.
 *
 * `statusTokenLayering` and `cssTokenReferenceContract` each walk `app/`,
 * `components/`, `lib/` and `src/` for every `.ts(x)` file; this wants the
 * `page.tsx` files specifically, because the claim being made is about ROUTES —
 * a helper module that passes a page number through is not the thing that owes
 * the user a control. Same recursion, different set, so it is not a third copy
 * of that walker. (Those two are copies of each other, and folding them onto one
 * shared helper is still worth doing.)
 */
function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

/** Block and line comments. `://` is spared so URLs in code survive. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<![:\w])\/\/[^\n]*/g, "");
}

/** `page: 1`, `params.page`, `{ page }` — a page number going OUT in a request. */
const REQUESTS_A_PAGE = /\bpage:\s*[\w({]|\bparams\.page\b|\{\s*page\s*[,}]/;

/**
 * Something that can move the page number off a constant.
 *
 * The negative lookahead is the whole point: `setPage(1)` is what every filter
 * handler calls when it resets, and a page holding only those has no way
 * forward. `setPage(page + 1)`, `setPage(next)` and `onPageChange` do.
 */
const CAN_CHANGE_THE_PAGE = /\bonPageChange\b|\bsetPage\(\s*(?!\d+\s*\))/;

/** Narrowing the set server-side instead of walking it. See the header. */
const NARROWS_INSTEAD = /<SearchSelectField\b/;

const offersAWay = (code: string) => CAN_CHANGE_THE_PAGE.test(code) || NARROWS_INSTEAD.test(code);

/**
 * Pages that request a page and answer for it some other way.
 *
 * Recorded with the reason, and checked for staleness below: an exemption that
 * no longer applies is how a list of known gaps turns into a list of forgotten
 * ones.
 */
const EXEMPT: Record<string, string> = {
  "app/organizations/page.tsx":
    "Requests page 1..N in a loop and keeps every result — it renders a parent/child " +
    "tree, and a paged view would split a node from its children onto different pages. " +
    "The whole collection is on screen, so there is nothing left to page to.",
};

const ROUTES = routeFiles(path.join(FRONTEND_ROOT, "app")).map((f) =>
  path.relative(FRONTEND_ROOT, f).split(path.sep).join("/")
);

/** A route's source with comments removed — every rule here reads code, not prose. */
const codeOf = (rel: string) =>
  stripComments(readFileSync(path.join(FRONTEND_ROOT, rel), "utf8"));

const REQUESTING = ROUTES.filter((rel) => REQUESTS_A_PAGE.test(codeOf(rel)));

describe("the scan is looking at something", () => {
  it("found the app's routes", () => {
    // Every assertion below is "nothing is missing a control", which an empty
    // list satisfies perfectly.
    expect(ROUTES.length).toBeGreaterThan(20);
    expect(ROUTES).toContain("app/souls/page.tsx");
  });

  it("found pages that request a page number", () => {
    expect(REQUESTING.length).toBeGreaterThan(5);
    expect(REQUESTING).toContain("app/souls/page.tsx");
  });

  it("ignores a page number that is only mentioned in prose", () => {
    // The two false accusations that made stripping necessary. Both files talk
    // about "this page:" in a doc comment and neither requests one.
    for (const rel of ["app/actors/page.tsx", "app/ledger/page.tsx"]) {
      const raw = readFileSync(path.join(FRONTEND_ROOT, rel), "utf8");
      expect(REQUESTS_A_PAGE.test(raw)).toBe(true); // matches the prose…
      expect(REQUESTS_A_PAGE.test(stripComments(raw))).toBe(false); // …and not the code
    }
  });

  it("still detects a request written inside a params bag", () => {
    // The detector has to survive the shapes actually in use, not just
    // `page: page`. This is the organizations spelling.
    expect(REQUESTS_A_PAGE.test('api.get(url, { params: { page } })')).toBe(true);
    expect(REQUESTS_A_PAGE.test("soulsApi.list({ page: 1, search })")).toBe(true);
    expect(REQUESTS_A_PAGE.test("const params = { page };")).toBe(true);
    // And not fire on an unrelated identifier ending in `page`.
    expect(REQUESTS_A_PAGE.test("const homepage = 1;")).toBe(false);
  });

  it("does not accept a filter reset as a way to reach page two", () => {
    // The distinction the whole rule turns on. Every filter handler in this app
    // calls `setPage(1)`; a page holding only those can go back to the start and
    // nowhere else, which is the defect, not the fix.
    expect(offersAWay("onChange={() => setPage(1)}")).toBe(false);
    expect(offersAWay("setPage(1);")).toBe(false);

    expect(offersAWay("setPage(page + 1)")).toBe(true);
    expect(offersAWay("setPage(next)")).toBe(true);
    expect(offersAWay("<Pagination onPageChange={setPage} />")).toBe(true);
    expect(offersAWay("<SearchSelectField id=\"soul\" />")).toBe(true);
  });

  it("does not depend on which component draws the control", () => {
    // Five shapes ship today and the rule names none of them. A page whose
    // control lives inside a grid, a slot, or a component invented tomorrow is
    // judged the same way.
    const byShape = ["app/souls/page.tsx", "app/audit/page.tsx", "app/corpus/page.tsx", "app/tenants/page.tsx"];
    for (const rel of byShape) {
      expect(REQUESTING).toContain(rel);
      expect(offersAWay(codeOf(rel))).toBe(true);
    }
    // …and none of those four renders <Pagination> in its own code.
    for (const rel of byShape) {
      expect(/<Pagination\b/.test(codeOf(rel))).toBe(false);
    }
  });
});

describe("a page that asks for page N lets the reader change N", () => {
  it("has no route requesting a page with no way to reach the others", () => {
    const offenders = REQUESTING.filter(
      (rel) => !(rel in EXEMPT) && !offersAWay(codeOf(rel))
    );
    if (offenders.length > 0) {
      throw new Error(
        `These routes request a numbered page and contain nothing able to set it ` +
          `to anything but a constant — \`setPage(1)\` is a filter reset, not a way ` +
          `forward. Everything past the first page is on screen nowhere and ` +
          `reachable by nothing, and the list looks complete. Wire a page-changing ` +
          `control (this rule does not care which component draws it), replace the ` +
          `paging with <SearchSelectField>, or record the route in EXEMPT with its ` +
          `reason.\n\n` +
          offenders.join("\n")
      );
    }
    expect(offenders).toEqual([]);
  });

  it("records no exemption that has stopped being true", () => {
    const stale = Object.keys(EXEMPT).filter(
      (rel) => !REQUESTING.includes(rel) || offersAWay(codeOf(rel))
    );
    expect(stale).toEqual([]);
  });

  it("exempts by naming a reason, not by leaving a blank", () => {
    for (const [rel, reason] of Object.entries(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(40);
      expect(ROUTES).toContain(rel);
    }
  });
});
