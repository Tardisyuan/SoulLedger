import { test, expect, setupAuthenticatedPage, seedAuthState, TEST_USER, OPENED_JUDGMENT, SOULS } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 2026-10-10 一轮合进来的四块界面,此前没有任何 E2E:审判评议区、通知批量条、权限页导入配置(第 2 步预演)、
 * 灵魂详情右栏案号与「全部 N 场 ›」。三个 project 都跑,mobile-chrome 是 393 宽,所以每条末尾都断言
 * 文档没有横向溢出。
 */

async function noHorizontalOverflow(page: Page) {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(client);
}

const comment = (n: number, body: string) => ({
  id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`,
  author: "1",
  author_name: "测试管理员",
  body,
  created_at: `2026-10-10T0${n}:00:00Z`,
});

test.describe("审判评议区", () => {
  test("opens on the latest three of five, expands the rest, and posts a new one", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const rows = [1, 2, 3, 4, 5].map((n) => comment(n, `第${n}条评议`));
    api.on("GET", "/judgment/:id/comments/", () => ({ body: rows }));
    api.on("POST", "/judgment/:id/comments/", (call) => {
      const row = comment(6, call.body.body);
      rows.push(row);
      return { body: row };
    });

    await page.goto(`/judgment/${OPENED_JUDGMENT.id}`);
    const section = page.getByTestId("judgment-comments");
    await expect(section.getByRole("button", { name: /评议 · 5/ })).toHaveAttribute("aria-expanded", "true");
    // Oldest first, only the last three shown.
    await expect(section.getByText("第3条评议")).toBeVisible();
    await expect(section.getByText("第5条评议")).toBeVisible();
    await expect(section.getByText("第2条评议")).toHaveCount(0);

    await section.getByTestId("comments-show-rest").click();
    await expect(section.getByText("第1条评议")).toBeVisible();

    await section.getByLabel("写评议").fill("新的评议");
    await section.getByRole("button", { name: "发表" }).click();
    await expect.poll(() => api.lastCall("POST", "/judgment/:id/comments/")?.body).toEqual({ body: "新的评议" });
    await expect(section.getByText("新的评议")).toBeVisible();
    await expect(section.getByLabel("写评议")).toHaveValue("");
    await noHorizontalOverflow(page);
  });
});

test.describe("通知批量条", () => {
  test("two selected rows are marked read in one request", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const row = (id: number, title: string) => ({
      id, title, message: "m", notification_type: "SYSTEM", is_read: false,
      related_resource: null, related_id: null, created_at: "2026-10-10T01:00:00Z", request_context: null,
    });
    const results = [row(11, "通知甲"), row(12, "通知乙"), row(13, "通知丙")];
    api.on("GET", "/notifications/", { count: 3, next: null, previous: null, results });
    api.on("POST", "/notifications/batch-read/", { marked_read: 2 });

    await page.goto("/notifications");
    await expect(page.getByText("通知乙").first()).toBeVisible();
    await page.getByRole("checkbox", { name: "选择通知:通知甲" }).check();
    await page.getByRole("checkbox", { name: "选择通知:通知乙" }).check();

    const bar = page.getByRole("region", { name: "通知批量操作" });
    await expect(bar).toContainText("已选 2 条");
    await bar.getByRole("button", { name: "标为已读" }).click();
    await expect.poll(() => api.lastCall("POST", "/notifications/batch-read/")?.body).toEqual({ ids: [11, 12] });
    await expect(page.getByText("已标记 2 条为已读")).toBeVisible();
    await expect(bar).toHaveCount(0);
    await noHorizontalOverflow(page);
  });
});

test.describe("权限页导入配置", () => {
  test("a file goes to the dry-run summary (step 2) and Back returns to step 1", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const section = { created: 1, skipped: 0 };
    api.on("POST", "/perm/import/", {
      message: "dry run",
        overwrite_enabled: false,
        stats: {
          permissions: section, roles: { created: 0, skipped: 0 }, role_permissions: { created: 0, skipped: 1 },
          field_permissions: { created: 0, skipped: 0 }, role_data_scopes: { created: 0, skipped: 0 },
          skipped_details: [{ section: "role_permissions", key: "GUARDIAN:soul.read", reason: "already_exists" }],
          updated: 0, removed: { role_permissions: 0, field_permissions: 0, role_data_scopes: 0, total: 0 },
          removes_own_permissions: false,
        },
    });
    // 导入是写:只给没绑殿的 ADMIN(2026-10-29,CanWriteGlobalSettings);TEST_USER 绑着殿。
    await seedAuthState(page, { ...TEST_USER, tenant: null });

    await page.goto("/permissions");
    await page.getByTestId("app-content").getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "导入配置…" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("导入配置 · 1/3");
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "permissions_CN_DIYU.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ permissions: [{ codename: "x.read", name: "x" }] })),
    });
    await dialog.getByRole("button", { name: "下一步" }).click();

    await expect(dialog).toContainText("导入配置 · 2/3");
    await expect(dialog).toContainText("permissions_CN_DIYU.json");
    await expect(dialog).toContainText("将新增");
    // A dry run: the request says so, and nothing was applied.
    expect(api.lastCall("POST", "/perm/import/")?.body).toMatchObject({ dry_run: true, overwrite: false });
    expect(api.countOf("POST", "/perm/import/")).toBe(1);
    await noHorizontalOverflow(page);

    await dialog.getByRole("button", { name: "上一步" }).click();
    await expect(dialog).toContainText("导入配置 · 1/3");
  });
});

test.describe("灵魂详情右栏案号", () => {
  test("shows the open case with 全部 N 场 ›, which opens the judgment list filtered to the soul", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    const closed = { ...OPENED_JUDGMENT, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", case_number: "CN-2026-0000", verdict: "HEAVEN", is_final: true };
    api.on("GET", "/judgment/", (call) => {
      const results = call.query.soul === SOULS[0].id ? [OPENED_JUDGMENT, closed] : [];
      return { body: { count: results.length, next: null, previous: null, results } };
    });

    await page.goto(`/souls/${SOULS[0].id}`);
    const caseRef = page.locator("[data-case-ref]");
    await expect(caseRef).toContainText(OPENED_JUDGMENT.case_number);
    await expect(caseRef).toContainText("未结");
    await noHorizontalOverflow(page);

    await caseRef.locator("[data-case-all]").click();
    await expect(page).toHaveURL(`/judgment?soul=${SOULS[0].id}`);
    await expect
      .poll(() => api.calls.some((c) => c.method === "GET" && c.path === "/judgment/" && c.query.soul === SOULS[0].id))
      .toBe(true);
    await noHorizontalOverflow(page);
  });
});
