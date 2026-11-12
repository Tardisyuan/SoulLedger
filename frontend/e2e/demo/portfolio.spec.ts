import { expect, test } from "@playwright/test";
import { clean, enter, watch } from "./support";

// 2026-11-12 作品集建议 A1:演示首页有「这是怎么做的」(正式版落地页的同一个组件),导览结尾的链接到得了它。
test("the home page shows how it was built: architecture, test counts, the two app recordings", async ({ page, context }) => {
  const seen = watch(context, page);
  await page.goto("/");
  const section = page.locator("#how-built");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByTestId("landing-architecture")).toBeVisible();
  await expect(section.getByTestId("landing-numbers").locator("dd")).toHaveCount(5);
  await expect(section.locator("video")).toHaveCount(2);
  clean(seen, "home how-built");
});

test("the finished tour's 「这是怎么做的」 lands on that section, not on a missing anchor", async ({ page, context }) => {
  const seen = watch(context, page);
  await enter(page, "judge_eu");
  await page.getByTestId("demo-tour-skip").click();
  await page.getByTestId("demo-tour-how-built").click();
  await page.waitForURL((u) => u.pathname === "/" && u.hash === "#how-built");
  await expect(page.locator("#how-built")).toBeInViewport();
  clean(seen, "tour how-built link");
});
