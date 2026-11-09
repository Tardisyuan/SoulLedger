/**
 * `/dashboard` 的 KPI 卡悬停(`StatCard.tsx` 的 `.kpi-fx`,globals.css):指针悬停时卡片上浮 2px、带一圈光、
 * 扫过一道金属光;只在 `(hover: hover) and (pointer: fine)` 下;减少动态效果时不动。
 *
 * 只能是 E2E:jsdom 不算 `:hover` 也不算层叠后的 transform。判据两条 ——
 * 浮起来的是 transform(合成层),不是布局:卡片自己的 offsetHeight / offsetTop 不变,同一行别的卡不被推开。
 */
import { expect, test, setupAuthenticatedPage } from "./fixtures";

async function openKpis(page: import("@playwright/test").Page) {
  await setupAuthenticatedPage(page);
  await page.goto("/dashboard?tab=more"); // KPI 条在「更多」里(同 kpi-row-does-not-jump-when-data-lands.spec.ts)
  await expect(page.locator("[data-kpi]")).toHaveCount(5); // 数据落地:之后卡片高度不再变
  const card = page.locator("[data-kpi-card].kpi-fx").first();
  await expect(card).toBeVisible();
  await page.mouse.move(0, 0);
  return card;
}

const box = (card: import("@playwright/test").Locator) =>
  card.evaluate((el) => ({ h: (el as HTMLElement).offsetHeight, top: (el as HTMLElement).offsetTop }));
const transform = (card: import("@playwright/test").Locator) => card.evaluate((el) => getComputedStyle(el).transform);

test("KPI 卡悬停:transform 上浮,布局高度不变", async ({ page, isMobile }) => {
  test.skip(isMobile, "触屏没有 (hover: hover) and (pointer: fine),悬停效果按设计不生效");
  const card = await openKpis(page);
  expect(await transform(card)).toBe("none");
  const before = await box(card);
  expect(before.h).toBeGreaterThan(0);

  await card.hover();
  // 0.25s 过渡:等到终值,translateY(-2px) 的矩阵。
  await expect.poll(() => transform(card)).toBe("matrix(1, 0, 0, 1, 0, -2)");
  expect(await card.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
  expect(await box(card)).toEqual(before);

  await page.mouse.move(0, 0);
  await expect.poll(() => transform(card)).toBe("none");
});

test("KPI 卡悬停:减少动态效果时 transform 始终是 none", async ({ page, isMobile }) => {
  test.skip(isMobile, "触屏上本来就没有悬停效果,这条量不出东西");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const card = await openKpis(page);
  const before = await box(card);

  await card.hover();
  // 先确认悬停真的落在卡上 —— 不然下面那条 none 量的是一张没被悬停的卡。
  expect(await card.evaluate((el) => el.matches(":hover"))).toBe(true);
  // 减少动态效果下 `transition: none`,计算值当场就是终值,不用等。
  expect(await transform(card)).toBe("none");
  expect(await box(card)).toEqual(before);
});
