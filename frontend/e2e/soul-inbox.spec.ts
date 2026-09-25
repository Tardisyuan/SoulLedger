import { test, expect, setupAuthenticatedPage, INBOX_CONVERSATIONS } from "./fixtures";

/**
 * The hall inbox against the route mock, as ADMIN (fixtures.ts TEST_USER).
 * ADMIN short-circuits every codename, so withholding `soul_inbox.read` /
 * `soul_inbox.reply` is pinned in the jest suite (SoulInboxPage.test.tsx).
 */

test.describe("Hall inbox", () => {
  test("a letter opens oldest first and a reply reaches the endpoint", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/soul-inbox");

    await expect(page.locator("h1")).toContainText("殿司收件箱");
    await page.locator(`button[data-conversation-id="${INBOX_CONVERSATIONS[0].id}"]`).click();
    const thread = page.getByRole("region", { name: "与 写信的灵魂 的来往" });
    await expect(thread.locator("li[data-event-id]")).toHaveCount(2);
    await expect(thread.locator("li[data-event-id]").first()).toContainText("我想申诉这次判决");
    await expect(thread.locator("li[data-event-id]").last()).toContainText("第五殿 · 判官 测试管理员");

    await thread.getByLabel("以殿司名义回复").fill("已受理");
    await thread.getByRole("button", { name: "发送" }).click();
    await expect.poll(() => api.lastCall("POST", "/chat/inbox/:id/reply/")?.body).toEqual({ body: "已受理" });
  });

  test("three columns on a desktop; at 393 the folders are a dropdown and the thread sits under the list", async ({ page }) => {
    await setupAuthenticatedPage(page);
    const row = () => page.locator(`button[data-conversation-id="${INBOX_CONVERSATIONS[0].id}"]`);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/soul-inbox");
    await row().click();
    const folders = page.getByRole("navigation", { name: "文件夹" });
    await expect(folders).toBeVisible();
    const thread = page.getByRole("region", { name: "与 写信的灵魂 的来往" });
    const [f, l, t] = [await folders.boundingBox(), await row().boundingBox(), await thread.boundingBox()];
    expect(f!.x + f!.width).toBeLessThanOrEqual(l!.x + 1);
    expect(l!.x + l!.width).toBeLessThanOrEqual(t!.x + 1);

    await page.setViewportSize({ width: 393, height: 851 });
    await expect(folders).toBeHidden();
    await expect(page.getByRole("combobox", { name: "文件夹" })).toBeVisible();
    const [l2, t2] = [await row().boundingBox(), await thread.boundingBox()];
    expect(t2!.y).toBeGreaterThanOrEqual(l2!.y + l2!.height - 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
