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

  test("1024–1279: still pushed, with the page's side padding at 24", async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.goto("/judgment");
    const padded = page.getByTestId("app-content").locator("[class~='md:px-10']").first();
    await expect(padded).toHaveCSS("padding-left", "40px");
    await page.getByTestId("officer-assist-entry").click();
    await expect(page.getByRole("complementary", { name: "问一问" })).toBeVisible();
    await expect(padded).toHaveCSS("padding-left", "24px");
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
