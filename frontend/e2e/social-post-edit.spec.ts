import { test, expect, setupAuthenticatedPage, TEST_USER, type ApiMock } from "./fixtures";

/**
 * /social — 作者编辑自己的帖子(PATCH /social/posts/:id/,后端只认作者)。
 * 别人的帖子上没有「编辑」。
 */

const post = (n: number, author: number) => ({
  id: `c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c10${n}`,
  author,
  author_name: author === TEST_USER.id ? "测试管理员" : "梅瑞特",
  author_username: author === TEST_USER.id ? "test_admin" : "merit",
  content: `第 ${n} 条`,
  visibility: "PUBLIC",
  moderation_status: "PUBLISHED",
  edited_at: n === 1 ? "2026-10-02T09:00:00Z" : null,
  screening: null,
  comment_count: 0,
  reaction_count: 0,
  media: [],
  reaction_counts: { LIKE: 0, LOVE: 0, RESPECT: 0, SYMPATHY: 0, ETERNAL_LIGHT: 0 },
  create_time: "2026-10-01T09:00:00Z",
});

let api: ApiMock;

test.beforeEach(async ({ page }) => {
  api = await setupAuthenticatedPage(page);
  api.on("GET", "/social/posts/feed/", { count: 2, next: null, previous: null, results: [post(1, TEST_USER.id), post(2, 2)] });
  api.on("GET", "/social/follows/following/", []);
  api.on("GET", "/social/follows/followers/", []);
  api.on("GET", "/social/media/", { max_per_post: 9, max_pending: 18, max_bytes: 5242880 });
  api.on("PATCH", "/social/posts/:id/", (call) => ({ body: { ...post(1, TEST_USER.id), ...call.body } }));
});

test("作者改自己的帖子:只发改动的字段;别人的帖子没有编辑入口", async ({ page }) => {
  await page.goto("/social");
  const cards = page.locator("[data-post-card]");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1).getByRole("button", { name: "编辑" })).toHaveCount(0);
  await expect(cards.nth(0).locator("[data-edited]")).toHaveText("已编辑");
  await expect(cards.nth(1).locator("[data-edited]")).toHaveCount(0);

  await cards.nth(0).getByRole("button", { name: "编辑" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox")).toHaveValue("第 1 条");
  await expect(dialog.getByRole("button", { name: "保存" })).toBeDisabled();

  await dialog.getByRole("textbox").fill("改过的话");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => api.lastCall("PATCH", "/social/posts/:id/")?.body).toEqual({ content: "改过的话" });
  await expect(dialog).toHaveCount(0);
});
