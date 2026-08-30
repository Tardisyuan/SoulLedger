/**
 * A failed request must not present itself as "there is nothing here".
 *
 * Nine pages had no error branch at all. A 500 produced an empty array, which
 * fell through to the empty state, so **"the server is down" and "there is
 * nothing here" rendered the same words**. Measured 2026-08-29 by loading each
 * page twice against the same fixture -- once returning 500, once returning an
 * empty list -- and comparing the page text: identical, character for
 * character.
 *
 * Three of the nine destructured `error` from `useQuery` and never read it.
 * `/organizations` was worse: no empty state either, so a failure rendered a
 * heading and nothing else.
 *
 * WHY THIS IS AN E2E TEST. The distinction is "what does the user see", and
 * the two states differ only in rendered output. A unit test would have to
 * assert on a component's props, which is the level at which these nine pages
 * were already "correct" -- every one of them called useQuery properly and
 * then ignored half its result.
 *
 * The assertion compares the two renderings to each other rather than looking
 * for particular copy. Matching on a phrase would pass the moment someone
 * changed the empty-state wording, and the property is that they *differ*.
 */
import { expect, test } from "@playwright/test";

import { setupAuthenticatedPage } from "./fixtures";

/** Route, and the endpoint whose failure the page must not hide.
 *
 * RegExp rather than a glob. `fetchAllPages` builds its URL as
 * `${base}${path}?${params}`, so the realms/actors/organizations requests end
 * in a bare question mark, and the glob form of these patterns did not match
 * that. Three of the eight tests then "passed" against a page whose request
 * was never intercepted at all -- green because nothing happened.
 *
 * (The glob patterns are not written out here on purpose: a doubled asterisk
 * followed by a slash closes a block comment, which is how this file briefly
 * stopped compiling.)
 */
const PAGES: { path: string; endpoint: RegExp }[] = [
  { path: "/tenants", endpoint: /\/api\/v1\/tenants\// },
  { path: "/cross-judgments", endpoint: /\/api\/v1\/dispatch\/cross-tenant-judgments\// },
  { path: "/notifications", endpoint: /\/api\/v1\/notifications\// },
  { path: "/realms", endpoint: /\/api\/v1\/realms\// },
  { path: "/actors", endpoint: /\/api\/v1\/actors\// },
  { path: "/organizations", endpoint: /\/api\/v1\/organizations\// },
  { path: "/death-sync", endpoint: /\/api\/v1\/death-sync\/registrations\// },
  { path: "/social/follows", endpoint: /\/api\/v1\/social\/follows\// },
];

async function bodyTextWith(
  page: import("@playwright/test").Page,
  path: string,
  endpoint: RegExp,
  respond: "empty" | "error"
) {
  // QueryProvider sets `retry: 1`, so a failing query is only *decided* after
  // two attempts. Counting them is how this waits for the outcome instead of
  // for a wall-clock guess -- reading the body before the retry settled gave
  // the same text for both states and made the comparison below vacuous.
  let attempts = 0;
  await page.route(endpoint, async (route) => {
    attempts += 1;
    if (respond === "error") {
      await route.fulfill({ status: 500, body: "{}" });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
      });
    }
  });
  await page.goto(path);
  // `networkidle` alone was not enough: the first version of this helper read
  // the body while the shell was still mounting and got the bare "SoulLedger"
  // for both states, so the comparison was between two identical blanks and
  // the test "passed" for /tenants while telling me nothing. Wait for a
  // control the shell always renders, then read.
  await page.getByRole("button", { name: /登出|Log ?out/i }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const wanted = respond === "error" ? 2 : 1;
  await expect
    .poll(() => attempts, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(wanted);
  // One frame for the state change to render.
  await page.waitForTimeout(250);
  const text = (await page.locator("body").innerText()).trim();
  await page.unroute(endpoint);
  return text;
}

for (const { path, endpoint } of PAGES) {
  test(`${path} says something different when the request fails`, async ({ page }) => {
    await setupAuthenticatedPage(page);

    const empty = await bodyTextWith(page, path, endpoint, "empty");
    const failed = await bodyTextWith(page, path, endpoint, "error");

    // Prove the page actually rendered before comparing. Without this, two
    // un-rendered shells compare equal-and-non-empty and the assertion below
    // is measuring nothing.
    expect(empty.length).toBeGreaterThan(40);
    expect(failed.length).toBeGreaterThan(40);
    expect(failed).not.toBe(empty);
  });
}

test("the failed state offers a way to try again", async ({ page }) => {
  await setupAuthenticatedPage(page);
  await page.route(/\/api\/v1\/realms\//, (route) =>
    route.fulfill({ status: 500, body: "{}" })
  );
  await page.goto("/realms");
  // `role="alert"` rather than a class or a phrase: it is what a screen reader
  // announces, and it is the part of this that is a contract.
  await expect(page.getByRole("alert")).toBeVisible();
});
