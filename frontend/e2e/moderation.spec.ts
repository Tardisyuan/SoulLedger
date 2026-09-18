import {
  test,
  expect,
  domainEnum,
  setupAuthenticatedPage,
  MODERATED_POSTS,
  MODERATION_REPORTS,
  SOCIAL_MUTES,
} from "./fixtures";

/**
 * The soul circle moderation backend against the route mock, as ADMIN
 * (fixtures.ts TEST_USER). ADMIN short-circuits every codename, so withholding
 * `social.moderate` is pinned in the jest suite (ModerationPage.test.tsx).
 */

test.describe("Circle moderation", () => {
  test("a report shows its count and translated reason; muting sends the chosen days", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/moderation");

    await expect(page.locator("h1")).toContainText("朋友圈审核");
    const row = page.locator(`li[data-report-id="${MODERATION_REPORTS[0].id}"]`);
    await expect(row).toContainText("这是一条被举报的帖子");
    await expect(row).toContainText("3 人举报");
    await expect(domainEnum(row, "ABUSE")).toHaveText("辱骂骚扰");
    await expect(row.getByText("ABUSE", { exact: true })).toHaveCount(0);

    await page.getByLabel("禁言天数").selectOption("30");
    await row.getByRole("button", { name: /禁言/ }).click();
    await expect.poll(() => api.lastCall("POST", "/social-moderation/reports/:id/resolve/")?.body).toEqual({
      resolution: "MUTE",
      note: "",
      mute_days: 30,
    });
  });

  test("delete asks first", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/moderation");
    const row = page.locator(`li[data-report-id="${MODERATION_REPORTS[0].id}"]`);
    await row.getByRole("button", { name: "删除" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("删除这条内容");
    expect(api.countOf("POST", "/social-moderation/reports/:id/resolve/")).toBe(0);
    await dialog.getByRole("button", { name: "删除" }).click();
    await expect.poll(() => api.lastCall("POST", "/social-moderation/reports/:id/resolve/")?.body?.resolution).toBe("DELETE");
  });

  test("pending content, the word list and mutes each reach their endpoint", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/moderation");

    await page.getByRole("button", { name: "待审内容", exact: true }).click();
    const post = page.locator(`li[data-content-id="${MODERATED_POSTS[0].id}"]`);
    await expect(post).toContainText("命中敏感词的帖子");
    expect(api.lastCall("GET", "/social-moderation/posts/")?.query.moderation_status).toBe("PENDING");
    await post.getByRole("button", { name: "通过" }).click();
    await expect.poll(() => api.countOf("POST", "/social-moderation/posts/:id/approve/")).toBe(1);

    await page.getByRole("button", { name: "敏感词", exact: true }).click();
    await expect(page.getByText("违禁词", { exact: true })).toBeVisible();
    await page.getByLabel("敏感词", { exact: true }).fill("新词");
    await page.getByRole("button", { name: "添加" }).click();
    await expect.poll(() => api.lastCall("POST", "/social-moderation/sensitive-words/")?.body).toEqual({ word: "新词" });

    await page.getByRole("button", { name: "禁言", exact: true }).click();
    const mute = page.locator(`li[data-mute-id="${SOCIAL_MUTES[0].id}"]`);
    await mute.getByRole("button", { name: "解除禁言" }).click();
    await expect.poll(() => api.countOf("POST", "/social-moderation/mutes/:id/lift/")).toBe(1);
  });
});
