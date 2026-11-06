import { expect, test } from "@playwright/test";
import { clean, enter, watch } from "./support";

test("the landing page's two app recordings load", async ({ page }) => {
  await page.goto("/");
  const videos = page.locator("#how-built video");
  await expect(videos).toHaveCount(2);
  for (const video of await videos.all()) {
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  }
});

test("the landing page's footer opens the credits without signing in", async ({ page }) => {
  await page.goto("/");
  await page.locator('footer a[href="/about"]').click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.locator("main")).toContainText("SoulLedger Glyphs");
  await expect(page.locator("main")).toContainText("Claude Code");
});

test("393px: the landing page and sign-in work and nothing overflows", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  await expect(page.getByTestId("demo-github")).toBeVisible();
  await expect(page.getByTestId("demo-github")).toHaveAttribute("href", "https://github.com/Tardisyuan/SoulLedger");
  await enter(page, "judge");
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
  clean(seen, "393 landing");
});

test("393px: claiming a case", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  await page.goto("/judgment");
  const row = page.getByTestId("queue-group-unclaimed").getByTestId("queue-row").filter({ has: page.getByRole("button", { name: "认领", exact: true }) }).first();
  const name = (await row.getByRole("link").first().innerText()).trim();
  await row.getByRole("button", { name: "认领", exact: true }).click();
  await expect(page.getByTestId("queue-group-mine").getByText(name)).toBeVisible();
  clean(seen, "393 claim");
});

test("393px: a post", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "moderator");
  await page.goto("/social");
  await page.getByRole("button", { name: /发帖/ }).click();
  await page.getByPlaceholder("今天想说点什么").filter({ visible: true }).fill("窄屏发帖。");
  await page.getByRole("button", { name: "发布" }).filter({ visible: true }).click();
  await expect(page.locator("main").getByText("窄屏发帖。").first()).toBeVisible();
  clean(seen, "393 post");
});

test("393px: the tour fits above the fold and reaches its second step", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  await page.getByTestId("landing-card-cn").click();
  const card = page.getByTestId("demo-tour");
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(393);
  expect(box?.height).toBeLessThanOrEqual(page.viewportSize()!.height * 0.42);
  await page.getByTestId("demo-tour-next").click();
  await expect(page.getByTestId("demo-tour-progress")).toContainText("2 / 6");
  clean(seen, "393 tour");
});

test("393px: the soul entrance fills the screen under a 40px strip, nothing overflows", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  await page.getByTestId("demo-soul-gr").click();
  const strip = await page.getByTestId("demo-soul-strip").boundingBox();
  expect(strip && Math.round(strip.height)).toBe(40);
  await expect(page.getByTestId("demo-soul-phone")).toBeHidden();
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
  await page.getByTestId("demo-soul-back-short").click();
  await page.waitForURL((u) => u.pathname !== "/");
  await expect(page.locator("html")).toHaveAttribute("data-civ", "gr");
  clean(seen, "393 soul entrance");
});
