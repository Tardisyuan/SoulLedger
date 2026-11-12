/**
 * The connection banner must not move the page when it appears.
 *
 * It shows up a moment after load, once the socket has failed (always, in
 * this suite: nothing serves /ws). While it sat in the flow it pushed the
 * page down ~28 px at that moment, and a click aimed just before landed on
 * empty space: `avatar-upload.spec.ts` clicked 编辑资料, missed, and timed out
 * waiting for the dialog, 1 run in 16. Design E 组 then floated it `fixed` across the
 * top of the viewport, where it covered the top of every toolbar button; an in-flow
 * try pushed the page 28px again and was reverted (`44ca2db4`). v4 第八批: it is a pill
 * inside the 52px toolbar (≤ 768: floating under the toolbar's edge), so it takes no
 * height anywhere. This pins that: the content starts where the masthead ends.
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

  // 第三十批: the masthead is the 52 px toolbar, then the page (its page head — topline and title — is the top of
  // the page itself). The banner pushes neither: the toolbar sits at the very top, the page starts where it ends, and
  // the page head is the first thing in the page.
  const header = await page.getByTestId("global-topbar").boundingBox();
  const content = await page.getByTestId("app-content").boundingBox();
  const head = await page.getByTestId("page-head").boundingBox();
  expect(header, "no masthead box").not.toBeNull();
  expect(content, "no content box").not.toBeNull();
  expect(head, "no page head box").not.toBeNull();
  expect(Math.round(header!.y), `the toolbar starts at y=${header!.y}, under the banner's height`).toBe(0);
  // The toolbar keeps its 52px with the pill in it, and the pill is inside it (desktop project).
  expect(Math.round(header!.height)).toBe(52);
  const pill = await banner.boundingBox();
  if ((page.viewportSize()?.width ?? 0) > 768) {
    expect(pill!.y).toBeGreaterThanOrEqual(header!.y);
    expect(pill!.y + pill!.height).toBeLessThanOrEqual(header!.y + header!.height);
  }
  expect(
    Math.abs(content!.y - (header!.y + header!.height)),
    `content starts at y=${content!.y}, masthead ends at y=${header!.y + header!.height}`
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(head!.y - content!.y), `page head starts at y=${head!.y}, content at y=${content!.y}`).toBeLessThanOrEqual(1);
});
