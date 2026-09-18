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
    await expect(thread.locator("li[data-event-id]").last()).toContainText("殿司 · 测试管理员");

    await thread.getByLabel("以殿司名义回复").fill("已受理");
    await thread.getByRole("button", { name: "发送" }).click();
    await expect.poll(() => api.lastCall("POST", "/chat/inbox/:id/reply/")?.body).toEqual({ body: "已受理" });
  });
});
