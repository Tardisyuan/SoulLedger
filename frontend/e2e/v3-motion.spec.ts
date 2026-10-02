import { test, expect, setupAuthenticatedPage, SOULS } from "./fixtures";

/**
 * 规范 v3「页面切换」与「表格交互 · 展开」在真浏览器里跑起来了没有。jsdom 不算 CSS 动画,
 * `motionTokens.test.ts` 只能读源码文本;这里听 `animationstart`,读计算后的时长。
 */

async function recordAnimations(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    (window as unknown as { __anims: string[] }).__anims = [];
    document.addEventListener("animationstart", (e) => (window as unknown as { __anims: string[] }).__anims.push(e.animationName), true);
  });
}
const started = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __anims: string[] }).__anims);

test.describe("v3 motion", () => {
  test("list → detail inside /souls replays the page transition (240ms) without a full load", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto("/souls");
    const link = page.getByRole("link", { name: SOULS[0].name }).first();
    await expect(link).toBeVisible();
    await expect(page.locator(".animate-page-enter")).toHaveCount(1);
    await recordAnimations(page);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/souls/${SOULS[0].id}$`));
    // Client navigation: the recorder installed above survived, so this was not a reload.
    await expect.poll(() => started(page)).toContain("page-enter-again");
    const wrapper = page.locator(".animate-page-enter-again");
    await expect(wrapper).toHaveCount(1);
    expect(await wrapper.evaluate((el) => getComputedStyle(el).animationDuration)).toBe("0.24s");
  });

  test("an expandable row opens over 200ms on grid-template-rows, and instantly under reduced motion", async ({ page }) => {
    for (const reduced of [false, true]) {
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await setupAuthenticatedPage(page);
      await page.goto("/scheduler");
      await page.locator('li[data-job-id="2"]').getByRole("button", { name: "执行记录" }).click();
      const failure = page.getByRole("dialog").locator('[data-run-status="FAILURE"]');
      await recordAnimations(page);
      await failure.getByRole("button", { name: "展开错误" }).click();

      const shell = failure.locator(".row-expand");
      await expect(shell.getByText(/ValueError: ledger row 42 has no soul/)).toBeVisible();
      await expect.poll(() => started(page)).toContain("row-expand");
      expect(await shell.evaluate((el) => getComputedStyle(el).display)).toBe("grid");
      expect(await shell.evaluate((el) => getComputedStyle(el).animationDuration)).toBe(reduced ? "0.001s" : "0.2s");
      // Once open, nothing is clipped: overflow is hidden only while the animation runs.
      await expect.poll(() => shell.evaluate((el) => getComputedStyle(el).overflow)).toBe("visible");
    }
  });
});
