import {
  test,
  expect,
  domainEnum,
  setupAuthenticatedPage,
  HANDLED_CONTENT,
  MODERATED_POSTS,
  MODERATION_REPORTS,
  SENSITIVE_WORDS,
} from "./fixtures";

/**
 * /moderation against the route mock, as ADMIN (fixtures.ts TEST_USER): the
 * four segments 举报 / 敏感词 / 禁言 / 已处理 (C 组 08, E 组 08b–d). ADMIN
 * short-circuits every codename, so withholding `social.moderate` is pinned in
 * the jest suite (ModerationPage.test.tsx).
 */

test.describe("Circle moderation", () => {
  test("举报: the review detail shows the full post; H needs a reason, then hides through the report", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/moderation");

    await expect(page.locator("h1")).toContainText("朋友圈审核");
    const item = page.locator(`li[data-review-key="report:${MODERATION_REPORTS[0].id}"]`);
    await expect(item).toContainText("这是一条被举报的帖子");
    await expect(item).toContainText("举报 3");

    const detail = page.getByRole("region", { name: "审阅详情" });
    await item.getByRole("button").click();
    await expect(detail).toContainText("全文比摘录长");
    await expect(domainEnum(detail, "ABUSE")).toHaveText("辱骂骚扰");
    await expect(detail.getByText("ABUSE", { exact: true })).toHaveCount(0);

    // H with an empty reason: refused on the page, nothing sent.
    await page.locator("body").press("h");
    await expect(detail.getByRole("alert")).toContainText("隐藏必须写理由");
    expect(api.countOf("POST", "/social-moderation/reports/:id/resolve/")).toBe(0);

    await detail.getByLabel("处理理由（隐藏必填）").fill("辱骂他人");
    await detail.getByRole("button", { name: /^隐藏/ }).click();
    await expect.poll(() => api.lastCall("POST", "/social-moderation/reports/:id/resolve/")?.body).toEqual({
      resolution: "HIDE",
      note: "辱骂他人",
    });
  });

  test("举报: a rule hit sits in the same queue; A lets it through", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/moderation");
    const hit = page.locator(`li[data-review-key="posts:${MODERATED_POSTS[0].id}"]`);
    await expect(hit).toContainText("规则命中 · 敏感词");
    await hit.getByRole("button").click();
    await expect(page.getByRole("region", { name: "审阅详情" })).toContainText("命中敏感词的帖子");
    await page.locator("body").press("a");
    await expect.poll(() => api.countOf("POST", "/social-moderation/posts/:id/approve/")).toBe(1);
  });

  test("敏感词: the inline row adds on Enter; deleting goes through the batch bar", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/moderation");
    await page.getByRole("button", { name: "敏感词", exact: true }).click();

    await page.getByLabel("类别", { exact: true }).selectOption("PRIVACY");
    await page.getByLabel("命中后", { exact: true }).selectOption("MASK");
    await page.getByLabel("敏感词", { exact: true }).fill("门牌号");
    await page.getByLabel("敏感词", { exact: true }).press("Enter");
    await expect.poll(() => api.lastCall("POST", "/social-moderation/sensitive-words/")?.body).toEqual({
      word: "门牌号",
      category: "PRIVACY",
      action: "MASK",
    });

    const row = page.locator("tr", { hasText: SENSITIVE_WORDS[0].word });
    await expect(row.getByRole("button")).toHaveCount(0);
    await row.getByRole("checkbox").check();
    await page.getByRole("button", { name: "删除所选" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("删除 1 个敏感词");
    await dialog.getByRole("button", { name: "删除所选" }).click();
    await expect.poll(() => api.lastCall("POST", "/social-moderation/sensitive-words/batch-delete/")?.body).toEqual({
      ids: [SENSITIVE_WORDS[0].id],
    });
  });

  test("禁言: the term is a meter; 解除禁言 asks first", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/moderation");
    await page.getByRole("button", { name: "禁言", exact: true }).click();
    await expect(page.getByRole("meter")).toHaveCount(1);
    await page.getByRole("button", { name: "解除禁言" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("灵魂端会收到通知");
    expect(api.countOf("POST", "/social-moderation/mutes/:id/lift/")).toBe(0);
    await dialog.getByRole("button", { name: "解除禁言" }).click();
    await expect.poll(() => api.countOf("POST", "/social-moderation/mutes/:id/lift/")).toBe(1);
  });

  test("已处理: a hidden row opens read-only with 恢复可见; a deleted one points at the recycle bin", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/moderation");
    await page.getByRole("button", { name: "已处理", exact: true }).click();

    await page.locator("tr", { hasText: "判词不公" }).getByRole("button").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText("判词不公，阎王只听殿司一面之词……全文。");
    await drawer.getByRole("button", { name: "恢复可见" }).click();
    await expect.poll(() => api.countOf("POST", "/social-moderation/posts/:id/restore/")).toBe(1);

    await page.locator("tr", { hasText: HANDLED_CONTENT[1].excerpt }).getByRole("button").click();
    const deleted = page.getByRole("dialog");
    await expect(deleted).toContainText("在回收站");
    await expect(deleted.getByRole("link", { name: /在回收站中管理/ })).toHaveAttribute("href", "/recycle-bin");
    await expect(deleted.getByRole("button", { name: "恢复可见" })).toHaveCount(0);
  });
});
