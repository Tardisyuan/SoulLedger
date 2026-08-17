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

test.describe("Workflow editor toolbar", () => {
  /**
   * `WorkflowTemplate.priority` in a real browser, end to end.
   *
   * `20994df` added the column, the toolbar `<select>` and Jest coverage for
   * the label, the three option strings, the default and the save payload —
   * but every one of those assertions runs against a jsdom tree that was never
   * navigated to, and the backend assertion starts from a hand-built POST. The
   * one thing nothing covered is the join: that the control actually renders
   * on /workflow behind the real router, middleware and lazy chunk, and that
   * what a user picks in it is what leaves the browser.
   *
   * That join is exactly where this column used to be lost — the editor sent a
   * body with no `priority` key at all, so the three `priority: 1` presets were
   * saved back as ordinary ones and nothing anywhere went red.
   *
   * No product code was changed to make this writable: the select is located by
   * the `aria-label` it already carries (`t("workflow.detail.priority")`), the
   * same key `app/workflow/[id]/page.tsx` labels `ApprovalWorkflow.priority`
   * with, so this test also fails if that shared label is forked.
   */
  test("priority select renders, offers exactly three tiers, and its choice reaches the POST body", async ({
    page,
  }) => {
    // The default mock has no POST handler for this path, so it would fall
    // through to the empty-page fallback and still 200. Answering 201 with the
    // echoed body is what the real WorkflowTemplateViewSet does.
    api.on("POST", "/workflow/templates/", (call) => ({
      status: 201,
      body: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ...call.body },
    }));

    await page.goto("/workflow");
    await page.getByRole("button", { name: "流程编辑器", exact: true }).click();

    const priority = page.getByLabel("优先级", { exact: true }).filter({ visible: true });
    await expect(priority).toBeVisible();

    // Three tiers, and each option's value paired with its own copy — a select
    // whose labels drifted off their values reads correctly and saves the wrong
    // number. `toHaveCount(3)` is the absence half: a fourth tier would have to
    // be a deliberate edit here, because 0/1/2 is the whole of the model column.
    await expect(priority.locator("option")).toHaveCount(3);
    for (const [value, label] of [["0", "普通"], ["1", "紧急"], ["2", "危急"]]) {
      await expect(priority.locator(`option[value="${value}"]`)).toHaveText(label);
    }

    // A fresh editor opens at the column's own floor.
    await expect(priority).toHaveValue("0");

    await page.getByLabel("模板名称", { exact: true }).filter({ visible: true }).fill("危急模板");
    await priority.selectOption("2");
    await expect(priority).toHaveValue("2");

    await page.getByRole("button", { name: "保存模板", exact: true }).click();

    await expect.poll(() => api.countOf("POST", "/workflow/templates/")).toBe(1);
    const body = api.lastCall("POST", "/workflow/templates/")!.body;

    // `toBe(2)`, not `toBe("2")`: the select hands back a string and
    // `WorkflowEditor` is what calls Number() on it. Dropping that conversion
    // would leave a payload DRF still coerces, so the type is the only place
    // the regression is visible — and 2 is neither the default (0) nor the
    // value any preset carries (1), so it can only have come from the click.
    expect(body.priority).toBe(2);
    expect(body.name).toBe("危急模板");

    // The save really was the create path, not a silent no-op that left the
    // editor's other fields behind.
    expect(body.case_type).toBe("ROUTINE");
    expect(body.civilization).toBe("CHINESE");
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
