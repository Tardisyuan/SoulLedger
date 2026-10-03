import { test, expect, setupAuthenticatedPage } from "./fixtures";

/**
 * The editor tab fills the viewport below the identity band (用户 2026-10-02): at 1440×900
 * its bottom edge sits PageShell's 24px `py-6` above the viewport's, the page does not
 * scroll, and the ten-node preset lands inside the canvas.
 * The frame was `100vh-220px`, written before the v3 band (52 + 156) pushed the editor's
 * top to ~355px — so its bottom ran ~135px below the fold.
 *
 * The page used to be taller than the viewport (doc 1068 at 1440×900): AppLayout's content
 * wrapper was `min-h-[calc(100vh-2.5rem)]`, older than the 208px masthead, so the window
 * could scroll by 168px. It is now `min-h-(--content-min-h)` (viewport − toolbar − band), and
 * the frame takes the page's bottom padding into account, so the document is one viewport.
 * Measured at scroll 0, after the band has settled. The one red this test had (2026-10-02, bottom 882 vs
 * ≥ 892, while the page could still scroll) was a scrolled window: reproduced once at scrollY = 18 — body at −18,
 * frame top 337 instead of 355, height unchanged at 545. What scrolled it is NOT known: it did
 * not recur in ~130 reruns (12 of them logging every scroll event and scrollTo / scrollBy /
 * scrollIntoView / focus call — none; 50 at load ~43 under `DEBUG=pw:api` — no click retry,
 * no extra scroll-into-view; CPU throttled ×6 / ×8; fonts delayed 2.5 s). The claim here is
 * about the layout at the top of the page, so the test puts the window there and waits for
 * the band to finish expanding (it collapses past 60px and animates its height) before it
 * reads anything. The tolerances are the original ones, moved up by the 24px padding.
 */
test.use({ viewport: { width: 1440, height: 900 } });

test("at 1440×900 the editor ends at the viewport's bottom edge and the ten-node preset fits", async ({ page }, info) => {
  test.skip(info.project.name === "mobile-chrome", "below 1024 the editor is the read-only document view");
  await setupAuthenticatedPage(page);
  await page.goto("/workflow");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(10);

  const scrolledBy = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByTestId("plaque")).not.toHaveAttribute("data-compact");
  const m = await page.evaluate(async () => {
    // Two consecutive frames with the same frame rect and band height: the band's height
    // transition (and the `--identity-band` var it writes) has finished.
    const read = () => {
      const r = document.querySelector('[data-testid="workflow-editor-frame"]')!.getBoundingClientRect();
      return `${r.top},${r.bottom},${(document.querySelector('[data-testid="plaque"]') as HTMLElement).offsetHeight}`;
    };
    const frameTick = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let prev = "", i = 0; i < 120; i++) {
      await frameTick();
      const now = read();
      if (now === prev) break;
      prev = now;
    }
    const frame = document.querySelector('[data-testid="workflow-editor-frame"]')!.getBoundingClientRect();
    const pane = document.querySelector(".react-flow")!.getBoundingClientRect();
    const outside = [...document.querySelectorAll(".react-flow__node")]
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.top < pane.top - 1 || r.bottom > pane.bottom + 1 || r.left < pane.left - 1 || r.right > pane.right + 1);
    // The palette's keyboard hint is inside the palette's box, not below it (用户 2026-10-02:
    // it ran ~40px past the bottom edge).
    const palette = document.querySelector('[data-testid="workflow-editor-frame"] nav')!.getBoundingClientRect();
    const hint = document.querySelector("[data-palette-hint]")!.getBoundingClientRect();
    return {
      bottom: frame.bottom, top: frame.top, y: window.scrollY, vh: window.innerHeight, outside: outside.length,
      doc: document.documentElement.scrollHeight, hintBottom: hint.bottom, hintTop: hint.top, paletteBottom: palette.bottom,
    };
  });
  const seen = `frame ${m.top}–${m.bottom} at scrollY ${m.y} (the window had been scrolled by ${scrolledBy} before the reset)`;
  // Ends one page-padding (24) above the viewport's bottom edge: not below it (cut off), not
  // well above it (wasted) — and the document is exactly one viewport tall.
  expect(m.y, seen).toBe(0);
  expect(m.bottom, seen).toBeLessThanOrEqual(m.vh - 24 + 1);
  expect(m.bottom, seen).toBeGreaterThanOrEqual(m.vh - 24 - 8);
  expect(m.doc, `document ${m.doc} in a ${m.vh} viewport`).toBeLessThanOrEqual(m.vh);
  expect(m.outside).toBe(0);
  expect(m.hintBottom, `hint ${m.hintTop}–${m.hintBottom}, palette ends ${m.paletteBottom}`).toBeLessThanOrEqual(m.paletteBottom + 0.5);
});
