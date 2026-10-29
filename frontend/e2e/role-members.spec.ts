/**
 * 角色抽屉的「成员」页签(rbac-snowy 决定第 6 条;role-mgmt / impl-sec 遗留):从角色这一侧授一批人兼任、再移除,
 * 每一步看的都是服务端(有状态的 mock,`ApiMock.roleExtras`)回来的名单,不是本地草稿。主角色那一行移除按钮不可点。
 */
import { test, expect, seedAuthState, setupAuthenticatedPage, TEST_USER, type ApiMock } from "./fixtures";

test.describe("roles drawer: members tab", () => {
  let api: ApiMock;

  test.beforeEach(async ({ page }) => {
    api = await setupAuthenticatedPage(page);
    await seedAuthState(page, { ...TEST_USER, tenant: null });
    await page.goto("/permissions");
    await expect(page.getByRole("heading", { name: "权限矩阵" })).toBeVisible();
    await page.getByRole("button", { name: /^角色/ }).first().click();
  });

  const openMembers = async (page: import("@playwright/test").Page, role: string) => {
    await page.locator("tr", { hasText: role }).getByRole("button").first().click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("radiogroup", { name: "角色页签" }).getByRole("radio", { name: "成员" }).click();
    return drawer;
  };

  test("grant a holder as 兼任, see them listed from the server, then remove them", async ({ page }) => {
    const drawer = await openMembers(page, "GUARDIAN");
    await expect(drawer.getByText("没有人持有此角色。")).toBeVisible();

    await drawer.getByRole("button", { name: "批量授予" }).click();
    const picker = drawer.getByRole("form", { name: "批量授予" });
    await picker.getByRole("checkbox", { name: "test_judge" }).check();
    await picker.getByRole("button", { name: "授予 1 人" }).click();

    await expect.poll(() => api.lastCall("POST", "/perm/roles/:id/members/")?.body).toEqual({
      action: "add", kind: "extra", user_ids: [2],
    });
    await expect(page.getByText("已授予 1 人 · 对方刷新页面后生效")).toBeVisible();
    const list = drawer.getByRole("list", { name: "持有此角色的人" });
    const judge = list.locator('li[data-member="test_judge"]');
    await expect(judge).toBeVisible();
    await expect(judge).toContainText("兼任");
    await expect(list.locator('li[data-member="test_admin"]')).toHaveCount(0);

    await judge.getByRole("button", { name: "移除 test_judge 的兼任" }).click();
    await expect.poll(() => api.lastCall("POST", "/perm/roles/:id/members/")?.body).toEqual({
      action: "remove", kind: "extra", user_ids: [2],
    });
    await expect(page.getByText("已移除 1 人 · 对方刷新页面后生效")).toBeVisible();
    await expect(drawer.getByText("没有人持有此角色。")).toBeVisible();
    await expect(list.locator('li[data-member="test_judge"]')).toHaveCount(0);
  });

  test("a main-role holder is listed as 主角色 and cannot be removed here", async ({ page }) => {
    const drawer = await openMembers(page, "JUDGE");
    const judge = drawer.getByRole("list", { name: "持有此角色的人" }).locator('li[data-member="test_judge"]');
    await expect(judge).toContainText("主角色");
    await expect(judge).not.toContainText("兼任");
    await expect(judge.getByRole("button", { name: "移除 test_judge 的兼任" })).toBeDisabled();
  });
});
