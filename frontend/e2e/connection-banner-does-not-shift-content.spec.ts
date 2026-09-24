/**
 * The connection banner must not move the page when it appears.
 *
 * It shows up a moment after load, once the socket has failed (always, in
 * this suite: nothing serves /ws). While it sat in the flow it pushed the
 * page down ~28 px at that moment, and a click aimed just before landed on
 * empty space: `avatar-upload.spec.ts` clicked 编辑资料, missed, and timed out
 * waiting for the dialog, 1 run in 16. It now floats in a zero-height sticky
 * anchor over the page's top padding (AppLayout). This pins that: the page
 * title's position is the same before and after the banner appears.
 */
import { expect, test, setupAuthenticatedPage } from "./fixtures";

// Measured with the banner ON screen, not before/after: it can appear before
// the page's own title does, so a before/after comparison saw the banner in
// both readings and stayed green with the banner back in the flow (tried).
// The invariant that holds regardless of timing: the content starts where
// the masthead ends — the banner occupies no layout height.
test("the connection banner takes no layout space: content starts right under the masthead", async ({ page }) => {
  await setupAuthenticatedPage(page);
  await page.goto("/souls");
  const banner = page.getByRole("status").filter({ hasText: /重连中|连接失败|已断开/ });
  await expect(banner).toBeVisible({ timeout: 15_000 });

  const header = await page.locator("header").first().boundingBox();
  const content = await page.getByTestId("app-content").boundingBox();
  expect(header, "no masthead box").not.toBeNull();
  expect(content, "no content box").not.toBeNull();
  expect(
    Math.abs(content!.y - (header!.y + header!.height)),
    `content starts at y=${content!.y}, masthead ends at y=${header!.y + header!.height}`
  ).toBeLessThanOrEqual(1);
});
