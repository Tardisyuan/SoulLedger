import { test, expect, setupAuthenticatedPage, SOULS } from "./fixtures";

/**
 * /souls batch bar (规范 v1 §3.1「有接口」): POST /souls/batch-recycle/, all
 * or nothing. As ADMIN (fixtures.ts TEST_USER), who holds `soul.delete`.
 */
test.describe("Souls batch recycle", () => {
  const bar = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "批量操作" });

  test("select two, confirm in the recycle-bin wording, and both ids are sent", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.goto("/souls");
    await page.getByRole("checkbox", { name: `选择「${SOULS[0].name}」` }).check();
    await page.getByRole("checkbox", { name: `选择「${SOULS[1].name}」` }).check();
    // Ticking a box does not follow the row link.
    await expect(page).toHaveURL(/\/souls$/);
    await expect(bar(page)).toContainText("已选 2");

    await bar(page).getByRole("button", { name: "移入回收站" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("将 2 个灵魂移入回收站？");
    await expect(dialog).toContainText("会移入回收站，不会真的抹去");
    expect(api.countOf("POST", "/souls/batch-recycle/")).toBe(0);
    await dialog.getByRole("button", { name: "移入回收站" }).click();

    await expect.poll(() => api.lastCall("POST", "/souls/batch-recycle/")?.body).toEqual({ ids: [SOULS[0].id, SOULS[1].id] });
    await expect(dialog).toBeHidden();
    await expect(bar(page)).toHaveCount(0);
  });

  test("a 409 names the refused soul, deletes nothing, keeps the selection", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    api.on("POST", "/souls/batch-recycle/", () => ({
      status: 409,
      body: { code: "not_deletable", error: "concluded", ids: [SOULS[1].id], archivable: true },
    }));
    await page.goto("/souls");
    await page.getByRole("checkbox", { name: `选择「${SOULS[0].name}」` }).check();
    await page.getByRole("checkbox", { name: `选择「${SOULS[1].name}」` }).check();
    await bar(page).getByRole("button", { name: "移入回收站" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "移入回收站" }).click();

    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText("一个都没有移入：1 个被拒绝");
    await expect(alert).toContainText("已有结案审判");
    const refused = alert.getByRole("list", { name: "被拒绝的灵魂" });
    await expect(refused).toContainText(SOULS[1].name);
    await expect(refused).not.toContainText(SOULS[0].name);
    await expect(bar(page)).toContainText("已选 2");
  });
});
