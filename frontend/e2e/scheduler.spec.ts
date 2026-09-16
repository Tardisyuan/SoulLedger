import { test, expect, domainEnum, setupAuthenticatedPage, SCHEDULER_JOBS, SCHEDULER_RUNS } from "./fixtures";

/**
 * /scheduler against the route mock, as ADMIN (see fixtures.ts TEST_USER).
 * Permission withholding is not assertable here — ADMIN short-circuits every
 * codename — and is pinned in `src/__tests__/SchedulerPage.test.tsx` instead.
 */

const row = (page: import("@playwright/test").Page, id: number) => page.locator(`li[data-job-id="${id}"]`);

test.describe("Scheduler page", () => {
  test("lists jobs grouped global-first, then by tenant, with translated names and statuses", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto("/scheduler");

    await expect(page.locator("h1")).toContainText("定时任务");
    const groups = page.locator("section[data-group]");
    await expect(groups).toHaveCount(3);
    expect(await groups.evaluateAll((els) => els.map((el) => el.getAttribute("data-group")))).toEqual([
      "global",
      "tenant:CN_DIYU",
      "tenant:EU_HEAVEN_HELL",
    ]);
    await expect(groups.nth(1)).toContainText("租户 CN_DIYU");

    const failing = row(page, 2);
    await expect(failing).toContainText("重算功过格");
    await expect(failing).toContainText("每天 00:00");
    await expect(failing).toContainText("连续失败 2 次");
    // Translated copy in the text node, raw member only in `title`.
    await expect(domainEnum(failing, "FAILURE")).toHaveText("失败");
    await expect(failing.getByText("FAILURE", { exact: true })).toHaveCount(0);

    await expect(row(page, 3)).toContainText("已停用");
    await expect(page.getByRole("switch")).toHaveCount(SCHEDULER_JOBS.length);
  });

  test("filters to failing jobs, and collapses a group", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto("/scheduler");
    await expect(row(page, 1)).toBeVisible();

    await page.getByRole("button", { name: "连续失败", exact: true }).click();
    await expect(page.locator("li[data-job-id]")).toHaveCount(1);
    await expect(row(page, 2)).toBeVisible();

    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.locator('section[data-group="global"]').getByRole("button", { expanded: true }).click();
    await expect(row(page, 1)).toHaveCount(0);
    await expect(row(page, 2)).toBeVisible();
  });

  test("edits a schedule: preset fields, time zone, preview, and a PATCH carrying only the changes", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/scheduler");
    await row(page, 2).getByRole("button", { name: "编辑调度" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("频率")).toHaveValue("daily");
    await dialog.getByLabel("分钟", { exact: true }).fill("30");
    await dialog.getByLabel("时区", { exact: true }).selectOption("Asia/Shanghai");
    await expect(dialog.getByTestId("cron-preview").locator("li")).toHaveCount(3);

    // The raw text follows the preset, and a raw edit that leaves the preset's
    // shape turns the selector to custom.
    await dialog.getByRole("button", { name: "高级：直接编辑 cron" }).click();
    await expect(dialog.getByLabel("分", { exact: true })).toHaveValue("30");
    await dialog.getByLabel("周", { exact: true }).fill("1-5");
    await expect(dialog.getByLabel("频率")).toHaveValue("custom");
    await dialog.getByLabel("周", { exact: true }).fill("*");
    await expect(dialog.getByLabel("频率")).toHaveValue("daily");

    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden();
    expect(api.lastCall("PATCH", "/scheduler/jobs/:id/")?.path).toBe("/scheduler/jobs/2/");
    expect(api.lastCall("PATCH", "/scheduler/jobs/:id/")?.body).toEqual({ minute: "30", timezone: "Asia/Shanghai" });
    await expect(page.getByText("调度已保存")).toBeVisible();
  });

  test("shows a 400 cron error beside the cron fields and keeps the dialog open", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("PATCH", "/scheduler/jobs/:id/", () => ({ status: 400, body: { cron: ["invalid crontab: Invalid end range: 61 > 59."] } }));
    await page.goto("/scheduler");
    await row(page, 2).getByRole("button", { name: "编辑调度" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("分钟", { exact: true }).fill("15");
    await dialog.getByRole("button", { name: "保存" }).click();

    await expect(dialog.getByRole("alert").filter({ hasText: "invalid crontab" })).toBeVisible();
    await expect(dialog.getByLabel("分", { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("runs a job now after confirming, and reports a held lock as such", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/scheduler");

    await row(page, 2).getByRole("button", { name: "立即运行" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("重算功过格");
    expect(api.countOf("POST", "/scheduler/jobs/:id/run/")).toBe(0);
    await confirm.getByRole("button", { name: "立即运行" }).click();
    await expect(page.getByText("已入队，运行状态会自动刷新")).toBeVisible();
    expect(api.lastCall("POST", "/scheduler/jobs/:id/run/")?.path).toBe("/scheduler/jobs/2/run/");

    api.on("POST", "/scheduler/jobs/:id/run/", () => ({ status: 409, body: { detail: "a run of this job is already in progress" } }));
    await row(page, 1).getByRole("button", { name: "立即运行" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "立即运行" }).click();
    await expect(page.getByText("已有一次运行在进行中，请等它结束后再试")).toBeVisible();
  });

  test("opens run history in a drawer: filtered by job, status filter, expandable error, Escape closes", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/scheduler");
    await row(page, 2).getByRole("button", { name: "执行记录" }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText("执行记录 · 重算功过格");
    await expect(drawer.locator("[data-run-status]")).toHaveCount(SCHEDULER_RUNS.length);
    expect(api.lastCall("GET", "/scheduler/runs/")?.query).toMatchObject({ job: "2", page: "1" });

    const failure = drawer.locator('[data-run-status="FAILURE"]');
    await expect(failure.getByText(/ValueError: ledger row 42/)).toHaveCount(0);
    await failure.getByRole("button", { name: "展开错误" }).click();
    await expect(failure.getByText(/ValueError: ledger row 42 has no soul/)).toBeVisible();

    await drawer.getByLabel("状态").selectOption("FAILURE");
    await expect.poll(() => api.lastCall("GET", "/scheduler/runs/")?.query.status).toBe("FAILURE");

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("the manual refresh button refetches the job list", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/scheduler");
    await expect(row(page, 1)).toBeVisible();
    const before = api.countOf("GET", "/scheduler/jobs/");
    await page.getByRole("button", { name: "刷新" }).click();
    await expect.poll(() => api.countOf("GET", "/scheduler/jobs/")).toBeGreaterThan(before);
  });
});
