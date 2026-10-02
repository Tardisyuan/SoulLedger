import { test, expect, setupAuthenticatedPage, type ApiMock } from "./fixtures";

/**
 * /social — 官员帖子的配图(2026-10-02:官员也能发图)。
 *
 * 签名取图地址是 API 路径,JSON mock 会答它;这里用 page.route 发真像素,
 * 并让带 `t=stale` 的地址答 404 —— 服务端对过期 / 无权 / 已删一律 404(media_views.py)。
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const img = (post: number, i: number, t = "ok") => ({
  id: `p${post}m${i}`,
  url: `/api/v1/social-media/p${post}m${i}/?t=${t}`,
  width: 1200,
  height: 800,
});

function post(n: number, media: ReturnType<typeof img>[]) {
  return {
    id: `c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c00${n}`,
    author: 2,
    author_name: "梅瑞特",
    author_username: "merit",
    content: `第 ${n} 条:${media.length} 张图`,
    visibility: "TENANT",
    comment_count: 0,
    reaction_count: 0,
    media,
    create_time: "2026-10-01T09:00:00Z",
  };
}

function page1(stale: boolean) {
  return {
    count: 3,
    next: null,
    previous: null,
    results: [
      post(1, [img(1, 0, stale ? "stale" : "fresh")]),
      post(2, [0, 1, 2, 3].map((i) => img(2, i))),
      post(3, [0, 1, 2, 3, 4, 5, 6].map((i) => img(3, i))),
    ],
  };
}

let api: ApiMock;
let feedCalls = 0;

test.beforeEach(async ({ page }) => {
  api = await setupAuthenticatedPage(page);
  feedCalls = 0;
  api.on("GET", "/social/posts/feed/", () => ({ body: page1(feedCalls++ === 0) }));
  // 这两个 @action 回裸数组(views.py `following` / `followers`);默认的空页对象会让 FollowPanel 崩。
  api.on("GET", "/social/follows/following/", []);
  api.on("GET", "/social/follows/followers/", []);
  api.on("GET", "/social/media/", { max_per_post: 9, max_pending: 18, max_bytes: 5242880 });
  await page.route("**/api/v1/social-media/**", (route) =>
    route.request().url().includes("t=stale")
      ? route.fulfill({ status: 404, body: "" })
      : route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
});

test("帖子按 1 / 4 / 7 张画方格,7 张的末格叠 +N,点开查看器能切换", async ({ page, isMobile }) => {
  await page.goto("/social");
  const grids = page.locator("[data-media-grid]");
  await expect(grids).toHaveCount(3);
  await expect(grids.nth(1).locator("[data-media-cell]")).toHaveCount(4);
  // 1440:两列排前四格、第四格 +3;393:三列排前六格、第六格 +1。
  const [cells, more] = isMobile ? [6, "+1"] : [4, "+3"];
  await expect(grids.nth(2).locator("[data-media-cell]:visible")).toHaveCount(cells);
  await expect(grids.nth(2).locator("[data-media-more] span:visible")).toHaveText(more);

  await grids.nth(2).locator("[data-media-cell]").nth(1).getByRole("button").click();
  const viewer = page.locator("[data-media-viewer]");
  await expect(viewer.getByTestId("viewer-position")).toHaveText("2 / 7");
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByTestId("viewer-position")).toHaveText("3 / 7");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("签名过期的那张:虚线格「链接已过期」,不留破图;「重新获取」拿新地址", async ({ page }) => {
  await page.goto("/social");
  const first = page.locator("[data-media-grid]").first();
  await expect(first.locator("[data-media-expired]")).toContainText("链接已过期");
  await expect(first.locator("img")).toHaveCount(0);

  const before = api.countOf("GET", "/social/posts/feed/");
  await first.getByRole("button", { name: /重新获取|重取/ }).click();
  await expect.poll(() => api.countOf("GET", "/social/posts/feed/")).toBeGreaterThan(before);
  const image = first.locator("img");
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(first.locator("[data-media-expired]")).toHaveCount(0);
});

test("发帖框:「最多 9 张」来自后端;传图、移除、发帖带上剩下那张的 id", async ({ page, isMobile }) => {
  test.skip(isMobile, "393 下发帖框在悬浮按钮打开的弹窗里,流程同一个组件");
  let n = 0;
  api.on("POST", "/social/media/", () => {
    n += 1;
    const id = `d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d00${n}`;
    return { status: 201, body: { id, url: `/api/v1/social-media/${id}/?t=ok`, width: 1, height: 1, byte_size: 70, content_type: "image/png" } };
  });
  api.on("DELETE", "/social/media/:id/", { status: 204, body: null });
  api.on("POST", "/social/posts/", (call) => ({ status: 201, body: { id: "e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e001", ...call.body } }));

  await page.goto("/social");
  const composer = page.locator("[data-post-composer]");
  await expect(composer.locator("[data-media-limit]")).toHaveText("最多 9 张");
  await composer.getByTestId("composer-media-input").setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: PNG },
    { name: "b.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(composer.locator('[data-attachment="done"]')).toHaveCount(2);
  await composer.locator("[data-attachment]").first().getByRole("button", { name: /移除/ }).click();
  await expect(composer.locator("[data-attachment]")).toHaveCount(1);
  await expect.poll(() => api.countOf("DELETE", "/social/media/:id/")).toBe(1);

  await composer.getByRole("button", { name: "发布" }).click();
  await expect.poll(() => api.lastCall("POST", "/social/posts/")?.body).toEqual({
    content: "",
    visibility: "PUBLIC",
    media: ["d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d002"],
  });
});
