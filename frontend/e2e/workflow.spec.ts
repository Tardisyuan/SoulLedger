import { test, expect, type Page } from "@playwright/test";
import { domainEnum, setupAuthenticatedPage, WORKFLOW_INSTANCE, type ApiMock } from "./fixtures";

/**
 * Text locators here must be filtered to the visible match.
 *
 * While the Next dev server is still compiling a route it streams the subtree
 * into a `<div hidden>` parked on <body> and only grafts it into place once the
 * chunk lands. Until then the same text exists twice in the DOM, and a bare
 * getByText() resolves to two elements -> strict mode violation. It is a race,
 * so it fails intermittently on every engine (measured: chromium 7-8 times in
 * 42 runs), not just the slow ones. Filtering to `visible` drops the parked
 * copy, which is inert by definition.
 */
const seen = (page: Page, text: string) => page.getByText(text).filter({ visible: true });
const heading = (page: Page, name: string) =>
  page.getByRole("heading", { name }).filter({ visible: true });

/**
 * /workflow — the approval-template screen.
 *
 * Every test in this file used to run unauthenticated, so middleware.ts
 * redirected each one to /login and they all asserted against the login
 * page's <body>. They now authenticate first (see fixtures.ts) and assert on
 * the template list, the preview pane and the instances tab.
 */

let api: ApiMock;

test.beforeEach(async ({ page }) => {
  api = await setupAuthenticatedPage(page);
});

test.describe("Workflow page", () => {
  test("renders the header and all three tabs for an authenticated user", async ({ page }) => {
    await page.goto("/workflow");

    // Reaching the page at all is the first real assertion — unauthenticated
    // this URL is a redirect to /login.
    await expect(page).toHaveURL(/\/workflow$/);
    await expect(page.locator("h1").filter({ visible: true })).toContainText("审批流程");

    for (const tab of ["现有流程", "流程编辑器", "审批实例"]) {
      await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
    }
  });

  test("previews the default predefined template with its full node list", async ({ page }) => {
    await page.goto("/workflow");

    await expect(seen(page, "预定义模板")).toBeVisible();

    // CHINESE_ROUTINE is the initial selection (page.tsx:91) and has ten
    // nodes, one per court of the Chinese underworld.
    await expect(heading(page, "十殿审判流程")).toBeVisible();
    await expect(seen(page, "10 个节点")).toBeVisible();
    await expect(seen(page, "秦广王 · 分流")).toBeVisible();
    await expect(seen(page, "转轮王 · 终审")).toBeVisible();
  });

  test("selecting a different template swaps the preview", async ({ page }) => {
    await page.goto("/workflow");
    await expect(heading(page, "十殿审判流程")).toBeVisible();

    await page.getByRole("button", { name: "申诉审判流程", exact: true }).click();

    await expect(heading(page, "申诉审判流程")).toBeVisible();
    await expect(heading(page, "十殿审判流程")).toHaveCount(0);
  });

  test("instances tab lists the workflows returned by the API", async ({ page }) => {
    await page.goto("/workflow");

    await page.getByRole("button", { name: "审批实例", exact: true }).click();

    await expect(seen(page, WORKFLOW_INSTANCE.workflow_name)).toBeVisible();
    await expect(seen(page, WORKFLOW_INSTANCE.soul)).toBeVisible();

    // The row's meta line is `<DomainEnum case_type> · <soul>`. Asserting the
    // enum through `title` rather than either the raw member or one locale's
    // copy — see domainEnum() in fixtures.ts for why.
    await expect(domainEnum(page, WORKFLOW_INSTANCE.case_type)).toBeVisible();
    // The §4.6 regression guard: the raw member must never reach the user.
    await expect(page.getByText(WORKFLOW_INSTANCE.case_type, { exact: true })).toHaveCount(0);

    expect(api.countOf("GET", "/workflows/")).toBeGreaterThan(0);
  });

  test("empty instances list shows the empty state, not a blank pane", async ({ page }) => {
    api.on("GET", "/workflows/", { count: 0, next: null, previous: null, results: [] });
    await page.goto("/workflow");

    await page.getByRole("button", { name: "审批实例", exact: true }).click();
    await expect(seen(page, "暂无审批实例")).toBeVisible();
  });

  test("a 500 on the instances list renders no rows and does not crash the tab", async ({ page }) => {
    api.on("GET", "/workflows/", () => ({ status: 500, body: { detail: "boom" } }));
    await page.goto("/workflow");

    await page.getByRole("button", { name: "审批实例", exact: true }).click();

    // Known gap, pinned deliberately: this tab has no error state, so a
    // failed load is indistinguishable from "no instances". What must hold
    // either way is that no fabricated row appears and the page still works.
    await expect(seen(page, WORKFLOW_INSTANCE.workflow_name)).toHaveCount(0);
    await expect(seen(page, "暂无审批实例")).toBeVisible();
    await page.getByRole("button", { name: "现有流程", exact: true }).click();
    await expect(heading(page, "十殿审判流程")).toBeVisible();
  });
});

test.describe("Workflow page health", () => {
  test("loads without an uncaught exception", async ({ page }) => {
    // pageerror fires only for uncaught exceptions, so this cannot be muted
    // by network noise the way a console-error filter can.
    const crashes: string[] = [];
    page.on("pageerror", (err) => crashes.push(err.message));

    await page.goto("/workflow");
    await expect(heading(page, "十殿审判流程")).toBeVisible();

    expect(crashes).toEqual([]);
  });
});
