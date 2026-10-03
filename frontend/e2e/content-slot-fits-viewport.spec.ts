import { expect, test, setupAuthenticatedPage } from "./fixtures";

/**
 * A page whose content is short is exactly one viewport tall (用户 2026-10-02).
 *
 * AppLayout's content slot had `min-h-[calc(100vh-2.5rem)]`, written before the v3 masthead
 * (52px toolbar + 156px identity band): every short page was 168px taller than the window
 * (and 56px more below 769, where `main` pads for the bottom bar), so it scrolled onto
 * nothing. The slot now takes `--content-min-h` (globals.css: viewport − `--below-band` −
 * `--bottom-bar`). Measured 2026-10-02 over 30 routes: every page that was shorter than the
 * window is now exactly the window, at 1440×900 and at 393×852.
 *
 * /recycle-bin and /audit are short under the e2e fixtures (an empty bin, an empty log). The
 * floor is asserted as well: the slot must still fill the window, or an empty state would sit
 * in a page that ends half-way down.
 */
for (const [w, h] of [[1440, 900], [393, 852]] as const) {
  for (const path of ["/recycle-bin", "/audit"]) {
    test(`${path} at ${w}×${h} is one viewport tall`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await setupAuthenticatedPage(page);
      await page.goto(path);
      await expect(page.getByTestId("plaque")).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight), { timeout: 5_000 })
        .toBe(h);
    });
  }
}
