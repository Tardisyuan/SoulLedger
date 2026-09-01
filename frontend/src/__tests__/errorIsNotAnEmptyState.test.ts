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
 */
const DISTINGUISHES_FAILURE =
  /<QueryError|role="alert"|data-query-error|isError=|isError\s*\?|isError\s*&&|!isError|if \(isError\)|if \(error\)/;

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
