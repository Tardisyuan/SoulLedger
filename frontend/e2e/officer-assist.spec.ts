import { test, expect, setupAuthenticatedPage } from "./fixtures";

/**
 * 「问一问」 in a real layout engine (canvas 「灵魂簿 官员端 · 问一问」 1a 一, 1g).
 * jsdom has no layout, so the push itself — the page really giving up 420 px,
 * the 1024–1279 padding really dropping to 24 — is only checkable here.
 */

test.describe("问一问", () => {
  test("≥ 1280: the panel pushes the page, and a question gets its answer", async ({ page }) => {
    const api = await setupAuthenticatedPage(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/judgment");

    await page.getByTestId("officer-assist-entry").click();
    const panel = page.getByRole("complementary", { name: "问一问" });
    await expect(panel).toBeVisible();
    const [p, content] = [await panel.boundingBox(), await page.getByTestId("app-content").boundingBox()];
    expect(Math.round(p!.width)).toBe(420);
    expect(Math.round(p!.x + p!.width)).toBe(1440);
    // The page's content box ends where the panel starts: pushed, not covered.
    expect(content!.x + content!.width - 420).toBeLessThanOrEqual(p!.x + 1);

    const box = panel.getByRole("textbox");
    await expect(box).toBeFocused();
    await box.fill("我的队列有多少？");
    await box.press("Enter");
    await expect(panel.getByText("答：我的队列有多少？")).toBeVisible();
    expect(api.lastCall("POST", "/assist/")?.body).toEqual({ question: "我的队列有多少？", screen: "judgment" });

    await box.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByTestId("officer-assist-entry")).toBeFocused();
  });

  test("Design E 组: the head is 48 px on an ink rule, and the panel starts below the connection bar", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/judgment");
    // Nothing serves /ws in this suite, so the bar always comes up.
    const bar = page.getByTestId("connection-banner");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("officer-assist-entry").click();
    const panel = page.getByRole("complementary", { name: "问一问" });
    await expect(panel).toBeVisible();

    const b = (await bar.boundingBox())!;
    // Global state, top of the viewport, the whole width — pillar and panel included.
    expect(Math.round(b.x)).toBe(0);
    expect(Math.round(b.y)).toBe(0);
    expect(Math.round(b.width)).toBe(1440);
    const p = (await panel.boundingBox())!;
    expect(Math.round(p.y)).toBe(Math.round(b.y + b.height));

    const head = panel.getByTestId("officer-assist-head");
    expect(Math.round((await head.boundingBox())!.height)).toBe(48);
    await expect(head).toHaveCSS("border-bottom-width", "1px");
  });

  test("1200–1279: still pushed (720 left beside the panel), with the page's side padding at 24", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.setViewportSize({ width: 1260, height: 900 });
    await page.goto("/judgment");
    // v2 PageShell: `md:px-8` (32 px); v1's was `md:px-10`.
    const padded = page.getByTestId("app-content").locator("[class~='md:px-8']").first();
    await expect(padded).toHaveCSS("padding-left", "32px");
    await page.getByTestId("officer-assist-entry").click();
    await expect(page.getByRole("complementary", { name: "问一问" })).toBeVisible();
    await expect(padded).toHaveCSS("padding-left", "24px");
  });

  test("Design E 组: a wide viewport whose main column would keep < 720 beside the panel gets the overlay, not the push", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto("/judgment");
    const content = page.getByTestId("app-content");
    const before = (await content.boundingBox())!;
    expect(before.width - 420).toBeLessThan(720);

    await page.getByTestId("officer-assist-entry").click();
    const drawer = page.getByRole("dialog", { name: "问一问" });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("complementary", { name: "问一问" })).toHaveCount(0);
    // Not pushed: the page keeps its width, and the panel lies over it.
    expect(Math.round((await content.boundingBox())!.width)).toBe(Math.round(before.width));
    await expect(content).not.toHaveAttribute("data-assist-pushed", "");
  });

  test("< 1024: a modal drawer over a scrim", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/judgment");
    await page.getByTestId("officer-assist-entry").click();
    const drawer = page.getByRole("dialog", { name: "问一问" });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("complementary", { name: "问一问" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page.getByTestId("officer-assist-entry")).toBeFocused();
  });
});
