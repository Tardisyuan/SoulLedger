/**
 * "The request failed" and "there is nothing here" are different facts, and a
 * page that renders only the second one lies about the first.
 *
 * This has now been fixed twice by hand. `PageError.tsx`'s own docstring
 * records the first round — nine pages, measured 2026-08-29 by rendering each
 * one twice against the same fixture, once returning 500 and once returning an
 * empty list, and finding the page text identical character for character. It
 * introduced `QueryError` and a `data-query-error` attribute for a check to
 * hang off. **No check was written.** So the shape came back: eight more pages
 * were found the same way on 2026-09-01 —
 *
 *   disposition, social (feed), dispatch (both sections), dispatch/[id],
 *   judgment/[id], workflow/[id], profile, dashboard
 *
 * — three of them, `judgment/[id]` / `workflow/[id]` / `dispatch/[id]`, in the
 * subtler form `if (error || !record)`, which answers a fetch failure with a
 * sentence about the record not existing. `dashboard` is subtler still: it HAS
 * an error branch, and the branch wraps only the pie chart, leaving the table
 * beside it to render "no data" against `?? []`.
 *
 * A guard is the whole difference between fixing this twice and fixing it
 * once. Hence the two rules below.
 *
 * WHY TEXT AND NOT RENDERS. Rendering 17 pages twice each — with a query
 * client, an i18n provider, a tenant context and a router per page — would be
 * the strictest possible check and would also be the slowest file in the
 * suite, for a property that is visible in the source. The narrower risk of a
 * text rule is that it passes on a page that *mentions* an error without
 * branching on one; that is what the `data-query-error` attribute is for, and
 * pages that render their lists through DataTable are covered by rule 2
 * instead, which checks the prop is actually passed rather than that the word
 * appears.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const APP_ROOT = path.join(__dirname, "..", "..", "app");

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

const PAGES = pageFiles(APP_ROOT).map((full) => ({
  label: path.relative(path.join(APP_ROOT, ".."), full),
  source: readFileSync(full, "utf8"),
}));

/** Renders an empty state of any kind. */
const RENDERS_EMPTY = /<EmptyState|empty=\{/;

/**
 * Renders or excludes a failure DISTINCTLY from the empty state.
 *
 * The first draft of this matched the identifier `isError` anywhere, and
 * measurably did not work: deleting the error branch from
 * `app/disposition/page.tsx` left `isError` sitting in the useQuery
 * destructure, so the rule still passed on a page that had just lost the
 * behaviour. What it looks for now is the artifact — a dedicated error element
 * (`<QueryError`, `role="alert"`, `data-query-error`), the prop that tells a
 * grid (`isError=`), or an empty-state condition that excludes the failure
 * (`!isError`, `isError ?`, `if (error)`).
 *
 * `<QueryError` is not required: `app/corpus/page.tsx` renders an `EmptyState`
 * carrying `common.error` under `isEmpty={!isError && …}`, which distinguishes
 * the two facts correctly with a different component. The rule is about the
 * distinction, not about which component draws it.
 *
 * TWO SHAPES ADDED 2026-09-05, both found by this rule reporting a page that
 * does distinguish the two facts:
 *
 *  - `<SectionError`, the per-section sibling of `QueryError`. It is a
 *    dedicated error element by the same argument `QueryError` is.
 *  - `error ? (`, the JSX ternary. The list had `if (error)` — the statement
 *    form — and every page here branches in JSX, where a bare `if` cannot go.
 *    So that alternative could only ever have matched a page that also had a
 *    guard clause, and `app/ledger/page.tsx` branches on `{error ? …}` four
 *    times without matching any of the nine alternatives. A pattern that
 *    cannot match the way the codebase actually writes the thing is the
 *    never-fires shape this repo has a note about, in a rule rather than in a
 *    check.
 */
const DISTINGUISHES_FAILURE =
  /<QueryError|<SectionError|role="alert"|data-query-error|isError=|isError\s*\?|isError\s*&&|!isError|if \(isError\)|if \(error\)|error\s*\?\s*\(/;

const RENDERS_GRID = /<DataTable|<DataGrid/;
const PASSES_IS_ERROR = /isError=/;

describe("the scan is looking at something", () => {
  it("finds the app's pages", () => {
    // 37 today. A floor, not an equality: new routes are expected, a collapse
    // to zero from a broken walk is not — and would make every rule below
    // pass over an empty list.
    expect(PAGES.length).toBeGreaterThanOrEqual(30);
  });

  it("finds pages for both rules to judge", () => {
    expect(PAGES.filter((p) => RENDERS_EMPTY.test(p.source)).length).toBeGreaterThanOrEqual(15);
    expect(PAGES.filter((p) => RENDERS_GRID.test(p.source)).length).toBeGreaterThanOrEqual(8);
  });

  it("the failure pattern does not simply match every page", () => {
    // If it did, rule 1 would be vacuous. Login and welcome have no read query
    // to fail, so a pattern that matches them is matching prose.
    const matched = PAGES.filter((p) => DISTINGUISHES_FAILURE.test(p.source)).length;
    expect(matched).toBeLessThan(PAGES.length);
  });
});

describe("a page that can render an empty state can also render a failure", () => {
  const subjects = PAGES.filter((p) => RENDERS_EMPTY.test(p.source));

  it.each(subjects.map((p) => [p.label, p] as const))("%s", (_label, page) => {
    expect(DISTINGUISHES_FAILURE.test(page.source)).toBe(true);
  });
});

/**
 * RULE 3 — the mirror of rule 1, and it was the missing half.
 *
 * Rule 1 asks: a page that can say "there is nothing here" must also be able
 * to say "the request failed". Nothing asked the converse, and three pages sat
 * in exactly that gap — `actors`, `organizations`, `realms` each rendered
 * `<QueryError` and a skeleton and had **no empty state at all**
 * (`grep -c EmptyState` was 0 on all three), so a query that SUCCEEDED with
 * zero rows produced a heading over blank space and said nothing.
 *
 * `PageError.tsx:59` had already written half of this down — "organizations
 * was worse still: no empty state either" — and that round added the error
 * branch and left the observation unacted on. A sentence in a docstring is not
 * a check; this is.
 *
 * THREE WAYS TO SAY IT, because there are three shapes of absence here and the
 * rule is about the statement, not the component:
 *   - `<EmptyState` / `empty={` — a list route with nothing in it;
 *   - `<DataTable` / `<DataGrid` — the grid renders its own empty row;
 *   - `not_found` / `notFound` — a DETAIL route, where "nothing" means the one
 *     record does not exist. `app/workflow/[id]` is the only subject today
 *     that qualifies this way, and it is not an exemption by path: a route
 *     that fetches one record has no empty-list state to render, and saying
 *     "not found" is the true sentence rather than a way around the rule.
 */
const NAMES_ABSENCE = /<EmptyState|empty=\{|<DataTable|<DataGrid|not_found|notFound/;

describe("a page that can say the request failed can also say there is nothing here", () => {
  const subjects = PAGES.filter((p) => /<QueryError/.test(p.source));

  it("finds pages to judge", () => {
    // 16 today. A floor: the rule must not quietly become vacuous by the
    // subject list collapsing.
    expect(subjects.length).toBeGreaterThanOrEqual(12);
  });

  it("the absence pattern does not simply match every page", () => {
    const matched = PAGES.filter((p) => NAMES_ABSENCE.test(p.source)).length;
    expect(matched).toBeLessThan(PAGES.length);
  });

  it.each(subjects.map((p) => [p.label, p] as const))("%s", (_label, page) => {
    expect(NAMES_ABSENCE.test(page.source)).toBe(true);
  });
});

describe("a page that renders a data grid tells it when the query failed", () => {
  // DataTable is the one that gets this right on its own: it renders a
  // distinct error row and, at data-table.tsx:144, computes
  // `isEmpty = !isLoading && !isError && !data?.length`, so the error
  // suppresses the empty state. All of that is dead unless the page passes the
  // prop — `app/dashboard/page.tsx` did not, and showed "no data" in a table
  // beside a chart that said the load had failed.
  const subjects = PAGES.filter((p) => RENDERS_GRID.test(p.source));

  it.each(subjects.map((p) => [p.label, p] as const))("%s", (_label, page) => {
    expect(PASSES_IS_ERROR.test(page.source)).toBe(true);
  });
});
