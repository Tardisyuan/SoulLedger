import { test, expect, setupAuthenticatedPage } from "./fixtures";

/**
 * The editor tab fills the viewport below the identity band (用户 2026-10-02): at 1440×900
 * its bottom edge is the viewport's, and the ten-node preset lands inside the canvas.
 * The frame was `100vh-220px`, written before the v3 band (52 + 156) pushed the editor's
 * top to ~355px — so its bottom ran ~135px below the fold.
 */
test.use({ viewport: { width: 1440, height: 900 } });

test("at 1440×900 the editor ends at the viewport's bottom edge and the ten-node preset fits", async ({ page }, info) => {
  test.skip(info.project.name === "mobile-chrome", "below 1024 the editor is the read-only document view");
  await setupAuthenticatedPage(page);
  await page.goto("/workflow");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(10);

  const m = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="workflow-editor-frame"]')!.getBoundingClientRect();
    const pane = document.querySelector(".react-flow")!.getBoundingClientRect();
    const outside = [...document.querySelectorAll(".react-flow__node")]
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.top < pane.top - 1 || r.bottom > pane.bottom + 1 || r.left < pane.left - 1 || r.right > pane.right + 1);
    return { bottom: frame.bottom, vh: window.innerHeight, outside: outside.length };
  });
  // Ends on the viewport's bottom edge: not below it (cut off), not well above it (wasted).
  expect(m.bottom).toBeLessThanOrEqual(m.vh + 1);
  expect(m.bottom).toBeGreaterThanOrEqual(m.vh - 8);
  expect(m.outside).toBe(0);
});
