import { expect, test } from "@playwright/test";
import { clean, enter, expectSealHandedOver, handOff, recording, rows, watch, watchHandOff } from "./support";

// Narrow, the journey preview is a still frame that a tap plays once. (第二十七批 took the 「怎么做的」 section off the demo's
// home page; 2026-11-12 A1 put it back, below the roles.)
test("393px: the journey preview is a still frame until tapped", async ({ page }) => {
  await page.goto("/");
  const preview = page.getByTestId("demo-home-preview");
  await expect(preview).toHaveAttribute("data-mode", /still|manual/);
  await expect(preview.getByTestId("soul-journey")).toBeVisible();
  if ((await preview.getAttribute("data-mode")) === "still") {
    await page.getByTestId("demo-home-preview-play").click();
    await expect(preview).toHaveAttribute("data-shown", "cn");
  }
});

test("393px: 「这是怎么做的」 is on the home page and nothing in it overflows", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#how-built");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByTestId("landing-numbers")).toBeVisible();
  const box = await section.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(393);
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
});

test("393px: the safeguards tour's overreach answer fits the card and the page does not scroll sideways", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  await page.getByTestId("demo-home-guard").click();
  await page.waitForURL((u) => u.pathname === "/tenants");
  await page.getByTestId("demo-tour-next").click();
  await page.getByTestId("demo-tour-next").click();
  await page.getByTestId("demo-overreach-try-vertical").click();
  const answer = page.getByTestId("demo-overreach-answer-vertical");
  await answer.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("demo-overreach-status-vertical")).toHaveText("403");
  const box = await page.getByTestId("demo-tour").boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(393);
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
  clean(seen, "393 overreach");
});

test("393px: a case's 「并发与事务」 opens as a sheet that fits, and its 409 shows", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge");
  const open = rows(recording("judge"), "/judgment/").find((j) => !j.is_final && j.verdict == null)!;
  await page.goto(`/judgment/${open.id}`);
  await page.getByTestId("demo-txn-open").click();
  await page.getByTestId("demo-txn-try").scrollIntoViewIfNeeded();
  await page.getByTestId("demo-txn-try").click();
  await expect(page.getByTestId("demo-txn-status")).toHaveText("409");
  const box = await page.getByTestId("demo-txn").boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(393);
  clean(seen, "393 transactions card");
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

test("393px: the cover's seal lands on the page head's civilization mark (the bottom bar draws no brand mark)", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await watchHandOff(page);
  await page.getByTestId("landing-card-eg").click();
  expectSealHandedOver(await handOff(page));
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
  // fe-mobile 3.1: one line by default, standing on the door bar, not over it.
  await expect(card).toHaveAttribute("data-folded", "");
  expect(box!.height).toBeLessThanOrEqual(50);
  const rail = (await page.getByTestId("door-rail").boundingBox())!;
  expect(box!.y + box!.height).toBeLessThanOrEqual(rail.y + 1);
  await page.getByTestId("demo-tour-next").click();
  await expect(page.getByTestId("demo-tour-progress")).toContainText("2 / 6");
  // Unfolded, it is the full card, still above the door bar.
  await page.getByTestId("demo-tour-unfold").click();
  await expect(card).not.toHaveAttribute("data-folded", "");
  const full = (await card.boundingBox())!;
  expect(full.y + full.height).toBeLessThanOrEqual(rail.y + 1);
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

test.describe("in English", () => {
  test.use({ locale: "en-US" });
  // Egypt's Field of Reeds is the one near-full realm in the recordings: its 「◐ nearly full」 sat in a 44px box sized for
  // 「◐ 将满」 and spilled 35px past the card, so the phone's layout viewport grew to 399 and the door bar ended below the
  // screen. On a phone that shows as innerWidth, not as scrollWidth - innerWidth (the viewport grows to fit), so read both.
  test("393px: the Egyptian realms page does not widen the page", async ({ page }) => {
    await enter(page, "judge_eg");
    await page.goto("/realms");
    await expect(page.locator('[data-realm-card="EG_AARU"] [data-load="near"]')).toBeVisible();
    await page.getByTestId("underworld-map").locator("svg").first().waitFor();
    const { inner, scroll } = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(inner).toBe(393);
    expect(scroll).toBeLessThanOrEqual(393);
  });
});
