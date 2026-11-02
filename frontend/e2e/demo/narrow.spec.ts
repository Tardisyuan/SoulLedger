import { expect, test } from "@playwright/test";
import { clean, enter, watch } from "./support";

test("393px: the landing page and sign-in work and nothing overflows", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  await expect(page.getByTestId("demo-banner")).toBeVisible();
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
  await page.getByTestId("demo-tour-back").click();
  await page.getByTestId("demo-tour-next").click();
  await expect(page.getByTestId("demo-tour-progress")).toContainText("2 / 6");
  clean(seen, "393 tour");
});
