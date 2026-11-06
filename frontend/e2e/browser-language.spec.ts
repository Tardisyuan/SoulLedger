import { expect, test } from "@playwright/test";

/** The rule: a browser whose language starts with zh gets Chinese, every other gets English, and a choice sticks. */
test.describe("in an English browser", () => {
  test.use({ locale: "en-GB" });
  test("the first document is already English", async ({ page }) => {
    const res = await page.goto("/");
    expect(await res?.text()).toContain('lang="en');
    await expect(page.locator("html")).toHaveAttribute("lang", /^en/);
  });
  test("a choice outlives the browser's language", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("combobox").filter({ visible: true }).first().selectOption("zh-Hans");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("同一个问题：这个灵魂过得了关吗？");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", /^zh/);
  });
});

test.describe("in a Chinese browser", () => {
  test.use({ locale: "zh-TW" });
  test("zh of any region is Chinese", async ({ page }) => {
    const res = await page.goto("/");
    expect(await res?.text()).toContain('lang="zh');
  });
});

test.describe("in a French browser", () => {
  test.use({ locale: "fr-FR" });
  test("anything else is English, never Kemet", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", /^en/);
  });
});

test("the landing page keeps its margins at 1280 and links a card to sign-in", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const box = await page.getByRole("heading", { level: 1 }).boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(64);
  await page.getByTestId("landing-card-eg").click();
  await expect(page).toHaveURL(/\/login\?civ=eg$/);
  await expect(page.locator("html")).toHaveAttribute("data-civ", "eg");
});
